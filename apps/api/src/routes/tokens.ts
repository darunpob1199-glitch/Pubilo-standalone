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

type GraphTokenValidationResult = {
    ok: boolean;
    reason: 'valid' | 'invalid' | 'network_error';
    error?: string;
};

function extractAccessTokenFromHtml(html: string): string {
    const source = String(html || '');
    if (!source) return '';

    const tokenChars = '[A-Za-z0-9_-]+';
    const patterns: RegExp[] = [
        new RegExp(`__accessToken\\s*=\\s*"(EA${tokenChars})"`),
        new RegExp(`"__accessToken"\\s*:\\s*"(EA${tokenChars})"`),
        new RegExp(`__window\\.__accessToken="(EA${tokenChars})"`),
        new RegExp(`"accessToken":\\s*"(EA${tokenChars})"`),
        new RegExp(`"access_token":\\s*"(EA${tokenChars})"`),
        new RegExp(`accessToken['"]\\s*:\\s*['"](EA${tokenChars})['"]`),
        new RegExp(`access_token=(EA${tokenChars})`),
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
            return String(match[1]).trim();
        }
    }

    return '';
}

async function validateGraphAccessToken(accessToken: string, expectedUserId: string = ''): Promise<GraphTokenValidationResult> {
    const normalizedToken = String(accessToken || '').trim();
    const normalizedExpectedUserId = String(expectedUserId || '').trim();
    if (!normalizedToken) {
        return { ok: false, reason: 'invalid', error: 'missing_token' };
    }

    try {
        const response = await fetch(
            `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(normalizedToken)}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            },
        );
        const data: any = await response.json().catch(() => ({}));
        if (data?.id && !data?.error) {
            const graphId = String(data.id || '').trim();
            if (normalizedExpectedUserId && graphId && graphId !== normalizedExpectedUserId) {
                return {
                    ok: false,
                    reason: 'invalid',
                    error: `token_user_mismatch:${graphId}`,
                };
            }

            const accountsResponse = await fetch(
                `https://graph.facebook.com/v21.0/me/accounts?fields=id&limit=1&access_token=${encodeURIComponent(normalizedToken)}`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                },
            );
            const accountsData: any = await accountsResponse.json().catch(() => ({}));
            if (Array.isArray(accountsData?.data) && !accountsData?.error) {
                return { ok: true, reason: 'valid' };
            }

            const accountErrMsg = normalizeGraphError(accountsData).toLowerCase();
            const accountErrCode = Number(accountsData?.error?.code || 0);
            const accountErrSubcode = Number(accountsData?.error?.error_subcode || 0);
            const accountTokenInvalid = accountErrCode === 190
                || accountErrCode === 102
                || accountErrSubcode === 463
                || accountErrSubcode === 467
                || accountErrMsg.includes('error validating access token')
                || accountErrMsg.includes('invalid oauth access token')
                || accountErrMsg.includes('access token is invalid');
            if (accountTokenInvalid) {
                return { ok: false, reason: 'invalid', error: normalizeGraphError(accountsData) };
            }

            return { ok: false, reason: 'network_error', error: normalizeGraphError(accountsData) };
        }

        const code = Number(data?.error?.code || 0);
        const subcode = Number(data?.error?.error_subcode || 0);
        const message = normalizeGraphError(data).toLowerCase();
        const isDefinitelyInvalid = code === 190
            || code === 102
            || subcode === 463
            || subcode === 467
            || message.includes('session has been invalidated')
            || message.includes('error validating access token')
            || message.includes('invalid oauth access token')
            || message.includes('access token has expired')
            || message.includes('access token is invalid')
            || message.includes('cannot parse access token');

        if (isDefinitelyInvalid) {
            return { ok: false, reason: 'invalid', error: normalizeGraphError(data) };
        }

        if (!response.ok) {
            return { ok: false, reason: 'network_error', error: normalizeGraphError(data) };
        }

        return { ok: false, reason: 'network_error', error: normalizeGraphError(data) };
    } catch (error) {
        return {
            ok: false,
            reason: 'network_error',
            error: String(error instanceof Error ? error.message : error),
        };
    }
}

async function fetchAccessTokenFromFacebookCookie(
    cookieData: string,
    currentAccessToken?: string,
    expectedUserId: string = '',
): Promise<{
    success: boolean;
    token?: string;
    error?: string;
}> {
    const headers = buildFacebookHeaders(cookieData);
    if (!headers) {
        return { success: false, error: 'Missing cookie' };
    }

    const normalizedAccessToken = String(currentAccessToken || '').trim();
    if (normalizedAccessToken) {
        const currentValidation = await validateGraphAccessToken(normalizedAccessToken, expectedUserId);
        if (currentValidation.ok) {
            return { success: true, token: normalizedAccessToken };
        }
    }

    const probeUrls = [
        'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
        'https://business.facebook.com/latest/home',
        'https://www.facebook.com/',
    ];
    let lastError = '';
    for (const endpoint of probeUrls) {
        try {
            const response = await fetch(endpoint, { headers });
            const html = await response.text();
            const extractedToken = extractAccessTokenFromHtml(html);
            if (!extractedToken) {
                continue;
            }

            const validation = await validateGraphAccessToken(extractedToken, expectedUserId);
            if (validation.ok) {
                return { success: true, token: extractedToken };
            }
            lastError = validation.error || 'Extracted access token is invalid';
        } catch (error) {
            lastError = String(error instanceof Error ? error.message : error);
        }
    }

    return { success: false, error: lastError || 'Cannot fetch valid access token from cookie' };
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
            const normalizedAdsToken = String(adsToken || '').trim();
            const currentValidation = normalizedAdsToken
                ? await validateGraphAccessToken(normalizedAdsToken, String(row.facebook_user_id || ''))
                : { ok: false, reason: 'invalid' as const };

            const needsCookieRefresh = !!(
                cookie &&
                (
                    refreshFromCookie ||
                    !normalizedAdsToken ||
                    currentValidation.reason === 'invalid'
                )
            );
            let shouldPersistTokenUpdate = false;
            let persistedTokenValue = normalizedAdsToken;

            if (needsCookieRefresh) {
                const refreshed = await fetchAccessTokenFromFacebookCookie(
                    String(cookie || ''),
                    normalizedAdsToken,
                    String(row.facebook_user_id || ''),
                );
                if (refreshed.success && refreshed.token && refreshed.token !== normalizedAdsToken) {
                    adsToken = refreshed.token;
                    persistedTokenValue = String(refreshed.token || '').trim();
                    shouldPersistTokenUpdate = true;
                } else if (!refreshed.success && currentValidation.reason === 'invalid') {
                    // Only clear the stored token when Graph definitively confirmed it as
                    // invalid (code 190). Avoid clearing on transient network errors
                    // which would permanently wipe a potentially-valid token.
                    const refreshErrorLower = String(refreshed.error || '').toLowerCase();
                    const isRefreshNetworkIssue =
                        refreshErrorLower.includes('fetch failed')
                        || refreshErrorLower.includes('network')
                        || refreshErrorLower.includes('timed out')
                        || refreshErrorLower.includes('timeout')
                        || refreshErrorLower.includes('econnrefused')
                        || refreshErrorLower.includes('dns');
                    if (!isRefreshNetworkIssue) {
                        adsToken = '';
                        persistedTokenValue = '';
                        shouldPersistTokenUpdate = true;
                    }
                }
            } else if (currentValidation.reason === 'invalid') {
                adsToken = '';
                persistedTokenValue = '';
                shouldPersistTokenUpdate = true;
            }

            if (shouldPersistTokenUpdate) {
                const now = new Date().toISOString();
                await c.env.DB.prepare(`
                    UPDATE facebook_credentials
                    SET ads_token_encrypted = ?, updated_at = ?
                    WHERE id = ?
                `).bind(
                    persistedTokenValue
                        ? await encryptSecret(c.env, persistedTokenValue)
                        : null,
                    now,
                    row.id,
                ).run();
                row.updated_at = now;
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
        const normalizeOptionalString = (value: unknown): string | null => {
            if (typeof value !== 'string') return null;
            const trimmed = value.trim();
            return trimmed ? trimmed : null;
        };
        const normalizedToken = normalizeOptionalString(adsToken);
        const normalizedCookie = normalizeOptionalString(cookie);
        const normalizedFbDtsg = normalizeOptionalString(fbDtsg);
        const normalizedUserName = normalizeOptionalString(userName) || String(userId).trim();
        const normalizedAvatarUrl = normalizeOptionalString(avatarUrl);

        await c.env.DB.prepare(`
            INSERT INTO facebook_credentials (
                id, workspace_id, facebook_user_id, ads_token_encrypted, cookie_encrypted, fb_dtsg_encrypted,
                account_name, avatar_url, created_by_user_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                ads_token_encrypted = COALESCE(excluded.ads_token_encrypted, facebook_credentials.ads_token_encrypted),
                cookie_encrypted = COALESCE(excluded.cookie_encrypted, facebook_credentials.cookie_encrypted),
                fb_dtsg_encrypted = COALESCE(excluded.fb_dtsg_encrypted, facebook_credentials.fb_dtsg_encrypted),
                account_name = COALESCE(excluded.account_name, facebook_credentials.account_name),
                avatar_url = COALESCE(excluded.avatar_url, facebook_credentials.avatar_url),
                updated_at = excluded.updated_at
        `).bind(
            `${workspaceId}:${userId}`,
            workspaceId,
            userId,
            await encryptSecret(c.env, normalizedToken),
            await encryptSecret(c.env, normalizedCookie),
            await encryptSecret(c.env, normalizedFbDtsg),
            normalizedUserName,
            normalizedAvatarUrl,
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
