import { Hono } from 'hono';
import type { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/encryption';
import { fetchFreshPageToken } from '../lib/post-action-jobs';
import { recordPublishHistory } from '../lib/publish-history';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();
const FB_API = 'https://graph.facebook.com/v21.0';
const MAX_SHARE_OPERATIONS = 100;

type SharePostInput = {
    id: string;
    messageText?: string;
    postType?: string;
    publishedAt?: string;
    facebookUrl?: string;
    mediaUrl?: string;
};

type ShareTargetInput = {
    id: string;
    name?: string;
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePostType(value: unknown): string {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized.includes('reel') || normalized.includes('video')) return 'reels';
    if (normalized.includes('image') || normalized.includes('photo')) return 'image';
    if (normalized.includes('text')) return 'text';
    return normalized || 'link';
}

function normalizeFacebookPostId(value: unknown): string {
    return normalizeText(value).replace(/^fb:/i, '');
}

function buildFacebookPostUrl(post: SharePostInput, sourcePageId = ''): string {
    const explicitUrl = normalizeText(post.facebookUrl);
    if (explicitUrl) return explicitUrl;

    const postId = normalizeFacebookPostId(post.id);
    if (!postId) return 'https://www.facebook.com/';

    const parts = postId.split('_').filter(Boolean);
    const objectId = parts.length > 1 ? parts[parts.length - 1] : postId;
    const ownerId = parts.length > 1 ? parts[0] : normalizeText(sourcePageId);
    const postType = normalizePostType(post.postType);

    if (postType === 'reels') {
        return `https://www.facebook.com/reel/${encodeURIComponent(objectId)}/`;
    }

    if (ownerId && objectId) {
        return `https://www.facebook.com/${encodeURIComponent(ownerId)}/posts/${encodeURIComponent(objectId)}`;
    }

    return `https://www.facebook.com/${encodeURIComponent(postId)}`;
}

async function getStoredPageToken(env: Env, workspaceId: string, pageId: string): Promise<string> {
    const row = await env.DB.prepare(`
        SELECT post_token_encrypted
        FROM page_settings
        WHERE organization_id = ? AND page_id = ?
        LIMIT 1
    `).bind(workspaceId, pageId).first<{ post_token_encrypted?: string | null }>();

    return normalizeText(await decryptSecret(env, row?.post_token_encrypted));
}

async function savePageToken(env: Env, workspaceId: string, pageId: string, pageName: string, token: string): Promise<void> {
    if (!pageId) return;

    await env.DB.prepare(`
        INSERT INTO page_settings (organization_id, page_id, page_name, post_token_encrypted, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(organization_id, page_id) DO UPDATE SET
            page_name = COALESCE(excluded.page_name, page_settings.page_name),
            post_token_encrypted = COALESCE(excluded.post_token_encrypted, page_settings.post_token_encrypted),
            updated_at = CURRENT_TIMESTAMP
    `).bind(
        workspaceId,
        pageId,
        pageName || null,
        await encryptSecret(env, token || null),
    ).run();
}

async function resolveTargetPageToken(
    env: Env,
    params: {
        workspaceId: string;
        pageId: string;
        pageName: string;
        providedToken?: string;
        accessToken?: string;
        cookieData?: string;
    },
): Promise<string> {
    const providedToken = normalizeText(params.providedToken);
    if (providedToken) {
        await savePageToken(env, params.workspaceId, params.pageId, params.pageName, providedToken);
        return providedToken;
    }

    const freshToken = await fetchFreshPageToken(
        params.pageId,
        normalizeText(params.accessToken),
        normalizeText(params.cookieData),
    );
    if (freshToken) {
        await savePageToken(env, params.workspaceId, params.pageId, params.pageName, freshToken);
        return freshToken;
    }

    return getStoredPageToken(env, params.workspaceId, params.pageId);
}

async function sharePostToPage(post: SharePostInput, sourcePageId: string, targetPageId: string, targetPageToken: string): Promise<string> {
    const response = await fetch(`${FB_API}/${encodeURIComponent(targetPageId)}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            link: buildFacebookPostUrl(post, sourcePageId),
            access_token: targetPageToken,
        }).toString(),
    });
    const data = await response.json() as any;

    if (response.ok && data?.id) {
        return String(data.id);
    }

    const code = data?.error?.code ? ` code=${data.error.code}` : '';
    const type = data?.error?.type ? ` type=${data.error.type}` : '';
    const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
    throw new Error(String(data?.error?.message || data?.message || 'Graph share failed') + code + type + subcode);
}

async function recordShareQueueResult(
    env: Env,
    params: {
        workspaceId: string;
        sourcePageId: string;
        targetPageId: string;
        postId: string;
        postType: string;
        status: 'shared' | 'failed';
        sharedPostId?: string;
        errorMessage?: string;
    },
): Promise<void> {
    await env.DB.prepare(`
        INSERT INTO share_queue (
            organization_id,
            source_page_id,
            target_page_id,
            facebook_post_id,
            post_type,
            share_schedule_minutes,
            status,
            shared_post_id,
            shared_at,
            error_message,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
        params.workspaceId,
        params.sourcePageId,
        params.targetPageId,
        params.postId,
        params.postType,
        '',
        params.status,
        params.sharedPostId || null,
        params.status === 'shared' ? new Date().toISOString() : null,
        params.errorMessage || null,
    ).run();
}

app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json() as Record<string, any>;
        const sourcePageId = normalizeText(body.sourcePageId || body.pageId);
        const sourcePageName = normalizeText(body.sourcePageName || body.pageName);
        const posts = Array.isArray(body.posts)
            ? body.posts
                .map((post: Record<string, any>) => ({
                    id: normalizeText(post.id),
                    messageText: normalizeText(post.messageText || post.message_text),
                    postType: normalizePostType(post.postType || post.post_type),
                    publishedAt: normalizeText(post.publishedAt || post.published_at),
                    facebookUrl: normalizeText(post.facebookUrl || post.facebook_url),
                    mediaUrl: normalizeText(post.mediaUrl || post.media_url),
                }))
                .filter((post: SharePostInput) => post.id)
            : [];
        const targets = Array.isArray(body.targetPages)
            ? body.targetPages
                .map((target: Record<string, any>) => ({
                    id: normalizeText(target.id || target.pageId),
                    name: normalizeText(target.name || target.pageName),
                }))
                .filter((target: ShareTargetInput) => target.id && target.id !== sourcePageId)
            : [];
        const targetPageTokens = body.targetPageTokens && typeof body.targetPageTokens === 'object'
            ? body.targetPageTokens as Record<string, string>
            : {};
        const accessToken = normalizeText(body.accessToken);
        const cookieData = normalizeText(body.cookieData);

        if (!sourcePageId) {
            return c.json({ success: false, error: 'Missing sourcePageId' }, 400);
        }
        if (!posts.length) {
            return c.json({ success: false, error: 'Please select at least one post' }, 400);
        }
        if (!targets.length) {
            return c.json({ success: false, error: 'Please select at least one target page' }, 400);
        }

        const operationCount = posts.length * targets.length;
        if (operationCount > MAX_SHARE_OPERATIONS) {
            return c.json({
                success: false,
                error: `แชร์ต่อรอบได้สูงสุด ${MAX_SHARE_OPERATIONS} รายการ ตอนนี้มี ${operationCount} รายการ`,
            }, 400);
        }

        if (sourcePageName) {
            await savePageToken(c.env, workspaceId, sourcePageId, sourcePageName, '');
        }

        const tokenByTarget = new Map<string, string>();
        const results: Array<Record<string, any>> = [];

        for (const target of targets) {
            const token = await resolveTargetPageToken(c.env, {
                workspaceId,
                pageId: target.id,
                pageName: target.name || `เพจ ${target.id}`,
                providedToken: targetPageTokens[target.id],
                accessToken,
                cookieData,
            });
            tokenByTarget.set(target.id, token);
        }

        for (const post of posts) {
            const postType = normalizePostType(post.postType);
            for (const target of targets) {
                const token = tokenByTarget.get(target.id) || '';
                if (!token) {
                    const errorMessage = 'Missing post token for target page';
                    await recordShareQueueResult(c.env, {
                        workspaceId,
                        sourcePageId,
                        targetPageId: target.id,
                        postId: post.id,
                        postType,
                        status: 'failed',
                        errorMessage,
                    });
                    results.push({
                        postId: post.id,
                        targetPageId: target.id,
                        targetPageName: target.name,
                        status: 'failed',
                        error: errorMessage,
                    });
                    continue;
                }

                try {
                    const sharedPostId = await sharePostToPage(post, sourcePageId, target.id, token);
                    await recordShareQueueResult(c.env, {
                        workspaceId,
                        sourcePageId,
                        targetPageId: target.id,
                        postId: post.id,
                        postType,
                        status: 'shared',
                        sharedPostId,
                    });
                    await recordPublishHistory(c.env, {
                        organizationId: workspaceId,
                        externalKey: `manual-share:${sourcePageId}:${target.id}:${sharedPostId}`,
                        pageId: target.id,
                        source: 'manual_share',
                        sourceRef: post.id,
                        postType: 'share',
                        messageText: post.messageText || '',
                        mediaKind: 'share',
                        mediaUrl: post.mediaUrl || '',
                        facebookPostId: sharedPostId,
                        facebookUrl: `https://www.facebook.com/${sharedPostId}`,
                        publishedAt: new Date().toISOString(),
                        extraJson: JSON.stringify({
                            sourcePageId,
                            sourcePageName,
                            targetPageId: target.id,
                            targetPageName: target.name,
                            originalPostId: post.id,
                            originalPostUrl: buildFacebookPostUrl(post, sourcePageId),
                        }),
                    });
                    results.push({
                        postId: post.id,
                        targetPageId: target.id,
                        targetPageName: target.name,
                        status: 'shared',
                        sharedPostId,
                        facebookUrl: `https://www.facebook.com/${sharedPostId}`,
                    });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    await recordShareQueueResult(c.env, {
                        workspaceId,
                        sourcePageId,
                        targetPageId: target.id,
                        postId: post.id,
                        postType,
                        status: 'failed',
                        errorMessage,
                    });
                    results.push({
                        postId: post.id,
                        targetPageId: target.id,
                        targetPageName: target.name,
                        status: 'failed',
                        error: errorMessage,
                    });
                }
            }
        }

        const successCount = results.filter((result) => result.status === 'shared').length;
        const failedCount = results.length - successCount;
        return c.json({
            success: true,
            sourcePageId,
            total: results.length,
            successCount,
            failedCount,
            results,
        });
    } catch (error) {
        return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
});

export { app as sharePostsRouter };
