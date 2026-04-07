import { Hono } from 'hono';
import { Env } from '../index';
import { recordPublishHistory } from '../lib/publish-history';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';
const DEFAULT_GHOST_TARGET_COUNTRIES = ['TH'];

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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
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
    const headers = buildFacebookHeaders(cookieData);

    // Try with access token first (standard Graph API)
    if (accessToken) {
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
            console.warn('[publish] /me/accounts page token fetch failed:', error);
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
            console.warn('[publish] direct page token fetch failed:', error);
        }
    }

    // Cookie-only fallback: call Graph API with just Cookie header (no access_token param).
    if (headers) {
        try {
            const cookieRes = await fetch(
                `${FB_API}/me/accounts?fields=id,access_token&limit=100`,
                { headers },
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

function buildNewsPreviewUrl(requestUrl: string, params: {
    targetUrl: string;
    imageUrl?: string;
    title?: string;
    description?: string;
    siteName?: string;
    version?: string;
}): string {
    const previewUrl = new URL('/api/news-link', requestUrl);
    previewUrl.searchParams.set('target', params.targetUrl);

    if (params.imageUrl) previewUrl.searchParams.set('image', params.imageUrl);
    if (params.title) previewUrl.searchParams.set('title', params.title);
    if (params.description) previewUrl.searchParams.set('description', params.description);
    if (params.siteName) previewUrl.searchParams.set('site', params.siteName);
    if (params.version) previewUrl.searchParams.set('v', params.version);

    return previewUrl.toString();
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
    const publishParams = new URLSearchParams({
        access_token: pageToken,
        is_published: 'true',
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
    if (data?.error) {
        throw new Error(data.error.message || 'Failed to publish unpublished post');
    }
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
    const hasLinkMetadata = Boolean(
        params.title ||
        params.caption ||
        params.description ||
        params.pictureUrl,
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
            if (params.title) body.set('name', params.title);
            if (params.caption) body.set('caption', params.caption);
            if (params.description) body.set('description', params.description);
            if (params.pictureUrl) body.set('picture', params.pictureUrl);
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
        const isCallToActionError = firstLower.includes('call_to_action')
            || firstLower.includes('call to action')
            || firstLower.includes('unpublished_content_type');

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
        const retryCallToActionError = retryLower.includes('call_to_action')
            || retryLower.includes('call to action')
            || retryLower.includes('unpublished_content_type');

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
            || thirdLower.includes('unsupported post request');
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
}): Promise<{ adId: string; adsetId: string; campaignId: string; postId: string; seedAdId: string; adData: any }> {
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
}> {
    const creativePayload: Record<string, any> = {
        page_id: params.pageId,
        link_data: {
            link: params.linkUrl,
            message: params.message || '',
            ...(params.hostedImageUrl ? { picture: params.hostedImageUrl } : {}),
            ...(params.title ? { name: params.title } : {}),
            ...(params.caption ? { caption: params.caption } : {}),
            ...(params.description ? { description: params.description } : {}),
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

        const facebookHeaders = buildFacebookHeaders(cookieData);
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
        let freshPageToken = await fetchFreshPageToken(pageId, accessToken, cookieData);
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
            storedPageToken,
            requestedPageToken,
            accessToken,
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
            !!callToActionLabel
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
        const previewUrl = isLinkAttachmentPost
            ? buildNewsPreviewUrl(c.req.url, {
                targetUrl: finalLink,
                imageUrl: hostedImageUrl || undefined,
                title: attachmentTitle || 'ดูรายละเอียดสินค้า',
                description: attachmentDescription || finalMessage || 'แตะเพื่อดูรายละเอียดสินค้า',
                siteName: previewSiteName,
                version: `${Date.now()}`,
            })
            : '';
        const publishLinkUrl = isLinkAttachmentPost ? previewUrl : finalLink;

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
                        facebookHeaders ? { headers: facebookHeaders } : undefined,
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
                    facebookHeaders,
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

        if (adCreativeFlowEnabled && isLinkAttachmentPost && accessToken && !resolvedAdAccountId) {
            try {
                accessibleAdAccounts = await fetchAccessibleAdAccountIds(accessToken, facebookHeaders);
                resolvedAdAccountId = accessibleAdAccounts[0] || '';
            } catch (error) {
                console.warn('[publish] Failed to auto-resolve ad account from access token:', error);
            }
        }
        const normalizedCallToAction = normalizeCallToActionType(callToAction);
        const canUseAdCreativeFlow = adCreativeFlowEnabled && isLinkAttachmentPost && !!accessToken && !!resolvedAdAccountId;

        if (isLinkAttachmentPost) {
            // Include access token as last-resort candidate for feed fallback.
            // Some workspaces can still post via feed with a valid user token even when
            // page token lookup temporarily fails.
            const pageTokenCandidates = buildAuthCandidates([
                freshPageToken,
                requestedPageToken,
                storedPageToken,
                accessToken,
            ]);
            const feedLinkCandidates = (() => {
                if (publishLinkUrl && finalLink && publishLinkUrl !== finalLink) {
                    // Try controlled preview URL first to keep stable rich metadata.
                    // If Facebook rejects/failed preview scraping, fallback to direct link.
                    return [publishLinkUrl, finalLink];
                }
                return [finalLink || publishLinkUrl];
            })().filter(Boolean);
            const pageTokenForPublish = pageTokenCandidates[0] || '';
            let adCreativeError: string | null = null;
            let adCreativeDebug: Record<string, unknown> = {
                canUseAdCreativeFlow,
                resolvedAdAccountId: resolvedAdAccountId || '',
            };

            console.log('[publish] Link post diagnostics:', {
                hasClientAccessToken: !!accessToken,
                resolvedAdAccountId: resolvedAdAccountId || '(none)',
                adCreativeAllowedByEnv,
                adCreativeRequestedByClient,
                adCreativeFlowEnabled,
                canUseAdCreativeFlow,
                pageTokenCandidateCount: pageTokenCandidates.length,
            });

            // Primary: ad creative produces rich cards with custom image, title, CTA button.
            if (canUseAdCreativeFlow) {
                try {
                    const creativeResult = await createStandaloneAdCreative({
                        env: c.env,
                        organizationId,
                        pageId,
                        accessToken,
                        cookieHeaders: facebookHeaders,
                        adAccountId: resolvedAdAccountId,
                        // Ad creative should point to the real outbound destination.
                        // Using preview URL here causes posts to render as api.pubilo.com cards.
                        linkUrl: finalLink,
                        hostedImageUrl: hostedImageUrl || undefined,
                        message: finalMessage,
                        title: attachmentTitle || undefined,
                        caption: previewSiteName || undefined,
                        description: attachmentDescription || undefined,
                        callToAction: normalizedCallToAction,
                        allowAdMaterialization: false,
                    });

                    if (!scheduleTimestamp && pageTokenForPublish) {
                        await publishExistingUnpublishedPost(creativeResult.postId, pageTokenForPublish, facebookHeaders);
                    }

                    const publishedUrl = buildFacebookPostUrl(creativeResult.postId, pageId);
                    await recordPublishedSuccess(creativeResult.postId, publishedUrl, {
                        flow: 'adcreative',
                        creativeId: creativeResult.creativeId,
                        materializedBy: creativeResult.materializedBy,
                    });
                    const hideResult = await maybeHideAfterPublish(creativeResult.postId, pageTokenForPublish);

                    return c.json({
                        success: true,
                        postId: creativeResult.postId,
                        url: publishedUrl,
                        timelineHidden: hideResult.hidden,
                        ...(hideResult.attempted && !hideResult.hidden ? { warning: `ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}` } : {}),
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
                            hide: hideResult,
                        },
                    });
                } catch (error) {
                    adCreativeError = error instanceof Error ? error.message : String(error);
                    adCreativeDebug = {
                        ...adCreativeDebug,
                        ...((((error as Error & { debug?: Record<string, unknown> }).debug) || {})),
                    };
                    console.warn('[publish] adcreative failed, falling back to feed:', adCreativeError);
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
            for (const candidateToken of pageTokenCandidates) {
                let candidateLastError = '';
                for (let linkIndex = 0; linkIndex < feedLinkCandidates.length; linkIndex += 1) {
                    const feedLinkUrl = feedLinkCandidates[linkIndex];
                    try {
                        const feedResult = await publishLinkCardViaFeed({
                            pageId,
                            pageToken: candidateToken,
                            headers: facebookHeaders,
                            message: finalMessage,
                            linkUrl: feedLinkUrl,
                            title: attachmentTitle || undefined,
                            caption: attachmentCaption || previewSiteName || undefined,
                            description: attachmentDescription || undefined,
                            pictureUrl: hostedImageUrl || undefined,
                            callToActionType: normalizedCallToAction,
                            callToActionLinkUrl: finalLink || feedLinkUrl,
                            publishAsAdsPost: !scheduleTimestamp,
                            scheduledTime: scheduleTimestamp || undefined,
                            allowMetadataDropRetry: true,
                        });
                        if (feedResult.createdAsDraft && !scheduleTimestamp) {
                            await publishExistingUnpublishedPost(feedResult.postId, candidateToken, facebookHeaders);
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
                            },
                        });
                    } catch (feedError) {
                        candidateLastError = feedError instanceof Error ? feedError.message : String(feedError);
                        lastFeedFacebookError = (feedError as { facebookError?: any })?.facebookError || lastFeedFacebookError;
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
                    try {
                        console.log(`[publish] Attempting cookie-only feed post as last resort (${i + 1}/${cookieHeaderCandidates.length})`);
                        const cookieResult = await publishViaFeedCookieOnly({
                            pageId,
                            cookieHeaders: cookieHeaderCandidates[i],
                            message: finalMessage,
                            linkUrl: publishLinkUrl || finalLink,
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
                            },
                        });
                    } catch (cookieError) {
                        const cookieMsg = cookieError instanceof Error ? cookieError.message : String(cookieError);
                        console.warn('[publish] cookie-only feed candidate failed:', cookieMsg);
                    }
                }
            }

            const isSessionInvalidated =
                isSessionInvalidatedFacebookError(lastFeedFacebookError) ||
                isAuthRelatedErrorMessage(lastFeedError) ||
                /changed.*password|security reasons/i.test(
                    `${adCreativeError || ''} ${lastFeedError || ''}`,
                );
            const isExpectedCreativeStoryMiss = /did not return object_story_id|materialization disabled/i.test(
                String(adCreativeError || '')
            );
            const normalizedAdCreativeError = isExpectedCreativeStoryMiss ? '' : String(adCreativeError || '').trim();
            const normalizedFeedError = String(lastFeedError || '').trim();
            const nonSessionReason = normalizedFeedError || normalizedAdCreativeError;
            const userMessage = isSessionInvalidated
                ? 'Facebook session หมดอายุ กรุณา logout แล้ว login Facebook ใหม่ จากนั้นกดปุ่ม extension แล้วรีเฟรชหน้า'
                : nonSessionReason
                    ? `โพสต์ไม่สำเร็จ: ${nonSessionReason}`
                    : 'โพสต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

            return c.json({
                success: false,
                error: userMessage,
                errorType: isSessionInvalidated ? 'SessionExpired' : 'LinkPublishFailed',
                ...(isSessionInvalidated ? { errorCode: 190 } : {}),
                _debug: {
                    adCreativeError,
                    feedError: lastFeedError,
                    candidatesTried: pageTokenCandidates.length,
                    isSessionInvalidated,
                },
            }, 400);
        }

        let lastFacebookError: any = null;
        let sawSessionExpired = false;

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
                console.log('[publish] Trying worker multipart upload', { tokenSource: authToken === accessToken ? 'accessToken' : 'pageToken' });
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
                        ...(facebookHeaders ? { headers: facebookHeaders } : {}),
                        body: multipartBody,
                    }
                    : {
                        headers: {
                            ...(facebookHeaders || {}),
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
                    console.warn('[publish] Token invalid (code 1), trying next candidate...', { tokenLen: authToken.length });
                    lastFacebookError = data.error;
                    continue;
                }

                lastFacebookError = data.error;
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
                        ...(facebookHeaders || {}),
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

        const isOAuthError = lastFacebookError?.type === 'OAuthException';
        return c.json({
            success: false,
            error: sawSessionExpired
                ? 'Facebook session หมดอายุ กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                : isOAuthError
                ? 'Token ทั้งหมดไม่ถูกต้อง กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                : (lastFacebookError?.message || 'Facebook API error'),
            errorCode: lastFacebookError?.code,
            errorSubcode: lastFacebookError?.error_subcode,
            errorType: lastFacebookError?.type,
            _debug: {
                candidateCount: authCandidates.length,
                postMode,
                isLinkAttachmentPost,
                hasImage: !!finalImageUrl,
                imageType: finalImageUrl ? (finalImageUrl.startsWith('data:') ? 'data-url' : finalImageUrl.startsWith('http') ? 'url' : 'unknown') : 'none',
                hostedImageUrl: hostedImageUrl ? hostedImageUrl.substring(0, 80) : '',
                previewUrl: previewUrl ? previewUrl.substring(0, 120) : '',
                hasLink: !!finalLink,
                fbError: lastFacebookError,
            },
        }, 400);
    } catch (error) {
        console.error('[publish] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishRouter };
