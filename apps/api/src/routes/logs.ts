import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/auto-post-logs - get post logs for a page
app.get('/', async (c) => {
    const pageId = c.req.query('pageId') || c.req.query('page_id');
    const limit = parseInt(c.req.query('limit') || '50');
    const type = c.req.query('type'); // 'post' or 'share'

    try {
        const workspaceId = getWorkspaceId(c);
        if (type === 'share') {
            // Get share logs
            const results = await c.env.DB.prepare(`
                SELECT * FROM share_queue 
                WHERE organization_id = ?
                  AND target_page_id = ? 
                ORDER BY created_at DESC LIMIT ?
            `).bind(workspaceId, pageId, limit).all();
            return c.json({ success: true, logs: results.results || [], type: 'share' });
        }

        // Default: get auto_post_logs with share status in single JOIN query
        let query = `SELECT apl.id, apl.page_id, apl.post_type, apl.quote_text, apl.status,
                            apl.facebook_post_id, apl.error_message, apl.created_at,
                            sq.status as share_status, sq.shared_at, sq.shared_post_id
                     FROM auto_post_logs apl
                     LEFT JOIN share_queue sq
                       ON apl.organization_id = sq.organization_id
                      AND apl.facebook_post_id = sq.facebook_post_id
                     WHERE apl.organization_id = ?`;
        const params: any[] = [workspaceId];

        if (pageId) {
            query += ' AND apl.page_id = ?';
            params.push(pageId);
        }

        query += ' ORDER BY apl.created_at DESC LIMIT ?';
        params.push(limit);

        const results = await c.env.DB.prepare(query).bind(...params).all();

        return c.json({ success: true, logs: results.results || [], type: 'post' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// DELETE /api/auto-post-logs/:id
app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const workspaceId = getWorkspaceId(c);
        await c.env.DB.prepare('DELETE FROM auto_post_logs WHERE organization_id = ? AND id = ?').bind(workspaceId, id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as logsRouter };
