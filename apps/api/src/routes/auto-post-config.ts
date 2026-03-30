import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/auto-post-config?pageId=xxx OR ?targetPageId=xxx
// pageId: get config for a single page
// targetPageId: get all pages that share TO this target page (for conflict display)
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');
    const targetPageId = c.req.query('targetPageId');

    try {
        const workspaceId = getWorkspaceId(c);
        // If targetPageId is provided, return ALL pages that share to this target
        if (targetPageId) {
            const results = await c.env.DB.prepare(`
                SELECT page_id, page_name, page_color, share_page_id, share_schedule_minutes, share_mode
                FROM page_settings 
                WHERE organization_id = ?
                  AND share_page_id = ?
            `).bind(workspaceId, targetPageId).all();

            return c.json({
                success: true,
                configs: results.results || [],
            });
        }

        // If pageId is provided, return config for that page
        if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

        const result = await c.env.DB.prepare(`
            SELECT page_id, auto_schedule, schedule_minutes, working_hours_start, working_hours_end,
                   post_mode, color_bg, color_bg_presets, color_bg_index, share_page_id, share_mode,
                   share_schedule_minutes, last_post_type
            FROM page_settings WHERE organization_id = ? AND page_id = ?
        `).bind(workspaceId, pageId).first<any>();

        if (result) {
            return c.json({
                success: true,
                config: {
                    enabled: !!result.auto_schedule,
                    schedule_minutes: result.schedule_minutes || '00,15,30,45',
                    working_hours_start: result.working_hours_start || 6,
                    working_hours_end: result.working_hours_end || 24,
                    post_mode: result.post_mode || 'both',
                    color_bg: !!result.color_bg,
                    color_bg_presets: result.color_bg_presets,
                    color_bg_index: result.color_bg_index || 0,
                    share_page_id: result.share_page_id,
                    share_mode: result.share_mode || 'both',
                    share_schedule_minutes: result.share_schedule_minutes,
                    last_post_type: result.last_post_type,
                },
            });
        }

        return c.json({
            success: true,
            config: {
                enabled: false,
                schedule_minutes: '00,15,30,45',
                working_hours_start: 6,
                working_hours_end: 24,
            },
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/auto-post-config
app.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const { pageId } = body;
        if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

        const workspaceId = getWorkspaceId(c);
        const now = new Date().toISOString();

        await c.env.DB.prepare(`
            INSERT INTO page_settings (organization_id, page_id, auto_schedule, schedule_minutes, working_hours_start, working_hours_end, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, page_id) DO UPDATE SET
                auto_schedule = excluded.auto_schedule,
                schedule_minutes = excluded.schedule_minutes,
                working_hours_start = excluded.working_hours_start,
                working_hours_end = excluded.working_hours_end,
                updated_at = excluded.updated_at
        `).bind(
            workspaceId,
            pageId,
            body.enabled ? 1 : 0,
            body.scheduleMinutes || '00,15,30,45',
            body.workingHoursStart || 6,
            body.workingHoursEnd || 24,
            now
        ).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as autoPostConfigRouter };
