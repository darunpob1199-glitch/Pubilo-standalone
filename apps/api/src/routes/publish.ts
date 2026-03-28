import { Hono } from 'hono';
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

async function ensureScheduledPublishQueueTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
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

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_status_time
        ON scheduled_publish_queue (status, scheduled_time)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_page_status
        ON scheduled_publish_queue (page_id, status, scheduled_time)
    `).run();
}

async function enqueueScheduledPublish(
    env: Env,
    pageId: string,
    scheduledTime: number,
    payload: Record<string, unknown>,
): Promise<number> {
    await ensureScheduledPublishQueueTable(env);

    const result = await env.DB.prepare(`
        INSERT INTO scheduled_publish_queue (
            page_id,
            payload_json,
            scheduled_time,
            status
        ) VALUES (?, ?, ?, 'pending')
    `).bind(
        pageId,
        JSON.stringify(payload),
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

    const adMaterialization = await materializeCreativeWithAd({
        adAccountId: params.adAccountId,
        accessToken: params.accessToken,
        pageId: params.pageId,
        creativeId,
        headers: params.cookieHeaders,
        seed: params.seed,
    });

    return {
        creativeId,
        postId: adMaterialization.postId,
        creativeData: adMaterialization.adData,
        adId: adMaterialization.adId,
        adsetId: adMaterialization.adsetId,
        campaignId: adMaterialization.campaignId,
        seedAdId: adMaterialization.seedAdId,
        materializedBy: 'ad',
    };
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
            scheduleInSystem,
            internalRun,
        } = body;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        let storedPageToken = pageToken;

        if (!storedPageToken) {
            console.log('[publish] No direct pageToken provided, checking D1 page_settings...');
            try {
                const dbResult = await c.env.DB.prepare(
                    'SELECT post_token FROM page_settings WHERE page_id = ? LIMIT 1'
                ).bind(pageId).first<{ post_token: string | null }>();

                if (dbResult?.post_token) {
                    storedPageToken = dbResult.post_token;
                    console.log('[publish] Got stored Page Token from D1 page_settings');
                }
            } catch (dbErr) {
                console.error('[publish] D1 error:', dbErr);
            }
        }

        const facebookHeaders = buildFacebookHeaders(cookieData);
        const freshPageToken = await fetchFreshPageToken(pageId, accessToken, cookieData);
        const authCandidates = buildAuthCandidates([
            freshPageToken,
            storedPageToken,
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

        let hostedImageUrl = '';
        if (isLinkAttachmentPost && finalImageUrl) {
            if (finalImageUrl.startsWith('http')) {
                hostedImageUrl = finalImageUrl;
            } else if (finalImageUrl.startsWith('data:')) {
                hostedImageUrl = await uploadImageToHost(finalImageUrl, c.env.FREEIMAGE_API_KEY);
                console.log('[publish] Uploaded link attachment image for feed attachment:', !!hostedImageUrl);
            }
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

        const shouldQueueInSystem = !!scheduleTimestamp && !!scheduleInSystem && !internalRun;
        if (shouldQueueInSystem) {
            const queuePayload: Record<string, unknown> = {
                ...body,
                imageUrl: hostedImageUrl || finalImageUrl,
                scheduledTime: null,
                scheduleInSystem: false,
                internalRun: false,
            };

            const queueId = await enqueueScheduledPublish(c.env, pageId, scheduleTimestamp, queuePayload);
            if (!queueId) {
                throw new Error('Failed to enqueue scheduled publish');
            }

            const queuePostId = `queue:${queueId}`;
            return c.json({
                success: true,
                queued: true,
                postId: queuePostId,
                id: queuePostId,
                url: buildFacebookPostUrl('', pageId),
                needsScheduling: false,
                scheduledTime: scheduleTimestamp,
                _debug: {
                    flow: 'system-queue',
                    queueId,
                    scheduledTime: scheduleTimestamp,
                },
            });
        }

        let lastFacebookError: any = null;
        let sawSessionExpired = false;
        const normalizedAdAccountId = normalizeAdAccountId(adAccountId);

        if (isLinkAttachmentPost && !normalizedAdAccountId) {
            return c.json({
                success: false,
                error: 'Missing Ad Account - กรุณากด extension เพื่อดึง Ads Token/Ad Account ใหม่แล้วลองอีกครั้ง',
                errorType: 'MissingAdAccount',
            }, 400);
        }

        if (isLinkAttachmentPost && accessToken && normalizedAdAccountId) {
            try {
                const pageTokenForPublish = freshPageToken || storedPageToken;
                if (!pageTokenForPublish) {
                    throw new Error('ไม่พบ Page Token สำหรับ publish post');
                }

                const seedContext = await resolveAdSeedContext({
                    preferredAdAccountId: normalizedAdAccountId,
                    accessToken,
                    pageId,
                    headers: facebookHeaders,
                });

                const resolvedAdAccountId = seedContext.seed?.adsetId
                    ? seedContext.adAccountId
                    : normalizedAdAccountId;

                const creativeResult = await createStandaloneAdCreative({
                    pageId,
                    accessToken,
                    cookieHeaders: facebookHeaders,
                    adAccountId: resolvedAdAccountId,
                    linkUrl: finalLink,
                    hostedImageUrl: hostedImageUrl || undefined,
                    message: finalMessage,
                    title: attachmentTitle || undefined,
                    caption: previewSiteName || undefined,
                    description: attachmentDescription || undefined,
                    callToAction: callToAction || 'SHOP_NOW',
                    seed: seedContext.seed,
                });

                console.log('[publish] Ad creative created:', {
                    creativeId: creativeResult.creativeId,
                    postId: creativeResult.postId,
                    creativeData: creativeResult.creativeData,
                    requestedAdAccountId: normalizedAdAccountId,
                    resolvedAdAccountId,
                    adId: creativeResult.adId,
                    adsetId: creativeResult.adsetId,
                    campaignId: creativeResult.campaignId,
                    seedAdId: creativeResult.seedAdId,
                    materializedBy: creativeResult.materializedBy,
                    scannedAccounts: seedContext.scannedAccounts,
                });

                if (!scheduleTimestamp) {
                    await publishExistingUnpublishedPost(creativeResult.postId, pageTokenForPublish, facebookHeaders);
                }

                return c.json({
                    success: true,
                    postId: creativeResult.postId,
                    url: buildFacebookPostUrl(creativeResult.postId, pageId),
                    needsScheduling: !!scheduleTimestamp,
                    ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
                    _debug: {
                        flow: 'adcreative',
                        creativeId: creativeResult.creativeId,
                        adAccountId: resolvedAdAccountId,
                        requestedAdAccountId: normalizedAdAccountId,
                        adId: creativeResult.adId || '',
                        adsetId: creativeResult.adsetId || '',
                        campaignId: creativeResult.campaignId || '',
                        seedAdId: creativeResult.seedAdId || '',
                        materializedBy: creativeResult.materializedBy || '',
                        scannedAccounts: seedContext.scannedAccounts,
                    },
                });
            } catch (error) {
                const rawMessage = error instanceof Error ? error.message : String(error);
                const friendlyMessage =
                    rawMessage === 'No reusable adset found for this page in the selected ad account'
                        ? 'ไม่พบ adset เดิมของเพจนี้ใน ad accounts ที่ token นี้เข้าถึงได้ กรุณาเปิด Ads Manager/เคยสร้างโฆษณาของเพจนี้ก่อน แล้วลองอีกครั้ง'
                        : rawMessage;
                lastFacebookError = { message: friendlyMessage, type: 'AdCreativeFlowError' };
                console.warn('[publish] Ad creative flow failed:', lastFacebookError);
                return c.json({
                    success: false,
                    error: lastFacebookError.message,
                    errorType: lastFacebookError.type,
                    _debug: {
                        flow: 'adcreative',
                        hasImage: !!hostedImageUrl,
                        adAccountId: normalizedAdAccountId,
                        previewUrl: previewUrl.substring(0, 120),
                    },
                }, 400);
            }
        }

        for (const authToken of authCandidates) {
            let endpoint = `${FB_API}/${pageId}`;
            let params = new URLSearchParams({ access_token: authToken });
            let multipartBody: FormData | null = null;
            let publishDraftAfterCreate = false;

            if (isLinkAttachmentPost) {
                endpoint += '/feed';
                params.append('link', previewUrl || finalLink);
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
                params.append('link', finalLink);
                if (finalMessage) params.append('message', finalMessage);
            } else {
                endpoint += '/feed';
                if (finalMessage) params.append('message', finalMessage);
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
            return c.json({
                success: true,
                postId,
                url: buildFacebookPostUrl(postId, pageId),
                needsScheduling: !!scheduleTimestamp,
                ...(scheduleTimestamp ? { scheduledTime: scheduleTimestamp } : {}),
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
