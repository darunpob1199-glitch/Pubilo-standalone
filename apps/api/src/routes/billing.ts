import { Hono } from 'hono';
import { BILLING_PLANS, getBillingPlan } from '../config/plans';
import type { Env } from '../types';
import { getWorkspaceId } from '../lib/workspace';
import { hasTmwConfig, createPay, detailPay, confirmPay, cancelPay } from '../lib/tmw-gateway';
import {
    applyPaidPaymentOrder,
    createCheckoutIntent,
    getEffectiveWorkspaceSubscription,
    getLatestWorkspacePaymentOrder,
    markPaymentOrderExpired,
} from '../lib/billing-state';

const app = new Hono<{ Bindings: Env }>();

function isTmwSuccess(status: unknown): boolean {
    return Number(status) === 1;
}

function buildTmwErrorMessage(prefix: string, payload: any): string {
    const msg = String(payload?.msg || '').trim();
    const status = payload?.status;
    const endpoint = payload?._meta?.endpoint;
    const raw = String(payload?._meta?.raw || '').trim();
    const base = msg || `${prefix} failed`;
    const extra: string[] = [];
    if (status !== undefined && status !== null && String(status) !== '') {
        extra.push(`status=${status}`);
    }
    if (endpoint) {
        extra.push(`endpoint=${endpoint}`);
    }
    if (!msg && raw) {
        extra.push(`raw=${raw.slice(0, 120)}`);
    }
    return extra.length ? `${base} (${extra.join(', ')})` : base;
}

app.get('/plans', (c) => {
    return c.json({
        success: true,
        plans: BILLING_PLANS,
    });
});

app.get('/current', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const subscription = await getEffectiveWorkspaceSubscription(c.env, workspaceId);
    const latestOrder = await getLatestWorkspacePaymentOrder(c.env, workspaceId);

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

    const intent = await createCheckoutIntent(c.env, {
        workspaceId,
        plan,
        source: 'billing',
    });

    return c.json({
        success: true,
        subscription: {
            id: intent.subscription.id,
            workspaceId,
            status: intent.subscription.status,
            planCode: intent.subscription.plan_code,
            interval: intent.subscription.billing_interval,
            amountThb: intent.subscription.amount_thb,
            currentPeriodEnd: intent.subscription.current_period_end,
        },
        paymentOrder: {
            id: intent.paymentOrder.id,
            status: intent.paymentOrder.status,
            amountThb: intent.paymentOrder.amount_thb,
            expiresAt: intent.paymentOrder.expires_at,
        },
        reusedOrder: intent.reusedOrder,
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
    if (order.status === 'cancelled' || order.status === 'expired') {
        return c.json({ success: false, error: `Order already ${order.status}` }, 409);
    }

    // ถ้ามี gateway_reference อยู่แล้ว ดึง detail เลย ไม่ต้อง create ใหม่
    if (order.gateway_reference) {
        try {
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
        } catch {
            // Ignore and continue creating new payment below.
        }
    }

    // สร้าง payment ใหม่ที่ TMW
    let ref1 = `p${Date.now().toString().slice(-7)}`;
    let created;
    try {
        created = await createPay(c.env, order.amount_thb, ref1);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `TMW create_pay request error: ${message}`, errorType: 'TMW_CREATE_PAY_REQUEST_ERROR' }, 502);
    }
    if (!isTmwSuccess(created.status) || !created.id_pay) {
        // Retry once with unique ref1 in case gateway rejects duplicate references.
        ref1 = `p${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
        try {
            created = await createPay(c.env, order.amount_thb, ref1);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ success: false, error: `TMW create_pay retry request error: ${message}`, errorType: 'TMW_CREATE_PAY_RETRY_REQUEST_ERROR' }, 502);
        }
    }
    if (!isTmwSuccess(created.status) || !created.id_pay) {
        return c.json({
            success: false,
            error: buildTmwErrorMessage('TMW create_pay', created),
            errorType: 'TMW_CREATE_PAY_FAILED',
            gateway: created?._meta || null,
        }, 502);
    }

    // ดึง QR code
    let detail;
    try {
        detail = await detailPay(c.env, created.id_pay, true);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ success: false, error: `TMW detail_pay request error: ${message}`, errorType: 'TMW_DETAIL_PAY_REQUEST_ERROR' }, 502);
    }
    if (!isTmwSuccess(detail.status)) {
        return c.json({
            success: false,
            error: buildTmwErrorMessage('TMW detail_pay', detail),
            errorType: 'TMW_DETAIL_PAY_FAILED',
            gateway: detail?._meta || null,
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
    if (order.status === 'cancelled' || order.status === 'expired') {
        return c.json({ success: true, status: order.status });
    }

    if (!order.gateway_reference || !hasTmwConfig(c.env)) {
        return c.json({ success: true, status: order.status });
    }

    // เรียก confirm ที่ TMW
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
    const result = await confirmPay(c.env, order.gateway_reference, clientIp);

    if (isTmwSuccess(result.status)) {
        const applied = await applyPaidPaymentOrder(c.env, orderId, {
            paidAt: new Date().toISOString(),
            gateway: 'tmw_maemanee',
        });
        return c.json({
            success: true,
            status: 'paid',
            paidAt: applied.order.paid_at,
            subscription: {
                id: applied.subscription.id,
                planCode: applied.subscription.plan_code,
                periodEnd: applied.subscription.current_period_end,
            },
        });
    }

    const detail = await detailPay(c.env, order.gateway_reference, false);
    if (detail.time_out !== undefined && detail.time_out < 0) {
        await markPaymentOrderExpired(c.env, orderId);
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
    if (order.status === 'cancelled') {
        return c.json({ success: true, status: 'cancelled' });
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
    const subscription = await getEffectiveWorkspaceSubscription(c.env, workspaceId);

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
    const applied = await applyPaidPaymentOrder(c.env, orderId, {
        paidAt: new Date().toISOString(),
        gateway: 'manual',
    });

    return c.json({
        success: true,
        message: 'Payment confirmed and subscription activated.',
        orderId,
        workspaceId: order.workspace_id,
        amountThb: order.amount_thb,
        subscription: {
            id: applied.subscription.id,
            planCode: applied.subscription.plan_code,
            periodEnd: applied.subscription.current_period_end,
        },
    });
});

// Check subscription status
app.get('/check-status', async (c) => {
    const workspaceId = getWorkspaceId(c);
    const subscription = await getEffectiveWorkspaceSubscription(c.env, workspaceId);

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
