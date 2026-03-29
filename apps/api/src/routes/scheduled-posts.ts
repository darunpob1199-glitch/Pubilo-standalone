import { Context, Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';

type ScheduledQueueRow = {
    id: number;
    page_id: string;
    payload_json: string;
    batch_id?: string | null;
    scheduled_time: number;
    status: string;
    created_at?: string;
    page_name?: string | null;
};

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

async function ensureScheduledPublishQueueTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            batch_id TEXT,
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

    try {
        await env.DB.prepare(`
            ALTER TABLE scheduled_publish_queue
            ADD COLUMN batch_id TEXT
        `).run();
    } catch (error) {
        const message = String(error);
        if (
            !message.includes('duplicate column name') &&
            !message.includes('already exists')
        ) {
            throw error;
        }
    }

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_batch_id
        ON scheduled_publish_queue (batch_id, status, scheduled_time)
    `).run();
}

function safeJsonParse(value: string): Record<string, any> {
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
}

async function fetchSystemQueuedPosts(env: Env, pageId: string) {
    await ensureScheduledPublishQueueTable(env);
    const primaryRows = await env.DB.prepare(`
        SELECT
            q.id,
            q.page_id,
            q.payload_json,
            q.batch_id,
            q.scheduled_time,
            q.status,
            q.created_at,
            ps.page_name
        FROM scheduled_publish_queue q
        LEFT JOIN page_settings ps ON ps.page_id = q.page_id
        WHERE q.page_id = ? AND q.status IN ('pending', 'processing')
        ORDER BY q.scheduled_time ASC
        LIMIT 200
    `).bind(pageId).all<ScheduledQueueRow>();

    const batchIds = Array.from(
        new Set(
            (primaryRows.results || [])
                .map((row) => String(row.batch_id || '').trim())
                .filter(Boolean),
        ),
    );

    let rows = primaryRows.results || [];

    if (batchIds.length > 0) {
        const placeholders = batchIds.map(() => '?').join(', ');
        const batchRows = await env.DB.prepare(`
            SELECT
                q.id,
                q.page_id,
                q.payload_json,
                q.batch_id,
                q.scheduled_time,
                q.status,
                q.created_at,
                ps.page_name
            FROM scheduled_publish_queue q
            LEFT JOIN page_settings ps ON ps.page_id = q.page_id
            WHERE q.status IN ('pending', 'processing')
              AND (q.page_id = ? OR q.batch_id IN (${placeholders}))
            ORDER BY q.scheduled_time ASC, q.created_at ASC
            LIMIT 500
        `).bind(pageId, ...batchIds).all<ScheduledQueueRow>();

        rows = batchRows.results || [];
    }

    const dedupedRows = Array.from(
        new Map(rows.map((row) => [row.id, row])).values(),
    );

    return dedupedRows.map((row) => {
        const payload = safeJsonParse(row.payload_json || '{}');
        const fallbackMessage = payload.message || payload.primaryText || '';
        const imageUrl = typeof payload.imageUrl === 'string' && payload.imageUrl.startsWith('http')
            ? payload.imageUrl
            : '';
        const normalizedBatchId = String(row.batch_id || payload.batchId || '').trim();
        const pageName = row.page_name || payload.pageName || `เพจ ${row.page_id}`;

        return {
            id: `queue:${row.id}`,
            queueId: row.id,
            pageId: row.page_id,
            pageName,
            batchId: normalizedBatchId,
            queueStatus: row.status,
            message: fallbackMessage,
            scheduled_publish_time: row.scheduled_time,
            created_time: row.created_at || '',
            status_type: payload.postMode || 'link',
            full_picture: imageUrl,
            permalink_url: '',
            source: 'system',
            // Backward-compatible aliases for the legacy web dashboard.
            scheduledTime: row.scheduled_time,
            postType: payload.postMode || 'link',
            imageUrl,
            fullImageUrl: imageUrl,
            permalink: '',
        };
    });
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
        const systemQueuedPosts = await fetchSystemQueuedPosts(c.env, pageId);
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
            return c.json({ success: true, posts: systemQueuedPosts });
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

            return c.json({ success: true, posts: [...systemQueuedPosts, ...posts] });
        }

        if (systemQueuedPosts.length > 0) {
            return c.json({
                success: true,
                posts: systemQueuedPosts,
                warning: lastFacebookError?.message || 'Facebook API error',
            });
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
