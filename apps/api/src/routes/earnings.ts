import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/earnings?pageId=xxx
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');

    try {
        const workspaceId = getWorkspaceId(c);
        let query = 'SELECT * FROM earnings WHERE organization_id = ?';
        const params: any[] = [workspaceId];

        if (pageId) {
            query += ' AND page_id = ?';
            params.push(pageId);
        }

        query += ' ORDER BY date DESC LIMIT 100';

        const results = await c.env.DB.prepare(query).bind(...params).all();
        return c.json({ success: true, earnings: results.results || [] });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/earnings
app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const { pageId, date, amount, currency } = await c.req.json();
        if (!pageId || !date) return c.json({ success: false, error: 'Missing pageId or date' }, 400);

        const now = new Date().toISOString();

        await c.env.DB.prepare(`
            INSERT INTO earnings (organization_id, page_id, date, amount, currency, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, page_id, date) DO UPDATE SET
                amount = excluded.amount,
                currency = excluded.currency
        `).bind(workspaceId, pageId, date, amount || 0, currency || 'THB', now).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as earningsRouter };
