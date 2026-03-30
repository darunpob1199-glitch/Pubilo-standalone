import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/quotes?random=true&limit=1&used=false&pageId=xxx
app.get('/', async (c) => {
    const random = c.req.query('random');
    const limit = parseInt(c.req.query('limit') || '10');
    const used = c.req.query('used'); // 'true' or 'false'
    const pageId = c.req.query('pageId');
    const countOnly = c.req.query('countOnly');

    try {
        const workspaceId = getWorkspaceId(c);
        // Get counts in single query (avoids 2 full table scans)
        const counts = await c.env.DB.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN used_by_pages IS NULL OR used_by_pages = '[]' OR used_by_pages = '' THEN 1 ELSE 0 END) as unused
            FROM quotes
            WHERE organization_id = ?
        `).bind(workspaceId).first<{ total: number; unused: number }>();

        const totalCount = counts?.total || 0;
        const unusedCount = { count: counts?.unused || 0 };
        const usedCount = { count: totalCount - (counts?.unused || 0) };

        if (countOnly === 'true') {
            return c.json({
                success: true,
                total: totalCount,
                unusedCount: unusedCount?.count || 0,
                usedCount: usedCount?.count || 0
            });
        }

        // Build query
        let query = 'SELECT * FROM quotes';
        const conditions: string[] = ['organization_id = ?'];
        const params: any[] = [workspaceId];

        // Get filter param (frontend sends filter=unused or filter=used)
        const filter = c.req.query('filter');

        // Filter by used status - support both 'used' param and 'filter' param
        if (used === 'false' || filter === 'unused') {
            conditions.push("(used_by_pages IS NULL OR used_by_pages = '[]' OR used_by_pages = '')");
        } else if (used === 'true' || filter === 'used') {
            conditions.push("(used_by_pages IS NOT NULL AND used_by_pages != '[]' AND used_by_pages != '')");
        }

        // Filter by pageId not used
        if (pageId) {
            conditions.push(`(used_by_pages IS NULL OR used_by_pages NOT LIKE '%"${pageId}"%')`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        if (random === 'true') {
            query += ' ORDER BY RANDOM()';
        } else {
            query += ' ORDER BY created_at DESC';
        }

        query += ` LIMIT ?`;
        params.push(limit);

        const results = await c.env.DB.prepare(query).bind(...params).all();

        return c.json({
            success: true,
            quotes: results.results || [],
            total: totalCount,
            unusedCount: unusedCount?.count || 0,
            usedCount: usedCount?.count || 0
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/quotes - add new quote
app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json();
        const content = body.content || body.quote_text;
        if (!content) return c.json({ success: false, error: 'Missing content' }, 400);

        await c.env.DB.prepare(`
            INSERT INTO quotes (organization_id, quote_text, created_at) VALUES (?, ?, ?)
        `).bind(workspaceId, content, new Date().toISOString()).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// DELETE /api/quotes/:id or DELETE /api/quotes?id=xxx
app.delete('/:id', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const id = c.req.param('id');
        await c.env.DB.prepare(`DELETE FROM quotes WHERE organization_id = ? AND id = ?`).bind(workspaceId, id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Support query param: DELETE /api/quotes?id=xxx
app.delete('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const id = c.req.query('id');
        if (!id) return c.json({ success: false, error: 'Missing id' }, 400);
        await c.env.DB.prepare(`DELETE FROM quotes WHERE organization_id = ? AND id = ?`).bind(workspaceId, id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// PUT /api/quotes/:id - mark as used
app.put('/:id', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const id = c.req.param('id');
        const { used_by_pages } = await c.req.json();

        await c.env.DB.prepare(`UPDATE quotes SET used_by_pages = ? WHERE organization_id = ? AND id = ?`)
            .bind(JSON.stringify(used_by_pages), workspaceId, id).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as quotesRouter };
