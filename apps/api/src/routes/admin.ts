import { Hono } from 'hono';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

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
        recentUsers,
        postsToday,
        postsWeek,
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
            SELECT id, name, email, avatar_url, created_at, last_login_at
            FROM users ORDER BY created_at DESC LIMIT 5
        `).all(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM publish_history
            WHERE date(published_at) = date('now')
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM publish_history
            WHERE datetime(published_at) >= datetime('now', '-7 days')
        `).first<{ count: number }>(),
    ]);

    // Revenue last 7 days
    const revenueByDay = await c.env.DB.prepare(`
        SELECT date(paid_at) as day, SUM(amount_thb) as total
        FROM payment_orders
        WHERE status = 'paid' AND datetime(paid_at) >= datetime('now', '-7 days')
        GROUP BY date(paid_at)
        ORDER BY day ASC
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
            postsToday: postsToday?.count || 0,
            postsThisWeek: postsWeek?.count || 0,
            revenueByDay: revenueByDay.results || [],
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
               os.plan_code, os.status as subscription_status,
               os.current_period_end, os.amount_thb
        FROM users u
        LEFT JOIN workspace_members wm ON u.id = wm.user_id
        LEFT JOIN workspaces w ON wm.workspace_id = w.id AND w.id != 'ws_legacy'
        LEFT JOIN (
            SELECT workspace_id, plan_code, status, current_period_end, amount_thb
            FROM organization_subscriptions
            WHERE id IN (
                SELECT id FROM organization_subscriptions os2
                WHERE os2.workspace_id = organization_subscriptions.workspace_id
                ORDER BY
                    CASE WHEN status = 'active' THEN 0 WHEN status = 'pending_payment' THEN 1 ELSE 2 END,
                    datetime(updated_at) DESC
                LIMIT 1
            )
        ) os ON w.id = os.workspace_id
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

    // Re-use existing billing confirm logic
    const { applyPaidPaymentOrder } = await import('../lib/billing-state');
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

// ── Activity / publish history ──────────────────────────────────────
app.get('/activity', async (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50')));

    const [recentPosts, queueStatus, recentLogs] = await Promise.all([
        c.env.DB.prepare(`
            SELECT ph.id, ph.organization_id, ph.page_id, ph.post_type,
                   ph.message_text, ph.facebook_url, ph.published_at,
                   ph.source, ph.warning_message,
                   ps.page_name
            FROM publish_history ph
            LEFT JOIN page_settings ps ON ph.page_id = ps.page_id AND ph.organization_id = ps.organization_id
            ORDER BY ph.published_at DESC
            LIMIT ?
        `).bind(limit).all(),

        c.env.DB.prepare(`
            SELECT status, COUNT(*) as count
            FROM scheduled_publish_queue
            GROUP BY status
        `).all(),

        c.env.DB.prepare(`
            SELECT id, organization_id, page_id, post_type, status,
                   error_message, created_at
            FROM auto_post_logs
            ORDER BY created_at DESC
            LIMIT 20
        `).all(),
    ]);

    return c.json({
        success: true,
        recentPosts: recentPosts.results || [],
        queueStatus: queueStatus.results || [],
        recentLogs: recentLogs.results || [],
    });
});

// ── System health ───────────────────────────────────────────────────
app.get('/system', async (c) => {
    const [
        autoSchedulePages,
        activePages,
        totalPages,
        recentErrors,
        queueStats,
        pendingShares,
        activeJobs,
    ] = await Promise.all([
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM page_settings WHERE auto_schedule = 1
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM page_settings
            WHERE auto_schedule = 1 AND post_token_encrypted IS NOT NULL AND post_token_encrypted != ''
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM page_settings
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT page_id, error_message, created_at
            FROM auto_post_logs
            WHERE status = 'error'
            ORDER BY created_at DESC
            LIMIT 10
        `).all(),
        c.env.DB.prepare(`
            SELECT status, COUNT(*) as count
            FROM scheduled_publish_queue
            WHERE datetime(created_at) >= datetime('now', '-24 hours')
            GROUP BY status
        `).all(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM share_queue WHERE status = 'pending'
        `).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM post_action_jobs
            WHERE status IN ('pending', 'processing')
        `).first<{ count: number }>(),
    ]);

    return c.json({
        success: true,
        system: {
            autoSchedulePages: autoSchedulePages?.count || 0,
            activePagesWithToken: activePages?.count || 0,
            totalPages: totalPages?.count || 0,
            pendingShares: pendingShares?.count || 0,
            activeJobs: activeJobs?.count || 0,
            recentErrors: recentErrors.results || [],
            queueStats24h: queueStats.results || [],
        },
    });
});

export { app as adminRouter };
