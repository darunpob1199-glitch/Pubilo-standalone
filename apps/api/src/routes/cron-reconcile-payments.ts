import { Hono } from 'hono';
import type { Env } from '../types';
import { reconcilePendingPaymentOrders } from '../lib/billing-reconcile';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
    const limit = Number(c.req.query('limit') || 20);
    const clientIp = c.req.query('clientIp') || '127.0.0.1';

    try {
        const result = await reconcilePendingPaymentOrders(c.env, {
            limit,
            clientIp,
        });
        return c.json(result);
    } catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

export { app as cronReconcilePaymentsRouter };
