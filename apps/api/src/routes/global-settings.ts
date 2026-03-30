import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/global-settings?key=xxx (optional key param)
app.get('/', async (c) => {
    const key = c.req.query('key');

    try {
        const workspaceId = getWorkspaceId(c);
        if (key) {
            // Get specific setting
            const result = await c.env.DB.prepare(`
                SELECT setting_value FROM organization_settings WHERE workspace_id = ? AND setting_key = ?
            `).bind(workspaceId, key).first<{ setting_value: string }>();

            return c.json({
                success: true,
                key,
                value: result?.setting_value || null,
            });
        }

        // Get all settings
        const results = await c.env.DB.prepare(`
            SELECT setting_key, setting_value FROM organization_settings WHERE workspace_id = ?
        `).bind(workspaceId).all();

        const settings: Record<string, string> = {};
        for (const row of results.results || []) {
            settings[(row as any).setting_key] = (row as any).setting_value;
        }

        return c.json({ success: true, settings });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/global-settings
app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json();
        const now = new Date().toISOString();

        // Handle both old format {geminiApiKey} and new format {key, value}
        if (body.key && body.value !== undefined) {
            await c.env.DB.prepare(`
                INSERT INTO organization_settings (workspace_id, setting_key, setting_value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(workspace_id, setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
            `).bind(workspaceId, body.key, body.value, now).run();
        } else if (body.geminiApiKey !== undefined) {
            await c.env.DB.prepare(`
                INSERT INTO organization_settings (workspace_id, setting_key, setting_value, updated_at)
                VALUES (?, 'gemini_api_key', ?, ?)
                ON CONFLICT(workspace_id, setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
            `).bind(workspaceId, body.geminiApiKey, now).run();
        }

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as globalSettingsRouter };
