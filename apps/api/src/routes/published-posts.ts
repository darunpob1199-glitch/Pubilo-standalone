import { Hono } from 'hono';
import type { Env } from '../index';
import { backfillLegacyPublishHistory, ensurePublishHistoryTable } from '../lib/publish-history';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();
const FB_API = 'https://graph.facebook.com/v21.0';
const FACEBOOK_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

type PublishedSource = 'merged' | 'facebook' | 'history';

type PublishedQueryInput = {
    workspaceId: string;
    pageId: string;
    limit: number;
    source: PublishedSource;
    after?: string;
    pageToken?: string;
    hideToken?: string;
    accessToken?: string;
    cookieData?: string;
    strictLive?: boolean;
};

type WorkspaceCredentialCandidate = {
    accessToken: string;
    cookieData: string;
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

function parseFacebookPostIdParts(rawPostId?: string | null): {
    normalized: string;
    ownerId: string;
    objectId: string;
} {
    const normalized = String(rawPostId || '').trim().replace(/^fb:/, '');
    if (!normalized) {
        return { normalized: '', ownerId: '', objectId: '' };
    }

    const splitByKnownSeparator = (value: string) => {
        if (value.includes('_')) return value.split('_');
        if (value.includes(',')) return value.split(',');
        if (value.includes(':')) return value.split(':');
        return [value];
    };

    const parts = splitByKnownSeparator(normalized)
        .map((part) => String(part || '').trim())
        .filter(Boolean);
    if (parts.length === 0) {
        return { normalized, ownerId: '', objectId: '' };
    }

    if (parts.length === 1) {
        return { normalized, ownerId: '', objectId: parts[0] };
    }

    return {
        normalized,
        ownerId: parts[0],
        objectId: parts[parts.length - 1],
    };
}

function toCanonicalFacebookPostId(rawPostId?: string | null, fallbackPageId?: string | null): string {
    const parsed = parseFacebookPostIdParts(rawPostId);
    const fallbackOwnerId = String(fallbackPageId || '').trim();
    if (!parsed.normalized) return '';

    if (parsed.ownerId && parsed.objectId && parsed.ownerId !== parsed.objectId) {
        return `${parsed.ownerId}_${parsed.objectId}`;
    }

    if (fallbackOwnerId && parsed.objectId) {
        return `${fallbackOwnerId}_${parsed.objectId}`;
    }

    return parsed.normalized;
}

function isFacebookPostPermalink(value?: string | null): boolean {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    try {
        const parsed = new URL(normalized);
        const host = String(parsed.hostname || '').toLowerCase();
        if (!(host.includes('facebook.com') || host.includes('fb.com'))) return false;

        const path = String(parsed.pathname || '').toLowerCase();
        const search = String(parsed.search || '').toLowerCase();

        if (path.includes('/posts/')) return true;
        if (path.includes('/reel/')) return true;
        if (path.includes('/videos/')) return true;
        if (path.includes('/permalink.php')) return true;
        if (path.includes('/story.php')) return true;
        if (path.includes('/photo.php')) return true;
        if (path.includes('/watch/')) return true;
        if (search.includes('story_fbid=')) return true;
        if (search.includes('fbid=')) return true;

        return false;
    } catch (_) {
        return false;
    }
}

function buildFacebookPostUrl(params: {
    pageId?: string | null;
    postId?: string | null;
    permalink?: string | null;
    postType?: string | null;
}): string | null {
    const pageId = String(params.pageId || '').trim();
    const postId = String(params.postId || '').trim();
    const postType = String(params.postType || '').trim().toLowerCase();
    if (!postId) return null;
    const parsedPostId = parseFacebookPostIdParts(postId);

    const normalizedPostId = parsedPostId.normalized;
    const permalink = normalizeFacebookUrl(params.permalink);
    if (permalink) {
        if (isFacebookPostPermalink(permalink)) {
            return permalink;
        }
    }

    if (postType.includes('reel') || postType.includes('video')) {
        const reelId = parsedPostId.objectId || normalizedPostId;
        return reelId ? `https://www.facebook.com/reel/${reelId}/` : null;
    }

    if (normalizedPostId.includes('_')) {
        const parts = normalizedPostId.split('_').filter(Boolean);
        const objectId = parts[parts.length - 1];
        const ownerId = parts[0] || pageId;
        if (ownerId && objectId) {
            return `https://www.facebook.com/${ownerId}/posts/${objectId}`;
        }
    }

    if (pageId) {
        const objectId = parsedPostId.objectId || normalizedPostId;
        return objectId ? `https://www.facebook.com/${pageId}/posts/${objectId}` : null;
    }

    return parsedPostId.objectId
        ? `https://www.facebook.com/${parsedPostId.objectId}`
        : null;
}

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = String(cookieData || '').trim();
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
                console.log('[published-posts] Derived access token from cookie HTML probe:', url);
                return token;
            }
        } catch (error) {
            console.warn('[published-posts] Cookie HTML token probe failed:', url, error);
        }
    }

    return '';
}

async function fetchFreshPageToken(pageId: string, accessToken?: string, cookieData?: string): Promise<string> {
    const cookieHeaders = buildFacebookHeaders(cookieData);
    const graphHeaders = buildFacebookGraphHeaders();
    const normalizedAccessToken = String(accessToken || '').trim();

    if (normalizedAccessToken) {
        try {
            const accountsRes = await fetch(
                `${FB_API}/me/accounts?access_token=${encodeURIComponent(normalizedAccessToken)}&fields=id,access_token&limit=100`,
                { headers: graphHeaders },
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
                `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(normalizedAccessToken)}`,
                { headers: graphHeaders },
            );
            const tokenData = await tokenRes.json() as any;

            if (tokenData?.access_token) {
                return tokenData.access_token;
            }
        } catch (error) {
            console.warn('[published-posts] direct page token fetch failed:', error);
        }
    }

    // Cookie-only token discovery fallback.
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
                    console.log('[published-posts] Recovered page token from cookie-only auth');
                    return matchedPage.access_token;
                }
            }
        } catch (error) {
            console.warn('[published-posts] cookie-only page token fetch failed:', error);
        }

        try {
            const derivedAccessToken = await fetchCookieDerivedAccessToken(cookieHeaders);
            if (derivedAccessToken) {
                const accountsRes = await fetch(
                    `${FB_API}/me/accounts?access_token=${encodeURIComponent(derivedAccessToken)}&fields=id,access_token&limit=100`,
                    { headers: graphHeaders },
                );
                const accountsData = await accountsRes.json() as any;
                const matchedPage = accountsData?.data?.find((page: any) => String(page.id) === String(pageId));
                if (matchedPage?.access_token) {
                    console.log('[published-posts] Recovered page token via derived access token');
                    return matchedPage.access_token;
                }

                const directRes = await fetch(
                    `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(derivedAccessToken)}`,
                    { headers: graphHeaders },
                );
                const directData = await directRes.json() as any;
                if (directData?.access_token) {
                    console.log('[published-posts] Recovered page token via derived access token (direct)');
                    return directData.access_token;
                }
            }
        } catch (error) {
            console.warn('[published-posts] derived access token page token fetch failed:', error);
        }
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

