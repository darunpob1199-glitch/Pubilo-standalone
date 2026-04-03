import { Hono } from 'hono';
import { Env } from '../index';
import { normalizeBillingData } from '../lib/billing-normalize';

const app = new Hono<{ Bindings: Env }>();

// GET /api/migrate - Show migration status
app.get('/', async (c) => {
    try {
        const tables = ['page_settings', 'tokens', 'prompts', 'quotes', 'global_settings'];
        const counts: Record<string, number> = {};

        for (const table of tables) {
            try {
                const result = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first();
                counts[table] = (result as any)?.count || 0;
            } catch {
                counts[table] = -1; // Table doesn't exist
            }
        }

        return c.json({
            success: true,
            message: 'Migration status',
            counts,
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.get('/billing/normalize', async (c) => {
    const workspaceId = c.req.query('workspaceId') || null;
    const limit = Number(c.req.query('limit') || 200);
    const dryRun = c.req.query('dryRun') !== 'false';

    try {
        const result = await normalizeBillingData(c.env, {
            workspaceId,
            limit,
            dryRun,
        });
        return c.json(result);
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/billing/normalize', async (c) => {
    let body: Record<string, unknown> = {};
    try {
        body = await c.req.json();
    } catch {
        body = {};
    }

    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
    const limit = Number(body.limit || 200);
    const dryRun = body.dryRun !== false;

    try {
        const result = await normalizeBillingData(c.env, {
            workspaceId,
            limit,
            dryRun,
        });
        return c.json(result);
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as migrateRouter };
