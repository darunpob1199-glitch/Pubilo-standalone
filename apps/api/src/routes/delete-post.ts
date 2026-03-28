import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';

async function ensureScheduledPublishQueueTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            scheduled_time INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            post_id TEXT,
            facebook_url TEXT,
            error_message TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT
        )
    `).run();
}

function extractQueueId(postId: string): number | null {
    const value = String(postId || '').trim();
    if (!value.startsWith('queue:')) return null;
    const id = Number(value.replace('queue:', '').trim());
    return Number.isFinite(id) && id > 0 ? id : null;
}

// POST /api/delete-post
app.post('/', async (c) => {
    try {
        const { postId, pageToken } = await c.req.json();

        if (!postId) {
            return c.json({ success: false, error: 'Missing postId' }, 400);
        }

        const queueId = extractQueueId(postId);
        if (queueId) {
            await ensureScheduledPublishQueueTable(c.env);
            await c.env.DB.prepare(`
                UPDATE scheduled_publish_queue
                SET status = 'cancelled',
                    updated_at = CURRENT_TIMESTAMP,
                    processed_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status IN ('pending', 'processing')
            `).bind(queueId).run();

            return c.json({ success: true, queued: true });
        }

        if (!pageToken) {
            return c.json({ success: false, error: 'Missing pageToken' }, 400);
        }

        const response = await fetch(`${FB_API}/${postId}?access_token=${pageToken}`, {
            method: 'DELETE',
        });

        const data = await response.json() as any;

        if (data.error) {
            return c.json({ success: false, error: data.error.message }, 400);
        }

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as deletePostRouter };