function buildPageIdCandidates(primaryPageId: string, ...extraCandidates: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];
    const pushCandidate = (value?: string | null) => {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    pushCandidate(primaryPageId);
    extraCandidates.forEach((value) => pushCandidate(value));
    return candidates;
}

function extractFacebookNumericIdsFromUrl(value?: string | null): string[] {
    const normalized = normalizeFacebookUrl(value);
    if (!normalized) return [];

    try {
        const parsed = new URL(normalized);
        const idSet = new Set<string>();
        const pushNumeric = (candidate?: string | null) => {
            const raw = String(candidate || '').trim();
            if (!raw) return;
            const numericMatch = raw.match(/^\d{8,}$/) ? raw : (raw.match(/(\d{8,})/)?.[1] || '');
            if (numericMatch) {
                idSet.add(numericMatch);
            }
        };

        pushNumeric(parsed.searchParams.get('id'));
        parsed.pathname
            .split('/')
            .map((segment) => String(segment || '').trim())
            .filter(Boolean)
            .forEach((segment) => pushNumeric(segment));

        return Array.from(idSet);
    } catch (_) {
        return [];
    }
}

function buildCanonicalFacebookPostIdCandidates(
    rawPostId: string,
    ownerIdCandidates: Array<string>,
    fallbackOwnerId = '',
): string[] {
    const parsed = parseFacebookPostIdParts(rawPostId);
    if (!parsed.normalized) return [];

    const objectId = parsed.objectId || parsed.normalized;
    const candidates = new Set<string>();
    candidates.add(parsed.normalized);

    if (parsed.ownerId && objectId && parsed.ownerId !== objectId) {
        candidates.add(`${parsed.ownerId}_${objectId}`);
    }

    const ownerCandidates = buildPageIdCandidates(
        fallbackOwnerId,
        ...ownerIdCandidates,
    );
    if (objectId) {
        ownerCandidates.forEach((ownerId) => {
            if (!ownerId || ownerId === objectId) return;
            candidates.add(`${ownerId}_${objectId}`);
        });
    }

    return Array.from(candidates);
}

async function resolveFacebookPageIdCandidates(params: {
    pageId: string;
    accessTokenCandidates: Array<string>;
    cookieHeaderCandidates: Array<Record<string, string>>;
}): Promise<string[]> {
    const pageId = String(params.pageId || '').trim();
    const idCandidates = new Set<string>();
    if (pageId) {
        idCandidates.add(pageId);
    }

    const pushFromPayload = (payload: any) => {
        const graphId = String(payload?.id || '').trim();
        if (graphId) idCandidates.add(graphId);
        extractFacebookNumericIdsFromUrl(payload?.link).forEach((candidateId) => idCandidates.add(candidateId));
        extractFacebookNumericIdsFromUrl(payload?.permalink_url).forEach((candidateId) => idCandidates.add(candidateId));
    };

    const tokenCandidates = buildAuthCandidates(params.accessTokenCandidates || []).slice(0, 4);
    const graphHeaders = buildFacebookGraphHeaders();
    for (const token of tokenCandidates) {
        try {
            const query = new URLSearchParams({
                fields: 'id,link,permalink_url',
                access_token: token,
            });
            const response = await fetch(`${FB_API}/${pageId}?${query.toString()}`, {
                headers: graphHeaders,
            });
            const payload = await response.json() as any;
            if (!payload?.error) {
                pushFromPayload(payload);
            }
        } catch (_) {
            // Ignore resolver probe failures and continue fallback candidates.
        }
    }

    const cookieCandidates = Array.isArray(params.cookieHeaderCandidates)
        ? params.cookieHeaderCandidates.slice(0, 2)
        : [];
    for (const headers of cookieCandidates) {
        try {
            const query = new URLSearchParams({
                fields: 'id,link,permalink_url',
            });
            const response = await fetch(`${FB_API}/${pageId}?${query.toString()}`, { headers });
            const payload = await response.json() as any;
            if (!payload?.error) {
                pushFromPayload(payload);
            }
        } catch (_) {
            // Ignore cookie resolver probe failures.
        }
    }

    return buildPageIdCandidates(pageId, ...Array.from(idCandidates));
}

type FacebookEdge = 'published_posts' | 'feed' | 'posts';

function encodeFacebookCursor(edge: FacebookEdge, cursor?: string | null): string {
    const normalizedCursor = String(cursor || '').trim();
    if (!normalizedCursor) return '';
    return `${edge}::${normalizedCursor}`;
}

function parseFacebookCursor(value?: string | null): { edge: FacebookEdge | null; cursor: string } {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return { edge: null, cursor: '' };
    }

    const match = normalized.match(/^(published_posts|feed|posts)::(.+)$/);
    if (!match) {
        return { edge: null, cursor: normalized };
    }

    return {
        edge: match[1] as FacebookEdge,
        cursor: String(match[2] || '').trim(),
    };
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

function isFacebookAuthInvalid(error: any): boolean {
    const code = Number(error?.code || 0);
    const subcode = Number(error?.error_subcode || 0);
    const type = String(error?.type || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    if (code === 190 || code === 102) return true;
    if ([460, 463, 467, 490].includes(subcode)) return true;
    if (message.includes('error validating access token')) return true;
    if (message.includes('session has been invalidated')) return true;
    if (message.includes('invalid oauth access token')) return true;
    if (message.includes('cannot parse access token')) return true;
    if (message.includes('access token could not be decrypted')) return true;
    if (
        code === 1 &&
        type === 'oauthexception' &&
        (
            message.includes('access token')
            || message.includes('session has been invalidated')
            || message.includes('invalid oauth')
        )
    ) {
        return true;
    }
    return false;
}

function isFacebookAppLoadError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('error loading application');
}

function isFacebookContentUnavailableHtml(html: string): boolean {
    const normalized = String(html || '').toLowerCase();
    if (!normalized) return true;
    return (
        normalized.includes('เนื้อหานี้ไม่พร้อมใช้งานในขณะนี้')
        || normalized.includes("this content isn't available right now")
        || normalized.includes('this page isn\'t available')
        || normalized.includes('the link may be broken')
        || normalized.includes('or the page may have been removed')
        || normalized.includes('content not found')
    );
}

function pickCanonicalFacebookPostId(rawPostId: string, ownerCandidates: Array<string>, fallbackOwnerId = ''): string {
    const canonicalCandidates = buildCanonicalFacebookPostIdCandidates(rawPostId, ownerCandidates, fallbackOwnerId);
    if (!canonicalCandidates.length) return '';
    const withOwner = canonicalCandidates.find((candidate) => candidate.includes('_'));
    return withOwner || canonicalCandidates[0] || '';
}

