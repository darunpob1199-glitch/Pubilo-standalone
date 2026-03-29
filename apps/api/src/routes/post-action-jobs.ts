import { Hono } from 'hono';
import type { Env } from '../index';
import {
    cancelPostActionJob,
    createPostActionJob,
    listPostActionJobs,
    processPendingPostActionJobs,
    type PostActionType,
} from '../lib/post-action-jobs';

const app = new Hono<{ Bindings: Env }>();

function normalizeAction(value: unknown): PostActionType {
    return String(value || '').trim().toLowerCase() === 'delete' ? 'delete' : 'hide';
}

app.get('/', async (c) => {
    try {
        const jobs = await listPostActionJobs(c.env, {
            pageId: String(c.req.query('pageId') || '').trim(),
            action: String(c.req.query('action') || '').trim() as PostActionType | '',
            limit: Number(c.req.query('limit') || 20),
        });

        return c.json({ success: true, jobs });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/', async (c) => {
    try {
        const body = await c.req.json() as Record<string, any>;
        const pageId = String(body.pageId || '').trim();
        const action = normalizeAction(body.action);
        const posts = Array.isArray(body.posts) ? body.posts : [];
        const postToken = String(body.postToken || '').trim();
        const hideToken = String(body.hideToken || '').trim();
        const pageName = String(body.pageName || '').trim();
        const requestedFilters = body.requestedFilters && typeof body.requestedFilters === 'object'
            ? JSON.stringify(body.requestedFilters)
            : null;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        if (!posts.length) {
            return c.json({ success: false, error: 'Please select at least one post' }, 400);
        }

        if (postToken || hideToken || pageName) {
            await c.env.DB.prepare(`
                INSERT INTO page_settings (page_id, page_name, post_token, hide_token, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(page_id) DO UPDATE SET
                    page_name = COALESCE(excluded.page_name, page_settings.page_name),
                    post_token = COALESCE(excluded.post_token, page_settings.post_token),
                    hide_token = COALESCE(excluded.hide_token, page_settings.hide_token),
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                pageId,
                pageName || null,
                postToken || null,
                hideToken || null,
            ).run();
        }

        const jobId = await createPostActionJob(c.env, {
            pageId,
            action,
            posts: posts.map((post: Record<string, any>) => ({
                id: String(post.id || '').trim(),
                messageText: String(post.message_text || post.messageText || '').trim(),
                postType: String(post.post_type || post.postType || '').trim(),
                publishedAt: String(post.published_at || post.publishedAt || '').trim(),
                facebookUrl: String(post.facebook_url || post.facebookUrl || '').trim(),
                mediaUrl: String(post.media_url || post.mediaUrl || '').trim(),
            })),
            requestedFiltersJson: requestedFilters,
        });

        c.executionCtx.waitUntil(processPendingPostActionJobs(c.env, { jobIds: [jobId], perJobLimit: 20, maxJobs: 1 }));

        return c.json({ success: true, jobId });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/:id/cancel', async (c) => {
    const jobId = Number(c.req.param('id') || 0);

    if (!Number.isFinite(jobId) || jobId <= 0) {
        return c.json({ success: false, error: 'Invalid job id' }, 400);
    }

    try {
        await cancelPostActionJob(c.env, jobId);
        return c.json({ success: true, jobId });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as postActionJobsRouter };
