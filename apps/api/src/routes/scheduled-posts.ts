import { Context, Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = typeof cookieData === 'string' ? cookieData.trim() : '';
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
            headers ? { headers } : undefined
        );
        const accountsData = await accountsRes.json() as any;
        const matchedPage = accountsData?.data?.find((page: any) => String(page.id) === String(pageId));

        if (matchedPage?.access_token) {
            return matchedPage.access_token;
        }
    } catch (error) {
        console.warn('[scheduled-posts] /me/accounts page token fetch failed:', error);
    }

    try {
        const tokenRes = await fetch(
            `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`,
            headers ? { headers } : undefined
        );
        const tokenData = await tokenRes.json() as any;

        if (tokenData?.access_token) {
            return tokenData.access_token;
        }
    } catch (error) {
        console.warn('[scheduled-posts] direct page token fetch failed:', error);
    }

    return '';
}

function buildAuthCandidates(tokens: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    tokens.forEach((token) => {
        const normalized = token?.trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    });

    return candidates;
}

async function handleScheduledPosts(
    pageId: string | undefined,
    pageToken: string | undefined,
    accessToken: string | undefined,
    cookieData: string | undefined,
    c: Context<{ Bindings: Env }>
) {
    if (!pageId) {
        return c.json({ success: false, error: 'Missing pageId' }, 400);
    }

    try {
        const fields = 'id,message,scheduled_publish_time,created_time,status_type,full_picture,attachments{media,subattachments},permalink_url';
        let storedPageToken = pageToken;

        if (!storedPageToken && pageId) {
            try {
                const dbResult = await c.env.DB.prepare(
                    'SELECT post_token FROM page_settings WHERE page_id = ? LIMIT 1'
                ).bind(pageId).first<{ post_token: string | null }>();

                if (dbResult?.post_token) {
                    storedPageToken = dbResult.post_token;
                }
            } catch (dbErr) {
                console.error('[scheduled-posts] D1 error:', dbErr);
            }
        }

        const headers = buildFacebookHeaders(cookieData);
        const freshPageToken = await fetchFreshPageToken(pageId, accessToken, cookieData);
        const authCandidates = buildAuthCandidates([
            storedPageToken,
            freshPageToken,
            accessToken,
        ]);

        if (authCandidates.length === 0) {
            return c.json({ success: false, error: 'Missing pageToken or accessToken' }, 400);
        }

        let lastFacebookError: any = null;

        for (const authToken of authCandidates) {
            const url = `${FB_API}/${pageId}/scheduled_posts?access_token=${encodeURIComponent(authToken)}&fields=${fields}`;
            const response = await fetch(url, headers ? { headers } : undefined);
            const data = await response.json() as any;

            if (data.error) {
                lastFacebookError = data.error;
                console.warn('[scheduled-posts] Facebook API error for token candidate:', data.error);
                continue;
            }

            const posts = (data.data || []).map((post: any) => {
                const imageUrl = post.full_picture || post.attachments?.data?.[0]?.media?.image?.src || '';
                const scheduledTime = post.scheduled_publish_time || 0;
                const type = post.status_type || 'unknown';
                const permalink = post.permalink_url || '';

                return {
                    id: post.id,
                    message: post.message || '',
                    scheduled_publish_time: scheduledTime,
                    created_time: post.created_time,
                    type,
                    image_url: imageUrl,
                    permalink,
                    // Backward-compatible aliases for the legacy web dashboard.
                    scheduledTime,
                    postType: type,
                    imageUrl,
                    fullImageUrl: imageUrl,
                };
            });

            return c.json({ success: true, posts });
        }

        return c.json({
            success: false,
            error: lastFacebookError?.message || 'Facebook API error',
            errorCode: lastFacebookError?.code,
            errorSubcode: lastFacebookError?.error_subcode,
            errorType: lastFacebookError?.type,
        }, 400);
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
}

// GET /api/scheduled-posts?pageId=xxx&pageToken=xxx
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');
    const pageToken = c.req.query('pageToken');
    const accessToken = c.req.query('accessToken');
    const cookieData = c.req.query('cookieData');
    return handleScheduledPosts(pageId, pageToken, accessToken, cookieData, c);
});

// POST /api/scheduled-posts { pageId, pageToken, accessToken }
app.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { pageId?: string; pageToken?: string; accessToken?: string; cookieData?: string };
    return handleScheduledPosts(body.pageId, body.pageToken, body.accessToken, body.cookieData, c);
});

export { app as scheduledPostsRouter };