function extractFacebookPostIdsFromHtml(html: string, pageId: string): string[] {
    const source = String(html || '');
    if (!source) return [];

    const ids = new Set<string>();
    const pushCanonical = (rawPostId?: string, ownerId = '') => {
        const canonicalId = pickCanonicalFacebookPostId(
            String(rawPostId || '').trim(),
            buildPageIdCandidates(pageId, ownerId),
            ownerId || pageId,
        );
        if (canonicalId) ids.add(canonicalId);
    };

    let match: RegExpExecArray | null;
    const ownerPostPattern = /\/(\d{8,})\/posts\/(\d{8,})/g;
    while ((match = ownerPostPattern.exec(source)) !== null) {
        const ownerId = String(match[1] || '').trim();
        const postObjectId = String(match[2] || '').trim();
        if (!ownerId || !postObjectId) continue;
        pushCanonical(`${ownerId}_${postObjectId}`, ownerId);
    }

    const storyPattern = /[?&]story_fbid=(\d{8,})&id=(\d{8,})/g;
    while ((match = storyPattern.exec(source)) !== null) {
        const postObjectId = String(match[1] || '').trim();
        const ownerId = String(match[2] || '').trim();
        if (!ownerId || !postObjectId) continue;
        pushCanonical(`${ownerId}_${postObjectId}`, ownerId);
    }

    const permalinkPattern = /\/permalink\/(\d{8,})/g;
    while ((match = permalinkPattern.exec(source)) !== null) {
        const postObjectId = String(match[1] || '').trim();
        if (!postObjectId) continue;
        pushCanonical(postObjectId, pageId);
    }

    const fbidPattern = /[?&]fbid=(\d{8,})/g;
    while ((match = fbidPattern.exec(source)) !== null) {
        const postObjectId = String(match[1] || '').trim();
        if (!postObjectId) continue;
        pushCanonical(postObjectId, pageId);
    }

    const postIdJsonPattern = /"post_id":"(\d{8,})"/g;
    while ((match = postIdJsonPattern.exec(source)) !== null) {
        const postObjectId = String(match[1] || '').trim();
        if (!postObjectId) continue;
        pushCanonical(postObjectId, pageId);
    }

    return Array.from(ids);
}

function mapHtmlPostIdsToRows(params: {
    pageId: string;
    postIds: Array<string>;
}): Array<Record<string, any>> {
    const pageId = String(params.pageId || '').trim();
    const rows: Array<Record<string, any>> = [];

    params.postIds.forEach((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;
        rows.push({
            id: `fbhtml:${normalizedPostId}`,
            page_id: pageId,
            source: 'facebook',
            source_ref: normalizedPostId,
            batch_id: null,
            queue_job_id: null,
            post_type: 'link',
            message_text: null,
            media_kind: 'link',
            media_url: null,
            media_thumb_url: null,
            facebook_post_id: normalizedPostId,
            facebook_url: buildFacebookPostUrl({
                pageId,
                postId: normalizedPostId,
                postType: 'link',
            }),
            scheduled_time: null,
            published_at: null,
            warning_message: null,
            created_at: null,
            is_hidden: false,
            timeline_visibility: null,
            hidden_at: null,
            sourceLabel: mapSourceLabel('facebook'),
            deleteAllowed: false,
        });
    });

    return rows;
}

async function fetchFacebookPublishedPostsFromHtml(params: {
    pageIdCandidates: Array<string>;
    limit: number;
    cookieHeaderCandidates: Array<Record<string, string>>;
}): Promise<{ success: boolean; logs?: Array<Record<string, any>>; meta?: Record<string, any>; error?: string }> {
    const pageIdCandidates = buildPageIdCandidates('', ...(params.pageIdCandidates || []));
    const limit = Math.max(1, Math.min(Number(params.limit || 100), 200));
    if (!pageIdCandidates.length) {
        return { success: false, error: 'Missing pageId candidates' };
    }

    const headerCandidates: Array<Record<string, string> | undefined> = [undefined];
    (params.cookieHeaderCandidates || []).forEach((headers) => {
        if (!headers) return;
        headerCandidates.push(headers);
    });

    for (const candidatePageId of pageIdCandidates) {
        const candidateUrls = [
            `https://mbasic.facebook.com/profile.php?id=${encodeURIComponent(candidatePageId)}&v=timeline`,
            `https://mbasic.facebook.com/${encodeURIComponent(candidatePageId)}?v=timeline`,
            `https://m.facebook.com/profile.php?id=${encodeURIComponent(candidatePageId)}&v=timeline`,
            `https://m.facebook.com/${encodeURIComponent(candidatePageId)}`,
            `https://www.facebook.com/profile.php?id=${encodeURIComponent(candidatePageId)}`,
            `https://www.facebook.com/${encodeURIComponent(candidatePageId)}`,
        ];

        for (const headers of headerCandidates) {
            for (const url of candidateUrls) {
                try {
                    const response = await fetch(url, headers ? { headers, redirect: 'follow' } : { redirect: 'follow' });
                    if (!response.ok) continue;

                    const html = await response.text();
                    if (!html || isFacebookContentUnavailableHtml(html)) continue;

                    const extractedIds = extractFacebookPostIdsFromHtml(html, candidatePageId);
                    if (!extractedIds.length) continue;

                    const logs = mapHtmlPostIdsToRows({
                        pageId: candidatePageId,
                        postIds: extractedIds.slice(0, limit),
                    });
                    if (!logs.length) continue;

                    return {
                        success: true,
                        logs,
                        meta: {
                            source: 'facebook-html',
                            hasMore: extractedIds.length > limit,
                            nextCursor: null,
                            pageIdUsed: candidatePageId,
                            pageIdCandidates,
                        },
                    };
                } catch (_) {
                    // Ignore HTML fallback probe failures.
                }
            }
        }
    }

    return { success: false, error: 'Facebook HTML fallback returned no posts' };
}

async function verifyFacebookPermalinkAlive(
    url: string,
    cookieHeaders?: Record<string, string>,
): Promise<boolean | null> {
    const targetUrl = normalizeFacebookUrl(url);
    if (!targetUrl) return null;
    if (!isFacebookPostPermalink(targetUrl)) return false;

    try {
        const response = await fetch(targetUrl, cookieHeaders ? { headers: cookieHeaders, redirect: 'follow' } : { redirect: 'follow' });
        if (!response.ok) return false;
        const html = await response.text();
        if (isFacebookContentUnavailableHtml(html)) return false;
        return true;
    } catch (error) {
        console.warn('[published-posts] permalink verification failed:', targetUrl, error);
        return null;
    }
}

