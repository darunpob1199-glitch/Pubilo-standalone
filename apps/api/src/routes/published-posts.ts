import { Hono } from 'hono';
import type { Env } from '../index';
import { backfillLegacyPublishHistory, ensurePublishHistoryTable } from '../lib/publish-history';

const app = new Hono<{ Bindings: Env }>();

function mapSourceLabel(source?: string): string {
    switch (String(source || '')) {
        case 'scheduled_queue':
            return 'Scheduled';
        case 'reel':
            return 'Reels';
        case 'auto_post':
            return 'Auto Post';
        case 'publish':
        default:
            return 'Manual';
    }
}

app.get('/', async (c) => {
    const pageId = String(c.req.query('pageId') || c.req.query('page_id') || '').trim();
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);

    try {
        await ensurePublishHistoryTable(c.env);
        await backfillLegacyPublishHistory(c.env);

        const query = `
            SELECT
                ph.id,
                ph.page_id,
                ph.source,
                ph.source_ref,
                ph.batch_id,
                ph.queue_job_id,
                ph.post_type,
                ph.message_text,
                ph.media_kind,
                ph.media_url,
                ph.media_thumb_url,
                ph.facebook_post_id,
                ph.facebook_url,
                ph.scheduled_time,
                ph.published_at,
                ph.warning_message,
                ph.created_at,
                sq.status as share_status,
                sq.shared_at,
                sq.shared_post_id
            FROM publish_history ph
            LEFT JOIN share_queue sq ON ph.facebook_post_id = sq.facebook_post_id
            WHERE (? = '' OR ph.page_id = ?)
            ORDER BY datetime(COALESCE(ph.published_at, ph.created_at)) DESC, ph.id DESC
            LIMIT ?
        `;

        const results = await c.env.DB.prepare(query).bind(pageId, pageId, limit).all<Record<string, any>>();
        const logs = (results.results || []).map((row) => ({
            ...row,
            sourceLabel: mapSourceLabel(row.source),
        }));

        return c.json({ success: true, logs });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.delete('/:id', async (c) => {
    const id = String(c.req.param('id') || '').trim();

    try {
        await ensurePublishHistoryTable(c.env);

        const row = await c.env.DB.prepare(`
            SELECT id, source, source_ref
            FROM publish_history
            WHERE id = ?
            LIMIT 1
        `).bind(id).first<{ id: number; source: string | null; source_ref: string | null }>();

        if (!row?.id) {
            return c.json({ success: false, error: 'Published row not found' }, 404);
        }

        const source = String(row.source || '').trim();
        const sourceRef = String(row.source_ref || '').trim();

        if (source === 'auto_post' && sourceRef) {
            await c.env.DB.prepare('DELETE FROM auto_post_logs WHERE id = ?').bind(sourceRef).run();
        } else if (source === 'scheduled_queue' && sourceRef) {
            await c.env.DB.prepare('DELETE FROM scheduled_publish_queue WHERE id = ?').bind(sourceRef).run();
        } else if (source === 'reel' && sourceRef) {
            await c.env.DB.prepare('DELETE FROM reel_uploads WHERE video_key = ? OR post_id = ? OR video_id = ?')
                .bind(sourceRef, sourceRef, sourceRef).run();
        }

        await c.env.DB.prepare('DELETE FROM publish_history WHERE id = ?').bind(id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishedPostsRouter };
