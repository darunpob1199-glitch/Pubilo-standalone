import { Hono } from 'hono';
import type { Env } from '../index';
import { backfillLegacyPublishHistory, ensurePublishHistoryTable } from '../lib/publish-history';

const app = new Hono<{ Bindings: Env }>();
const FB_API = 'https://graph.facebook.com/v21.0';

type PublishedSource = 'merged' | 'facebook' | 'history';

type PublishedQueryInput = {
    pageId: string;
    limit: number;
    source: PublishedSource;
    after?: string;
    pageToken?: string;
    accessToken?: string;
    cookieData?: string;
};

function normalizeSource(value?: string | null): PublishedSource {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'history') return 'history';
    if (normalized === 'facebook') return 'facebook';
    return 'merged';
}

function normalizeFacebookUrl(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
    if (normalized.startsWith('/')) return `https://www.facebook.com${normalized}`;
    return `https://www.facebook.com/${normalized.replace(/^\/+/, '')}`;
}

function buildFacebookPostUrl(params: {
    pageId?: string | null;
    postId?: string | null;
    permalink?: string | null;
    postType?: string | null;
}): string | null {
    const permalink = normalizeFacebookUrl(params.permalink);
    if (permalink) return permalink;

    const pageId = String(params.pageId || '').trim();
    const postId = String(params.postId || '').trim();
    const postType = String(params.postType || '').trim().toLowerCase();
    if (!postId) return null;

    const normalizedPostId = postId.replace(/^fb:/, '');

    if (postType.includes('reel') || postType.includes('video')) {
        const reelId = normalizedPostId.includes('_')
            ? normalizedPostId.split('_').pop()
            : normalizedPostId;
        return reelId ? `https://www.facebook.com/reel/${reelId}/` : null;
    }

    if (normalizedPostId.includes('_')) {
        const parts = normalizedPostId.split('_').filter(Boolean);
        const objectId = parts[parts.length - 1];
        const ownerId = pageId || parts[0];
        if (ownerId && objectId) {
            return `https://www.facebook.com/${ownerId}/posts/${objectId}`;
        }
    }

    if (pageId) {
        return `https://www.facebook.com/${pageId}/posts/${normalizedPostId}`;
    }

    return `https://www.facebook.com/${normalizedPostId}`;
}

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = String(cookieData || '').trim();
    if (!normalizedCookie) return undefined;

    return {
        Cookie: normalizedCookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
}

async function fetchFreshPageToken(pageId: string, accessToken?: string, cookieData?: string): Promise<string> {
    if (!accessToken) return '';

    const headers = buildFacebookHeaders(cookieData);

    try {
        const accountsRes = await fetch(
            `${FB_API}/me/accounts?access_token=${encodeURIComponent(accessToken)}&fields=id,access_token&limit=100`,
            headers ? { headers } : undefined,
        );
        const accountsData = await accountsRes.json() as any;
        const matchedPage = accountsData?.data?.find((page: any) => String(page.id) === String(pageId));

        if (matchedPage?.access_token) {
            return matchedPage.access_token;
        }
    } catch (error) {
        console.warn('[published-posts] /me/accounts page token fetch failed:', error);
    }

    try {
        const tokenRes = await fetch(
            `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`,
            headers ? { headers } : undefined,
        );
        const tokenData = await tokenRes.json() as any;

        if (tokenData?.access_token) {
            return tokenData.access_token;
        }
    } catch (error) {
        console.warn('[published-posts] direct page token fetch failed:', error);
    }

    return '';
}