async function fetchLiveFacebookPostIdSet(params: {
    pageId: string;
    pageIdCandidates?: Array<string>;
    accessTokenCandidates: Array<string>;
    maxItems?: number;
}): Promise<{
    success: boolean;
    ids: Set<string>;
    appError: boolean;
    authInvalid: boolean;
}> {
    const pageId = String(params.pageId || '').trim();
    const pageIdCandidates = buildPageIdCandidates(
        pageId,
        ...(Array.isArray(params.pageIdCandidates) ? params.pageIdCandidates : []),
    );
    const tokenCandidates = buildAuthCandidates(params.accessTokenCandidates || []).slice(0, 4);
    const maxItems = Math.max(50, Math.min(Number(params.maxItems || 500), 1000));
    const graphHeaders = buildFacebookGraphHeaders();
    const edgePriority: FacebookEdge[] = ['published_posts', 'feed', 'posts'];
    let sawAppError = false;
    let sawAuthInvalid = false;

    if (pageIdCandidates.length === 0 || tokenCandidates.length === 0) {
        return { success: false, ids: new Set<string>(), appError: false, authInvalid: false };
    }

    for (const token of tokenCandidates) {
        const ids = new Set<string>();
        let tokenHadAnySuccess = false;
        let tokenAuthInvalid = false;

        for (const candidatePageId of pageIdCandidates) {
            for (const edge of edgePriority) {
                let after = '';
                let pageFetchCount = 0;

                while (pageFetchCount < 5 && ids.size < maxItems) {
                    pageFetchCount += 1;
                    const paramsQuery = new URLSearchParams({
                        fields: 'id',
                        limit: '100',
                        access_token: token,
                    });
                    if (after) paramsQuery.set('after', after);

                    const response = await fetch(`${FB_API}/${candidatePageId}/${edge}?${paramsQuery.toString()}`, {
                        headers: graphHeaders,
                    });
                    const data = await response.json() as any;

                    if (data?.error) {
                        if (isFacebookAppLoadError(data.error)) sawAppError = true;
                        if (isFacebookAuthInvalid(data.error)) {
                            sawAuthInvalid = true;
                            tokenAuthInvalid = true;
                            break;
                        }
                        break;
                    }

                    tokenHadAnySuccess = true;
                    const rows: Array<Record<string, any>> = Array.isArray(data?.data) ? data.data : [];
                    rows.forEach((row) => {
                        const canonicalCandidates = buildCanonicalFacebookPostIdCandidates(
                            String(row?.id || '').trim(),
                            pageIdCandidates,
                            candidatePageId,
                        );
                        canonicalCandidates.forEach((canonicalId) => {
                            ids.add(canonicalId);
                        });
                    });

                    const nextAfter = String(data?.paging?.cursors?.after || '').trim();
                    if (!nextAfter || !data?.paging?.next) break;
                    after = nextAfter;
                }

                if (tokenAuthInvalid) break;
                if (tokenHadAnySuccess && ids.size >= maxItems) {
                    break;
                }
            }
            if (tokenAuthInvalid) {
                break;
            }
            if (tokenHadAnySuccess && ids.size >= maxItems) {
                break;
            }
        }

        if (tokenAuthInvalid) {
            continue;
        }

        if (tokenHadAnySuccess) {
            return { success: true, ids, appError: sawAppError, authInvalid: sawAuthInvalid };
        }
    }

    return { success: false, ids: new Set<string>(), appError: sawAppError, authInvalid: sawAuthInvalid };
}

function filterHistoryLogsByLiveIdSet(params: {
    logs: Array<Record<string, any>>;
    pageId: string;
    pageIdCandidates?: Array<string>;
    liveIds: Set<string>;
    limit?: number;
}): Array<Record<string, any>> {
    const { logs, pageId, liveIds, limit = 120 } = params;
    if (!Array.isArray(logs) || logs.length === 0) return [];
    if (!(liveIds instanceof Set) || liveIds.size === 0) return [];

    return logs
        .slice(0, Math.max(1, limit))
        .filter((row) => {
            const ownerCandidates = buildPageIdCandidates(
                pageId,
                ...(Array.isArray(params.pageIdCandidates) ? params.pageIdCandidates : []),
                String(row.page_id || '').trim(),
            );
            const canonicalHistoryIds = buildCanonicalFacebookPostIdCandidates(
                String(row.facebook_post_id || '').trim(),
                ownerCandidates,
                pageId || row.page_id,
            );
            if (!canonicalHistoryIds.length) return false;
            return canonicalHistoryIds.some((candidateId) => liveIds.has(candidateId));
        });
}

function isDefinitelyMissingFacebookPostError(error: any): boolean {
    const code = Number(error?.code ?? 0);
    const message = String(error?.message || '').toLowerCase();
    if (code === 803) return true;
    if (code === 100) {
        return (
            message.includes('unsupported get request')
            || message.includes('object with id')
            || message.includes('does not exist')
            || message.includes('cannot be loaded')
            || message.includes('nonexisting field')
            || message.includes('no node specified')
        );
    }
    return false;
}

async function verifyFacebookPostAliveByGraph(
    postId: string,
    ownerIdCandidates: Array<string>,
    accessToken: string,
    postType?: string,
): Promise<boolean | null> {
    const normalizedPostId = String(postId || '').trim();
    const normalizedToken = String(accessToken || '').trim();
    if (!normalizedPostId || !normalizedToken) return null;
    const normalizedOwnerIds = buildPageIdCandidates('', ...(Array.isArray(ownerIdCandidates) ? ownerIdCandidates : []));
    const normalizedPostType = String(postType || '').trim().toLowerCase();
    const isReelLike = normalizedPostType.includes('reel') || normalizedPostType.includes('video');
    const parsedPostId = parseFacebookPostIdParts(normalizedPostId);
    const postIdCore = parsedPostId.normalized;
    const objectId = parsedPostId.objectId || postIdCore;

    const graphPostIdCandidates = (() => {
        // For page timeline posts, canonical post id is usually pageId_postId.
        // Force this shape to avoid false positives from unrelated object ids.
        if (normalizedOwnerIds.length > 0 && !isReelLike) {
            if (objectId) {
                return normalizedOwnerIds
                    .filter((ownerId) => ownerId && ownerId !== objectId)
                    .map((ownerId) => `${ownerId}_${objectId}`);
            }
        }
        return [postIdCore || objectId].filter(Boolean);
    })();

    let sawMissingError = false;
    let sawOwnerMismatch = false;

    for (const graphPostId of graphPostIdCandidates) {
        try {
            const params = new URLSearchParams({
                fields: 'id,from{id},permalink_url',
                access_token: normalizedToken,
            });
            const response = await fetch(`${FB_API}/${graphPostId}?${params.toString()}`, {
                headers: buildFacebookGraphHeaders(),
            });
            const data = await response.json() as any;
            if (data?.error) {
                if (isDefinitelyMissingFacebookPostError(data.error)) {
                    sawMissingError = true;
                    continue;
                }
                if (isFacebookAuthInvalid(data.error)) return null;
                if (isFacebookAppLoadError(data.error)) return null;
                return null;
            }

            const fromId = String(data?.from?.id || '').trim();
            if (normalizedOwnerIds.length > 0) {
                if (fromId && !normalizedOwnerIds.includes(fromId)) {
                    sawOwnerMismatch = true;
                    continue;
                }
                if (!fromId && !isReelLike) {
                    // Non-reel post without from.id is too ambiguous to treat as alive.
                    return null;
                }
            }
            return !!String(data?.id || '').trim();
        } catch (error) {
            console.warn('[published-posts] graph post verification failed:', graphPostId, error);
            return null;
        }
    }

    if (sawMissingError || sawOwnerMismatch) {
        return false;
    }

    return null;
}

