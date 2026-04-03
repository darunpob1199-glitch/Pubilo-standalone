import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import { getBillingPlan, BILLING_PLANS } from '../config/plans';
import {
    createCheckoutIntent,
    applyPaidPaymentOrder,
    getEffectiveWorkspaceSubscription,
} from '../lib/billing-state';

const app = new Hono<{ Bindings: Env }>();

// ── CORS for admin dashboard (deployed on different domain) ──────────
app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

// ── Admin auth middleware ────────────────────────────────────────────
app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization') || '';
    const key = authHeader.replace(/^Bearer\s+/i, '').trim()
        || c.req.query('key') || '';

    const expectedKey = c.env.BILLING_ADMIN_KEY || '';
    if (!expectedKey || key !== expectedKey) {
        return c.json({ success: false, error: 'Unauthorized' }, 403);
    }
    await next();
});

// ── Overview stats ──────────────────────────────────────────────────
app.get('/overview', async (c) => {
    const [
        usersCount,
        workspacesCount,
        activeSubsCount,
        pendingSubsCount,
        revenueTotal,
        todayRevenue,
        monthRevenue,
        recentUsers,
    ] = await Promise.all([
        c.env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{ count: number }>(),
        c.env.DB.prepare(`SELECT COUNT(*) as count FROM workspaces WHERE id != 'ws_legacy'`).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM organization_subscriptions
            WHERE status = 'active' AND datetime(current_period_end) > datetime('now')
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM organization_subscriptions
            WHERE status = 'pending_payment'
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COALESCE(SUM(amount_thb), 0) as total FROM payment_orders WHERE status = 'paid'
        `).first<{ total: number }>(),
        c.env.DB.prepare(`
            SELECT COALESCE(SUM(amount_thb), 0) as total FROM payment_orders
            WHERE status = 'paid' AND date(paid_at) = date('now')
        `).first<{ total: number }>(),
        c.env.DB.prepare(`
            SELECT COALESCE(SUM(amount_thb), 0) as total FROM payment_orders
            WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-30 days')
        `).first<{ total: number }>(),
        c.env.DB.prepare(`
            SELECT id, name, email, avatar_url, created_at, last_login_at
            FROM users ORDER BY created_at DESC LIMIT 10
        `).all(),
    ]);

    // Revenue last 7 days
    const revenueByDay = await c.env.DB.prepare(`
        SELECT date(paid_at) as day, SUM(amount_thb) as total
        FROM payment_orders
        WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-7 days')
        GROUP BY date(paid_at)
        ORDER BY day ASC
    `).all();

    // Plan breakdown
    const planBreakdown = await c.env.DB.prepare(`
        SELECT plan_code, COUNT(*) as count
        FROM organization_subscriptions
        WHERE status = 'active' AND datetime(current_period_end) > datetime('now')
        GROUP BY plan_code
    `).all();

    return c.json({
        success: true,
        overview: {
            totalUsers: usersCount?.count || 0,
            totalWorkspaces: workspacesCount?.count || 0,
            activeSubscriptions: activeSubsCount?.count || 0,
            pendingSubscriptions: pendingSubsCount?.count || 0,
            totalRevenue: revenueTotal?.total || 0,
            todayRevenue: todayRevenue?.total || 0,
            monthRevenue: monthRevenue?.total || 0,
            revenueByDay: revenueByDay.results || [],
            planBreakdown: planBreakdown.results || [],
            recentUsers: recentUsers.results || [],
        },
    });
});

// ── Customers list ──────────────────────────────────────────────────
app.get('/customers', async (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50')));
    const offset = (page - 1) * limit;
    const search = (c.req.query('search') || '').trim();

    let whereClause = '';
    const bindings: any[] = [];
    if (search) {
        whereClause = `WHERE u.name LIKE ? OR u.email LIKE ?`;
        bindings.push(`%${search}%`, `%${search}%`);
    }

    const totalRow = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT u.id) as count FROM users u ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    const customers = await c.env.DB.prepare(`
        SELECT u.id, u.name, u.email, u.avatar_url, u.created_at, u.last_login_at,
               wm.workspace_id, w.name as workspace_name, wm.role,
               os.id as subscription_id, os.plan_code,
               os.status as subscription_status,
               os.current_period_end, os.amount_thb, os.started_at
        FROM users u
        LEFT JOIN workspace_members wm ON u.id = wm.user_id
        LEFT JOIN workspaces w ON wm.workspace_id = w.id AND w.id != 'ws_legacy'
        LEFT JOIN organization_subscriptions os ON w.id = os.workspace_id
            AND os.id = (
                SELECT os2.id FROM organization_subscriptions os2
                WHERE os2.workspace_id = w.id
                  AND (
                    (os2.status = 'active' AND datetime(os2.current_period_end) > datetime('now'))
                    OR os2.status = 'pending_payment'
                  )
                ORDER BY
                    CASE os2.status
                        WHEN 'active' THEN 0
                        WHEN 'pending_payment' THEN 1
                    END,
                    datetime(os2.updated_at) DESC
                LIMIT 1
            )
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();

    return c.json({
        success: true,
        customers: customers.results || [],
        pagination: {
            page,
            limit,
            total: totalRow?.count || 0,
            totalPages: Math.ceil((totalRow?.count || 0) / limit),
        },
    });
});

// ── Available plans ─────────────────────────────────────────────────
app.get('/plans', async (c) => {
    return c.json({
        success: true,
        plans: BILLING_PLANS.map(p => ({
            code: p.code,
            label: p.label,
            interval: p.interval,
            amountThb: p.amountThb,
            durationDays: p.durationDays,
            description: p.description,
        })),
    });
});

// ── Grant plan to workspace (admin assigns plan) ────────────────────
app.post('/grant-plan', async (c) => {
    const body = await c.req.json();
    const workspaceId = String(body.workspaceId || '').trim();
    const planCode = String(body.planCode || '').trim();

    if (!workspaceId) {
        return c.json({ success: false, error: 'Missing workspaceId' }, 400);
    }

    const plan = getBillingPlan(planCode);
    if (!plan) {
        return c.json({ success: false, error: `Invalid plan: ${planCode}` }, 400);
    }

    // Verify workspace exists
    const workspace = await c.env.DB.prepare(
        `SELECT id, name FROM workspaces WHERE id = ?`
    ).bind(workspaceId).first<{ id: string; name: string }>();

    if (!workspace) {
        return c.json({ success: false, error: 'Workspace not found' }, 404);
    }

    // Use the existing billing flow: create checkout → immediately apply as paid
    const checkout = await createCheckoutIntent(c.env, {
        workspaceId,
        plan,
        source: 'billing',
    });

    const applied = await applyPaidPaymentOrder(c.env, checkout.paymentOrder.id, {
        paidAt: new Date().toISOString(),
        gateway: 'admin_grant',
    });

    return c.json({
        success: true,
        message: `Plan "${plan.label}" granted to workspace "${workspace.name}"`,
        workspace: { id: workspace.id, name: workspace.name },
        subscription: {
            id: applied.subscription.id,
            planCode: applied.subscription.plan_code,
            status: applied.subscription.status,
            periodEnd: applied.subscription.current_period_end,
        },
    });
});

// ── Get workspace subscription detail ───────────────────────────────
app.get('/workspace/:workspaceId/subscription', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const subscription = await getEffectiveWorkspaceSubscription(c.env, workspaceId);

    return c.json({
        success: true,
        subscription,
    });
});

// ── Payments ────────────────────────────────────────────────────────
app.get('/payments', async (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50')));
    const offset = (page - 1) * limit;
    const status = c.req.query('status') || '';

    let whereClause = '';
    const bindings: any[] = [];
    if (status) {
        whereClause = `WHERE po.status = ?`;
        bindings.push(status);
    }

    const totalRow = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM payment_orders po ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    const payments = await c.env.DB.prepare(`
        SELECT po.id, po.workspace_id, po.plan_code, po.billing_interval,
               po.amount_thb, po.currency, po.status, po.gateway,
               po.gateway_reference, po.paid_at, po.expires_at,
               po.created_at, po.updated_at,
               w.name as workspace_name
        FROM payment_orders po
        LEFT JOIN workspaces w ON po.workspace_id = w.id
        ${whereClause}
        ORDER BY po.created_at DESC
        LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all();

    return c.json({
        success: true,
        payments: payments.results || [],
        pagination: {
            page,
            limit,
            total: totalRow?.count || 0,
            totalPages: Math.ceil((totalRow?.count || 0) / limit),
        },
    });
});

// ── Confirm payment (admin) ─────────────────────────────────────────
app.post('/confirm-payment', async (c) => {
    const body = await c.req.json();
    const orderId = String(body.orderId || '').trim();
    if (!orderId) {
        return c.json({ success: false, error: 'Missing orderId' }, 400);
    }

    const applied = await applyPaidPaymentOrder(c.env, orderId, {
        paidAt: new Date().toISOString(),
        gateway: 'admin_manual',
    });

    return c.json({
        success: true,
        message: 'Payment confirmed.',
        orderId,
        subscription: {
            id: applied.subscription.id,
            planCode: applied.subscription.plan_code,
            periodEnd: applied.subscription.current_period_end,
        },
    });
});

export { app as adminRouter };
