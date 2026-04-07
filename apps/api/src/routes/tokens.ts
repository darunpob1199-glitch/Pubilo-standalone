import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/encryption';
import { getUserId, getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = String(cookieData || '').trim();
    if (!normalizedCookie) return undefined;
    return {
        Cookie: normalizedCookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
}

function normalizeGraphError(data: any): string {
    return String(
        data?.error?.message ||
        data?.message ||
        'Facebook API error',
    );
}

async function fetchPageTokensFromFacebookCookie(cookieData: string, accessToken?: string): Promise<{
    success: boolean;
    token?: string;
    error?: string;
}> {
    const headers = buildFacebookHeaders(cookieData);
    if (!headers) {
        return { success: false, error: 'Missing cookie' };
    }

    const base = 'https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&limit=100';
    const candidates: string[] = [];
    const normalizedAccessToken = String(accessToken || '').trim();
    if (normalizedAccessToken) {
        candidates.push(`${base}&access_token=${encodeURIComponent(normalizedAccessToken)}`);
    }
    candidates.push(base);

    let lastError = '';
    for (const endpoint of candidates) {
        try {
            const response = await fetch(endpoint, { headers });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok || data?.error) {
                lastError = normalizeGraphError(data);
                continue;
            }

            const pages = Array.isArray(data?.data) ? data.data : [];
            const firstUsable = pages.find((page: any) => String(page?.access_token || '').trim());
            const token = String(firstUsable?.access_token || '').trim();
            if (token) {
                return { success: true, token };
            }

            lastError = 'No page access token from Facebook';
        } catch (error) {
            lastError = String(error instanceof Error ? error.message : error);
        }
    }

    return { success: false, error: lastError || 'Cannot fetch token from cookie' };
}

// GET /api/tokens?userId=xxx
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const userId = c.req.query('userId');
        const refreshFromCookie = String(c.req.query('refreshFromCookie') || '').trim() === '1';
        const results = await c.env.DB.prepare(`
            SELECT *
            FROM facebook_credentials
            WHERE workspace_id = ?
              AND (? IS NULL OR facebook_user_id = ?)
            ORDER BY updated_at DESC
        `).bind(workspaceId, userId || null, userId || null).all<any>();

        const tokens = [] as Array<any>;
        for (const row of (results.results || [])) {
            let adsToken = await decryptSecret(c.env, row.ads_token_encrypted);
            const cookie = await decryptSecret(c.env, row.cookie_encrypted);
            const fbDtsg = await decryptSecret(c.env, row.fb_dtsg_encrypted);

            const needsCookieRefresh = !!(
                cookie &&
                (
                    refreshFromCookie ||
                    !String(adsToken || '').trim()
                )
            );

            if (needsCookieRefresh) {
                const refreshed = await fetchPageTokensFromFacebookCookie(
                    String(cookie || ''),
                    String(adsToken || ''),
                );
                if (refreshed.success && refreshed.token && refreshed.token !== adsToken) {
                    adsToken = refreshed.token;
                    const now = new Date().toISOString();
                    await c.env.DB.prepare(`
                        UPDATE facebook_credentials
                        SET ads_token_encrypted = ?, updated_at = ?
                        WHERE id = ?
                    `).bind(
                        await encryptSecret(c.env, adsToken),
                        now,
                        row.id,
                    ).run();
                    row.updated_at = now;
                }
            }

            tokens.push({
                user_id: row.facebook_user_id,
                ads_token: adsToken,
                // facebook_credentials table does not store post tokens.
                // Never mirror ads token into post_token; it causes wrong-token fallbacks.
                post_token: null,
                cookie,
                fb_dtsg: fbDtsg,
                user_name: row.account_name,
                avatar_url: row.avatar_url,
                updated_at: row.updated_at,
            });
        }

        return c.json({ success: true, tokens, refreshFromCookie });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/tokens
app.post('/', async (c) => {
    try {
        const { userId, adsToken, cookie, fbDtsg, userName, avatarUrl } = await c.req.json();
        if (!userId) return c.json({ success: false, error: 'Missing userId' }, 400);

        const workspaceId = getWorkspaceId(c);
        const createdByUserId = getUserId(c);
        const now = new Date().toISOString();
        const normalizedToken = adsToken || null;

        await c.env.DB.prepare(`
            INSERT INTO facebook_credentials (
                id, workspace_id, facebook_user_id, ads_token_encrypted, cookie_encrypted, fb_dtsg_encrypted,
                account_name, avatar_url, created_by_user_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                ads_token_encrypted = excluded.ads_token_encrypted,
                cookie_encrypted = excluded.cookie_encrypted,
                fb_dtsg_encrypted = excluded.fb_dtsg_encrypted,
                account_name = excluded.account_name,
                avatar_url = excluded.avatar_url,
                updated_at = excluded.updated_at
        `).bind(
            `${workspaceId}:${userId}`,
            workspaceId,
            userId,
            await encryptSecret(c.env, normalizedToken),
            await encryptSecret(c.env, cookie || null),
            await encryptSecret(c.env, fbDtsg || null),
            userName || userId,
            avatarUrl || null,
            createdByUserId,
            now,
            now,
        ).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as tokensRouter };