function buildAuthCandidates(tokens: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    tokens.forEach((token) => {
        const normalized = String(token || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    });

    return candidates;
}

function mapSourceLabel(source?: string): string {
    switch (String(source || '')) {
        case 'facebook':
            return 'Facebook';
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

function inferFacebookPostType(post: Record<string, any>): string {
    const permalink = String(post.permalink_url || '').toLowerCase();
    const statusType = String(post.status_type || '').toLowerCase();
    const firstAttachment = Array.isArray(post.attachments?.data) ? post.attachments.data[0] : null;
    const attachmentType = String(firstAttachment?.media_type || firstAttachment?.type || '').toLowerCase();
    const attachmentUrl = String(firstAttachment?.url || firstAttachment?.target?.url || '').trim();

    if (
        permalink.includes('/reel/') ||
        attachmentType.includes('video') ||
        statusType.includes('video') ||
        statusType.includes('added_video')
    ) {
        return 'reels';
    }

    if (
        post.full_picture ||
        attachmentType.includes('photo') ||
        attachmentType.includes('image')
    ) {
        return 'image';
    }

    if (attachmentUrl) {
        return 'link';
    }

    if (String(post.message || '').trim()) {
        return 'text';
    }

    return 'link';
}

function mapFacebookPosts(data: any): Array<Record<string, any>> {
    const posts = Array.isArray(data?.data) ? data.data : [];

    return posts.map((post: Record<string, any>) => {
        const postType = inferFacebookPostType(post);
        return {
            id: `fb:${post.id}`,
            page_id: String(post.from?.id || ''),
            source: 'facebook',
            source_ref: String(post.id || ''),
            batch_id: null,
            queue_job_id: null,
            post_type: postType,
            message_text: String(post.message || post.story || '').trim() || null,
            media_kind: postType,
            media_url: normalizeFacebookUrl(post.full_picture || ''),
            media_thumb_url: normalizeFacebookUrl(post.full_picture || ''),
            facebook_post_id: String(post.id || ''),
            facebook_url: buildFacebookPostUrl({
                pageId: String(post.from?.id || ''),
                postId: String(post.id || ''),
                permalink: post.permalink_url,
                postType,
            }),
            scheduled_time: null,
            published_at: String(post.created_time || '').trim() || null,
            warning_message: null,
            created_at: String(post.created_time || '').trim() || null,
            sourceLabel: mapSourceLabel('facebook'),
            deleteAllowed: false,
        };
    });
}

async function getStoredPageToken(env: Env, pageId: string): Promise<string> {
    if (!pageId) return '';

    const result = await env.DB.prepare(`
        SELECT post_token
        FROM page_settings
        WHERE page_id = ?
        LIMIT 1
    `).bind(pageId).first<{ post_token?: string }>();

    return String(result?.post_token || '').trim();
}

async function fetchFacebookPublishedPosts(env: Env, input: PublishedQueryInput) {
    const { pageId, limit, after, pageToken, accessToken, cookieData } = input;

    if (!pageId) {
        return { success: false, error: 'Missing pageId' };
    }

    const storedPageToken = pageToken?.trim() || await getStoredPageToken(env, pageId);
    const freshPageToken = await fetchFreshPageToken(pageId, accessToken, cookieData);
    const authCandidates = buildAuthCandidates([
        freshPageToken,
        storedPageToken,
        accessToken,
    ]);

    if (!authCandidates.length) {
        return { success: false, error: 'Missing page token', errorType: 'MissingPageToken' };
    }

    const headers = buildFacebookHeaders(cookieData);
    let lastFacebookError: any = null;

    for (const authToken of authCandidates) {
        const params = new URLSearchParams({
            fields: 'id,message,story,created_time,full_picture,permalink_url,status_type,from,attachments{media_type,type,url,target,media,subattachments}',
            limit: String(Math.min(limit, 100)),
            access_token: authToken,
        });
        if (String(after || '').trim()) {
            params.set('after', String(after).trim());
        }

        const response = await fetch(
            `${FB_API}/${pageId}/posts?${params.toString()}`,
            headers ? { headers } : undefined,
        );
        const data = await response.json() as any;

        if (data?.error) {
            lastFacebookError = data.error;
            if (
                Number(data.error?.code) === 190 ||
                (Number(data.error?.code) === 1 && data.error?.type === 'OAuthException')
            ) {
                continue;
            }
            continue;
        }

        const logs = mapFacebookPosts(data).map((row) => ({
            ...row,
            page_id: pageId,
        }));
        const nextCursor = String(data?.paging?.cursors?.after || '').trim();
        const hasMore = Boolean(data?.paging?.next && nextCursor);

        return {
            success: true,
            logs,
            meta: {
                source: 'facebook',
                hasMore,
                nextCursor: hasMore ? nextCursor : null,
            },
        };
    }

    return {
        success: false,
        error: lastFacebookError?.message || 'Facebook API error',
        errorCode: lastFacebookError?.code,
        errorSubcode: lastFacebookError?.error_subcode,
        errorType: lastFacebookError?.type,
    };
}

async function fetchHistoryPublishedPosts(env: Env, input: PublishedQueryInput) {
    const { pageId, limit } = input;

    await ensurePublishHistoryTable(env);
    await backfillLegacyPublishHistory(env);

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
            ph.created_at
        FROM publish_history ph
        WHERE (? = '' OR ph.page_id = ?)
        ORDER BY datetime(COALESCE(ph.published_at, ph.created_at)) DESC, ph.id DESC
        LIMIT ?
    `;

    const results = await env.DB.prepare(query).bind(pageId, pageId, limit).all<Record<string, any>>();
    const logs = (results.results || []).map((row) => ({
        ...row,
        facebook_url: buildFacebookPostUrl({
            pageId: row.page_id,
            postId: row.facebook_post_id,
            permalink: row.facebook_url,
            postType: row.post_type,
        }),
        sourceLabel: mapSourceLabel(row.source),
        deleteAllowed: true,
    }));

    return {
        success: true,
        logs,
        meta: {
            source: 'history',
            hasMore: false,
            nextCursor: null,
        },
    };
}

function getPublishedSortTime(row: Record<string, any>): number {
    const raw = String(row.published_at || row.created_at || '').trim();
    if (!raw) return 0;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        ? raw.replace(' ', 'T')
        : raw;
    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getPublishedMergeKey(row: Record<string, any>): string {
    const postId = String(row.facebook_post_id || '').trim();
    if (postId) return `post:${postId}`;

    const facebookUrl = normalizeFacebookUrl(row.facebook_url);
    if (facebookUrl) return `url:${facebookUrl}`;

    const sourceRef = String(row.source_ref || row.id || '').trim();
    return `ref:${sourceRef}`;
}

function mergePublishedLogs(facebookLogs: Array<Record<string, any>>, historyLogs: Array<Record<string, any>>) {
    const merged = new Map<string, Record<string, any>>();

    facebookLogs.forEach((row) => {
        merged.set(getPublishedMergeKey(row), { ...row, deleteAllowed: false });
    });

    historyLogs.forEach((row) => {
        const key = getPublishedMergeKey(row);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, { ...row, deleteAllowed: false });
            return;
        }

        merged.set(key, {
            ...existing,
            warning_message: existing.warning_message || row.warning_message,
            batch_id: existing.batch_id || row.batch_id,
            queue_job_id: existing.queue_job_id || row.queue_job_id,
            source_ref: existing.source_ref || row.source_ref,
            media_url: existing.media_url || row.media_url,
            media_thumb_url: existing.media_thumb_url || row.media_thumb_url,
            facebook_url: existing.facebook_url || row.facebook_url,
        });
    });

    return Array.from(merged.values()).sort((a, b) => getPublishedSortTime(b) - getPublishedSortTime(a));
}

async function handleListRequest(env: Env, input: PublishedQueryInput) {
    if (input.source === 'history') {
        return fetchHistoryPublishedPosts(env, input);
    }
    if (input.source === 'facebook') {
        return fetchFacebookPublishedPosts(env, input);
    }

    const historyResult = await fetchHistoryPublishedPosts(env, input);
    const facebookResult = await fetchFacebookPublishedPosts(env, input);

    if (facebookResult.success) {
        return {
            success: true,
            logs: mergePublishedLogs(
                Array.isArray(facebookResult.logs) ? facebookResult.logs : [],
                Array.isArray(historyResult.logs) ? historyResult.logs : [],
            ),
            meta: facebookResult.meta || historyResult.meta,
        };
    }

    return historyResult;
}

app.get('/', async (c) => {
    const input: PublishedQueryInput = {
        pageId: String(c.req.query('pageId') || c.req.query('page_id') || '').trim(),
        limit: Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500),
        source: normalizeSource(c.req.query('source')),
        after: String(c.req.query('after') || c.req.query('cursor') || '').trim(),
        pageToken: String(c.req.query('pageToken') || '').trim(),
        accessToken: String(c.req.query('accessToken') || '').trim(),
        cookieData: String(c.req.query('cookieData') || '').trim(),
    };

    try {
        const result = await handleListRequest(c.env, input);
        return c.json(result, result.success ? 200 : 400);
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Partial<PublishedQueryInput>;
    const input: PublishedQueryInput = {
        pageId: String(body.pageId || '').trim(),
        limit: Math.min(parseInt(String(body.limit || '200'), 10) || 200, 500),
        source: normalizeSource(body.source),
        after: String((body as Record<string, any>).after || (body as Record<string, any>).cursor || '').trim(),
        pageToken: String(body.pageToken || '').trim(),
        accessToken: String(body.accessToken || '').trim(),
        cookieData: String(body.cookieData || '').trim(),
    };

    try {
        const result = await handleListRequest(c.env, input);
        return c.json(result, result.success ? 200 : 400);
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
