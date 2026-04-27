import { Hono } from 'hono';
import { Env } from '../index';
import { recordPublishHistory } from '../lib/publish-history';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';
import { createNewsLinkPreview } from '../lib/news-link-previews';
import { getAppOrigin } from '../auth/session';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';
const DEFAULT_GHOST_TARGET_COUNTRIES = ['TH'];
const FACEBOOK_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

type GhostAdSeed = {
    adId: string;
    adsetId: string;
    campaignId: string;
    raw: any;
    source: 'stored' | 'page-match' | 'account-match' | 'bootstrap';
};

type HideAfterPublishResult = {
    attempted: boolean;
    hidden: boolean;
    method: string;
    error: string;
};

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = typeof cookieData === 'string' ? cookieData.trim() : '';
    if (!normalizedCookie) return undefined;

    return {
        Cookie: normalizedCookie,
        'User-Agent': FACEBOOK_USER_AGENT,
    };
}

function buildFacebookGraphHeaders(): Record<string, string> {
    return {
        'User-Agent': FACEBOOK_USER_AGENT,
    };
}

async function deleteGraphNodeWithToken(
    nodeId: string,
    accessToken: string,
    headers?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
    const normalizedId = String(nodeId || '').trim();
    const normalizedToken = String(accessToken || '').trim();
    if (!normalizedId || !normalizedToken) {
        return {
            ok: false,
            error: 'missing_id_or_access_token',
        };
    }

    try {
        const response = await fetch(
            `${FB_API}/${encodeURIComponent(normalizedId)}?access_token=${encodeURIComponent(normalizedToken)}`,
            {
                method: 'DELETE',
                headers,
            },
        );
        const data = await response.json() as any;
        if (response.ok && data?.success === true) {
            return { ok: true };
        }
        const code = data?.error?.code ? ` code=${data.error.code}` : '';
        const type = data?.error?.type ? ` type=${data.error.type}` : '';
        const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
        return {
            ok: false,
            error: String(data?.error?.message || data?.message || 'Graph delete failed') + code + type + subcode,
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function extractAccessTokenFromHtml(html: string): string {
    const source = String(html || '');
    if (!source) return '';

    const tokenChars = '[A-Za-z0-9_-]+';
    const patterns: RegExp[] = [
        new RegExp(`__accessToken\\s*=\\s*"(EA${tokenChars})"`),
        new RegExp(`"__accessToken"\\s*:\\s*"(EA${tokenChars})"`),
        new RegExp(`__window\\.__accessToken="(EA${tokenChars})"`),
        new RegExp(`"accessToken":\\s*"(EAABsbCS${tokenChars})"`),
        new RegExp(`"access_token":\\s*"(EAABsbCS${tokenChars})"`),
        new RegExp(`accessToken['"]\\s*:\\s*['"](EA${tokenChars})['"]`),
        new RegExp(`"accessToken":\\s*"(EA${tokenChars})"`),
        new RegExp(`"access_token":\\s*"(EA${tokenChars})"`),
        new RegExp(`access_token=(EA${tokenChars})`),
        new RegExp(`\\\\"__accessToken\\\\"\\s*:\\s*\\\\"(EA${tokenChars})\\\\"`),
        new RegExp(`\\\\"accessToken\\\\"\\s*:\\s*\\\\"(EA${tokenChars})\\\\"`),
        new RegExp(`\\\\"access_token\\\\"\\s*:\\s*\\\\"(EA${tokenChars})\\\\"`),
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
            return String(match[1]).trim();
        }
    }

    const loose = source.match(/EA[A-Za-z0-9_-]{20,}/g) || [];
    const ranked = Array.from(new Set(loose))
        .map((token) => String(token || '').trim())
        .filter(Boolean)
        .sort((a, b) => {
            const score = (value: string) => {
                if (value.startsWith('EAABsbCS')) return 500 + value.length;
                if (value.startsWith('EAAG')) return 450 + value.length;
                if (value.startsWith('EAAChZC')) return 400 + value.length;
                return 300 + value.length;
            };
            return score(b) - score(a);
        });
    if (ranked.length > 0) {
        return ranked[0];
    }

    return '';
}

async function fetchCookieDerivedAccessToken(headers: Record<string, string>): Promise<string> {
    const probeUrls = [
        'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
        'https://business.facebook.com/latest/home',
        'https://www.facebook.com/',
    ];

    for (const url of probeUrls) {
        try {
            const response = await fetch(url, { headers });
            const html = await response.text();
            const token = extractAccessTokenFromHtml(html);
            if (token) {
                console.log('[publish] Derived access token from cookie HTML probe:', url);
                return token;
            }
        } catch (error) {
            console.warn('[publish] Cookie HTML token probe failed:', url, error);
        }
    }

    return '';
}

function isAuthRelatedErrorMessage(rawMessage: unknown): boolean {
    const message = String(rawMessage || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('session has been invalidated') ||
        message.includes('error validating access token') ||
        message.includes('invalid oauth access token') ||
        message.includes('access token has expired') ||
        message.includes('access token is invalid') ||
        message.includes('cannot parse access token') ||
        message.includes('the access token could not be decrypted')
    );
}

function isSessionInvalidatedFacebookError(errorLike: any): boolean {
    const code = Number(errorLike?.code || 0);
    const type = String(errorLike?.type || '').toLowerCase();
    const message = String(errorLike?.message || '');
    if (code === 190) return true;
    if (code === 463 || code === 467) return true;
    if (type === 'oauthexception' && isAuthRelatedErrorMessage(message)) return true;
    return false;
}

function isGenericInvalidRequestMessage(rawMessage: unknown): boolean {
    const message = String(rawMessage || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('invalid request')
        || message.includes('invalid parameter')
        || message.includes('invalid post request')
        || message.includes('invalid args')
        || message.includes('unsupported post request')
        || message.includes('error loading application')
    );
}

function normalizeBase64Input(raw?: string): string {
    if (!raw || typeof raw !== 'string') return '';

    const trimmed = raw.trim();
    if (!trimmed) return '';

    const payload = (() => {
        if (!trimmed.startsWith('data:')) return trimmed;
        const commaIndex = trimmed.indexOf(',');
        return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : '';
    })();

    let normalized = payload
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const remainder = normalized.length % 4;
    if (remainder > 0) {
        normalized += '='.repeat(4 - remainder);
    }

    return normalized;
}

function dataUrlToBlob(dataUrl: string): Blob {
    const [header = '', payload = ''] = dataUrl.split(',', 2);
    const mimeMatch = header.match(/^data:(.*?);base64$/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const base64 = normalizeBase64Input(payload);

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

async function fetchImageBlobFromUrl(url: string): Promise<Blob | null> {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) return null;
    try {
        const response = await fetch(normalizedUrl, {
            headers: {
                'User-Agent': FACEBOOK_USER_AGENT,
            },
        });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        if (!bytes || bytes.byteLength === 0) return null;
        return new Blob([bytes], { type: mimeType });
    } catch {
        return null;
    }
}

async function uploadImageToHost(imageData: string, apiKey?: string): Promise<string> {
    if (!apiKey) return '';

    const normalizedBase64 = normalizeBase64Input(imageData);
    if (!normalizedBase64) return '';

    const formData = new FormData();
    formData.append('key', apiKey);
    formData.append('source', normalizedBase64);
    formData.append('format', 'json');

    const response = await fetch('https://freeimage.host/api/1/upload', {
        method: 'POST',
        body: formData,
    });

    const data = await response.json() as any;
    if (!response.ok || data.error) {
        throw new Error(data?.error?.message || `Image upload failed: ${response.status}`);
    }

    return data.image?.url || data.image?.display_url || '';
}

async function fetchFreshPageToken(pageId: string, accessToken?: string, cookieData?: string): Promise<string> {
    const cookieHeaders = buildFacebookHeaders(cookieData);
    const tokenHeaders = buildFacebookGraphHeaders();
    const normalizedAccessToken = String(accessToken || '').trim();

    // Try with access token first (standard Graph API)
    if (normalizedAccessToken) {
        try {
            const accountsRes = await fetch(
                `${FB_API}/me/accounts?access_token=${encodeURIComponent(normalizedAccessToken)}&fields=id,access_token&limit=100`,
                { headers: tokenHeaders },
            );
            const accountsData = await accountsRes.json() as any;
            const matchedPage = accountsData?.data?.find((page: any) => String(page.id) === String(pageId));

            if (matchedPage?.access_token) {
                return matchedPage.access_token;
            }
        } catch (error) {
            console.warn('[publish] /me/accounts page token fetch failed:', error);
        }

        try {
            const tokenRes = await fetch(
                `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(normalizedAccessToken)}`,
                { headers: tokenHeaders },
            );
            const tokenData = await tokenRes.json() as any;

            if (tokenData?.access_token) {
                return tokenData.access_token;
            }
        } catch (error) {
            console.warn('[publish] direct page token fetch failed:', error);
        }
    }

    // Cookie-only fallback: call Graph API with just Cookie header (no access_token param).
    if (cookieHeaders) {
        try {
            const cookieRes = await fetch(
                `${FB_API}/me/accounts?fields=id,access_token&limit=100`,
                { headers: cookieHeaders },
            );
            const cookieData2 = await cookieRes.json() as any;
            if (cookieData2?.data) {
                const matchedPage = cookieData2.data.find((page: any) => String(page.id) === String(pageId));
                if (matchedPage?.access_token) {
                    console.log('[publish] Got page token via cookie-only auth');
                    return matchedPage.access_token;
                }
            }
        } catch (error) {
            console.warn('[publish] cookie-only page token fetch failed:', error);
        }

        // Last fallback: derive a temporary access token from Facebook HTML using cookie
        // and retry Graph page-token extraction with that token.
        const derivedAccessToken = await fetchCookieDerivedAccessToken(cookieHeaders);
        if (derivedAccessToken) {
            try {
                const derivedAccountsRes = await fetch(
                    `${FB_API}/me/accounts?access_token=${encodeURIComponent(derivedAccessToken)}&fields=id,access_token&limit=100`,
                    { headers: tokenHeaders },
                );
                const derivedAccountsData = await derivedAccountsRes.json() as any;
                const matchedPage = derivedAccountsData?.data?.find((page: any) => String(page.id) === String(pageId));
                if (matchedPage?.access_token) {
                    console.log('[publish] Got page token via cookie-derived access token');
                    return String(matchedPage.access_token).trim();
                }
            } catch (error) {
                console.warn('[publish] cookie-derived token /me/accounts fetch failed:', error);
            }
        }
    }

    return '';
}

async function publishViaFeedCookieOnly(params: {
    pageId: string;
    cookieHeaders: Record<string, string>;
    message?: string;
    linkUrl?: string;
}): Promise<{ postId: string }> {
    const body = new URLSearchParams();
    if (params.message) body.set('message', params.message);
    if (params.linkUrl) body.set('link', params.linkUrl);

    const response = await fetch(`${FB_API}/${params.pageId}/feed`, {
        method: 'POST',
        headers: {
            ...params.cookieHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    const data = await response.json() as any;
    if (data?.error) {
        throw new Error(data.error.message || 'Cookie-only feed post failed');
    }
    const postId = String(data?.id || data?.post_id || '');
    if (!postId) throw new Error('Facebook did not return post id for cookie-only feed');
    return { postId };
}

async function publishPhotoCookieOnly(params: {
    pageId: string;
    cookieHeaders: Record<string, string>;
    imageUrl?: string;
    caption?: string;
    scheduledTime?: number | null;
}): Promise<{ postId: string }> {
    const body = new URLSearchParams();
    if (params.imageUrl) body.set('url', params.imageUrl);
    if (params.caption) body.set('caption', params.caption);
    if (params.scheduledTime) {
        body.set('published', 'false');
        body.set('scheduled_publish_time', String(params.scheduledTime));
    }

    const response = await fetch(`${FB_API}/${params.pageId}/photos`, {
        method: 'POST',
        headers: {
            ...params.cookieHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    const data = await response.json() as any;
    if (data?.error) {
        throw new Error(data.error.message || 'Cookie-only photo post failed');
    }
    const postId = String(data?.post_id || data?.id || '');
    if (!postId) throw new Error('Facebook did not return post id for cookie-only photo');
    return { postId };
}

async function fetchFreshPageTokenFromWorkspaceCredentials(
    env: Env,
    organizationId: string,
    pageId: string,
): Promise<string> {
    try {
        const rows = await env.DB.prepare(`
            SELECT ads_token_encrypted, cookie_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
        `).bind(organizationId).all<{ ads_token_encrypted?: string | null; cookie_encrypted?: string | null }>();

        for (const row of rows.results || []) {
            const adsToken = String(await decryptSecret(env, row?.ads_token_encrypted) || '').trim();
            const cookie = String(await decryptSecret(env, row?.cookie_encrypted) || '').trim();
            if (!adsToken && !cookie) continue;

            const token = await fetchFreshPageToken(pageId, adsToken, cookie);
            if (token) {
                return token;
            }
        }
    } catch (error) {
        console.warn('[publish] workspace facebook_credentials token fetch failed:', error);
    }

    return '';
}

async function recoverAdsTokenFromWorkspaceCredentials(
    env: Env,
    organizationId: string,
): Promise<string> {
    try {
        const rows = await env.DB.prepare(`
            SELECT ads_token_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 3
        `).bind(organizationId).all<{ ads_token_encrypted?: string | null }>();

        for (const row of rows.results || []) {
            const adsToken = String(await decryptSecret(env, row?.ads_token_encrypted) || '').trim();
            if (!adsToken) continue;

            const testResp = await fetch(
                `${FB_API}/me?access_token=${encodeURIComponent(adsToken)}&fields=id`,
            );
            const testData = await testResp.json() as any;
            if (testData?.id && !testData?.error) {
                console.log('[publish] Recovered valid ads token from workspace credentials');
                return adsToken;
            }
        }
    } catch (error) {
        console.warn('[publish] ads token recovery from workspace credentials failed:', error);
    }
    return '';
}

async function getWorkspaceCookieCandidates(
    env: Env,
    organizationId: string,
): Promise<string[]> {
    try {
        const rows = await env.DB.prepare(`
            SELECT cookie_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
        `).bind(organizationId).all<{ cookie_encrypted?: string | null }>();

        const seen = new Set<string>();
        const cookies: string[] = [];
        for (const row of rows.results || []) {
            const cookie = String(await decryptSecret(env, row?.cookie_encrypted) || '').trim();
            if (!cookie || seen.has(cookie)) continue;
            seen.add(cookie);
            cookies.push(cookie);
        }
        return cookies;
    } catch (error) {
        console.warn('[publish] workspace cookie candidates fetch failed:', error);
        return [];
    }
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

function buildFacebookPostUrl(postId?: string, pageId?: string): string {
    const normalizedPostId = String(postId || '').trim();
    if (normalizedPostId) {
        return `https://www.facebook.com/${normalizedPostId}`;
    }

    const normalizedPageId = String(pageId || '').trim();
    return normalizedPageId ? `https://www.facebook.com/${normalizedPageId}` : 'https://www.facebook.com/';
}

function normalizeAdAccountId(adAccountId?: string): string {
    const normalized = String(adAccountId || '').trim();
    if (!normalized) return '';
    return normalized.startsWith('act_') ? normalized : `act_${normalized}`;
}

function parseBooleanFlag(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1'
        || normalized === 'true'
        || normalized === 'yes'
        || normalized === 'on';
}

const ALLOWED_CALL_TO_ACTION_TYPES = new Set([
    'SHOP_NOW',
    'LEARN_MORE',
    'SIGN_UP',
    'BOOK_NOW',
    'APPLY_NOW',
    'CONTACT_US',
    'DOWNLOAD',
    'GET_OFFER',
    'GET_QUOTE',
    'ORDER_NOW',
    'SUBSCRIBE',
    'WATCH_MORE',
    'SEND_MESSAGE',
    'MESSAGE_PAGE',
    'CALL_NOW',
]);

function normalizeCallToActionType(callToAction?: string): string {
    const normalized = String(callToAction || '').trim().toUpperCase();
    if (!normalized) return 'SHOP_NOW';
    return ALLOWED_CALL_TO_ACTION_TYPES.has(normalized)
        ? normalized
        : 'SHOP_NOW';
}

function buildNewsPreviewUrl(baseUrl: string, params: {
    previewId?: string;
    targetUrl?: string;
    imageUrl?: string;
    title?: string;
    description?: string;
    siteName?: string;
    version?: string;
}): string {
    const previewUrl = new URL('/api/news-link', baseUrl);

    if (params.previewId) {
        previewUrl.searchParams.set('id', params.previewId);
    }
    if (params.targetUrl) {
        previewUrl.searchParams.set('target', params.targetUrl);
    }

    if (params.imageUrl) previewUrl.searchParams.set('image', params.imageUrl);
    if (params.title) previewUrl.searchParams.set('title', params.title);
    if (params.description) previewUrl.searchParams.set('description', params.description);
    if (params.siteName) previewUrl.searchParams.set('site', params.siteName);
    if (params.version) previewUrl.searchParams.set('v', params.version);

    return previewUrl.toString();
}

function isControlledNewsPreviewUrl(rawUrl?: string): boolean {
    const normalized = String(rawUrl || '').trim();
    if (!normalized) return false;

    try {
        const parsed = new URL(normalized);
        return parsed.pathname === '/api/news-link'
            && (parsed.searchParams.has('id') || parsed.searchParams.has('target'));
    } catch {
        return false;
    }
}

function deriveSiteName(inputCaption?: string, targetUrl?: string): string {
    const explicit = inputCaption?.trim();
    if (explicit) return explicit;

    if (targetUrl) {
        try {
            return new URL(targetUrl).hostname.replace(/^www\./, '').toUpperCase();
        } catch {
            // Ignore parse errors and fall through.
        }
    }

    return 'PUBILO';
}

function normalizeOutboundLink(rawValue?: string): string {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        return raw;
    }

    if (raw.startsWith('//')) {
        return `https:${raw}`;
    }

    const withHttps = `https://${raw.replace(/^\/+/, '')}`;
    try {
        const parsed = new URL(withHttps);
        if (parsed.hostname) {
            return withHttps;
        }
    } catch {
        // keep original fallback
    }

    return raw;
}

function normalizeTargetPageIds(input: unknown, currentPageId: string): string[] {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    const normalizedCurrentPageId = String(currentPageId);

    return input
        .map((value) => String(value || '').trim())
        .filter((value) => {
            if (!value || value === normalizedCurrentPageId || seen.has(value)) {
                return false;
            }
            seen.add(value);
            return true;
        });
}

async function ensureScheduledPublishQueueTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
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
    } catch (_) {
        // Ignore if column already exists on long-lived prod DBs.
    }

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_status_time
        ON scheduled_publish_queue (status, scheduled_time)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_page_status
        ON scheduled_publish_queue (page_id, status, scheduled_time)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_batch_id
        ON scheduled_publish_queue (batch_id, status, scheduled_time)
    `).run();
}

async function ensureGhostAdSeedsTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ghost_ad_seeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT NOT NULL,
            page_id TEXT NOT NULL,
            ad_account_id TEXT NOT NULL,
            campaign_id TEXT NOT NULL,
            adset_id TEXT NOT NULL,
            seed_ad_id TEXT,
            source TEXT NOT NULL DEFAULT 'bootstrap',
            metadata_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (organization_id, page_id, ad_account_id)
        )
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_ghost_ad_seeds_lookup
        ON ghost_ad_seeds (organization_id, page_id, ad_account_id)
    `).run();
}

async function loadGhostAdSeed(
    env: Env,
    organizationId: string,
    pageId: string,
    adAccountId: string,
): Promise<GhostAdSeed | null> {
    await ensureGhostAdSeedsTable(env);

    const row = await env.DB.prepare(`
        SELECT campaign_id, adset_id, seed_ad_id, metadata_json
        FROM ghost_ad_seeds
        WHERE organization_id = ? AND page_id = ? AND ad_account_id = ?
        LIMIT 1
    `).bind(organizationId, pageId, adAccountId).first<{
        campaign_id?: string | null;
        adset_id?: string | null;
        seed_ad_id?: string | null;
        metadata_json?: string | null;
    }>();

    const campaignId = String(row?.campaign_id || '').trim();
    const adsetId = String(row?.adset_id || '').trim();
    if (!campaignId || !adsetId) return null;

    let raw: any = null;
    try {
        raw = row?.metadata_json ? JSON.parse(row.metadata_json) : null;
    } catch {
        raw = null;
    }

    return {
        adId: String(row?.seed_ad_id || '').trim(),
        adsetId,
        campaignId,
        raw,
        source: 'stored',
    };
}

async function saveGhostAdSeed(
    env: Env,
    params: {
        organizationId: string;
        pageId: string;
        adAccountId: string;
        campaignId: string;
        adsetId: string;
        seedAdId?: string;
        source?: GhostAdSeed['source'];
        metadata?: any;
    },
): Promise<void> {
    if (!params.organizationId || !params.pageId || !params.adAccountId || !params.campaignId || !params.adsetId) {
        return;
    }

    await ensureGhostAdSeedsTable(env);

    await env.DB.prepare(`
        INSERT INTO ghost_ad_seeds (
            organization_id,
            page_id,
            ad_account_id,
            campaign_id,
            adset_id,
            seed_ad_id,
            source,
            metadata_json,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(organization_id, page_id, ad_account_id) DO UPDATE SET
            campaign_id = excluded.campaign_id,
            adset_id = excluded.adset_id,
            seed_ad_id = excluded.seed_ad_id,
            source = excluded.source,
            metadata_json = excluded.metadata_json,
            updated_at = CURRENT_TIMESTAMP
    `).bind(
        params.organizationId,
        params.pageId,
        params.adAccountId,
        params.campaignId,
        params.adsetId,
        params.seedAdId || null,
        params.source || 'bootstrap',
        params.metadata ? JSON.stringify(params.metadata) : null,
    ).run();
}

async function deleteGhostAdSeed(
    env: Env,
    organizationId: string,
    pageId: string,
    adAccountId: string,
): Promise<void> {
    await ensureGhostAdSeedsTable(env);
    await env.DB.prepare(`
        DELETE FROM ghost_ad_seeds
        WHERE organization_id = ? AND page_id = ? AND ad_account_id = ?
    `).bind(organizationId, pageId, adAccountId).run();
}

async function enqueueScheduledPublish(
    env: Env,
    organizationId: string,
    pageId: string,
    scheduledTime: number,
    payload: Record<string, unknown>,
    batchId?: string,
): Promise<number> {
    await ensureScheduledPublishQueueTable(env);

    const result = await env.DB.prepare(`
        INSERT INTO scheduled_publish_queue (
            organization_id,
            page_id,
            payload_json,
            batch_id,
            scheduled_time,
            status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
    `).bind(
        organizationId,
        pageId,
        JSON.stringify(payload),
        batchId || null,
        scheduledTime
    ).run();

    return Number(result.meta?.last_row_id || 0);
}

async function publishExistingUnpublishedPost(postId: string, pageToken: string, headers?: Record<string, string>): Promise<void> {
    const attempts: Array<{ method: string; params: Record<string, string> }> = [
        { method: 'is_published', params: { is_published: 'true' } },
        { method: 'published', params: { published: 'true' } },
        { method: 'is_published+published', params: { is_published: 'true', published: 'true' } },
    ];

    let lastErrorMessage = '';
    let lastFacebookError: any = null;

    for (const attempt of attempts) {
        const publishParams = new URLSearchParams({
            access_token: pageToken,
            ...attempt.params,
        });

        const response = await fetch(`${FB_API}/${postId}`, {
            method: 'POST',
            headers: {
                ...(headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: publishParams.toString(),
        });
        const data = await response.json() as any;
        if (!data?.error) {
            return;
        }

        lastFacebookError = data.error || lastFacebookError;
        lastErrorMessage = data.error?.message || `Failed to publish unpublished post (${attempt.method})`;
    }

    const error = new Error(lastErrorMessage || 'Failed to publish unpublished post') as Error & {
        facebookError?: any;
    };
    error.facebookError = lastFacebookError;
    throw error;
}

async function publishExistingUnpublishedPostWithCandidates(
    postId: string,
    pageTokens: string[],
    headers?: Record<string, string>,
): Promise<string> {
    let lastError: Error | null = null;

    for (const candidateToken of buildAuthCandidates(pageTokens)) {
        try {
            await publishExistingUnpublishedPost(postId, candidateToken, headers);
            return candidateToken;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error || 'Failed to publish unpublished post'));
        }
    }

    throw lastError || new Error('Failed to publish unpublished post');
}

async function hidePagePostFromTimeline(
    postId: string,
    token: string,
    headers?: Record<string, string>,
): Promise<{ success: boolean; method?: string; error?: string }> {
    const attempts = [
        {
            method: 'is_hidden',
            body: new URLSearchParams({
                access_token: token,
                is_hidden: 'true',
            }),
        },
        {
            method: 'timeline_visibility',
            body: new URLSearchParams({
                access_token: token,
                timeline_visibility: 'hidden',
            }),
        },
    ];

    let lastError = '';
    for (const attempt of attempts) {
        const response = await fetch(`${FB_API}/${postId}`, {
            method: 'POST',
            headers: {
                ...(headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: attempt.body.toString(),
        });
        const data = await response.json() as any;
        if (!data?.error) {
            return {
                success: true,
                method: attempt.method,
            };
        }
        lastError = data?.error?.message || `hide_failed_${attempt.method}`;
    }

    return {
        success: false,
        error: lastError || 'Failed to hide post from timeline',
    };
}

async function hidePagePostFromTimelineCookieOnly(
    postId: string,
    headers: Record<string, string>,
): Promise<{ success: boolean; method?: string; error?: string }> {
    const attempts = [
        {
            method: 'cookie_is_hidden',
            body: new URLSearchParams({
                is_hidden: 'true',
            }),
        },
        {
            method: 'cookie_timeline_visibility',
            body: new URLSearchParams({
                timeline_visibility: 'hidden',
            }),
        },
    ];

    let lastError = '';
    for (const attempt of attempts) {
        const response = await fetch(`${FB_API}/${postId}`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: attempt.body.toString(),
        });
        const data = await response.json() as any;
        if (!data?.error) {
            return {
                success: true,
                method: attempt.method,
            };
        }
        lastError = data?.error?.message || `hide_failed_${attempt.method}`;
    }

    return {
        success: false,
        error: lastError || 'Failed to hide post from timeline (cookie-only)',
    };
}

async function publishLinkCardViaFeed(params: {
    pageId: string;
    pageToken: string;
    headers?: Record<string, string>;
    message?: string;
    linkUrl: string;
    title?: string;
    caption?: string;
    description?: string;
    pictureUrl?: string;
    callToActionType?: string;
    callToActionLinkUrl?: string;
    publishAsAdsPost?: boolean;
    scheduledTime?: number | null;
    allowMetadataDropRetry?: boolean;
}): Promise<{ postId: string; createdAsDraft: boolean }> {
    const shouldLetFacebookScrapePreview = isControlledNewsPreviewUrl(params.linkUrl);
    // Controlled previews own the OG tags. Sending Graph API metadata overrides
    // for external targets makes Facebook reject with "Only owners of the URL...".
    const hasLinkMetadata = Boolean(
        !shouldLetFacebookScrapePreview && (
            params.title ||
            params.caption ||
            params.description ||
            params.pictureUrl
        )
    );
    const hasCallToAction = Boolean(params.callToActionType);

    const execute = async (options: {
        includeLinkMetadata: boolean;
        includeCallToAction: boolean;
        includeAdsDraft: boolean;
    }): Promise<{ postId: string; createdAsDraft: boolean }> => {
        const body = new URLSearchParams({
            access_token: params.pageToken,
            link: params.linkUrl,
        });
        const shouldCreateDraft = Boolean(params.publishAsAdsPost) && !params.scheduledTime && options.includeAdsDraft;

        if (params.message) body.set('message', params.message);

        if (options.includeLinkMetadata) {
            if (!shouldLetFacebookScrapePreview) {
                if (params.title) body.set('name', params.title);
                if (params.caption) body.set('caption', params.caption);
                if (params.description) body.set('description', params.description);
            }
            if (params.pictureUrl && !shouldLetFacebookScrapePreview) {
                body.set('picture', params.pictureUrl);
            }
        }

        if (options.includeCallToAction && params.callToActionType) {
            body.set('call_to_action', JSON.stringify({
                type: params.callToActionType,
                value: {
                    link: params.callToActionLinkUrl || params.linkUrl,
                },
            }));
        }

        if (params.scheduledTime) {
            body.set('published', 'false');
            body.set('scheduled_publish_time', String(params.scheduledTime));
            body.set('unpublished_content_type', 'ADS_POST');
        } else if (shouldCreateDraft) {
            body.set('published', 'false');
            body.set('unpublished_content_type', 'ADS_POST');
        }

        const response = await fetch(`${FB_API}/${params.pageId}/feed`, {
            method: 'POST',
            headers: {
                ...(params.headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        const data = await response.json() as any;
        if (data?.error) {
            const error = new Error(data.error.message || 'Failed to create feed link card post') as Error & {
                facebookError?: any;
            };
            error.facebookError = data.error;
            throw error;
        }

        const postId = String(data?.id || data?.post_id || '');
        if (!postId) {
            throw new Error('Facebook did not return post id for feed link card');
        }

        return {
            postId,
            createdAsDraft: shouldCreateDraft,
        };
    };

    try {
        return await execute({
            includeLinkMetadata: hasLinkMetadata,
            includeCallToAction: hasCallToAction,
            includeAdsDraft: true,
        });
    } catch (error) {
        const firstMessage = error instanceof Error ? error.message : String(error);
        const firstLower = firstMessage.toLowerCase();
        const isOwnershipMetadataError = firstLower.includes('only owners of the url')
            && firstLower.includes('picture, name, thumbnail or description');
        const isGenericInvalidRequest = isGenericInvalidRequestMessage(firstMessage);
        const isCallToActionError = firstLower.includes('call_to_action')
            || firstLower.includes('call to action')
            || firstLower.includes('unpublished_content_type')
            || isGenericInvalidRequest;

        // Retry 1: drop metadata overrides if Facebook rejects domain metadata ownership.
        if (hasLinkMetadata && isOwnershipMetadataError) {
            try {
                return await execute({
                    includeLinkMetadata: false,
                    includeCallToAction: hasCallToAction,
                    includeAdsDraft: true,
                });
            } catch (retryError) {
                error = retryError;
            }
        }

        const retryMessage = error instanceof Error ? error.message : String(error);
        const retryLower = retryMessage.toLowerCase();
        const retryGenericInvalidRequest = isGenericInvalidRequestMessage(retryMessage);
        const retryCallToActionError = retryLower.includes('call_to_action')
            || retryLower.includes('call to action')
            || retryLower.includes('unpublished_content_type')
            || retryGenericInvalidRequest;

        // Retry 2: CTA might be rejected for some pages/tokens; retry without CTA.
        if (hasCallToAction && (isCallToActionError || retryCallToActionError)) {
            try {
                return await execute({
                    includeLinkMetadata: hasLinkMetadata,
                    includeCallToAction: false,
                    includeAdsDraft: true,
                });
            } catch (retryError) {
                error = retryError;
            }
        }

        // Retry 3: if ads-post mode is blocked, fallback to normal feed post.
        const thirdMessage = error instanceof Error ? error.message : String(error);
        const thirdLower = thirdMessage.toLowerCase();
        const isAdsPostError = thirdLower.includes('unpublished_content_type')
            || thirdLower.includes('ads_post')
            || isGenericInvalidRequestMessage(thirdMessage);
        if (Boolean(params.publishAsAdsPost) && isAdsPostError) {
            try {
                return await execute({
                    includeLinkMetadata: hasLinkMetadata,
                    includeCallToAction: false,
                    includeAdsDraft: false,
                });
            } catch (retryError) {
                error = retryError;
            }
        }

        // Optional last retry: drop all link metadata overrides.
        if (hasLinkMetadata && params.allowMetadataDropRetry === true) {
            try {
                return await execute({
                    includeLinkMetadata: false,
                    includeCallToAction: false,
                    includeAdsDraft: true,
                });
            } catch (retryError) {
                error = retryError;
            }
        }

        // Final fallback: combine both degradations (no metadata + no CTA + no ads draft).
        if (Boolean(params.publishAsAdsPost)) {
            const lastMessage = error instanceof Error ? error.message : String(error);
            const lastLower = String(lastMessage || '').toLowerCase();
            const shouldTryDirectPublishedFallback = isGenericInvalidRequestMessage(lastMessage)
                || lastLower.includes('unpublished_content_type')
                || lastLower.includes('ads_post');
            if (shouldTryDirectPublishedFallback) {
                try {
                    return await execute({
                        includeLinkMetadata: false,
                        includeCallToAction: false,
                        includeAdsDraft: false,
                    });
                } catch (retryError) {
                    error = retryError;
                }
            }
        }

        throw error;
    }
}

async function wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCreativeStoryIdWithRetry(
    creativeId: string,
    accessToken: string,
    headers?: Record<string, string>,
    attempts = 8,
    delayMs = 900,
): Promise<{ postId: string; raw: any }> {
    let lastData: any = null;
    const fields = 'id,object_story_id,effective_object_story_id,object_story_spec';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await fetch(
            `${FB_API}/${creativeId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
            headers ? { headers } : undefined
        );
        const data = await response.json() as any;
        lastData = data;

        if (data?.error) {
            throw new Error(data.error.message || 'Failed to fetch ad creative details');
        }

        const postId = data.object_story_id || data.effective_object_story_id || '';
        if (postId) {
            return { postId, raw: data };
        }

        if (attempt < attempts) {
            await wait(delayMs);
        }
    }

    return { postId: '', raw: lastData };
}

async function fetchReusableAdSeed(params: {
    adAccountId: string;
    accessToken: string;
    pageId: string;
    headers?: Record<string, string>;
}): Promise<GhostAdSeed | null> {
    const fields = 'id,name,adset_id,campaign_id,created_time,creative{id,effective_object_story_id,object_story_id,object_story_spec}';
    const response = await fetch(
        `${FB_API}/${params.adAccountId}/ads?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(params.accessToken)}`,
        params.headers ? { headers: params.headers } : undefined
    );
    const data = await response.json() as any;

    if (data?.error) {
        throw new Error(data.error.message || 'Failed to fetch reusable ad seed');
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const normalizedRows = rows
        .map((row: any) => {
            const spec = row?.creative?.object_story_spec || {};
            const creativePageId = String(spec?.page_id || '');
            const hasLinkData = !!spec?.link_data?.link;
            const hasStoryId = !!(row?.creative?.object_story_id || row?.creative?.effective_object_story_id);
            return {
                row,
                adId: String(row?.id || ''),
                adsetId: String(row?.adset_id || ''),
                campaignId: String(row?.campaign_id || ''),
                createdTime: String(row?.created_time || ''),
                creativePageId,
                hasLinkData,
                hasStoryId,
            };
        })
        .filter((row: any) => row.adId && row.adsetId && row.campaignId)
        .sort((a: any, b: any) => (a.createdTime < b.createdTime ? 1 : a.createdTime > b.createdTime ? -1 : 0));

    const pageMatch = normalizedRows.find((row: any) => row.creativePageId === String(params.pageId));
    if (pageMatch) {
        return {
            adId: pageMatch.adId,
            adsetId: pageMatch.adsetId,
            campaignId: pageMatch.campaignId,
            raw: pageMatch.row,
            source: 'page-match',
        };
    }

    const accountMatch = normalizedRows
        .filter((row: any) => row.hasLinkData || row.hasStoryId || row.creativePageId)
        .sort((a: any, b: any) => {
            const scoreA = Number(!!a.hasLinkData) * 2 + Number(!!a.hasStoryId);
            const scoreB = Number(!!b.hasLinkData) * 2 + Number(!!b.hasStoryId);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.createdTime < b.createdTime ? 1 : a.createdTime > b.createdTime ? -1 : 0;
        })[0];

    if (!accountMatch) {
        return null;
    }

    return {
        adId: accountMatch.adId,
        adsetId: accountMatch.adsetId,
        campaignId: accountMatch.campaignId,
        raw: accountMatch.row,
        source: 'account-match',
    };
}

async function fetchAccessibleAdAccountIds(
    accessToken: string,
    headers?: Record<string, string>,
): Promise<string[]> {
    const response = await fetch(
        `${FB_API}/me/adaccounts?fields=account_id,account_status&limit=100&access_token=${encodeURIComponent(accessToken)}`,
        headers ? { headers } : undefined
    );
    const data = await response.json() as any;

    if (data?.error) {
        throw new Error(data.error.message || 'Failed to fetch accessible ad accounts');
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const seen = new Set<string>();
    const accountIds: string[] = [];

    for (const row of rows) {
        const accountId = normalizeAdAccountId(row?.account_id);
        if (!accountId || seen.has(accountId)) continue;
        seen.add(accountId);
        accountIds.push(accountId);
    }

    return accountIds;
}

async function resolveAdSeedContext(params: {
    env: Env;
    organizationId: string;
    preferredAdAccountId: string;
    accessToken: string;
    pageId: string;
    headers?: Record<string, string>;
}): Promise<{
    adAccountId: string;
    seed: GhostAdSeed | null;
    scannedAccounts: string[];
}> {
    const candidateAccounts = [params.preferredAdAccountId].filter(Boolean);

    try {
        const accessibleAccounts = await fetchAccessibleAdAccountIds(params.accessToken, params.headers);
        for (const accountId of accessibleAccounts) {
            if (!accountId || candidateAccounts.includes(accountId)) continue;
            candidateAccounts.push(accountId);
        }
    } catch (error) {
        console.warn('[publish] Failed to enumerate accessible ad accounts:', error);
    }

    for (const accountId of candidateAccounts) {
        try {
            const storedSeed = await loadGhostAdSeed(
                params.env,
                params.organizationId,
                params.pageId,
                accountId,
            );
            if (storedSeed?.adsetId) {
                return {
                    adAccountId: accountId,
                    seed: storedSeed,
                    scannedAccounts: candidateAccounts,
                };
            }

            const seed = await fetchReusableAdSeed({
                adAccountId: accountId,
                accessToken: params.accessToken,
                pageId: params.pageId,
                headers: params.headers,
            });
            if (seed?.adsetId) {
                return {
                    adAccountId: accountId,
                    seed,
                    scannedAccounts: candidateAccounts,
                };
            }
        } catch (error) {
            console.warn('[publish] Failed to inspect ad account for reusable seed:', {
                accountId,
                error,
            });
        }
    }

    return {
        adAccountId: params.preferredAdAccountId,
        seed: null,
        scannedAccounts: candidateAccounts,
    };
}

async function createGhostBootstrapCampaign(params: {
    adAccountId: string;
    accessToken: string;
    headers?: Record<string, string>;
    pageId: string;
}): Promise<{ campaignId: string; objective: string; raw: any }> {
    const objectives = ['OUTCOME_TRAFFIC', 'LINK_CLICKS'];
    let lastError = '';

    for (const objective of objectives) {
        const body = new URLSearchParams({
            access_token: params.accessToken,
            name: `Pubilo Ghost Seed ${params.pageId}`,
            objective,
            status: 'PAUSED',
            special_ad_categories: '[]',
        });

        const response = await fetch(`${FB_API}/${params.adAccountId}/campaigns`, {
            method: 'POST',
            headers: {
                ...(params.headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        const data = await response.json() as any;
        if (!data?.error && data?.id) {
            return {
                campaignId: String(data.id),
                objective,
                raw: data,
            };
        }
        lastError = data?.error?.message || `Failed to create bootstrap campaign with objective ${objective}`;
    }

    throw new Error(lastError || 'Failed to create bootstrap campaign');
}

async function createGhostBootstrapAdSet(params: {
    adAccountId: string;
    accessToken: string;
    headers?: Record<string, string>;
    pageId: string;
    campaignId: string;
}): Promise<{ adsetId: string; raw: any }> {
    const targeting = JSON.stringify({
        geo_locations: {
            countries: DEFAULT_GHOST_TARGET_COUNTRIES,
        },
        publisher_platforms: ['facebook'],
        facebook_positions: ['feed'],
        device_platforms: ['mobile', 'desktop'],
        age_min: 18,
        age_max: 65,
    });

    const variants: Array<Record<string, string>> = [
        {
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'LINK_CLICKS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            destination_type: 'WEBSITE',
            promoted_object: JSON.stringify({ page_id: params.pageId }),
        },
        {
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'LINK_CLICKS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            destination_type: 'WEBSITE',
        },
        {
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'REACH',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        },
    ];

    let lastError = '';

    for (const variant of variants) {
        const body = new URLSearchParams({
            access_token: params.accessToken,
            name: `Pubilo Ghost Seed ${params.pageId}`,
            campaign_id: params.campaignId,
            status: 'PAUSED',
            daily_budget: '10000',
            targeting,
            ...variant,
        });

        const response = await fetch(`${FB_API}/${params.adAccountId}/adsets`, {
            method: 'POST',
            headers: {
                ...(params.headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        const data = await response.json() as any;
        if (!data?.error && data?.id) {
            return {
                adsetId: String(data.id),
                raw: data,
            };
        }
        lastError = data?.error?.message || 'Failed to create bootstrap adset';
    }

    throw new Error(lastError || 'Failed to create bootstrap adset');
}

async function bootstrapGhostAdSeed(params: {
    env: Env;
    organizationId: string;
    pageId: string;
    adAccountId: string;
    accessToken: string;
    headers?: Record<string, string>;
}): Promise<GhostAdSeed> {
    const campaign = await createGhostBootstrapCampaign({
        adAccountId: params.adAccountId,
        accessToken: params.accessToken,
        headers: params.headers,
        pageId: params.pageId,
    });

    const adset = await createGhostBootstrapAdSet({
        adAccountId: params.adAccountId,
        accessToken: params.accessToken,
        headers: params.headers,
        pageId: params.pageId,
        campaignId: campaign.campaignId,
    });

    const seed: GhostAdSeed = {
        adId: '',
        adsetId: adset.adsetId,
        campaignId: campaign.campaignId,
        raw: {
            campaign: campaign.raw,
            adset: adset.raw,
        },
        source: 'bootstrap',
    };

    await saveGhostAdSeed(params.env, {
        organizationId: params.organizationId,
        pageId: params.pageId,
        adAccountId: params.adAccountId,
        campaignId: seed.campaignId,
        adsetId: seed.adsetId,
        source: seed.source,
        metadata: seed.raw,
    });

    return seed;
}

async function fetchAdStoryIdWithRetry(
    adId: string,
    accessToken: string,
    headers?: Record<string, string>,
    attempts = 8,
    delayMs = 900,
): Promise<{ postId: string; raw: any }> {
    let lastData: any = null;
    const fields = 'id,adset_id,campaign_id,creative{id,effective_object_story_id,object_story_id,object_story_spec},effective_status,configured_status';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await fetch(
            `${FB_API}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
            headers ? { headers } : undefined
        );
        const data = await response.json() as any;
        lastData = data;

        if (data?.error) {
            throw new Error(data.error.message || 'Failed to fetch ad details');
        }

        const creative = data?.creative || {};
        const postId = data.object_story_id || data.effective_object_story_id || creative.object_story_id || creative.effective_object_story_id || '';
        if (postId) {
            return { postId, raw: data };
        }

        if (attempt < attempts) {
            await wait(delayMs);
        }
    }

    return { postId: '', raw: lastData };
}

async function materializeCreativeWithAd(params: {
    env: Env;
    organizationId: string;
    adAccountId: string;
    accessToken: string;
    pageId: string;
    creativeId: string;
    headers?: Record<string, string>;
    seed?: GhostAdSeed | null;
}): Promise<{ adId: string; adsetId: string; campaignId: string; postId: string; seedAdId: string; adData: any; bootstrapSeedCreated: boolean }> {
    let seed =
        params.seed
        ?? await loadGhostAdSeed(params.env, params.organizationId, params.pageId, params.adAccountId)
        ?? await fetchReusableAdSeed({
            adAccountId: params.adAccountId,
            accessToken: params.accessToken,
            pageId: params.pageId,
            headers: params.headers,
        });

    let bootstrapTried = false;
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (!seed?.adsetId) {
            seed = await bootstrapGhostAdSeed({
                env: params.env,
                organizationId: params.organizationId,
                pageId: params.pageId,
                adAccountId: params.adAccountId,
                accessToken: params.accessToken,
                headers: params.headers,
            });
            bootstrapTried = true;
        }

        try {
            const requestParams = new URLSearchParams({
                access_token: params.accessToken,
                name: `Pubilo ${Date.now()}`,
                adset_id: seed.adsetId,
                creative: JSON.stringify({ creative_id: params.creativeId }),
                status: 'PAUSED',
            });

            const createResponse = await fetch(`${FB_API}/${params.adAccountId}/ads`, {
                method: 'POST',
                headers: {
                    ...(params.headers || {}),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: requestParams.toString(),
            });
            const createData = await createResponse.json() as any;
            if (createData?.error) {
                throw new Error(createData.error.message || 'Failed to create ad from creative');
            }

            const adId = String(createData?.id || '');
            if (!adId) {
                throw new Error('Facebook did not return ad id');
            }

            const adStoryResult = await fetchAdStoryIdWithRetry(
                adId,
                params.accessToken,
                params.headers,
            );

            if (!adStoryResult.postId) {
                console.warn('[publish] Ad did not return story id after retries:', {
                    adId,
                    creativeId: params.creativeId,
                    adData: adStoryResult.raw,
                    seed,
                });
                throw new Error('Facebook did not return object_story_id for the ad');
            }

            if (seed.source === 'bootstrap') {
                await saveGhostAdSeed(params.env, {
                    organizationId: params.organizationId,
                    pageId: params.pageId,
                    adAccountId: params.adAccountId,
                    campaignId: seed.campaignId,
                    adsetId: seed.adsetId,
                    seedAdId: adId,
                    source: 'bootstrap',
                    metadata: seed.raw,
                });
            }

            return {
                adId,
                adsetId: seed.adsetId,
                campaignId: seed.campaignId,
                seedAdId: seed.adId || '',
                postId: adStoryResult.postId,
                adData: adStoryResult.raw,
                bootstrapSeedCreated: seed.source === 'bootstrap',
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);

            if (!bootstrapTried && seed && seed.source !== 'bootstrap') {
                console.warn('[publish] Existing ad seed failed, bootstrapping dedicated ghost seed:', {
                    pageId: params.pageId,
                    adAccountId: params.adAccountId,
                    source: seed.source,
                    error: lastError,
                });
                seed = null;
                continue;
            }

            if (seed && (seed.source === 'stored' || seed.source === 'bootstrap')) {
                await deleteGhostAdSeed(params.env, params.organizationId, params.pageId, params.adAccountId);
            }

            throw error;
        }
    }

    throw new Error(lastError || 'Failed to materialize ad creative');
}

async function createStandaloneAdCreative(params: {
    env: Env;
    organizationId: string;
    pageId: string;
    accessToken: string;
    cookieHeaders?: Record<string, string>;
    adAccountId: string;
    linkUrl: string;
    hostedImageUrl?: string;
    message?: string;
    title?: string;
    caption?: string;
    description?: string;
    callToAction?: string;
    seed?: GhostAdSeed | null;
    allowAdMaterialization?: boolean;
}): Promise<{
    creativeId: string;
    postId: string;
    creativeData: any;
    adId?: string;
    adsetId?: string;
    campaignId?: string;
    seedAdId?: string;
    materializedBy?: string;
    materializeAdAccountId?: string;
    hasReusableSeed?: boolean;
    scannedAccounts?: string[];
    cleanupAdId?: string;
    bootstrapSeedCreated?: boolean;
}> {
    const shouldLetFacebookScrapePreview = isControlledNewsPreviewUrl(params.linkUrl);
    const creativePayload: Record<string, any> = {
        page_id: params.pageId,
        link_data: {
            link: params.linkUrl,
            message: params.message || '',
            ...(!shouldLetFacebookScrapePreview && params.hostedImageUrl ? { picture: params.hostedImageUrl } : {}),
            ...(!shouldLetFacebookScrapePreview && params.title ? { name: params.title } : {}),
            ...(!shouldLetFacebookScrapePreview && params.caption ? { caption: params.caption } : {}),
            ...(!shouldLetFacebookScrapePreview && params.description ? { description: params.description } : {}),
            ...(params.callToAction ? {
                call_to_action: {
                    type: params.callToAction,
                    value: { link: params.linkUrl },
                },
            } : {}),
        },
    };

    const requestParams = new URLSearchParams({
        access_token: params.accessToken,
        name: `Pubilo ${Date.now()}`,
        object_story_spec: JSON.stringify(creativePayload),
        degrees_of_freedom_spec: JSON.stringify({
            creative_features_spec: {
                standard_enhancements: { enroll_status: 'OPT_OUT' },
            },
        }),
    });

    const createResponse = await fetch(`${FB_API}/${params.adAccountId}/adcreatives`, {
        method: 'POST',
        headers: {
            ...(params.cookieHeaders || {}),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: requestParams.toString(),
    });
    const createData = await createResponse.json() as any;
    if (createData?.error) {
        throw new Error(createData.error.message || 'Failed to create ad creative');
    }

    const creativeId = createData.id || '';
    if (!creativeId) {
        throw new Error('Facebook did not return ad creative id');
    }

    const storyResult = await fetchCreativeStoryIdWithRetry(
        creativeId,
        params.accessToken,
        params.cookieHeaders,
    );

    if (storyResult.postId) {
        return {
            creativeId,
            postId: storyResult.postId,
            creativeData: storyResult.raw,
            materializedBy: 'creative',
        };
    }

    if (!params.allowAdMaterialization) {
        const wrapped = new Error('Facebook did not return object_story_id for ad creative (materialization disabled)') as Error & {
            debug?: Record<string, unknown>;
        };
        wrapped.debug = {
            materializationEnabled: false,
            creativeId,
        };
        throw wrapped;
    }

    const seedContext = await resolveAdSeedContext({
        env: params.env,
        organizationId: params.organizationId,
        preferredAdAccountId: params.adAccountId,
        accessToken: params.accessToken,
        pageId: params.pageId,
        headers: params.cookieHeaders,
    });

    try {
        const materialized = await materializeCreativeWithAd({
            env: params.env,
            organizationId: params.organizationId,
            adAccountId: seedContext.adAccountId || params.adAccountId,
            accessToken: params.accessToken,
            pageId: params.pageId,
            creativeId,
            headers: params.cookieHeaders,
            seed: params.seed ?? seedContext.seed,
        });

        return {
            creativeId,
            postId: materialized.postId,
            creativeData: materialized.adData,
            adId: materialized.adId,
            adsetId: materialized.adsetId,
            campaignId: materialized.campaignId,
            seedAdId: materialized.seedAdId,
            materializedBy: 'ad',
            materializeAdAccountId: seedContext.adAccountId || params.adAccountId,
            hasReusableSeed: !!seedContext.seed,
            scannedAccounts: seedContext.scannedAccounts,
            cleanupAdId: materialized.adId,
            bootstrapSeedCreated: materialized.bootstrapSeedCreated,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(`Facebook did not return object_story_id for ad creative; ad materialization failed: ${message}`) as Error & {
            debug?: Record<string, unknown>;
        };
        wrapped.debug = {
            hasReusableSeed: !!seedContext.seed,
            scannedAccounts: seedContext.scannedAccounts,
            materializeAdAccountId: seedContext.adAccountId || params.adAccountId,
        };
        throw wrapped;
    }
}

// POST /api/publish - Publish to Facebook
app.post('/', async (c) => {
    try {
        const body = await c.req.json() as Record<string, any>;
        const {
            pageId,
            pageToken,
            accessToken,
            cookieData,
            message,
            imageUrl,
            scheduledTime,
            link,
            linkUrl,
            linkName,
            caption,
            description,
            primaryText,
            postMode,
            adAccountId,
            fbDtsg,
            callToAction,
            callToActionLabel,
            textFormatPresetId,
            scheduleInSystem,
            internalRun,
            targetPageIds,
            batchId,
            historyExternalKey,
            historySource,
            historySourceRef,
            historyQueueJobId,
            historyScheduledTime,
            organizationId: organizationIdFromBody,
            hideOnPublish,
            imageTransformStrategy,
            requireSquareLinkCard,
        } = body;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        const organizationId = String(
            internalRun ? (organizationIdFromBody || c.req.header('x-workspace-id') || '') : getWorkspaceId(c)
        ).trim();
        if (!organizationId) {
            return c.json({ success: false, error: 'Missing organizationId' }, 400);
        }

        const requestedPageToken = typeof pageToken === 'string' ? pageToken.trim() : '';
        let storedPageToken = '';
        let storedHideOnPublish = false;

        // Always read page_settings token as a durable fallback.
        try {
            const dbResult = await c.env.DB.prepare(
                'SELECT post_token_encrypted, hide_on_publish FROM page_settings WHERE organization_id = ? AND page_id = ? LIMIT 1'
            ).bind(organizationId, pageId).first<{ post_token_encrypted: string | null; hide_on_publish: number | null }>();

            if (dbResult?.post_token_encrypted) {
                storedPageToken = await decryptSecret(c.env, dbResult.post_token_encrypted) || '';
                console.log('[publish] Got stored Page Token from D1 page_settings');
            }
            storedHideOnPublish = Number(dbResult?.hide_on_publish || 0) === 1;
        } catch (dbErr) {
            console.error('[publish] D1 error:', dbErr);
        }

        const tokenRequestHeaders = buildFacebookGraphHeaders();
        const workspaceCookieCandidates = await getWorkspaceCookieCandidates(c.env, organizationId);
        const cookieHeaderCandidates: Array<Record<string, string>> = [];
        const seenCookies = new Set<string>();
        const addCookieHeaderCandidate = (rawCookie?: string) => {
            const normalized = String(rawCookie || '').trim();
            if (!normalized || seenCookies.has(normalized)) return;
            const headers = buildFacebookHeaders(normalized);
            if (!headers) return;
            seenCookies.add(normalized);
            cookieHeaderCandidates.push(headers);
        };
        addCookieHeaderCandidate(cookieData);
        workspaceCookieCandidates.forEach((cookie) => addCookieHeaderCandidate(cookie));
        let effectiveAccessToken = String(accessToken || '').trim();
        let freshPageToken = await fetchFreshPageToken(pageId, effectiveAccessToken, cookieData);
        const recoveredPageTokensFromCandidates: string[] = [];
        const refreshProbeCandidates = buildAuthCandidates([
            effectiveAccessToken,
            requestedPageToken,
            storedPageToken,
        ]);
        for (const probeToken of refreshProbeCandidates) {
            try {
                const recovered = await fetchFreshPageToken(pageId, probeToken, cookieData);
                if (recovered) {
                    recoveredPageTokensFromCandidates.push(recovered);
                }
            } catch (probeError) {
                console.warn('[publish] page token probe failed:', probeError);
            }
        }
        if (!freshPageToken) {
            for (const cookieCandidate of workspaceCookieCandidates) {
                if (!cookieCandidate || cookieCandidate === cookieData) continue;
                freshPageToken = await fetchFreshPageToken(pageId, effectiveAccessToken, cookieCandidate);
                if (freshPageToken) {
                    console.log('[publish] Recovered fresh page token via workspace cookie candidate');
                    break;
                }
            }
        }
        if (!effectiveAccessToken) {
            const workspaceFreshAdsToken = await recoverAdsTokenFromWorkspaceCredentials(
                c.env,
                organizationId,
            );
            if (workspaceFreshAdsToken) {
                effectiveAccessToken = workspaceFreshAdsToken;
                console.log('[publish] Recovered valid ads token from workspace credentials');
            }
        }
        if (!freshPageToken && effectiveAccessToken) {
            freshPageToken = await fetchFreshPageToken(pageId, effectiveAccessToken, cookieData);
        }
        if (!freshPageToken) {
            const workspaceFreshPageToken = await fetchFreshPageTokenFromWorkspaceCredentials(
                c.env,
                organizationId,
                pageId,
            );
            if (workspaceFreshPageToken) {
                freshPageToken = workspaceFreshPageToken;
                console.log('[publish] Recovered fresh page token from workspace facebook_credentials');
            }
        }
        const authCandidates = buildAuthCandidates([
            freshPageToken,
            ...recoveredPageTokensFromCandidates,
            storedPageToken,
            requestedPageToken,
            effectiveAccessToken,
        ]);

        if (authCandidates.length === 0) {
            return c.json({
                success: false,
                error: 'ไม่พบ token สำหรับโพสต์ - กรุณา login extension ใหม่ หรือตั้งค่า Page Token'
            }, 400);
        }

        // Determine post type
        const finalMessage = message || primaryText || '';
        const finalLink = normalizeOutboundLink(link || linkUrl || '');
        const finalImageUrl = imageUrl || '';
        const normalizedImageTransformStrategy = typeof imageTransformStrategy === 'string'
            ? imageTransformStrategy.trim().toLowerCase()
            : '';
        const requiresSquareLinkCard = parseBooleanFlag(requireSquareLinkCard)
            || (!!normalizedImageTransformStrategy && normalizedImageTransformStrategy !== 'original');
        const isLinkAttachmentPost = !!finalLink && (postMode === 'news' || postMode === 'link');
        if (isLinkAttachmentPost) {
            try {
                const parsed = new URL(finalLink);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    throw new Error('unsupported_protocol');
                }
            } catch {
                return c.json({
                    success: false,
                    error: 'ลิงก์ไม่ถูกต้อง กรุณาใส่ URL แบบเต็ม เช่น https://example.com/...',
                    errorType: 'InvalidLinkUrl',
                }, 400);
            }
        }

        // In Pubilo link/news mode we always expect an explicit cover image.
        // Posting without it causes Facebook to generate unpredictable plain URL cards.
        if (isLinkAttachmentPost && !String(finalImageUrl || '').trim()) {
            return c.json({
                success: false,
                error: 'ไม่พบรูปสำหรับโพสต์ลิงก์ กรุณาอัปโหลดรูปใหม่ก่อนกดโพสต์',
                errorType: 'MissingLinkCardImage',
            }, 400);
        }
        const requiresRichLinkCard = isLinkAttachmentPost && (
            !!finalImageUrl ||
            !!linkName ||
            !!description ||
            !!callToAction ||
            !!callToActionLabel ||
            requiresSquareLinkCard
        );

        const captionParts = [];
        if (finalMessage) captionParts.push(finalMessage);
        if (linkName) captionParts.push(linkName);
        else if (description) captionParts.push(`พิกัด : ${description}`);
        if (caption) captionParts.push(caption);
        if (finalLink) captionParts.push(finalLink);
        const finalCaption = captionParts.join('\n\n');

        const scheduleTimestamp = scheduledTime
            ? (typeof scheduledTime === 'number'
                ? scheduledTime
                : Math.floor(new Date(scheduledTime).getTime() / 1000))
            : null;
        const normalizedTargetPageIds = normalizeTargetPageIds(targetPageIds, pageId);
        const publishTargetPageIds = [pageId, ...normalizedTargetPageIds];

        let hostedImageUrl = '';
        if (isLinkAttachmentPost && finalImageUrl) {
            if (finalImageUrl.startsWith('http')) {
                hostedImageUrl = finalImageUrl;
            } else if (finalImageUrl.startsWith('data:')) {
                hostedImageUrl = await uploadImageToHost(finalImageUrl, c.env.FREEIMAGE_API_KEY);
                console.log('[publish] Uploaded link attachment image for feed attachment:', !!hostedImageUrl);
            }
        }

        if (requiresRichLinkCard && finalImageUrl && !hostedImageUrl) {
            return c.json({
                success: false,
                error: 'ไม่สามารถเตรียมรูปสำหรับ Rich Link Card ได้ (ระบบจะไม่ fallback เป็นลิงก์ธรรมดา)',
                errorType: 'RichLinkImageUnavailable',
            }, 400);
        }
        const attachmentTitle = (linkName || (description ? `พิกัด : ${description}` : '') || '').trim();
        const attachmentCaption = (caption || '').trim();
        const attachmentDescription = (description || '').trim();
        const previewSiteName = deriveSiteName(caption, finalLink);
        const previewUrlBase = getAppOrigin(c.env, c.req.url);
        const previewRecordId = isLinkAttachmentPost
            ? await createNewsLinkPreview(c.env, {
                targetUrl: finalLink,
                imageUrl: hostedImageUrl || undefined,
                title: attachmentTitle || 'ดูรายละเอียดสินค้า',
                description: attachmentDescription || finalMessage || 'แตะเพื่อดูรายละเอียดสินค้า',
                siteName: previewSiteName,
            })
            : '';
        const previewUrl = isLinkAttachmentPost
            ? buildNewsPreviewUrl(previewUrlBase, {
                previewId: previewRecordId,
                targetUrl: finalLink,
                imageUrl: hostedImageUrl || undefined,
                title: attachmentTitle || 'ดูรายละเอียดสินค้า',
                description: attachmentDescription || finalMessage || 'แตะเพื่อดูรายละเอียดสินค้า',
                siteName: previewSiteName,
                version: `${Date.now()}`,
            })
            : '';
        const publishLinkUrl = isLinkAttachmentPost ? previewUrl : finalLink;
        const richLinkPreviewOnly = isLinkAttachmentPost && requiresRichLinkCard;

        const shouldQueueInSystem = !!scheduleTimestamp && !!scheduleInSystem && !internalRun;
        const currentBatchId = typeof batchId === 'string' && batchId.trim()
            ? batchId.trim()
            : crypto.randomUUID();
        const resolvedPostType = isLinkAttachmentPost
            ? 'link'
            : finalImageUrl
                ? 'image'
                : 'text';
        const resolvedMediaKind = isLinkAttachmentPost
            ? 'link'
            : finalImageUrl
                ? 'image'
                : 'text';
        const historyMediaUrl = hostedImageUrl || (finalImageUrl.startsWith('http') ? finalImageUrl : '') || finalLink || '';
        const historySourceName = historySource === 'scheduled_queue'
            ? 'scheduled_queue'
            : 'publish';
        const historyScheduledValue = typeof historyScheduledTime === 'number'
            ? historyScheduledTime
            : scheduleTimestamp;

        const recordPublishedSuccess = async (
            postId: string,
            facebookUrl: string,
            extra: Record<string, unknown> = {},
        ) => {
            if (scheduleTimestamp) {
                return;
            }

            await recordPublishHistory(c.env, {
                organizationId,
                externalKey: String(historyExternalKey || `publish:${pageId}:${postId}`).trim(),
                pageId,
                source: historySourceName,
                sourceRef: String(historySourceRef || postId || '').trim(),
                batchId: currentBatchId,
                queueJobId: typeof historyQueueJobId === 'number' ? historyQueueJobId : null,
                postType: resolvedPostType,
                messageText: finalCaption || finalMessage || '',
                mediaKind: resolvedMediaKind,
                mediaUrl: historyMediaUrl,
                facebookPostId: postId,
                facebookUrl,
                scheduledTime: historyScheduledValue,
                extraJson: Object.keys(extra).length ? JSON.stringify(extra) : null,
            });
        };

        const shouldHideFromTimeline = (Boolean(hideOnPublish) || storedHideOnPublish) && !scheduleTimestamp;
        const resolveTimelineHideTarget = async (rawId: string, tokenForLookup: string) => {
            const inputId = String(rawId || '').trim();
            if (!inputId) return '';
            if (inputId.includes('_')) return inputId;

            const parsePostId = (payload: any): string => {
                const fromPostId = String(payload?.post_id || '').trim();
                if (fromPostId) return fromPostId;
                const fromId = String(payload?.id || '').trim();
                if (fromId.includes('_')) return fromId;
                return '';
            };

            const token = String(tokenForLookup || '').trim();
            if (token) {
                try {
                    const res = await fetch(
                        `${FB_API}/${encodeURIComponent(inputId)}?fields=id,post_id&access_token=${encodeURIComponent(token)}`,
                        { headers: tokenRequestHeaders },
                    );
                    const data = await res.json() as any;
                    const postId = parsePostId(data);
                    if (postId) return postId;
                } catch (err) {
                    console.warn('[publish] resolveTimelineHideTarget (token) failed:', err);
                }
            }

            for (let i = 0; i < cookieHeaderCandidates.length; i += 1) {
                try {
                    const res = await fetch(
                        `${FB_API}/${encodeURIComponent(inputId)}?fields=id,post_id`,
                        { headers: cookieHeaderCandidates[i] },
                    );
                    const data = await res.json() as any;
                    const postId = parsePostId(data);
                    if (postId) return postId;
                } catch (err) {
                    console.warn('[publish] resolveTimelineHideTarget (cookie) failed:', err);
                }
            }

            return inputId;
        };

        const maybeHideAfterPublish = async (postId: string, tokenForHide: string): Promise<HideAfterPublishResult> => {
            if (!shouldHideFromTimeline || !postId) {
                return {
                    attempted: false,
                    hidden: false,
                    method: '',
                    error: '',
                };
            }

            const authToken = String(tokenForHide || '').trim();
            const timelineHideTarget = await resolveTimelineHideTarget(postId, authToken);
            let lastHideError = '';
            if (authToken) {
                const result = await hidePagePostFromTimeline(
                    timelineHideTarget,
                    authToken,
                    tokenRequestHeaders,
                );
                if (result.success) {
                    try {
                        await c.env.DB.prepare(`
                            INSERT OR IGNORE INTO hidden_posts (organization_id, page_id, post_id, hidden_at)
                            VALUES (?, ?, ?, ?)
                        `).bind(
                            organizationId,
                            pageId,
                            timelineHideTarget,
                            new Date().toISOString(),
                        ).run();
                    } catch (dbErr) {
                        console.warn('[publish] Failed to persist hidden_posts row:', dbErr);
                    }
                    return {
                        attempted: true,
                        hidden: true,
                        method: result.method || '',
                        error: '',
                    };
                }
                lastHideError = result.error || '';
            }

            // Fallback: try hiding via cookie-only headers from latest session/cached workspace cookies.
            for (let i = 0; i < cookieHeaderCandidates.length; i += 1) {
                const cookieHideResult = await hidePagePostFromTimelineCookieOnly(
                    timelineHideTarget,
                    cookieHeaderCandidates[i],
                );
                if (cookieHideResult.success) {
                    try {
                        await c.env.DB.prepare(`
                            INSERT OR IGNORE INTO hidden_posts (organization_id, page_id, post_id, hidden_at)
                            VALUES (?, ?, ?, ?)
                        `).bind(
                            organizationId,
                            pageId,
                            timelineHideTarget,
                            new Date().toISOString(),
                        ).run();
                    } catch (dbErr) {
                        console.warn('[publish] Failed to persist hidden_posts row:', dbErr);
                    }
                    return {
                        attempted: true,
                        hidden: true,
                        method: cookieHideResult.method || '',
                        error: '',
                    };
                }
                lastHideError = cookieHideResult.error || lastHideError;
            }

            return {
                attempted: true,
                hidden: false,
                method: '',
                error: lastHideError || (authToken ? 'hide_failed_with_token_and_cookie' : 'hide_failed_cookie_only'),
            };
        };

        if (!internalRun && publishTargetPageIds.length > 1) {
            if (shouldQueueInSystem) {
                const queuedTargets: Array<{ pageId: string; queueId: number; queued: boolean }> = [];

                for (const targetPageId of publishTargetPageIds) {
                    const queuePayload: Record<string, unknown> = {
                        ...body,
                        organizationId,
                        pageId: targetPageId,
                        pageToken: '',
                        imageUrl: hostedImageUrl || finalImageUrl,
                        targetPageIds: [],
                        batchId: currentBatchId,
                        queueRoute: '/api/publish',
                        scheduledTime: null,
                        scheduleInSystem: false,
                        internalRun: false,
                    };

                    const queueId = await enqueueScheduledPublish(
                        c.env,
                        organizationId,
                        targetPageId,
                        scheduleTimestamp,
                        queuePayload,
                        currentBatchId,
                    );

                    queuedTargets.push({
                        pageId: targetPageId,
                        queueId,
                        queued: !!queueId,
                    });
                }

                return c.json({
                    success: true,
                    queued: true,
                    batchId: currentBatchId,
                    queuedTargets,
                    postId: `batch:${currentBatchId}`,
                    id: `batch:${currentBatchId}`,
                    url: buildFacebookPostUrl('', pageId),
                    needsScheduling: false,
                    scheduledTime: scheduleTimestamp,
                    _debug: {
                        flow: 'system-queue-multi-page',
                        batchId: currentBatchId,
                        targetCount: publishTargetPageIds.length,
                        scheduledTime: scheduleTimestamp,
                    },
                });
            }

            const fanOutResults: Array<Record<string, unknown>> = [];
            let primaryResult: Record<string, any> | null = null;
            let primaryError = '';

            for (const targetPageId of publishTargetPageIds) {
                const response = await app.fetch(
                    new Request('https://internal/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...body,
                            pageId: targetPageId,
                            pageToken: '',
                            imageUrl: hostedImageUrl || finalImageUrl,
                            targetPageIds: [],
                            batchId: currentBatchId,
                            internalRun: true,
                        }),
                    }),
                    c.env,
                    c.executionCtx,
                );
                const result = await response.json() as Record<string, any>;
                const success = !!(response.ok && result?.success);

                fanOutResults.push({
                    pageId: targetPageId,
                    success,
                    postId: result?.postId || null,
                    url: result?.url || null,
                    error: success ? null : (result?.error || `HTTP ${response.status}`),
                });

                if (targetPageId === pageId) {
                    if (success) {
                        primaryResult = result;
                    } else {
                        primaryError = String(result?.error || `HTTP ${response.status}`);
                    }
                }
            }

            if (!primaryResult) {
                return c.json({
                    success: false,
                    error: primaryError || 'Primary page publish failed',
                    batchId: currentBatchId,
                    fanOutResults,
                }, 400);
            }

            return c.json({
                ...primaryResult,
                batchId: currentBatchId,
                fanOutResults,
                _debug: {
                    ...(primaryResult._debug || {}),
                    flow: 'multi-page-immediate',
                    batchId: currentBatchId,
                    targetCount: publishTargetPageIds.length,
                },
            });
        }

        if (shouldQueueInSystem) {
            const queuePayload: Record<string, unknown> = {
                ...body,
                imageUrl: hostedImageUrl || finalImageUrl,
                pageToken: '',
                targetPageIds: [],
                batchId: currentBatchId,
                queueRoute: '/api/publish',
                scheduledTime: null,
                scheduleInSystem: false,
                internalRun: false,
            };

            const queueId = await enqueueScheduledPublish(
                c.env,
                organizationId,
                pageId,
                scheduleTimestamp,
                queuePayload,
                currentBatchId,
            );
            if (!queueId) {
                throw new Error('Failed to enqueue scheduled publish');
            }

            const queuePostId = `queue:${queueId}`;
            return c.json({
                success: true,
                queued: true,
                batchId: currentBatchId,
                postId: queuePostId,
                id: queuePostId,
                url: buildFacebookPostUrl('', pageId),
                needsScheduling: false,
                scheduledTime: scheduleTimestamp,
                _debug: {
                    flow: 'system-queue',
                    batchId: currentBatchId,
                    queueId,
                    scheduledTime: scheduleTimestamp,
                },
            });
        }

        const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
        let resolvedAdAccountId = normalizedAdAccountId;
        let accessibleAdAccounts: string[] = [];
        const rawAdCreativeEnv = String((c.env as any).ENABLE_AD_CREATIVE_PUBLISH || '').trim().toLowerCase();
        const adCreativeAllowedByEnv = rawAdCreativeEnv
            ? rawAdCreativeEnv === 'true'
            : true;
        const rawClientAdCreativeFlag = body.allowAdCreativePublish ?? body.useAdCreativeFlow ?? body.enableAdCreativePublish;
        const adCreativeRequestedByClient = rawClientAdCreativeFlag == null
            ? false
            : parseBooleanFlag(rawClientAdCreativeFlag);
        const adCreativeFlowEnabled = adCreativeAllowedByEnv && adCreativeRequestedByClient;

        if (adCreativeFlowEnabled && isLinkAttachmentPost && effectiveAccessToken) {
            try {
                accessibleAdAccounts = await fetchAccessibleAdAccountIds(effectiveAccessToken, tokenRequestHeaders);
                if (accessibleAdAccounts.length > 0) {
                    if (!resolvedAdAccountId) {
                        resolvedAdAccountId = accessibleAdAccounts[0] || '';
                    } else if (!accessibleAdAccounts.includes(resolvedAdAccountId)) {
                        console.warn('[publish] Selected ad account is not accessible for current token, switching to first accessible account:', {
                            selected: resolvedAdAccountId,
                            accessibleCount: accessibleAdAccounts.length,
                            fallback: accessibleAdAccounts[0] || '',
                        });
                        resolvedAdAccountId = accessibleAdAccounts[0] || '';
                    }
                } else if (!resolvedAdAccountId) {
                    resolvedAdAccountId = '';
                }
            } catch (error) {
                console.warn('[publish] Failed to auto-resolve ad account from access token:', error);
            }
        }
        const normalizedCallToAction = normalizeCallToActionType(callToAction);
        const canUseAdCreativeFlow = adCreativeFlowEnabled && isLinkAttachmentPost && !!effectiveAccessToken && !!resolvedAdAccountId;

        if (isLinkAttachmentPost) {
            // Include access token as last-resort candidate for feed fallback.
            // Some workspaces can still post via feed with a valid user token even when
            // page token lookup temporarily fails.
            const pageTokenCandidates = buildAuthCandidates([
                freshPageToken,
                ...recoveredPageTokensFromCandidates,
                requestedPageToken,
                storedPageToken,
            ]);
            const feedLinkCandidates = (() => {
                if (richLinkPreviewOnly && publishLinkUrl) {
                    return [publishLinkUrl];
                }
                if (publishLinkUrl && finalLink && publishLinkUrl !== finalLink) {
                    // Try controlled preview URL first to keep stable rich metadata.
                    // If Facebook rejects/failed preview scraping, fallback to direct link.
                    return [publishLinkUrl, finalLink];
                }
                return [finalLink || publishLinkUrl];
            })().filter(Boolean);
            let adCreativeError: string | null = null;
            let adCreativeDebug: Record<string, unknown> = {
                canUseAdCreativeFlow,
                resolvedAdAccountId: resolvedAdAccountId || '',
            };

            console.log('[publish] Link post diagnostics:', {
                hasClientAccessToken: !!effectiveAccessToken,
                resolvedAdAccountId: resolvedAdAccountId || '(none)',
                adCreativeAllowedByEnv,
                adCreativeRequestedByClient,
                adCreativeFlowEnabled,
                canUseAdCreativeFlow,
                pageTokenCandidateCount: pageTokenCandidates.length,
                requiresSquareLinkCard,
                imageTransformStrategy: normalizedImageTransformStrategy || 'none',
            });

            // Primary: ad creative produces rich cards with custom image, title, CTA button.
            if (canUseAdCreativeFlow) {
                try {
                    const creativeResult = await createStandaloneAdCreative({
                        env: c.env,
                        organizationId,
                        pageId,
                        accessToken: effectiveAccessToken,
                        cookieHeaders: tokenRequestHeaders,
                        adAccountId: resolvedAdAccountId,
                        // Square card mode must use the controlled preview URL so
                        // Facebook consumes the transformed 1080x1080 OG image.
                        linkUrl: requiresSquareLinkCard ? publishLinkUrl : finalLink,
                        // Controlled preview owns its OG image/metadata. Sending Graph
                        // metadata overrides for this URL triggers Facebook owner checks.
                        hostedImageUrl: hostedImageUrl || undefined,
                        message: finalMessage,
                        title: requiresSquareLinkCard ? undefined : (attachmentTitle || undefined),
                        caption: requiresSquareLinkCard ? undefined : (previewSiteName || undefined),
                        description: requiresSquareLinkCard ? undefined : (attachmentDescription || undefined),
                        callToAction: normalizedCallToAction,
                        // Rich card publishing depends on obtaining object_story_id.
                        // Allow ad materialization for immediate posts, then clean up
                        // the transient ad object right after publish succeeds.
                        allowAdMaterialization: !scheduleTimestamp,
                    });

                    let publishedPageToken = '';
                    if (!scheduleTimestamp) {
                        publishedPageToken = await publishExistingUnpublishedPostWithCandidates(
                            creativeResult.postId,
                            pageTokenCandidates,
                            tokenRequestHeaders,
                        );
                    }

                    let transientAdCleanup: { attempted: boolean; deleted: boolean; error: string } | null = null;
                    if (!scheduleTimestamp && creativeResult.cleanupAdId && effectiveAccessToken) {
                        const cleanupResult = await deleteGraphNodeWithToken(
                            creativeResult.cleanupAdId,
                            effectiveAccessToken,
                            tokenRequestHeaders,
                        );
                        transientAdCleanup = {
                            attempted: true,
                            deleted: cleanupResult.ok,
                            error: cleanupResult.ok ? '' : String(cleanupResult.error || ''),
                        };
                        if (!cleanupResult.ok) {
                            console.warn('[publish] Failed to delete transient materialized ad:', {
                                adId: creativeResult.cleanupAdId,
                                error: cleanupResult.error,
                            });
                        }
                    }

                    const publishedUrl = buildFacebookPostUrl(creativeResult.postId, pageId);
                    await recordPublishedSuccess(creativeResult.postId, publishedUrl, {
                        flow: 'adcreative',
                        creativeId: creativeResult.creativeId,
                        materializedBy: creativeResult.materializedBy,
                        bootstrapSeedCreated: !!creativeResult.bootstrapSeedCreated,
                        transientAdCleanup,
                    });
                    const hideResult = await maybeHideAfterPublish(creativeResult.postId, publishedPageToken);

                    const warningMessages: string[] = [];
                    if (hideResult.attempted && !hideResult.hidden) {
                        warningMessages.push(`ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}`);
                    }
                    if (transientAdCleanup?.attempted && !transientAdCleanup.deleted) {
                        warningMessages.push(`ลบ ad ชั่วคราวไม่สำเร็จ: ${transientAdCleanup.error}`);
                    }

                    return c.json({
                        success: true,
                        postId: creativeResult.postId,
                        url: publishedUrl,
                        timelineHidden: hideResult.hidden,
                        ...(warningMessages.length > 0 ? { warning: warningMessages.join(' | ') } : {}),
                        needsScheduling: !!scheduleTimestamp,
                        ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                        _debug: {
                            flow: 'adcreative',
                            creativeId: creativeResult.creativeId,
                            adAccountId: resolvedAdAccountId,
                            materializedBy: creativeResult.materializedBy || '',
                            materializeAdAccountId: creativeResult.materializeAdAccountId || resolvedAdAccountId,
                            hasReusableSeed: !!creativeResult.hasReusableSeed,
                            scannedAccounts: creativeResult.scannedAccounts || [],
                            bootstrapSeedCreated: !!creativeResult.bootstrapSeedCreated,
                            publishedPageTokenSource: publishedPageToken ? 'candidate' : '',
                            transientAdCleanup,
                            hide: hideResult,
                        },
                    });
                } catch (error) {
                    adCreativeError = error instanceof Error ? error.message : String(error);
                    adCreativeDebug = {
                        ...adCreativeDebug,
                        ...((((error as Error & { debug?: Record<string, unknown> }).debug) || {})),
                    };
                    console.warn('[publish] adcreative failed, falling back to feed:', {
                        error: adCreativeError,
                        debug: adCreativeDebug,
                    });
                }
            }

            // Fallback: feed with target URL. Try each page token candidate until one works.
            if (pageTokenCandidates.length === 0) {
                return c.json({
                    success: false,
                    error: adCreativeError
                        ? `Ad creative ไม่สำเร็จ: ${adCreativeError} — และไม่พบ Page Token สำหรับ fallback`
                        : 'ไม่พบ Page Token สำหรับโพสต์ลิงก์ กรุณากด extension ใหม่แล้วลองอีกครั้ง',
                    errorType: 'MissingPageToken',
                    _debug: {
                        adCreativeError,
                        canUseAdCreativeFlow,
                        candidateCount: authCandidates.length,
                    },
                }, 400);
            }

            let lastFeedError = '';
            let lastFeedFacebookError: any = null;
            let sawAuthRelatedFeedError = false;
            let sawSessionInvalidatedFeedError = false;
            let sawNonAuthFeedError = false;
            for (const candidateToken of pageTokenCandidates) {
                let candidateLastError = '';
                for (let linkIndex = 0; linkIndex < feedLinkCandidates.length; linkIndex += 1) {
                    const feedLinkUrl = feedLinkCandidates[linkIndex];
                    try {
                        const feedRequestBase = {
                            pageId,
                            pageToken: candidateToken,
                            headers: tokenRequestHeaders,
                            message: finalMessage,
                            linkUrl: feedLinkUrl,
                            title: attachmentTitle || undefined,
                            caption: attachmentCaption || previewSiteName || undefined,
                            description: attachmentDescription || undefined,
                            pictureUrl: hostedImageUrl || undefined,
                            callToActionType: normalizedCallToAction,
                            callToActionLinkUrl: finalLink || feedLinkUrl,
                            allowMetadataDropRetry: true,
                        } as const;
                        let feedResult = await publishLinkCardViaFeed({
                            ...feedRequestBase,
                            publishAsAdsPost: !scheduleTimestamp,
                            scheduledTime: scheduleTimestamp || undefined,
                        });
                        let usedDraftPublishFallback = false;
                        if (feedResult.createdAsDraft && !scheduleTimestamp) {
                            try {
                                await publishExistingUnpublishedPost(feedResult.postId, candidateToken, tokenRequestHeaders);
                            } catch (publishDraftError) {
                                const draftPublishErrorMessage = publishDraftError instanceof Error
                                    ? publishDraftError.message
                                    : String(publishDraftError);
                                const draftPublishFacebookError = (publishDraftError as { facebookError?: any })?.facebookError || null;
                                const shouldRetryAsDirectPublished = isGenericInvalidRequestMessage(draftPublishErrorMessage)
                                    || draftPublishErrorMessage.toLowerCase().includes('unpublished')
                                    || draftPublishErrorMessage.toLowerCase().includes('is_published')
                                    || draftPublishErrorMessage.toLowerCase().includes('published')
                                    || Number(draftPublishFacebookError?.code || 0) === 100;

                                if (!shouldRetryAsDirectPublished) {
                                    throw publishDraftError;
                                }

                                console.warn(
                                    '[publish] Draft publish failed, retrying with direct published feed post:',
                                    draftPublishErrorMessage,
                                );
                                feedResult = await publishLinkCardViaFeed({
                                    ...feedRequestBase,
                                    publishAsAdsPost: false,
                                });
                                usedDraftPublishFallback = true;
                            }
                        }

                        const feedUrl = buildFacebookPostUrl(feedResult.postId, pageId);
                        await recordPublishedSuccess(feedResult.postId, feedUrl, {
                            flow: adCreativeError ? 'feed-fallback' : 'feed-link',
                        });
                        const hideResult = await maybeHideAfterPublish(feedResult.postId, candidateToken);
                        const warningMessages: string[] = [];
                        if (hideResult.attempted && !hideResult.hidden) {
                            warningMessages.push(`ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}`);
                        }
                        if (adCreativeError) {
                            warningMessages.push('Ad creative ไม่สำเร็จ ระบบสลับไปโพสต์ผ่าน feed แทน');
                        }
                        if (linkIndex > 0 && publishLinkUrl && publishLinkUrl !== finalLink) {
                            warningMessages.push('Preview link ใช้งานไม่ได้ ระบบสลับไปใช้ลิงก์จริงให้อัตโนมัติ');
                        }
                        if (usedDraftPublishFallback) {
                            warningMessages.push('Facebook ไม่ยอม publish แบบ draft ระบบสลับไปโพสต์ตรงให้อัตโนมัติ');
                        }

                        return c.json({
                            success: true,
                            postId: feedResult.postId,
                            url: feedUrl,
                            timelineHidden: hideResult.hidden,
                            ...(warningMessages.length > 0 ? { warning: warningMessages.join(' | ') } : {}),
                            needsScheduling: !!scheduleTimestamp,
                            ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                            _debug: {
                                flow: adCreativeError ? 'feed-fallback' : 'feed-link',
                                adCreativeError,
                                hide: hideResult,
                                feedLinkUrl,
                                feedLinkAttempt: linkIndex + 1,
                                usedDraftPublishFallback,
                            },
                        });
                    } catch (feedError) {
                        candidateLastError = feedError instanceof Error ? feedError.message : String(feedError);
                        const feedFacebookError = (feedError as { facebookError?: any })?.facebookError || null;
                        lastFeedFacebookError = feedFacebookError || lastFeedFacebookError;
                        const normalizedFeedMessage = String(candidateLastError || '');
                        const authRelatedFeedError = isSessionInvalidatedFacebookError(feedFacebookError)
                            || isAuthRelatedErrorMessage(normalizedFeedMessage)
                            || /changed.*password|security reasons/i.test(normalizedFeedMessage);
                        if (authRelatedFeedError) {
                            sawAuthRelatedFeedError = true;
                        } else {
                            sawNonAuthFeedError = true;
                        }
                        if (
                            isSessionInvalidatedFacebookError(feedFacebookError)
                            || /session has been invalidated|error validating access token|access token has expired|access token is invalid/i.test(
                                normalizedFeedMessage.toLowerCase(),
                            )
                        ) {
                            sawSessionInvalidatedFeedError = true;
                        }
                        if (linkIndex + 1 < feedLinkCandidates.length) {
                            console.warn(
                                `[publish] feed link attempt failed, retrying with fallback link (${linkIndex + 1}/${feedLinkCandidates.length}):`,
                                candidateLastError,
                            );
                        }
                    }
                }
                lastFeedError = candidateLastError;
                console.warn(`[publish] feed candidate failed (${pageTokenCandidates.indexOf(candidateToken) + 1}/${pageTokenCandidates.length}):`, lastFeedError);
            }

            // Last resort: cookie-only feed post (no access_token at all, just Cookie header).
            if (cookieHeaderCandidates.length > 0) {
                for (let i = 0; i < cookieHeaderCandidates.length; i += 1) {
                    for (let linkIndex = 0; linkIndex < feedLinkCandidates.length; linkIndex += 1) {
                        const fallbackLinkUrl = feedLinkCandidates[linkIndex];
                        const messageCandidates = [finalMessage, ""];
                        for (const candidateMessage of messageCandidates) {
                            try {
                                console.log(
                                    `[publish] Attempting cookie-only feed post as last resort (${i + 1}/${cookieHeaderCandidates.length}) linkAttempt=${linkIndex + 1}/${feedLinkCandidates.length} msg=${candidateMessage ? "with-message" : "no-message"}`,
                                );
                                const cookieResult = await publishViaFeedCookieOnly({
                                    pageId,
                                    cookieHeaders: cookieHeaderCandidates[i],
                                    message: candidateMessage,
                                    linkUrl: fallbackLinkUrl,
                                });

                                const cookieUrl = buildFacebookPostUrl(cookieResult.postId, pageId);
                                await recordPublishedSuccess(cookieResult.postId, cookieUrl, {
                                    flow: 'cookie-only-feed',
                                });
                                const hideResult = await maybeHideAfterPublish(cookieResult.postId, pageTokenCandidates[0] || '');

                                return c.json({
                                    success: true,
                                    postId: cookieResult.postId,
                                    url: cookieUrl,
                                    timelineHidden: hideResult.hidden,
                                    warning: 'โพสต์ผ่าน cookie-only mode (ไม่มี Ads Token)',
                                    needsScheduling: !!scheduleTimestamp,
                                    ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                                    _debug: {
                                        flow: 'cookie-only-feed',
                                        adCreativeError,
                                        tokenFeedError: lastFeedError,
                                        cookieCandidateIndex: i + 1,
                                        feedLinkUrl: fallbackLinkUrl,
                                        feedLinkAttempt: linkIndex + 1,
                                        usedMessage: !!candidateMessage,
                                    },
                                });
                            } catch (cookieError) {
                                const cookieMsg = cookieError instanceof Error ? cookieError.message : String(cookieError);
                                console.warn('[publish] cookie-only feed candidate failed:', cookieMsg);
                            }
                        }
                    }
                }
            }

            // Last resort after all link-card attempts: downgrade to photo + caption (+ link in text).
            // This preserves publish success even when Facebook rejects link-card payload with generic
            // Invalid request / Unsupported request errors.
            const fallbackCaption = finalCaption || finalMessage || (finalLink ? `พิกัด : ${finalLink}` : '');
            const photoCaptionCandidates = Array.from(
                new Set(
                    [
                        fallbackCaption,
                        String(finalMessage || '').trim(),
                        String(description ? `พิกัด : ${description}` : '').trim(),
                        '',
                    ]
                        .map((value) => String(value || '').trim()),
                ),
            );
            let photoFallbackLastError = '';
            let photoFallbackLastFacebookError: any = null;

            for (const candidateToken of pageTokenCandidates) {
                for (const candidateCaption of photoCaptionCandidates) {
                    try {
                        let endpoint = `${FB_API}/${pageId}/photos`;
                        let body: URLSearchParams | FormData;
                        let headers: Record<string, string>;
                        let shouldUseMultipart = false;
                        let sourceBlob: Blob | null = null;

                        if (finalImageUrl.startsWith('data:')) {
                            shouldUseMultipart = true;
                            sourceBlob = dataUrlToBlob(finalImageUrl);
                        } else if (hostedImageUrl || finalImageUrl.startsWith('http')) {
                            sourceBlob = await fetchImageBlobFromUrl(hostedImageUrl || finalImageUrl);
                            if (sourceBlob) {
                                shouldUseMultipart = true;
                            }
                        }

                        if (shouldUseMultipart && sourceBlob) {
                            const multipart = new FormData();
                            multipart.append('access_token', candidateToken);
                            multipart.append('source', sourceBlob, 'pubilo-link-fallback.jpg');
                            if (candidateCaption) multipart.append('caption', candidateCaption);
                            if (scheduleTimestamp) {
                                multipart.append('scheduled_publish_time', String(scheduleTimestamp));
                                multipart.append('published', 'false');
                            }
                            body = multipart;
                            headers = tokenRequestHeaders;
                        } else {
                            const params = new URLSearchParams({
                                access_token: candidateToken,
                                url: hostedImageUrl || finalImageUrl,
                            });
                            if (candidateCaption) params.set('caption', candidateCaption);
                            if (scheduleTimestamp) {
                                params.set('scheduled_publish_time', String(scheduleTimestamp));
                                params.set('published', 'false');
                            }
                            body = params;
                            headers = {
                                ...tokenRequestHeaders,
                                'Content-Type': 'application/x-www-form-urlencoded',
                            };
                        }

                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers,
                            body: body instanceof URLSearchParams ? body.toString() : body,
                        });
                        const data = await response.json() as any;
                        if (data?.error) {
                            photoFallbackLastFacebookError = data.error || photoFallbackLastFacebookError;
                            photoFallbackLastError = data.error?.message || 'photo_fallback_failed';
                            continue;
                        }

                        const fallbackPostId = String(data?.post_id || data?.id || '');
                        if (!fallbackPostId) {
                            photoFallbackLastError = 'Facebook did not return post id for photo fallback';
                            continue;
                        }

                        const fallbackUrl = buildFacebookPostUrl(fallbackPostId, pageId);
                        await recordPublishedSuccess(fallbackPostId, fallbackUrl, {
                            flow: 'photo-fallback-after-link-failure',
                            originalFlowError: lastFeedError || adCreativeError || '',
                        });
                        const hideResult = await maybeHideAfterPublish(fallbackPostId, candidateToken);

                        const warningMessages: string[] = [
                            requiresSquareLinkCard
                                ? 'Facebook ปฏิเสธ 1080x1080 Link Card ระบบสลับเป็นโพสต์รูปภาพ+แคปชันให้อัตโนมัติ'
                                : candidateCaption && candidateCaption.includes(finalLink)
                                    ? 'Facebook ปฏิเสธการสร้าง Link Card ระบบสลับเป็นโพสต์รูปภาพ+แคปชันให้อัตโนมัติ'
                                    : 'Facebook ปฏิเสธ Link Card/ลิงก์ ระบบสลับเป็นโพสต์รูปภาพแบบปลอดภัยให้อัตโนมัติ',
                        ];
                        if (hideResult.attempted && !hideResult.hidden) {
                            warningMessages.push(`ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}`);
                        }

                        return c.json({
                            success: true,
                            postId: fallbackPostId,
                            url: fallbackUrl,
                            timelineHidden: hideResult.hidden,
                            warning: warningMessages.join(' | '),
                            needsScheduling: !!scheduleTimestamp,
                            ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                            _debug: {
                                flow: 'photo-fallback-after-link-failure',
                                adCreativeError,
                                feedError: lastFeedError,
                                requiresSquareLinkCard,
                                imageTransformStrategy: normalizedImageTransformStrategy || 'fit',
                                previewUrl: publishLinkUrl,
                                usedCaptionMode: candidateCaption ? (candidateCaption.includes(finalLink) ? 'with-link' : 'without-link') : 'empty',
                                hide: hideResult,
                            },
                        });
                    } catch (photoFallbackError) {
                        const msg = photoFallbackError instanceof Error ? photoFallbackError.message : String(photoFallbackError);
                        photoFallbackLastError = msg;
                    }
                }
            }

            // Cookie-only photo fallback (when token-based photo fallback also failed).
            const fallbackImageUrlForCookie = hostedImageUrl || (finalImageUrl.startsWith('http') ? finalImageUrl : '');
            if (fallbackImageUrlForCookie && cookieHeaderCandidates.length > 0) {
                for (let i = 0; i < cookieHeaderCandidates.length; i += 1) {
                    for (const candidateCaption of photoCaptionCandidates) {
                        try {
                            const cookiePhoto = await publishPhotoCookieOnly({
                                pageId,
                                cookieHeaders: cookieHeaderCandidates[i],
                                imageUrl: fallbackImageUrlForCookie,
                                caption: candidateCaption,
                                scheduledTime: scheduleTimestamp || null,
                            });
                            const fallbackUrl = buildFacebookPostUrl(cookiePhoto.postId, pageId);
                            await recordPublishedSuccess(cookiePhoto.postId, fallbackUrl, {
                                flow: 'cookie-photo-fallback-after-link-failure',
                                originalFlowError: lastFeedError || adCreativeError || '',
                            });
                            const hideResult = await maybeHideAfterPublish(cookiePhoto.postId, pageTokenCandidates[0] || '');
                            return c.json({
                                success: true,
                                postId: cookiePhoto.postId,
                                url: fallbackUrl,
                                timelineHidden: hideResult.hidden,
                                warning: candidateCaption && candidateCaption.includes(finalLink)
                                    ? (requiresSquareLinkCard
                                        ? 'Facebook ปฏิเสธ 1080x1080 Link Card ระบบสลับเป็นโพสต์รูปภาพ+แคปชัน (cookie fallback)'
                                        : 'Facebook ปฏิเสธ Link Card ระบบสลับเป็นโพสต์รูปภาพ+แคปชัน (cookie fallback)')
                                    : 'Facebook ปฏิเสธ Link Card/ลิงก์ ระบบสลับเป็นโพสต์รูปภาพแบบปลอดภัย (cookie fallback)',
                                needsScheduling: !!scheduleTimestamp,
                                ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                                _debug: {
                                    flow: 'cookie-photo-fallback-after-link-failure',
                                    adCreativeError,
                                    feedError: lastFeedError,
                                    requiresSquareLinkCard,
                                    imageTransformStrategy: normalizedImageTransformStrategy || 'fit',
                                    previewUrl: publishLinkUrl,
                                    cookieCandidateIndex: i + 1,
                                    usedCaptionMode: candidateCaption ? (candidateCaption.includes(finalLink) ? 'with-link' : 'without-link') : 'empty',
                                    hide: hideResult,
                                },
                            });
                        } catch (cookiePhotoError) {
                            const msg = cookiePhotoError instanceof Error ? cookiePhotoError.message : String(cookiePhotoError);
                            photoFallbackLastError = msg || photoFallbackLastError;
                        }
                    }
                }
            }

            const hasOnlyAuthRelatedFailures = sawAuthRelatedFeedError && !sawNonAuthFeedError;
            const normalizedPhotoFallbackError = String(photoFallbackLastError || '').trim();
            const sawSessionInvalidatedPhotoFallback =
                isSessionInvalidatedFacebookError(photoFallbackLastFacebookError)
                || /session has been invalidated|error validating access token|access token has expired|access token is invalid|changed.*password|security reasons/i.test(
                    normalizedPhotoFallbackError.toLowerCase(),
                );
            const isSessionInvalidated = sawSessionInvalidatedPhotoFallback || (
                hasOnlyAuthRelatedFailures && (
                    sawSessionInvalidatedFeedError
                    || isSessionInvalidatedFacebookError(lastFeedFacebookError)
                    || /changed.*password|security reasons/i.test(
                        `${adCreativeError || ''} ${lastFeedError || ''} ${normalizedPhotoFallbackError}`,
                    )
                )
            );
            const isExpectedCreativeStoryMiss = /did not return object_story_id|materialization disabled/i.test(
                String(adCreativeError || '')
            );
            const normalizedAdCreativeError = isExpectedCreativeStoryMiss ? '' : String(adCreativeError || '').trim();
            const normalizedFeedError = String(lastFeedError || '').trim();
            const nonSessionReason = normalizedFeedError || normalizedPhotoFallbackError || normalizedAdCreativeError;
            const lastFeedCode = Number(lastFeedFacebookError?.code || 0);
            const lastFeedSubcode = Number(lastFeedFacebookError?.error_subcode || 0);
            const lastPhotoFallbackCode = Number(photoFallbackLastFacebookError?.code || 0);
            const lastPhotoFallbackSubcode = Number(photoFallbackLastFacebookError?.error_subcode || 0);
            const resolvedErrorCode = (lastFeedCode === 1 && lastPhotoFallbackCode && lastPhotoFallbackCode !== 1)
                ? lastPhotoFallbackCode
                : (lastFeedCode || lastPhotoFallbackCode || 0);
            const resolvedErrorSubcode = lastFeedSubcode || lastPhotoFallbackSubcode || 0;
            const invalidRequestWithCode100 = isGenericInvalidRequestMessage(nonSessionReason) && resolvedErrorCode === 100;
            const userMessage = isSessionInvalidated
                ? 'Facebook session หมดอายุ กรุณา logout แล้ว login Facebook ใหม่ จากนั้นกดปุ่ม extension แล้วรีเฟรชหน้า'
                : invalidRequestWithCode100
                    ? 'โพสต์ไม่สำเร็จ: Invalid request (Facebook code 100) ระบบลอง fallback แล้วแต่ Facebook ปฏิเสธ payload ทั้งหมด กรุณาลองเปลี่ยนข้อความ/ลิงก์หรือเลือกเพจอื่น'
                : nonSessionReason
                    ? `โพสต์ไม่สำเร็จ: ${nonSessionReason}`
                    : 'โพสต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

            console.warn('[publish] link card failed all fallbacks:', {
                adCreativeError,
                adCreativeDebug,
                feedError: lastFeedError,
                photoFallbackError: normalizedPhotoFallbackError,
                resolvedErrorCode,
                resolvedErrorSubcode,
                pageTokenCandidates: pageTokenCandidates.length,
            });

            return c.json({
                success: false,
                error: userMessage,
                errorType: isSessionInvalidated ? 'SessionExpired' : 'LinkPublishFailed',
                ...(isSessionInvalidated ? { errorCode: 190 } : {}),
                ...(!isSessionInvalidated && resolvedErrorCode ? { errorCode: resolvedErrorCode } : {}),
                ...(!isSessionInvalidated && resolvedErrorSubcode ? { errorSubcode: resolvedErrorSubcode } : {}),
                _debug: {
                    flow: 'link-card-failed-all-fallbacks',
                    adCreativeError,
                    feedError: lastFeedError,
                    photoFallbackError: normalizedPhotoFallbackError,
                    previewUrl,
                    hostedImageUrl,
                    candidatesTried: pageTokenCandidates.length,
                    candidateCount: pageTokenCandidates.length,
                    lastFeedCode,
                    lastFeedSubcode,
                    lastPhotoFallbackCode,
                    lastPhotoFallbackSubcode,
                    resolvedErrorCode,
                    resolvedErrorSubcode,
                    isSessionInvalidated,
                    sawAuthRelatedFeedError,
                    sawSessionInvalidatedFeedError,
                    sawSessionInvalidatedPhotoFallback,
                    sawNonAuthFeedError,
                    hasOnlyAuthRelatedFailures,
                },
            }, 400);
        }

        let lastFacebookError: any = null;
        let sawSessionExpired = false;
        let sawNonSessionError = false;

        for (const authToken of authCandidates) {
            let endpoint = `${FB_API}/${pageId}`;
            let params = new URLSearchParams({ access_token: authToken });
            let multipartBody: FormData | null = null;
            let publishDraftAfterCreate = false;

            if (isLinkAttachmentPost) {
                endpoint += '/feed';
                params.append('link', publishLinkUrl);
                if (finalMessage) params.append('message', finalMessage);
                params.append('published', 'false');
                params.append('unpublished_content_type', 'ADS_POST');
                publishDraftAfterCreate = !scheduleTimestamp;
            } else if (finalImageUrl && finalImageUrl.startsWith('data:')) {
                endpoint += '/photos';
                multipartBody = new FormData();
                multipartBody.append('access_token', authToken);
                multipartBody.append('source', dataUrlToBlob(finalImageUrl), 'pubilo-upload.jpg');
                if (finalCaption) multipartBody.append('caption', finalCaption);
                console.log('[publish] Trying worker multipart upload', { tokenSource: authToken === effectiveAccessToken ? 'accessToken' : 'pageToken' });
            } else if (finalImageUrl && finalImageUrl.startsWith('http')) {
                endpoint += '/photos';
                params.append('url', finalImageUrl);
                if (finalCaption) params.append('caption', finalCaption);
            } else if (finalLink) {
                endpoint += '/feed';
                params.append('link', publishLinkUrl);
                if (finalMessage) params.append('message', finalMessage);
            } else {
                endpoint += '/feed';
                if (finalMessage) params.append('message', finalMessage);
                if (typeof textFormatPresetId === 'string' && textFormatPresetId.trim()) {
                    params.append('text_format_preset_id', textFormatPresetId.trim());
                }
            }

            if (scheduleTimestamp && !isLinkAttachmentPost) {
                if (multipartBody) {
                    multipartBody.append('scheduled_publish_time', String(scheduleTimestamp));
                    multipartBody.append('published', 'false');
                } else {
                    params.append('scheduled_publish_time', String(scheduleTimestamp));
                    params.append('published', 'false');
                }
            }

            console.log('[publish] Posting to:', endpoint, '| token candidate length:', authToken.length);
            console.log('[publish] Post mode:', postMode, '| Has link:', !!finalLink, '| Has image:', !!finalImageUrl);
            if (isLinkAttachmentPost) {
                console.log('[publish] Link attachment payload:', {
                    previewUrl,
                    hasHostedImage: !!hostedImageUrl,
                    publishDraftAfterCreate,
                        hasCallToAction: !!callToAction,
                        callToAction: normalizedCallToAction,
                        callToActionLabel: typeof callToActionLabel === 'string' ? callToActionLabel.slice(0, 40) : '',
                        adAccountId: adAccountId || '',
                    });
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                ...(multipartBody
                    ? {
                        headers: tokenRequestHeaders,
                        body: multipartBody,
                    }
                    : {
                        headers: {
                            ...tokenRequestHeaders,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: params.toString(),
                    }),
            });

            const data = await response.json() as any;

            if (data.error) {
                // Code 190 = session expired across ALL tokens from this
                // user.  Stop immediately – nothing else will work.
                if (Number(data.error?.code) === 190) {
                    sawSessionExpired = true;
                    lastFacebookError = data.error;
                    console.warn('[publish] Session expired for token candidate, trying next candidate...', {
                        tokenLen: authToken.length,
                        errorSubcode: data.error?.error_subcode,
                    });
                    continue;
                }

                // Code 1 + OAuthException = THIS token is invalid/malformed,
                // but another candidate might still work.  Continue to next.
                if (Number(data.error?.code) === 1 && data.error?.type === 'OAuthException') {
                    const normalizedCode1Message = String(data.error?.message || '').trim();
                    if (isAuthRelatedErrorMessage(normalizedCode1Message)) {
                        console.warn('[publish] Token invalid (code 1), trying next candidate...', { tokenLen: authToken.length });
                        lastFacebookError = data.error;
                        sawNonSessionError = true;
                        continue;
                    }
                }

                lastFacebookError = data.error;
                sawNonSessionError = true;
                console.warn('[publish] Facebook API error for token candidate:', data.error);
                continue;
            }

            const postId = data.id || data.post_id || data.story_id || '';
            if (isLinkAttachmentPost && publishDraftAfterCreate && postId) {
                const publishNowParams = new URLSearchParams({
                    access_token: authToken,
                    is_published: 'true',
                });
                const publishNowEndpoint = `${FB_API}/${postId}`;
                console.log('[publish] Publishing draft post now:', publishNowEndpoint);
                const publishNowResponse = await fetch(publishNowEndpoint, {
                    method: 'POST',
                    headers: {
                        ...tokenRequestHeaders,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: publishNowParams.toString(),
                });
                const publishNowData = await publishNowResponse.json() as any;
                if (publishNowData?.error) {
                    lastFacebookError = publishNowData.error;
                    console.warn('[publish] Draft publish error for token candidate:', publishNowData.error);
                    continue;
                }
            }
            console.log('[publish] Success! Post ID:', postId);
            const publishedUrl = buildFacebookPostUrl(postId, pageId);
            await recordPublishedSuccess(postId, publishedUrl, {
                flow: isLinkAttachmentPost ? 'facebook-link-post' : 'facebook-direct-post',
                postMode: postMode || null,
            });
            const hideResult = await maybeHideAfterPublish(postId, authToken);
            return c.json({
                success: true,
                postId,
                url: publishedUrl,
                timelineHidden: hideResult.hidden,
                ...(hideResult.attempted && !hideResult.hidden ? { warning: `ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}` } : {}),
                needsScheduling: !!scheduleTimestamp,
                ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                _debug: {
                    hide: hideResult,
                },
            });
        }

        // Last resort for image mode: cookie-only /photos post (no access_token).
        if (!isLinkAttachmentPost && cookieHeaderCandidates.length > 0 && finalImageUrl) {
            for (let i = 0; i < cookieHeaderCandidates.length; i += 1) {
                try {
                    console.log(`[publish] Attempting cookie-only photo post as last resort (${i + 1}/${cookieHeaderCandidates.length})`);
                    const cookiePhotoResult = await publishPhotoCookieOnly({
                        pageId,
                        cookieHeaders: cookieHeaderCandidates[i],
                        imageUrl: finalImageUrl,
                        caption: finalCaption,
                        scheduledTime: scheduleTimestamp || null,
                    });
                    const cookiePhotoUrl = buildFacebookPostUrl(cookiePhotoResult.postId, pageId);
                    await recordPublishedSuccess(cookiePhotoResult.postId, cookiePhotoUrl, {
                        flow: 'cookie-only-photo',
                        postMode: postMode || null,
                    });
                    const hideResult = await maybeHideAfterPublish(cookiePhotoResult.postId, authCandidates[0] || '');
                    return c.json({
                        success: true,
                        postId: cookiePhotoResult.postId,
                        url: cookiePhotoUrl,
                        timelineHidden: hideResult.hidden,
                        warning: 'โพสต์ผ่าน cookie-only mode (ไม่มี Ads/Page token ที่ใช้งานได้)',
                        needsScheduling: !!scheduleTimestamp,
                        ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                        _debug: {
                            flow: 'cookie-only-photo',
                            hide: hideResult,
                            cookieCandidateIndex: i + 1,
                        },
                    });
                } catch (cookiePhotoError) {
                    const cookiePhotoMsg = cookiePhotoError instanceof Error ? cookiePhotoError.message : String(cookiePhotoError);
                    console.warn('[publish] cookie-only photo candidate failed:', cookiePhotoMsg);
                }
            }
        }

        const shouldReportSessionExpired = sawSessionExpired && !sawNonSessionError;
        const isTokenAuthError =
            !shouldReportSessionExpired &&
            isSessionInvalidatedFacebookError(lastFacebookError);
        return c.json({
            success: false,
            error: shouldReportSessionExpired
                ? 'Facebook session หมดอายุ กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                : isTokenAuthError
                ? 'Token ทั้งหมดไม่ถูกต้อง กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                : (lastFacebookError?.message || 'Facebook API error'),
            errorCode: shouldReportSessionExpired ? 190 : lastFacebookError?.code,
            errorSubcode: lastFacebookError?.error_subcode,
            errorType: lastFacebookError?.type,
            _debug: {
                candidateCount: authCandidates.length,
                postMode,
                isLinkAttachmentPost,
                hasImage: !!finalImageUrl,
                imageType: finalImageUrl ? (finalImageUrl.startsWith('data:') ? 'data-url' : finalImageUrl.startsWith('http') ? 'url' : 'unknown') : 'none',
                hostedImageUrl: hostedImageUrl || '',
                previewUrl: previewUrl ? previewUrl.substring(0, 120) : '',
                hasLink: !!finalLink,
                fbError: lastFacebookError,
                sawSessionExpired,
                sawNonSessionError,
                shouldReportSessionExpired,
            },
        }, 400);
    } catch (error) {
        console.error('[publish] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishRouter };
