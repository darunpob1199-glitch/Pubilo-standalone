import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/auto-hide-config?pageId=xxx
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');
    if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

    try {
        const workspaceId = getWorkspaceId(c);
        const result = await c.env.DB.prepare(`
            SELECT page_id, hide_types, hide_token_encrypted FROM page_settings WHERE organization_id = ? AND page_id = ?
        `).bind(workspaceId, pageId).first<any>();

        if (result) {
            return c.json({
                success: true,
                config: {
                    enabled: !!result.hide_types,
                    hide_types: result.hide_types || 'shared_story,mobile_status_update,added_photos',
                    hide_token: await decryptSecret(c.env, result.hide_token_encrypted) || '',
                },
            });
        }

        return c.json({
            success: true,
            config: {
                enabled: false,
                hide_types: 'shared_story,mobile_status_update,added_photos',
                hide_token: '',
            },
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/auto-hide-config
app.post('/', async (c) => {
    try {
        const { pageId, enabled, hideTypes, hideToken } = await c.req.json();
        if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

        const workspaceId = getWorkspaceId(c);
        const now = new Date().toISOString();

        await c.env.DB.prepare(`
            INSERT INTO page_settings (organization_id, page_id, auto_hide, hide_types, hide_token_encrypted, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, page_id) DO UPDATE SET
                auto_hide = excluded.auto_hide,
                hide_types = excluded.hide_types,
                hide_token_encrypted = excluded.hide_token_encrypted,
                updated_at = excluded.updated_at
        `).bind(
            workspaceId,
            pageId,
            enabled ? 1 : 0,
            enabled ? hideTypes : null,
            await encryptSecret(c.env, hideToken || null),
            now,
        ).run();

        return c.json({
            success: true,
            config: { enabled, hide_types: hideTypes, hide_token: hideToken },
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as autoHideConfigRouter };
