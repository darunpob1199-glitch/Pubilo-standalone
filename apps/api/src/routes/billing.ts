import { Hono } from 'hono';
import { BILLING_PLANS, getBillingPlan } from '../config/plans';
import type { Env } from '../types';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

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
    const currentPeriodEnd = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();
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

export { app as billingRouter };