async function filterHistoryLogsByLivePermalink(params: {
    logs: Array<Record<string, any>>;
    cookieHeadersList: Array<Record<string, string>>;
    accessTokenCandidates: Array<string>;
    pageId: string;
    pageIdCandidates?: Array<string>;
    limit?: number;
}): Promise<Array<Record<string, any>>> {
    const { logs, cookieHeadersList, accessTokenCandidates, pageId, limit = 120 } = params;
    const candidates = Array.isArray(logs) ? logs.slice(0, Math.max(1, limit)) : [];
    const headerCandidates = (Array.isArray(cookieHeadersList) ? cookieHeadersList : []).filter(Boolean);
    const tokenCandidates = buildAuthCandidates(accessTokenCandidates || []).slice(0, 4);

    const checked = await Promise.all(
        candidates.map(async (row) => {
            const postId = String(
                row.facebook_post_id
                || '',
            ).trim();
            const permalink = String(
                row.facebook_url
                || buildFacebookPostUrl({
                    pageId: row.page_id,
                    postId: row.facebook_post_id,
                    permalink: row.facebook_url,
                    postType: row.post_type,
                })
                || '',
            ).trim();

            if (postId && tokenCandidates.length > 0) {
                const ownerCandidates = buildPageIdCandidates(
                    pageId,
                    ...(Array.isArray(params.pageIdCandidates) ? params.pageIdCandidates : []),
                    String(row.page_id || '').trim(),
                );
                for (const token of tokenCandidates) {
                    const aliveByGraph = await verifyFacebookPostAliveByGraph(
                        postId,
                        ownerCandidates,
                        token,
                        String(row.post_type || '').trim(),
                    );
                    if (aliveByGraph === true) {
                        return { row, state: 'alive' as const };
                    }
                    if (aliveByGraph === false) {
                        return { row, state: 'dead' as const };
                    }
                }
            }

            if (permalink && headerCandidates.length > 0) {
                const outcomes: Array<boolean | null> = [];
                for (const headers of headerCandidates) {
                    const alive = await verifyFacebookPermalinkAlive(permalink, headers);
                    outcomes.push(alive);
                    if (alive === true) {
                        return { row, state: 'alive' as const };
                    }
                }
                if (outcomes.length > 0 && outcomes.every((value) => value === false)) {
                    return { row, state: 'dead' as const };
                }
            }
            return { row, state: 'unknown' as const };
        }),
    );

    return checked
        .filter((entry) => entry.state === 'alive')
        .map((entry) => entry.row);
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
        const timelineVisibility = String(post.timeline_visibility || '').trim().toLowerCase();
        const isHidden = post.is_hidden === true || timelineVisibility === 'hidden';
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
            is_hidden: isHidden,
            timeline_visibility: timelineVisibility || null,
            hidden_at: null,
            sourceLabel: mapSourceLabel('facebook'),
            deleteAllowed: false,
        };
    });
}

function collectPinnedPostIds(payload: any): string[] {
    const sources = [
        payload?.data,
        payload?.pinned_posts?.data,
        payload?.pinned_post?.data,
    ];
    const seen = new Set<string>();
    const postIds: string[] = [];

    sources.forEach((source) => {
        if (!Array.isArray(source)) return;
        source.forEach((item: any) => {
            const postId = String(item?.id || '').trim();
            if (!postId || seen.has(postId)) return;
            seen.add(postId);
            postIds.push(postId);
        });
    });

    return postIds;
}

async function fetchPinnedPostIds(
    pageId: string,
    authToken: string,
    headers?: Record<string, string>,
): Promise<Set<string>> {
    const pinnedIds = new Set<string>();
    const endpoints = [
        `${FB_API}/${pageId}/pinned_posts?fields=id&limit=10&access_token=${encodeURIComponent(authToken)}`,
        `${FB_API}/${pageId}?fields=pinned_posts.limit(10){id}&access_token=${encodeURIComponent(authToken)}`,
    ];

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, headers ? { headers } : undefined);
            const payload = await response.json() as any;
            if (payload?.error) continue;

            collectPinnedPostIds(payload).forEach((postId) => pinnedIds.add(postId));
            if (pinnedIds.size > 0) return pinnedIds;
        } catch (error) {
            console.warn('[published-posts] pinned posts lookup failed:', error);
        }
    }

    return pinnedIds;
}

async function getStoredPageToken(env: Env, workspaceId: string, pageId: string): Promise<string> {
    if (!pageId) return '';

    const result = await env.DB.prepare(`
        SELECT post_token_encrypted, hide_token_encrypted
        FROM page_settings
        WHERE organization_id = ? AND page_id = ?
        LIMIT 1
    `).bind(workspaceId, pageId).first<{ post_token_encrypted?: string; hide_token_encrypted?: string }>();

    const postToken = String(await decryptSecret(env, result?.post_token_encrypted) || '').trim();
    if (postToken) return postToken;

    const hideToken = String(await decryptSecret(env, result?.hide_token_encrypted) || '').trim();
    return hideToken;
}

async function getWorkspaceCredentialCandidates(env: Env, workspaceId: string): Promise<WorkspaceCredentialCandidate[]> {
    try {
        const rows = await env.DB.prepare(`
            SELECT ads_token_encrypted, cookie_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
        `).bind(workspaceId).all<{ ads_token_encrypted?: string | null; cookie_encrypted?: string | null }>();

        const seen = new Set<string>();
        const credentials: WorkspaceCredentialCandidate[] = [];
        for (const row of rows.results || []) {
            const accessToken = String(await decryptSecret(env, row?.ads_token_encrypted) || '').trim();
            const cookie = String(await decryptSecret(env, row?.cookie_encrypted) || '').trim();
            const dedupeKey = `${accessToken}::${cookie}`;
            if (!accessToken && !cookie) continue;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            credentials.push({
                accessToken,
                cookieData: cookie,
            });
        }
        return credentials;
    } catch (error) {
        console.warn('[published-posts] workspace credential candidates fetch failed:', error);
        return [];
    }
}

