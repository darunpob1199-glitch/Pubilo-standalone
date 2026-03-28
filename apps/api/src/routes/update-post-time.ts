import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

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

// Update scheduled post time via Facebook API
app.post('/', async (c) => {
    try {
        const { postId, pageToken, scheduledTime } = await c.req.json();

        if (!postId) return c.json({ success: false, error: 'Missing postId' }, 400);
        if (!scheduledTime) return c.json({ success: false, error: 'Missing scheduledTime' }, 400);

        const queueId = extractQueueId(postId);
        if (queueId) {
            await ensureScheduledPublishQueueTable(c.env);
            await c.env.DB.prepare(`
                UPDATE scheduled_publish_queue
                SET scheduled_time = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status IN ('pending', 'processing')
            `).bind(Number(scheduledTime), queueId).run();
            return c.json({ success: true, queued: true });
        }

        if (!pageToken) return c.json({ success: false, error: 'Missing pageToken' }, 400);

        const response = await fetch(`https://graph.facebook.com/v21.0/${postId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: pageToken, scheduled_publish_time: scheduledTime })
        });
        const data = await response.json() as any;

        if (data.error) {
            return c.json({ success: false, error: data.error.message || 'Facebook API error' });
        }

        return c.json({ success: true });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as updatePostTimeRouter };
