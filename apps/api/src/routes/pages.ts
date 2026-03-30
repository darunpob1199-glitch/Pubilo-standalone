import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/pages - list all pages with settings
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const results = await c.env.DB.prepare(`
            SELECT page_id, page_name, page_color, picture_url, auto_schedule, post_token_encrypted
            FROM page_settings 
            WHERE organization_id = ?
            ORDER BY page_name ASC
        `).bind(workspaceId).all();

        const pages = (results.results || []).map((row: any) => ({
            id: row.page_id,
            name: row.page_name || 'Unknown Page',
            picture: row.picture_url ? { data: { url: row.picture_url } } : null,
            color: row.page_color || '#f59e0b',
            auto_schedule: row.auto_schedule,
            has_token: !!row.post_token_encrypted,
        }));

        return c.json({ success: true, pages });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as pagesRouter };