async function fetchFacebookPublishedPostsCookieOnly(params: {
    pageId: string;
    limit: number;
    after?: string;
    headers: Record<string, string>;
}): Promise<{ success: boolean; logs?: Array<Record<string, any>>; meta?: Record<string, any>; error?: string }> {
    const { pageId, limit, after, headers } = params;
    const parsedCursor = parseFacebookCursor(after);
    const edgeHint = parsedCursor.edge;
    const afterCursor = parsedCursor.cursor;
    let lastError = '';
    const endpointCatalog: Array<{ edge: FacebookEdge; metaSource: string }> = [
        { edge: 'published_posts', metaSource: 'facebook-cookie-published' },
        { edge: 'feed', metaSource: 'facebook-cookie-feed' },
        { edge: 'posts', metaSource: 'facebook-cookie' },
    ];
    const endpointsToTry = edgeHint
        ? endpointCatalog.filter((endpoint) => endpoint.edge === edgeHint)
        : endpointCatalog;
    const endpointResults: Array<{
        edge: FacebookEdge;
        metaSource: string;
        logs: Array<Record<string, any>>;
        hasMore: boolean;
        nextCursor: string;
    }> = [];

    for (const endpoint of endpointsToTry) {
        const query = new URLSearchParams({
            fields: 'id,message,story,created_time,full_picture,permalink_url,status_type,from,is_hidden,timeline_visibility,attachments{media_type,type,url,target,media,subattachments}',
            limit: String(Math.min(limit, 100)),
        });
        if (afterCursor) {
            query.set('after', afterCursor);
        }

        try {
            const response = await fetch(
                `${FB_API}/${pageId}/${endpoint.edge}?${query.toString()}`,
                { headers },
            );
            const data = await response.json() as any;
            if (data?.error) {
                lastError = data.error?.message || 'Facebook API error';
                continue;
            }

            const logs: Array<Record<string, any>> = mapFacebookPosts(data).map((row) => ({
                ...row,
                page_id: pageId,
            }));
            const nextCursor = String(data?.paging?.cursors?.after || '').trim();
            const hasMore = Boolean(data?.paging?.next && nextCursor);

            endpointResults.push({
                edge: endpoint.edge,
                metaSource: endpoint.metaSource,
                logs,
                hasMore,
                nextCursor,
            });

            if (!afterCursor && !edgeHint && logs.length === 0) {
                continue;
            }

            const encodedNextCursor = hasMore
                ? encodeFacebookCursor(endpoint.edge, nextCursor)
                : '';
            return {
                success: true,
                logs,
                meta: {
                    source: endpoint.metaSource,
                    hasMore,
                    edge: endpoint.edge,
                    nextCursor: encodedNextCursor || null,
                },
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    if (endpointResults.length > 0 && !afterCursor && !edgeHint) {
        const nonEmpty = endpointResults
            .filter((row) => row.logs.length > 0)
            .sort((a, b) => {
                if (b.logs.length !== a.logs.length) {
                    return b.logs.length - a.logs.length;
                }
                return Number(b.hasMore) - Number(a.hasMore);
            });
        if (nonEmpty.length > 0) {
            const preferred = nonEmpty[0];
            const encodedNextCursor = preferred.hasMore
                ? encodeFacebookCursor(preferred.edge, preferred.nextCursor)
                : '';
            return {
                success: true,
                logs: preferred.logs,
                meta: {
                    source: preferred.metaSource,
                    hasMore: preferred.hasMore,
                    edge: preferred.edge,
                    nextCursor: encodedNextCursor || null,
                },
            };
        }
    }

    return { success: false, error: lastError || 'Facebook API error (cookie-only)' };
}

async function fetchFacebookPublishedPosts(env: Env, input: PublishedQueryInput) {
    const { workspaceId, pageId, limit, after, pageToken, hideToken, accessToken, cookieData } = input;

    if (!pageId) {
        return { success: false, error: 'Missing pageId' };
    }

    const workspaceCredentialCandidates = await getWorkspaceCredentialCandidates(env, workspaceId);
    const workspaceCookieCandidates = workspaceCredentialCandidates
        .map((candidate) => candidate.cookieData)
        .filter(Boolean);
    const workspaceAccessTokenCandidates = workspaceCredentialCandidates
        .map((candidate) => candidate.accessToken)
        .filter(Boolean);

    const cookieHeaderCandidates: Array<Record<string, string>> = [];
    const seenCookies = new Set<string>();
    const addCookieCandidate = (rawCookie?: string) => {
        const normalized = String(rawCookie || '').trim();
        if (!normalized || seenCookies.has(normalized)) return;
        const candidateHeaders = buildFacebookHeaders(normalized);
        if (!candidateHeaders) return;
        seenCookies.add(normalized);
        cookieHeaderCandidates.push(candidateHeaders);
    };
    addCookieCandidate(cookieData);
    workspaceCookieCandidates.forEach((cookie) => addCookieCandidate(cookie));

    const requestedStoredPageToken = pageToken?.trim() || await getStoredPageToken(env, workspaceId, pageId);
    const resolvedPageIds = await resolveFacebookPageIdCandidates({
        pageId,
        accessTokenCandidates: buildAuthCandidates([
            accessToken,
            requestedStoredPageToken,
            ...workspaceAccessTokenCandidates,
        ]),
        cookieHeaderCandidates,
    });
    const pageIdCandidates = buildPageIdCandidates(pageId, ...resolvedPageIds);
    const storedPageTokenCandidates = buildAuthCandidates([
        requestedStoredPageToken,
        ...(await Promise.all(
            pageIdCandidates.map(async (candidatePageId) => {
                if (!candidatePageId || candidatePageId === pageId) {
                    return requestedStoredPageToken;
                }
                return await getStoredPageToken(env, workspaceId, candidatePageId);
            }),
        )),
    ]);

    let freshPageToken = '';
    for (const candidatePageId of pageIdCandidates) {
        const recoveredToken = await fetchFreshPageToken(candidatePageId, accessToken, cookieData);
        if (recoveredToken) {
            freshPageToken = recoveredToken;
            break;
        }
    }
    if (!freshPageToken) {
        for (const candidate of workspaceCredentialCandidates) {
            if (!candidate.accessToken) continue;
            for (const candidatePageId of pageIdCandidates) {
                const recoveredToken = await fetchFreshPageToken(
                    candidatePageId,
                    candidate.accessToken,
                    candidate.cookieData || cookieData,
                );
                if (recoveredToken) {
                    freshPageToken = recoveredToken;
                    console.log('[published-posts] Recovered fresh page token from workspace facebook_credentials');
                    break;
                }
            }
            if (freshPageToken) break;
        }
    }

    const authCandidates = buildAuthCandidates([
        freshPageToken,
        hideToken,
        ...storedPageTokenCandidates,
        pageToken,
        accessToken,
        ...workspaceAccessTokenCandidates,
    ]);
    const graphHeaders = buildFacebookGraphHeaders();
    const parsedCursor = parseFacebookCursor(after);
    const edgeHint = parsedCursor.edge;
    const afterCursor = parsedCursor.cursor;
    let lastFacebookError: any = null;
    let sawAppLoadError = false;
    let sawAuthInvalid = false;

    for (const authToken of authCandidates) {
        const endpointCatalog: Array<{ edge: FacebookEdge; metaSource: string }> = [
            { edge: 'published_posts', metaSource: 'facebook-published' },
            { edge: 'feed', metaSource: 'facebook-feed' },
            { edge: 'posts', metaSource: 'facebook' },
        ];
        const endpointsToTry = edgeHint
            ? endpointCatalog.filter((endpoint) => endpoint.edge === edgeHint)
            : endpointCatalog;
        const endpointResults: Array<{
            pageId: string;
            edge: FacebookEdge;
            metaSource: string;
            logs: Array<Record<string, any>>;
            hasMore: boolean;
            nextCursor: string;
        }> = [];
        let tokenAuthInvalid = false;

        const finalizeResult = async (result: {
            pageId: string;
            edge: FacebookEdge;
            metaSource: string;
            logs: Array<Record<string, any>>;
            hasMore: boolean;
            nextCursor: string;
        }) => {
            const pinnedIds = await fetchPinnedPostIds(result.pageId, authToken, graphHeaders);
            const pinnedCanonicalIds = new Set<string>();
            pinnedIds.forEach((pinnedPostId) => {
                buildCanonicalFacebookPostIdCandidates(
                    String(pinnedPostId || '').trim(),
                    pageIdCandidates,
                    result.pageId,
                ).forEach((canonicalId) => pinnedCanonicalIds.add(canonicalId));
            });
            const normalizedLogs = result.logs.map((row) => ({
                ...row,
                is_pinned: buildCanonicalFacebookPostIdCandidates(
                    String(row.facebook_post_id || '').trim(),
                    pageIdCandidates,
                    result.pageId,
                ).some((candidateId) => pinnedCanonicalIds.has(candidateId)),
            }));
            const encodedNextCursor = result.hasMore
                ? encodeFacebookCursor(result.edge, result.nextCursor)
                : '';

            return {
                success: true,
                logs: normalizedLogs,
                meta: {
                    source: result.metaSource,
                    edge: result.edge,
                    hasMore: result.hasMore,
                    nextCursor: encodedNextCursor || null,
                    pageIdUsed: result.pageId,
                    pageIdCandidates,
                },
            };
        };

        for (const candidatePageId of pageIdCandidates) {
            const params = new URLSearchParams({
                fields: 'id,message,story,created_time,full_picture,permalink_url,status_type,from,is_hidden,timeline_visibility,attachments{media_type,type,url,target,media,subattachments}',
                limit: String(Math.min(limit, 100)),
                access_token: authToken,
            });
            if (afterCursor) {
                params.set('after', afterCursor);
            }

            for (const endpoint of endpointsToTry) {
                const response = await fetch(
                    `${FB_API}/${candidatePageId}/${endpoint.edge}?${params.toString()}`,
                    { headers: graphHeaders },
                );
                const data = await response.json() as any;

                if (data?.error) {
                    lastFacebookError = data.error;
                    if (isFacebookAppLoadError(data.error)) {
                        sawAppLoadError = true;
                    }
                    if (isFacebookAuthInvalid(data.error)) {
                        sawAuthInvalid = true;
                        tokenAuthInvalid = true;
                        break;
                    }
                    continue;
                }

                const logs: Array<Record<string, any>> = mapFacebookPosts(data).map((row) => ({
                    ...row,
                    page_id: pageId,
                }));
                const nextCursor = String(data?.paging?.cursors?.after || '').trim();
                const hasMore = Boolean(data?.paging?.next && nextCursor);

                endpointResults.push({
                    pageId: candidatePageId,
                    edge: endpoint.edge,
                    metaSource: endpoint.metaSource,
                    logs,
                    hasMore,
                    nextCursor,
                });

                if (!afterCursor && !edgeHint && logs.length === 0) {
                    continue;
                }

                return finalizeResult({
                    pageId: candidatePageId,
                    edge: endpoint.edge,
                    metaSource: endpoint.metaSource,
                    logs,
                    hasMore,
                    nextCursor,
                });
            }

            if (tokenAuthInvalid) {
                break;
            }
        }

        if (tokenAuthInvalid) {
            continue;
        }

        if (endpointResults.length > 0 && !afterCursor && !edgeHint) {
            const nonEmpty = endpointResults
                .filter((row) => row.logs.length > 0)
                .sort((a, b) => {
                    if (b.logs.length !== a.logs.length) {
                        return b.logs.length - a.logs.length;
                    }
                    return Number(b.hasMore) - Number(a.hasMore);
                });
            if (nonEmpty.length > 0) {
                return finalizeResult(nonEmpty[0]);
            }
        }

        // Move to next token candidate.
        continue;
    }

    // Last resort: cookie-only listing (no access_token in query).
    for (const cookieHeaders of cookieHeaderCandidates) {
        for (const candidatePageId of pageIdCandidates) {
            const cookieOnlyResult = await fetchFacebookPublishedPostsCookieOnly({
                pageId: candidatePageId,
                limit,
                after,
                headers: cookieHeaders,
            });
            if (cookieOnlyResult.success) {
                return {
                    success: true,
                    logs: (cookieOnlyResult.logs || []).map((row) => ({
                        ...row,
                        page_id: pageId,
                    })),
                    meta: {
                        ...(cookieOnlyResult.meta || {
                            source: 'facebook-cookie',
                            hasMore: false,
                            nextCursor: null,
                        }),
                        pageIdUsed: candidatePageId,
                        pageIdCandidates,
                    },
                };
            }
        }
    }

    const htmlFallbackResult = await fetchFacebookPublishedPostsFromHtml({
        pageIdCandidates,
        limit,
        cookieHeaderCandidates,
    });
    if (htmlFallbackResult.success) {
        return htmlFallbackResult;
    }

    return {
        success: false,
        error: lastFacebookError?.message || 'Facebook API error',
        errorCode: lastFacebookError?.code,
        errorSubcode: lastFacebookError?.error_subcode,
        errorType: lastFacebookError?.type,
        pageIdCandidates,
        errorCategory: (
            sawAppLoadError
            || isFacebookAppLoadError(lastFacebookError)
            || String(lastFacebookError?.message || '').toLowerCase().includes('error loading application')
        )
            ? 'facebook_app_error'
            : (
                sawAuthInvalid || isFacebookAuthInvalid(lastFacebookError)
                    ? 'facebook_auth_invalid'
                    : 'facebook_api_error'
            ),
    };
}

async function fetchHistoryPublishedPosts(env: Env, input: PublishedQueryInput) {
    const { workspaceId, pageId, limit } = input;

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
            ph.extra_json,
            hp.post_id AS hidden_post_id,
            hp.hidden_at AS hidden_at,
            ph.created_at
        FROM publish_history ph
        LEFT JOIN hidden_posts hp
               ON hp.organization_id = ph.organization_id
              AND hp.page_id = ph.page_id
              AND hp.post_id = ph.facebook_post_id
        WHERE ph.organization_id = ?
          AND (? = '' OR ph.page_id = ?)
        ORDER BY datetime(COALESCE(ph.published_at, ph.created_at)) DESC, ph.id DESC
        LIMIT ?
    `;

    const results = await env.DB.prepare(query).bind(workspaceId, pageId, pageId, limit).all<Record<string, any>>();
    const logs = (results.results || []).map((row) => {
        let isHiddenFromExtra = false;
        let hiddenAtFromExtra = '';
        try {
            const extra = row.extra_json ? JSON.parse(String(row.extra_json)) : null;
            const hide = extra?.hide || {};
            isHiddenFromExtra = hide?.hidden === true || extra?.timelineHidden === true;
            hiddenAtFromExtra = String(hide?.hiddenAt || '').trim();
        } catch (_) {
            // Ignore malformed extra_json rows.
        }

        const hiddenAt = String(row.hidden_at || hiddenAtFromExtra || '').trim() || null;
        const isHidden = !!(row.hidden_post_id || isHiddenFromExtra);
        const warningMessage = String(row.warning_message || '').trim();

        return {
            ...row,
            facebook_url: buildFacebookPostUrl({
                pageId: row.page_id,
                postId: row.facebook_post_id,
                permalink: row.facebook_url,
                postType: row.post_type,
            }),
            warning_message: warningMessage || (isHidden ? 'ซ่อนจากหน้าเพจแล้ว' : null),
            is_hidden: isHidden,
            timeline_visibility: isHidden ? 'hidden' : null,
            hidden_at: hiddenAt,
            sourceLabel: mapSourceLabel(row.source),
            deleteAllowed: true,
        };
    });

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
        ? `${raw.replace(' ', 'T')}Z`
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
            is_hidden: existing.is_hidden === true || row.is_hidden === true,
            timeline_visibility: existing.timeline_visibility || row.timeline_visibility,
            hidden_at: existing.hidden_at || row.hidden_at,
        });
    });

    return Array.from(merged.values()).sort((a, b) => getPublishedSortTime(b) - getPublishedSortTime(a));
}

async function handleListRequest(env: Env, input: PublishedQueryInput) {
    if (input.source === 'history') {
        return fetchHistoryPublishedPosts(env, input);
    }
    if (input.source === 'facebook') {
        const facebookResult = await fetchFacebookPublishedPosts(env, input);
        if (facebookResult.success) {
            return facebookResult;
        }
        if (input.strictLive) {
            const errorCategory = String((facebookResult as any).errorCategory || '').trim().toLowerCase();
            const fallbackReason = String((facebookResult as any).error || '').trim().toLowerCase();
            const isFacebookAppError = errorCategory === 'facebook_app_error'
                || fallbackReason.includes('error loading application');
            if (isFacebookAppError) {
                const historyResult = await fetchHistoryPublishedPosts(env, input);
                if (historyResult.success) {
                    const workspaceCredentialCandidates = await getWorkspaceCredentialCandidates(env, input.workspaceId);
                    const workspaceAccessTokenCandidates = workspaceCredentialCandidates
                        .map((candidate) => candidate.accessToken)
                        .filter(Boolean);
                    const livePageIdCandidates = buildPageIdCandidates(
                        input.pageId,
                        ...(
                            Array.isArray((facebookResult as any).pageIdCandidates)
                                ? ((facebookResult as any).pageIdCandidates as Array<string>)
                                : []
                        ),
                    );
                    const liveIdSetResult = await fetchLiveFacebookPostIdSet({
                        pageId: input.pageId,
                        pageIdCandidates: livePageIdCandidates,
                        accessTokenCandidates: buildAuthCandidates([
                            input.pageToken,
                            input.accessToken,
                            ...workspaceAccessTokenCandidates,
                        ]),
                        maxItems: Math.max(input.limit * 3, 200),
                    });

                    const historyLogs = Array.isArray(historyResult.logs) ? historyResult.logs : [];
                    const verifiedLogs = liveIdSetResult.success
                        ? filterHistoryLogsByLiveIdSet({
                            logs: historyLogs,
                            pageId: input.pageId,
                            pageIdCandidates: livePageIdCandidates,
                            liveIds: liveIdSetResult.ids,
                            limit: input.limit,
                        })
                        : historyLogs;

                    return {
                        success: true,
                        logs: verifiedLogs,
                        meta: {
                            ...(historyResult.meta || {}),
                            source: liveIdSetResult.success ? 'history-live-verified' : 'history-live-unverified',
                            fallbackReason: (facebookResult as any).error || 'facebook_app_error',
                            fallbackCategory: errorCategory || 'facebook_app_error',
                            liveSetVerified: liveIdSetResult.success,
                            liveSetCount: liveIdSetResult.ids.size,
                        },
                    };
                }

                // Keep strict-live UI usable even when Facebook app edge is intermittently down.
                // Return an empty, safe result instead of surfacing a hard error to the client.
                return {
                    success: true,
                    logs: [],
                    meta: {
                        source: 'history-live-unverified',
                        fallbackReason: (facebookResult as any).error || 'facebook_app_error',
                        fallbackCategory: errorCategory || 'facebook_app_error',
                        liveSetVerified: false,
                        liveSetCount: 0,
                    },
                };
            }
            // Non-app-error strictLive failure: also fall back to history
            // so the delete page still shows posts from local history.
            const historyFallback = await fetchHistoryPublishedPosts(env, input);
            if (historyFallback.success && Array.isArray(historyFallback.logs) && historyFallback.logs.length > 0) {
                return {
                    success: true,
                    logs: historyFallback.logs,
                    meta: {
                        ...(historyFallback.meta || {}),
                        source: 'history-fallback',
                        fallbackReason: (facebookResult as any).error || 'facebook_api_error',
                        fallbackCategory: (facebookResult as any).errorCategory || 'facebook_api_error',
                    },
                };
            }
            return facebookResult;
        }
        const historyResult = await fetchHistoryPublishedPosts(env, input);
        if (historyResult.success) {
            return {
                success: true,
                logs: Array.isArray(historyResult.logs) ? historyResult.logs : [],
                meta: {
                    ...(historyResult.meta || {}),
                    source: 'history-fallback',
                    fallbackReason: (facebookResult as any).error || 'facebook_error',
                    fallbackCategory: (facebookResult as any).errorCategory || 'facebook_api_error',
                },
            };
        }

        return facebookResult;
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
        workspaceId: getWorkspaceId(c),
        pageId: String(c.req.query('pageId') || c.req.query('page_id') || '').trim(),
        limit: Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500),
        source: normalizeSource(c.req.query('source')),
        after: String(c.req.query('after') || c.req.query('cursor') || '').trim(),
        pageToken: String(c.req.query('pageToken') || '').trim(),
        hideToken: String(c.req.query('hideToken') || '').trim(),
        accessToken: String(c.req.query('accessToken') || '').trim(),
        cookieData: String(c.req.query('cookieData') || '').trim(),
        strictLive: String(c.req.query('strictLive') || '').trim() === 'true',
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
        workspaceId: getWorkspaceId(c),
        pageId: String(body.pageId || '').trim(),
        limit: Math.min(parseInt(String(body.limit || '200'), 10) || 200, 500),
        source: normalizeSource(body.source),
        after: String((body as Record<string, any>).after || (body as Record<string, any>).cursor || '').trim(),
        pageToken: String(body.pageToken || '').trim(),
        hideToken: String((body as Record<string, any>).hideToken || '').trim(),
        accessToken: String(body.accessToken || '').trim(),
        cookieData: String(body.cookieData || '').trim(),
        strictLive: Boolean((body as Record<string, any>).strictLive),
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
        const workspaceId = getWorkspaceId(c);
        await ensurePublishHistoryTable(c.env);

        const row = await c.env.DB.prepare(`
            SELECT id, source, source_ref
            FROM publish_history
            WHERE organization_id = ? AND id = ?
            LIMIT 1
        `).bind(workspaceId, id).first<{ id: number; source: string | null; source_ref: string | null }>();

        if (!row?.id) {
            return c.json({ success: false, error: 'Published row not found' }, 404);
        }

        const source = String(row.source || '').trim();
        const sourceRef = String(row.source_ref || '').trim();

        if (source === 'auto_post' && sourceRef) {
            await c.env.DB.prepare('DELETE FROM auto_post_logs WHERE organization_id = ? AND id = ?').bind(workspaceId, sourceRef).run();
        } else if (source === 'scheduled_queue' && sourceRef) {
            await c.env.DB.prepare('DELETE FROM scheduled_publish_queue WHERE organization_id = ? AND id = ?').bind(workspaceId, sourceRef).run();
        } else if (source === 'reel' && sourceRef) {
            await c.env.DB.prepare(`
                DELETE FROM reel_uploads
                WHERE organization_id = ?
                  AND (video_key = ? OR post_id = ? OR video_id = ?)
            `).bind(workspaceId, sourceRef, sourceRef, sourceRef).run();
        }

        await c.env.DB.prepare('DELETE FROM publish_history WHERE organization_id = ? AND id = ?').bind(workspaceId, id).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishedPostsRouter };
