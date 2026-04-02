import { Hono } from 'hono';
import { Env } from '../index';
import { recordPublishHistory } from '../lib/publish-history';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

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

    return '';
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
            if (!adsToken) continue;

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
    scheduledTime?: number | null;
    allowMetadataDropRetry?: boolean;
}): Promise<{ postId: string }> {
    const hasRichMetadata = Boolean(
        params.title ||
        params.caption ||
        params.description ||
        params.pictureUrl,
    );

    const execute = async (includeRichMetadata: boolean): Promise<{ postId: string }> => {
        const body = new URLSearchParams({
            access_token: params.pageToken,
            link: params.linkUrl,
        });

        if (params.message) body.set('message', params.message);

        if (includeRichMetadata) {
            if (params.title) body.set('name', params.title);
            if (params.caption) body.set('caption', params.caption);
            if (params.description) body.set('description', params.description);
            if (params.pictureUrl) body.set('picture', params.pictureUrl);
        }

        if (params.scheduledTime) {
            body.set('published', 'false');
            body.set('scheduled_publish_time', String(params.scheduledTime));
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

        return { postId };
    };

    try {
        return await execute(hasRichMetadata);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldRetryWithoutMetadata =
            hasRichMetadata &&
            params.allowMetadataDropRetry !== false &&
            message.includes('Only owners of the URL') &&
            message.includes('picture, name, thumbnail or description');

        if (!shouldRetryWithoutMetadata) {
            throw error;
        }

        console.warn('[publish] Feed link metadata rejected by Facebook, retrying without metadata override');
        return await execute(false);
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
}): Promise<{ adId: string; adsetId: string; campaignId: string; raw: any } | null> {
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
    const matchingRows = rows
        .map((row: any) => {
            const spec = row?.creative?.object_story_spec || {};
            const creativePageId = String(spec?.page_id || '');
            return {
                row,
                adId: String(row?.id || ''),
                adsetId: String(row?.adset_id || ''),
                campaignId: String(row?.campaign_id || ''),
                createdTime: String(row?.created_time || ''),
                creativePageId,
            };
        })
        .filter((row: any) => row.adId && row.adsetId && row.creativePageId === String(params.pageId))
        .sort((a: any, b: any) => (a.createdTime < b.createdTime ? 1 : a.createdTime > b.createdTime ? -1 : 0));

    if (!matchingRows.length) {
        return null;
    }

    const selected = matchingRows[0];
    return {
        adId: selected.adId,
        adsetId: selected.adsetId,
        campaignId: selected.campaignId,
        raw: selected.row,
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
    preferredAdAccountId: string;
    accessToken: string;
    pageId: string;
    headers?: Record<string, string>;
}): Promise<{
    adAccountId: string;
    seed: { adId: string; adsetId: string; campaignId: string; raw: any } | null;
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
    adAccountId: string;
    accessToken: string;
    pageId: string;
    creativeId: string;
    headers?: Record<string, string>;
    seed?: { adId: string; adsetId: string; campaignId: string; raw: any } | null;
}): Promise<{ adId: string; adsetId: string; campaignId: string; postId: string; seedAdId: string; adData: any }> {
    const seed = params.seed ?? await fetchReusableAdSeed({
        adAccountId: params.adAccountId,
        accessToken: params.accessToken,
        pageId: params.pageId,
        headers: params.headers,
    });

    if (!seed?.adsetId) {
        throw new Error('No reusable adset found for this page in the selected ad account');
    }

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

    return {
        adId,
        adsetId: seed.adsetId,
        campaignId: seed.campaignId,
        seedAdId: seed.adId,
        postId: adStoryResult.postId,
        adData: adStoryResult.raw,
    };
}

async function createStandaloneAdCreative(params: {
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
    seed?: { adId: string; adsetId: string; campaignId: string; raw: any } | null;
}): Promise<{ creativeId: string; postId: string; creativeData: any; adId?: string; adsetId?: string; campaignId?: string; seedAdId?: string; materializedBy?: string }> {
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
    throw new Error('Facebook did not return object_story_id for ad creative');
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
        const finalLink = link || linkUrl || '';
        const finalImageUrl = imageUrl || '';
        const isLinkAttachmentPost = !!finalLink && (postMode === 'news' || postMode === 'link');
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

        const shouldHideFromTimeline = storedHideOnPublish && !scheduleTimestamp;
        const maybeHideAfterPublish = async (postId: string, tokenForHide: string) => {
            if (!shouldHideFromTimeline || !postId) {
                return {
                    attempted: false,
                    hidden: false,
                    method: '',
                    error: '',
                };
            }

            const authToken = String(tokenForHide || '').trim();
            if (!authToken) {
                return {
                    attempted: true,
                    hidden: false,
                    method: '',
                    error: 'missing_publish_token',
                };
            }

            const result = await hidePagePostFromTimeline(
                postId,
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
                        postId,
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

            return {
                attempted: true,
                hidden: false,
                method: '',
                error: result.error || 'hide_failed',
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

        if (isLinkAttachmentPost && accessToken && !resolvedAdAccountId) {
            try {
                accessibleAdAccounts = await fetchAccessibleAdAccountIds(accessToken, facebookHeaders);
                resolvedAdAccountId = accessibleAdAccounts[0] || '';
            } catch (error) {
                console.warn('[publish] Failed to auto-resolve ad account from access token:', error);
            }
        }
        const normalizedCallToAction = normalizeCallToActionType(callToAction);
        const canUseAdCreativeFlow = isLinkAttachmentPost && !!accessToken && !!resolvedAdAccountId;

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
            const pageTokenForPublish = pageTokenCandidates[0] || '';
            let adCreativeError: string | null = null;

            console.log('[publish] Link post diagnostics:', {
                hasClientAccessToken: !!accessToken,
                resolvedAdAccountId: resolvedAdAccountId || '(none)',
                canUseAdCreativeFlow,
                pageTokenCandidateCount: pageTokenCandidates.length,
            });

            // Primary: ad creative produces rich cards with custom image, title, CTA button.
            if (canUseAdCreativeFlow) {
                try {
                    const creativeResult = await createStandaloneAdCreative({
                        pageId,
                        accessToken,
                        cookieHeaders: facebookHeaders,
                        adAccountId: resolvedAdAccountId,
                        linkUrl: publishLinkUrl,
                        hostedImageUrl: hostedImageUrl || undefined,
                        message: finalMessage,
                        title: attachmentTitle || undefined,
                        caption: previewSiteName || undefined,
                        description: attachmentDescription || undefined,
                        callToAction: normalizedCallToAction,
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
                            hide: hideResult,
                        },
                    });
                } catch (error) {
                    adCreativeError = error instanceof Error ? error.message : String(error);
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
            for (const candidateToken of pageTokenCandidates) {
                try {
                    const feedResult = await publishLinkCardViaFeed({
                        pageId,
                        pageToken: candidateToken,
                        headers: facebookHeaders,
                        message: finalMessage,
                        linkUrl: publishLinkUrl,
                        scheduledTime: scheduleTimestamp || undefined,
                    });

                    const feedUrl = buildFacebookPostUrl(feedResult.postId, pageId);
                    await recordPublishedSuccess(feedResult.postId, feedUrl, {
                        flow: adCreativeError ? 'feed-fallback' : 'feed-link',
                    });
                    const hideResult = await maybeHideAfterPublish(feedResult.postId, candidateToken);

                    return c.json({
                        success: true,
                        postId: feedResult.postId,
                        url: feedUrl,
                        timelineHidden: hideResult.hidden,
                        ...(hideResult.attempted && !hideResult.hidden ? { warning: `ซ่อนโพสต์ไม่สำเร็จ: ${hideResult.error}` } : {}),
                        ...(adCreativeError ? { warning: 'Ad creative ไม่สำเร็จ ระบบสลับไปโพสต์ผ่าน feed แทน' } : {}),
                        needsScheduling: !!scheduleTimestamp,
                        ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                        _debug: {
                            flow: adCreativeError ? 'feed-fallback' : 'feed-link',
                            adCreativeError,
                            hide: hideResult,
                        },
                    });
                } catch (feedError) {
                    lastFeedError = feedError instanceof Error ? feedError.message : String(feedError);
                    console.warn(`[publish] feed candidate failed (${pageTokenCandidates.indexOf(candidateToken) + 1}/${pageTokenCandidates.length}):`, lastFeedError);
                }
            }

            const isSessionInvalidated = /session has been invalidated|error validating access token|changed.*password|security reasons/i.test(
                `${adCreativeError || ''} ${lastFeedError || ''}`
            );
            const userMessage = isSessionInvalidated
                ? 'Facebook session หมดอายุ กรุณา logout แล้ว login Facebook ใหม่ จากนั้นกดปุ่ม extension แล้วรีเฟรชหน้า'
                : adCreativeError
                    ? `โพสต์ไม่สำเร็จ กรุณา login Facebook ใหม่แล้วกด extension`
                    : `โพสต์ไม่สำเร็จ: ${lastFeedError}`;

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
