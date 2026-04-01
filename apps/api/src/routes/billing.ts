import { Hono } from 'hono';
import { BILLING_PLANS, getBillingPlan } from '../config/plans';
import type { Env } from '../types';
import { getWorkspaceId } from '../lib/workspace';
import { hasTmwConfig, createPay, detailPay, confirmPay, cancelPay } from '../lib/tmw-gateway';

const app = new Hono<{ Bindings: Env }>();

function isTmwSuccess(status: unknown): boolean {
    return Number(status) === 1;
}

app.get('/plans', (c) => {
    return c.json({
        success: true,
        plans: BILLING_PLANS,
    });
});

app.get('/current', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const subscription = await c.env.DB.prepare(`
        SELECT id, workspace_id, plan_code, status, billing_interval, amount_thb, currency, started_at, current_period_end, created_at, updated_at
        FROM organization_subscriptions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).bind(workspaceId).first<any>();

    const latestOrder = await c.env.DB.prepare(`
        SELECT id, workspace_id, plan_code, billing_interval, amount_thb, currency, status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).bind(workspaceId).first<any>();

    return c.json({
        success: true,
        subscription: subscription ? {
            ...subscription,
            plan: getBillingPlan(subscription.plan_code),
        } : null,
        latestOrder,
    });
});

app.post('/checkout-intent', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const body = await c.req.json();
    const plan = getBillingPlan(body.planCode);
    if (!plan) {
        return c.json({ success: false, error: 'Invalid planCode' }, 400);
    }

    const subscriptionId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const now = new Date();

    // เช็ค subscription เดิมที่ยังเหลือวัน → +วัน แทน reset
    const existingSub = await c.env.DB.prepare(`
        SELECT current_period_end FROM organization_subscriptions
        WHERE workspace_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
    `).bind(workspaceId).first<{ current_period_end: string | null }>();

    const baseDate = (existingSub?.current_period_end && new Date(existingSub.current_period_end) > now)
        ? new Date(existingSub.current_period_end)
        : now;
    const currentPeriodEnd = new Date(baseDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO organization_subscriptions (
                id, workspace_id, plan_code, status, billing_interval, amount_thb, currency,
                started_at, current_period_end, created_at, updated_at
            ) VALUES (?, ?, ?, 'pending_payment', ?, ?, 'THB', ?, ?, ?, ?)
        `).bind(
            subscriptionId,
            workspaceId,
            plan.code,
            plan.interval,
            plan.amountThb,
            now.toISOString(),
            currentPeriodEnd,
            now.toISOString(),
            now.toISOString(),
        ),
        c.env.DB.prepare(`
            INSERT INTO payment_orders (
                id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb,
                currency, status, expires_at, payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'THB', 'pending', ?, ?, ?, ?)
        `).bind(
            orderId,
            workspaceId,
            subscriptionId,
            plan.code,
            plan.interval,
            plan.amountThb,
            expiresAt,
            JSON.stringify({
                manualCheckout: true,
                gatewayReady: false,
                amountThb: plan.amountThb,
            }),
            now.toISOString(),
            now.toISOString(),
        ),
    ]);

    return c.json({
        success: true,
        subscription: {
            id: subscriptionId,
            workspaceId,
            status: 'pending_payment',
            planCode: plan.code,
            interval: plan.interval,
            amountThb: plan.amountThb,
            currentPeriodEnd,
        },
        paymentOrder: {
            id: orderId,
            status: 'pending',
            amountThb: plan.amountThb,
            expiresAt,
        },
    });
});

// สร้าง payment ผ่าน TMW แม่มณี → ได้ QR code กลับมา
app.post('/create-payment', async (c) => {
    const workspaceId = getWorkspaceId(c);

    if (!hasTmwConfig(c.env)) {
        return c.json({ success: false, error: 'Payment gateway not configured' }, 503);
    }

    const body = await c.req.json();
    const orderId = String(body.orderId || '').trim();
    if (!orderId) {
        return c.json({ success: false, error: 'Missing orderId' }, 400);
    }

    const order = await c.env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, amount_thb, status, gateway_reference
        FROM payment_orders
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
    `).bind(orderId, workspaceId).first<{
        id: string;
        workspace_id: string;
        subscription_id: string;
        amount_thb: number;
        status: string;
        gateway_reference: string | null;
    }>();

    if (!order) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }
    if (order.status === 'paid') {
        return c.json({ success: false, error: 'Order already paid' }, 409);
    }

    // ถ้ามี gateway_reference อยู่แล้ว ดึง detail เลย ไม่ต้อง create ใหม่
    if (order.gateway_reference) {
        const detail = await detailPay(c.env, order.gateway_reference, true);
        if (isTmwSuccess(detail.status)) {
            return c.json({
                success: true,
                orderId: order.id,
                idPay: order.gateway_reference,
                amount: detail.amount,
                urlpay: detail.urlpay,
                qrBase64: detail.qr_base64_image || null,
                timeOut: detail.time_out,
            });
        }
    }

    // สร้าง payment ใหม่ที่ TMW
    let ref1 = `pubilo-${orderId.slice(0, 8)}`;
    let created = await createPay(c.env, order.amount_thb, ref1);
    if (!isTmwSuccess(created.status) || !created.id_pay) {
        // Retry once with unique ref1 in case gateway rejects duplicate references.
        ref1 = `pubilo-${orderId.slice(0, 6)}-${Date.now().toString().slice(-6)}`;
        created = await createPay(c.env, order.amount_thb, ref1);
    }
    if (!isTmwSuccess(created.status) || !created.id_pay) {
        return c.json({
            success: false,
            error: created.msg || 'TMW create_pay failed',
            errorType: 'TMW_CREATE_PAY_FAILED',
        }, 502);
    }

    // ดึง QR code
    const detail = await detailPay(c.env, created.id_pay, true);
    if (!isTmwSuccess(detail.status)) {
        return c.json({
            success: false,
            error: detail.msg || 'TMW detail_pay failed',
            errorType: 'TMW_DETAIL_PAY_FAILED',
        }, 502);
    }

    // บันทึก gateway_reference ลง DB
    await c.env.DB.prepare(`
        UPDATE payment_orders
        SET gateway = 'tmw_maemanee',
            gateway_reference = ?,
            qr_reference = ?,
            payload_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(
        created.id_pay,
        ref1,
        JSON.stringify({
            tmwIdPay: created.id_pay,
            urlpay: detail.urlpay,
            ref1,
            amountThb: order.amount_thb,
        }),
        orderId,
    ).run();

    return c.json({
        success: true,
        orderId: order.id,
        idPay: created.id_pay,
        amount: detail.amount,
        urlpay: detail.urlpay,
        qrBase64: detail.qr_base64_image || null,
        timeOut: detail.time_out,
    });
});

// เช็คสถานะ payment — frontend poll endpoint นี้
app.get('/payment-status/:orderId', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const orderId = c.req.param('orderId');

    const order = await c.env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, amount_thb, status, gateway_reference, paid_at
        FROM payment_orders
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
    `).bind(orderId, workspaceId).first<{
        id: string;
        workspace_id: string;
        subscription_id: string;
        amount_thb: number;
        status: string;
        gateway_reference: string | null;
        paid_at: string | null;
    }>();

    if (!order) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }

    if (order.status === 'paid') {
        return c.json({ success: true, status: 'paid', paidAt: order.paid_at });
    }

    if (!order.gateway_reference || !hasTmwConfig(c.env)) {
        return c.json({ success: true, status: order.status });
    }

    // เรียก confirm ที่ TMW
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
    const result = await confirmPay(c.env, order.gateway_reference, clientIp);

    if (isTmwSuccess(result.status)) {
        const now = new Date().toISOString();
        await c.env.DB.batch([
            c.env.DB.prepare(`
                UPDATE payment_orders
                SET status = 'paid', paid_at = ?, updated_at = ?
                WHERE id = ?
            `).bind(now, now, orderId),
            c.env.DB.prepare(`
                UPDATE organization_subscriptions
                SET status = 'active', updated_at = ?
                WHERE id = ?
            `).bind(now, order.subscription_id),
        ]);

        return c.json({ success: true, status: 'paid', paidAt: now });
    }

    const detail = await detailPay(c.env, order.gateway_reference, false);
    if (detail.time_out !== undefined && detail.time_out < 0) {
        return c.json({ success: true, status: 'expired', timeOut: detail.time_out });
    }

    return c.json({ success: true, status: 'pending', timeOut: detail.time_out });
});

// ยกเลิก payment order ที่หมดเวลา
app.post('/cancel-payment', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const body = await c.req.json();
    const orderId = String(body.orderId || '').trim();

    if (!orderId) {
        return c.json({ success: false, error: 'Missing orderId' }, 400);
    }

    const order = await c.env.DB.prepare(`
        SELECT id, gateway_reference, status
        FROM payment_orders
        WHERE id = ? AND workspace_id = ?
        LIMIT 1
    `).bind(orderId, workspaceId).first<{
        id: string;
        gateway_reference: string | null;
        status: string;
    }>();

    if (!order) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }
    if (order.status === 'paid') {
        return c.json({ success: false, error: 'Cannot cancel paid order' }, 409);
    }

    if (order.gateway_reference && hasTmwConfig(c.env)) {
        await cancelPay(c.env, order.gateway_reference).catch(() => {});
    }

    await c.env.DB.prepare(`
        UPDATE payment_orders
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(orderId).run();

    return c.json({ success: true });
});

// Cancel subscription
app.post('/cancel', async (c) => {
    const workspaceId = getWorkspaceId(c);

    const subscription = await c.env.DB.prepare(`
        SELECT id, status
        FROM organization_subscriptions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).bind(workspaceId).first<{ id: string; status: string }>();

    if (!subscription) {
        return c.json({ success: false, error: 'No subscription found' }, 404);
    }

    if (subscription.status === 'cancelled') {
        return c.json({ success: false, error: 'Subscription already cancelled' }, 400);
    }

    await c.env.DB.prepare(`
        UPDATE organization_subscriptions
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(subscription.id).run();

    return c.json({
        success: true,
        message: 'Subscription cancelled. You can still use the service until the current period ends.',
    });
});

// Admin: confirm payment manually
app.post('/confirm-payment', async (c) => {
    const body = await c.req.json();
    const orderId = String(body.orderId || '').trim();
    const adminKey = String(body.adminKey || '').trim();

    if (!orderId) {
        return c.json({ success: false, error: 'Missing orderId' }, 400);
    }

    const expectedAdminKey = c.env.BILLING_ADMIN_KEY || '';
    if (!expectedAdminKey || adminKey !== expectedAdminKey) {
        return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    const order = await c.env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, status, amount_thb
        FROM payment_orders
        WHERE id = ?
        LIMIT 1
    `).bind(orderId).first<{
        id: string;
        workspace_id: string;
        subscription_id: string;
        status: string;
        amount_thb: number;
    }>();

    if (!order) {
        return c.json({ success: false, error: 'Order not found' }, 404);
    }

    if (order.status === 'paid') {
        return c.json({ success: false, error: 'Order already paid' }, 400);
    }

    const now = new Date().toISOString();

    await c.env.DB.batch([
        c.env.DB.prepare(`
            UPDATE payment_orders
            SET status = 'paid', paid_at = ?, gateway = 'manual', updated_at = ?
            WHERE id = ?
        `).bind(now, now, orderId),
        c.env.DB.prepare(`
            UPDATE organization_subscriptions
            SET status = 'active', updated_at = ?
            WHERE id = ?
        `).bind(now, order.subscription_id),
    ]);

    return c.json({
        success: true,
        message: 'Payment confirmed and subscription activated.',
        orderId,
        workspaceId: order.workspace_id,
        amountThb: order.amount_thb,
    });
});

// Check subscription status
app.get('/check-status', async (c) => {
    const workspaceId = getWorkspaceId(c);

    const subscription = await c.env.DB.prepare(`
        SELECT id, status, plan_code, current_period_end
        FROM organization_subscriptions
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).bind(workspaceId).first<{
        id: string;
        status: string;
        plan_code: string;
        current_period_end: string;
    }>();

    if (!subscription) {
        return c.json({ success: true, active: false, reason: 'no_subscription' });
    }

    const isExpired = subscription.current_period_end
        ? new Date(subscription.current_period_end) < new Date()
        : false;

    const isActive = subscription.status === 'active' && !isExpired;

    return c.json({
        success: true,
        active: isActive,
        status: subscription.status,
        planCode: subscription.plan_code,
        periodEnd: subscription.current_period_end,
        expired: isExpired,
    });
});

export { app as billingRouter };
