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
            return String(matchedPage.access_token).trim();
        }
    } catch (error) {
        console.warn('[publish-reel] /me/accounts page token fetch failed:', error);
    }

    return '';
}

function buildAuthCandidates(tokens: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    tokens.forEach((token) => {
        const normalized = typeof token === 'string' ? token.trim() : '';
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    });

    return candidates;
}

function buildFacebookVideoUrl(params: { pageId: string; videoId?: string; postId?: string; permalinkUrl?: string }): string {
    if (params.permalinkUrl) return params.permalinkUrl;
    if (params.postId) return `https://www.facebook.com/${params.postId}`;
    if (params.videoId) return `https://www.facebook.com/${params.pageId}/videos/${params.videoId}`;
    return `https://www.facebook.com/${params.pageId}`;
}

function isUploadableBlob(value: unknown): value is Blob {
    return !!value
        && typeof value === 'object'
        && typeof (value as Blob).arrayBuffer === 'function'
        && typeof (value as Blob).stream === 'function';
}

function getVideoProcessingStatus(payload: any): string {
    return String(
        payload?.status?.video_status ||
        payload?.status?.processing_phase?.status ||
        payload?.status?.publishing_phase?.status ||
        '',
    ).trim();
}

async function wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVideoDetailsWithRetry(
    videoId: string,
    accessToken: string,
    headers?: Record<string, string>,
    attempts = 8,
    delayMs = 1500,
): Promise<any> {
    let lastData: any = null;
    const fields = 'id,post_id,permalink_url,status,description';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await fetch(
            `${FB_API}/${videoId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
            headers ? { headers } : undefined,
        );
        const data = await response.json() as any;
        lastData = data;

        if (data?.error) {
            return data;
        }

        if (data?.permalink_url || data?.post_id) {
            return data;
        }

        const status = getVideoProcessingStatus(data);
        if (!status || /ready|complete|published/i.test(status)) {
            return data;
        }

        if (attempt < attempts) {
            await wait(delayMs);
        }
    }

    return lastData;
}

app.post('/', async (c) => {
    try {
        const formData = await c.req.formData();
        const pageId = String(formData.get('pageId') || '').trim();
        const pageToken = String(formData.get('pageToken') || '').trim();
        const accessToken = String(formData.get('accessToken') || '').trim();
        const cookieData = String(formData.get('cookieData') || '').trim();
        const caption = String(formData.get('caption') || '').trim();
        const videoInput = formData.get('video') as unknown;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        if (!isUploadableBlob(videoInput)) {
            return c.json({ success: false, error: 'Missing video file' }, 400);
        }

        const isFileLike = typeof (videoInput as File).name === 'string';
        const videoFile = isFileLike
            ? videoInput as File
            : new File([videoInput], 'pubilo-reel.mp4', { type: videoInput.type || 'video/mp4' });

        let storedPageToken = pageToken;
        if (!storedPageToken) {
            try {
                const dbResult = await c.env.DB.prepare(
                    'SELECT post_token FROM page_settings WHERE page_id = ? LIMIT 1',
                ).bind(pageId).first<{ post_token: string | null }>();

                if (dbResult?.post_token) {
                    storedPageToken = dbResult.post_token.trim();
                }
            } catch (dbErr) {
                console.error('[publish-reel] D1 error:', dbErr);
            }
        }

        const facebookHeaders = buildFacebookHeaders(cookieData);
        const freshPageToken = await fetchFreshPageToken(pageId, accessToken, cookieData);
        const authCandidates = buildAuthCandidates([
            freshPageToken,
            storedPageToken,
            accessToken,
        ]);

        if (!authCandidates.length) {
            return c.json({
                success: false,
                error: 'ไม่พบ token สำหรับโพสต์วิดีโอ - กรุณา login extension ใหม่ หรือตั้งค่า Page Token',
            }, 400);
        }

        let lastFacebookError: any = null;
        let sawSessionExpired = false;

        for (const authToken of authCandidates) {
            const body = new FormData();
            body.append('access_token', authToken);
            body.append('source', videoFile, videoFile.name || 'pubilo-reel.mp4');
            if (caption) {
                body.append('description', caption);
            }

            console.log('[publish-reel] Uploading video with token candidate', {
                pageId,
                tokenSource:
                    authToken === freshPageToken
                        ? 'freshPageToken'
                        : authToken === storedPageToken
                            ? 'storedPageToken'
                            : 'accessToken',
                fileName: videoFile.name,
                fileSize: videoFile.size,
                fileType: videoFile.type,
            });

            const response = await fetch(`${FB_API}/${pageId}/videos`, {
                method: 'POST',
                ...(facebookHeaders ? { headers: facebookHeaders } : {}),
                body,
            });

            const data = await response.json() as any;

            if (data?.error) {
                if (Number(data.error?.code) === 190) {
                    sawSessionExpired = true;
                    lastFacebookError = data.error;
                    continue;
                }

                if (Number(data.error?.code) === 1 && data.error?.type === 'OAuthException') {
                    lastFacebookError = data.error;
                    continue;
                }

                lastFacebookError = data.error;
                continue;
            }

            const videoId = String(data?.id || data?.video_id || '').trim();
            if (!videoId) {
                lastFacebookError = { message: 'Facebook did not return video id' };
                continue;
            }

            const videoDetails = await fetchVideoDetailsWithRetry(videoId, authToken, facebookHeaders);
            if (videoDetails?.error) {
                lastFacebookError = videoDetails.error;
                continue;
            }

            const postId = String(videoDetails?.post_id || '').trim();
            const permalinkUrl = String(videoDetails?.permalink_url || '').trim();
            const status = getVideoProcessingStatus(videoDetails);

            return c.json({
                success: true,
                postId: postId || videoId,
                videoId,
                url: buildFacebookVideoUrl({
                    pageId,
                    videoId,
                    postId,
                    permalinkUrl,
                }),
                _debug: {
                    tokenSource:
                        authToken === freshPageToken
                            ? 'freshPageToken'
                            : authToken === storedPageToken
                                ? 'storedPageToken'
                                : 'accessToken',
                    processingStatus: status,
                    hasPermalink: !!permalinkUrl,
                    hasPostId: !!postId,
                },
            });
        }

        return c.json({
            success: false,
            error: sawSessionExpired
                ? 'Facebook session หมดอายุ กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                : (lastFacebookError?.message || 'Facebook API error'),
            errorCode: lastFacebookError?.code,
            errorSubcode: lastFacebookError?.error_subcode,
            errorType: lastFacebookError?.type,
            _debug: {
                candidateCount: authCandidates.length,
                fbError: lastFacebookError,
            },
        }, 400);
    } catch (error) {
        console.error('[publish-reel] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishReelRouter };
