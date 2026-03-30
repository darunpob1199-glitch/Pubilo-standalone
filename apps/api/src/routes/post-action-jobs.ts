import { Hono } from 'hono';
import type { Env } from '../index';
import {
    cancelPostActionJob,
    createPostActionJob,
    getPostActionJobDetail,
    listPostActionJobs,
    processPendingPostActionJobs,
    retryFailedPostActionJob,
    type PostActionType,
} from '../lib/post-action-jobs';
import { encryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

function normalizeAction(value: unknown): PostActionType {
    return String(value || '').trim().toLowerCase() === 'delete' ? 'delete' : 'hide';
}

app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const jobs = await listPostActionJobs(c.env, {
            organizationId: workspaceId,
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
        const workspaceId = getWorkspaceId(c);
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
                INSERT INTO page_settings (organization_id, page_id, page_name, post_token_encrypted, hide_token_encrypted, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(organization_id, page_id) DO UPDATE SET
                    page_name = COALESCE(excluded.page_name, page_settings.page_name),
                    post_token_encrypted = COALESCE(excluded.post_token_encrypted, page_settings.post_token_encrypted),
                    hide_token_encrypted = COALESCE(excluded.hide_token_encrypted, page_settings.hide_token_encrypted),
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                workspaceId,
                pageId,
                pageName || null,
                await encryptSecret(c.env, postToken || null),
                await encryptSecret(c.env, hideToken || null),
            ).run();
        }

        const jobId = await createPostActionJob(c.env, {
            organizationId: workspaceId,
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

app.get('/:id', async (c) => {
    const jobId = Number(c.req.param('id') || 0);

    if (!Number.isFinite(jobId) || jobId <= 0) {
        return c.json({ success: false, error: 'Invalid job id' }, 400);
    }

    try {
        const detail = await getPostActionJobDetail(c.env, getWorkspaceId(c), jobId);
        return c.json({ success: true, ...detail });
    } catch (error) {
        const message = String(error);
        const status = message.includes('not found') ? 404 : 500;
        return c.json({ success: false, error: message }, status);
    }
});

app.post('/:id/retry-failed', async (c) => {
    const jobId = Number(c.req.param('id') || 0);

    if (!Number.isFinite(jobId) || jobId <= 0) {
        return c.json({ success: false, error: 'Invalid job id' }, 400);
    }

    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json().catch(() => ({})) as Record<string, any>;
        const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0) : [];
        await retryFailedPostActionJob(c.env, workspaceId, jobId, itemIds);
        c.executionCtx.waitUntil(processPendingPostActionJobs(c.env, { jobIds: [jobId], perJobLimit: 20, maxJobs: 1 }));
        return c.json({ success: true, jobId });
    } catch (error) {
        const message = String(error);
        const status = message.includes('not found') ? 404 : 400;
        return c.json({ success: false, error: message }, status);
    }
});

app.post('/:id/cancel', async (c) => {
    const jobId = Number(c.req.param('id') || 0);

    if (!Number.isFinite(jobId) || jobId <= 0) {
        return c.json({ success: false, error: 'Invalid job id' }, 400);
    }

    try {
        await cancelPostActionJob(c.env, getWorkspaceId(c), jobId);
        return c.json({ success: true, jobId });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as postActionJobsRouter };
