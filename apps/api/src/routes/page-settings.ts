import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/page-settings?pageId=xxx
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');
    if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

    try {
        const workspaceId = getWorkspaceId(c);
        const result = await c.env.DB.prepare(`
            SELECT * FROM page_settings WHERE organization_id = ? AND page_id = ?
        `).bind(workspaceId, pageId).first<any>();

        const defaultSettings = {
            page_id: pageId,
            auto_schedule: 0,
            hide_on_publish: 0,
            schedule_minutes: '00, 15, 30, 45',
            ai_model: 'gemini-2.0-flash-exp',
            ai_resolution: '2K',
            link_image_size: '1:1',
            image_image_size: '1:1',
            working_hours_start: 6,
            working_hours_end: 24,
        };

        const hydrated = result ? {
            ...result,
            post_token: await decryptSecret(c.env, result.post_token_encrypted),
            hide_token: await decryptSecret(c.env, result.hide_token_encrypted),
            comment_token: await decryptSecret(c.env, result.comment_token_encrypted),
        } : null;

        return c.json({
            success: true,
            settings: hydrated || defaultSettings,
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/page-settings
app.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const { pageId } = body;
        if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

        const workspaceId = getWorkspaceId(c);
        const now = new Date().toISOString();

        // Build update fields
        const fields: Record<string, any> = {
            organization_id: workspaceId,
            page_id: pageId,
            updated_at: now,
        };

        if (body.autoSchedule !== undefined) fields.auto_schedule = body.autoSchedule ? 1 : 0;
        if (body.hideOnPublish !== undefined) fields.hide_on_publish = body.hideOnPublish ? 1 : 0;
        if (body.scheduleMinutes !== undefined) fields.schedule_minutes = body.scheduleMinutes;
        if (body.workingHoursStart !== undefined) fields.working_hours_start = body.workingHoursStart;
        if (body.workingHoursEnd !== undefined) fields.working_hours_end = body.workingHoursEnd;
        if (body.aiModel !== undefined) fields.ai_model = body.aiModel;
        if (body.aiResolution !== undefined) fields.ai_resolution = body.aiResolution;
        if (body.linkImageSize !== undefined) fields.link_image_size = body.linkImageSize;
        if (body.imageImageSize !== undefined) fields.image_image_size = body.imageImageSize;
        if (body.postToken !== undefined) fields.post_token_encrypted = await encryptSecret(c.env, body.postToken || null);
        if (body.hideToken !== undefined) fields.hide_token_encrypted = await encryptSecret(c.env, body.hideToken || null);
        if (body.commentToken !== undefined) fields.comment_token_encrypted = await encryptSecret(c.env, body.commentToken || null);
        if (body.postMode !== undefined) fields.post_mode = body.postMode;
        if (body.colorBg !== undefined) fields.color_bg = body.colorBg ? 1 : 0;
        if (body.colorBgPresets !== undefined) fields.color_bg_presets = body.colorBgPresets;
        if (body.colorBgIndex !== undefined) fields.color_bg_index = body.colorBgIndex;
        if (body.sharePageId !== undefined) fields.share_page_id = body.sharePageId;
        if (body.shareMode !== undefined) fields.share_mode = body.shareMode;
        if (body.shareScheduleMinutes !== undefined) fields.share_schedule_minutes = body.shareScheduleMinutes;
        if (body.pageColor !== undefined) fields.page_color = body.pageColor;
        if (body.pageName !== undefined) fields.page_name = body.pageName;
        if (body.pictureUrl !== undefined) fields.picture_url = body.pictureUrl;
        if (body.imageSource !== undefined) fields.image_source = body.imageSource;
        if (body.ogBackgroundUrl !== undefined) fields.og_background_url = body.ogBackgroundUrl;
        if (body.ogFont !== undefined) fields.og_font = body.ogFont;
        if (body.newsAnalysisPrompt !== undefined) fields.news_analysis_prompt = body.newsAnalysisPrompt;
        if (body.newsGenerationPrompt !== undefined) fields.news_generation_prompt = body.newsGenerationPrompt;
        if (body.newsImageSize !== undefined) fields.news_image_size = body.newsImageSize;
        if (body.newsVariationCount !== undefined) fields.news_variation_count = body.newsVariationCount;
        if (body.hideTypes !== undefined) fields.hide_types = body.hideTypes;

        // Retire the legacy auto-hide worker flow whenever settings are saved through the new UI.
        if (body.hideOnPublish !== undefined) {
            fields.auto_hide = 0;
            fields.hide_types = null;
        }

        const columns = Object.keys(fields);
        const placeholders = columns.map(() => '?').join(', ');
        const updateClauses = columns
            .filter((column) => !['page_id', 'organization_id'].includes(column))
            .map((column) => `${column} = excluded.${column}`)
            .join(', ');

        await c.env.DB.prepare(`
            INSERT INTO page_settings (${columns.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT(organization_id, page_id) DO UPDATE SET ${updateClauses}
        `).bind(...Object.values(fields)).run();

        const result = await c.env.DB.prepare(`
            SELECT * FROM page_settings WHERE organization_id = ? AND page_id = ?
        `).bind(workspaceId, pageId).first<any>();

        return c.json({
            success: true,
            settings: result ? {
                ...result,
                post_token: await decryptSecret(c.env, result.post_token_encrypted),
                hide_token: await decryptSecret(c.env, result.hide_token_encrypted),
                comment_token: await decryptSecret(c.env, result.comment_token_encrypted),
            } : null,
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// DELETE /api/page-settings?pageId=xxx
app.delete('/', async (c) => {
    const pageId = c.req.query('pageId');
    if (!pageId) return c.json({ success: false, error: 'Missing pageId' }, 400);

    try {
        const workspaceId = getWorkspaceId(c);
        await c.env.DB.prepare(`
            DELETE FROM page_settings WHERE organization_id = ? AND page_id = ?
        `).bind(workspaceId, pageId).run();

        return c.json({ success: true, deleted: pageId });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as pageSettingsRouter };
