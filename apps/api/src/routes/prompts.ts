import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/prompts
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const pageId = c.req.query('pageId');
        const promptType = c.req.query('promptType');
        let query = `
            SELECT id, organization_id, page_id, prompt_type,
                   COALESCE(prompt_text, prompt) as prompt_text,
                   name, prompt, category, created_at, updated_at
            FROM prompts
        `;
        const conditions: string[] = ['organization_id = ?'];
        const params: string[] = [workspaceId];

        if (pageId) {
            conditions.push('page_id = ?');
            params.push(pageId);
        }

        if (promptType) {
            conditions.push('prompt_type = ?');
            params.push(promptType);
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ' ORDER BY updated_at DESC, created_at DESC';

        const results = await c.env.DB.prepare(query).bind(...params).all();
        return c.json({ success: true, prompts: results.results || [] });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/prompts
app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json();
        const now = new Date().toISOString();

        if (body.pageId && body.promptType) {
            const promptText = body.promptText ?? body.prompt ?? '';
            if (!promptText) return c.json({ success: false, error: 'Missing promptText' }, 400);

            const promptId = body.id || `${workspaceId}:${body.pageId}:${body.promptType}`;

            await c.env.DB.prepare(`
                INSERT INTO prompts (
                    id, organization_id, page_id, prompt_type, prompt_text, name, prompt, category, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    organization_id = excluded.organization_id,
                    page_id = excluded.page_id,
                    prompt_type = excluded.prompt_type,
                    prompt_text = excluded.prompt_text,
                    name = excluded.name,
                    prompt = excluded.prompt,
                    category = excluded.category,
                    updated_at = excluded.updated_at
            `).bind(
                promptId,
                workspaceId,
                body.pageId,
                body.promptType,
                promptText,
                body.name || body.promptType,
                promptText,
                body.category || body.promptType,
                now,
                now
            ).run();

            return c.json({ success: true, id: promptId });
        }

        const { id, name, prompt, category } = body;
        if (!name || !prompt) return c.json({ success: false, error: 'Missing name or prompt' }, 400);

        const promptId = id || `${workspaceId}:${crypto.randomUUID()}`;

        await c.env.DB.prepare(`
            INSERT INTO prompts (id, organization_id, name, prompt, category, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                organization_id = excluded.organization_id,
                name = excluded.name,
                prompt = excluded.prompt,
                category = excluded.category,
                updated_at = excluded.updated_at
        `).bind(promptId, workspaceId, name, prompt, category || 'general', now, now).run();

        return c.json({ success: true, id: promptId });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// DELETE /api/prompts?id=xxx
app.delete('/', async (c) => {
    const id = c.req.query('id');
    if (!id) return c.json({ success: false, error: 'Missing id' }, 400);

    try {
        const workspaceId = getWorkspaceId(c);
        await c.env.DB.prepare(`DELETE FROM prompts WHERE organization_id = ? AND id = ?`).bind(workspaceId, id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as promptsRouter };
