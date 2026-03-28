import { Hono } from 'hono';
import { Env } from '../index';
import {
    markReelUploadCompleted,
    markReelUploadFailed,
    markReelUploadPublishing,
    upsertReelUploadStage,
} from '../lib/reel-uploads';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';
const REELS_V2_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB for now; direct-to-R2 can raise this later.

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

function buildAffiliateCommentMessage(commentText?: string, productLink?: string): string {
    const parts = [
        String(commentText || '').trim(),
        String(productLink || '').trim(),
    ].filter(Boolean);

    return parts.join('\n\n').trim();
}

function isUploadableBlob(value: unknown): value is Blob {
    return !!value
        && typeof value === 'object'
        && typeof (value as Blob).arrayBuffer === 'function'
        && typeof (value as Blob).stream === 'function';
}

function sanitizeFileName(rawName?: string): string {
    const value = String(rawName || '').trim();
    const fallback = 'pubilo-reel.mp4';
    if (!value) return fallback;

    return value
        .replace(/[^\w.\-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || fallback;
}

function buildR2VideoKey(pageId: string, fileName: string): string {
    const safePageId = String(pageId || 'unknown').replace(/[^\w-]+/g, '');
    const safeName = sanitizeFileName(fileName);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const randomPart = crypto.randomUUID();
    return `reels/${safePageId}/${stamp}-${randomPart}-${safeName}`;
}

function getVideoFileName(video: Blob & { name?: string }, fallback = 'pubilo-reel.mp4'): string {
    const rawName = typeof video.name === 'string' ? video.name : fallback;
    return sanitizeFileName(rawName);
}

function getVideoMimeType(video: Blob, fallback = 'video/mp4'): string {
    const type = typeof video.type === 'string' ? video.type.trim() : '';
    return type || fallback;
}

async function putVideoIntoR2(env: Env, params: {
    pageId: string;
    video: Blob & { name?: string };
    source: 'browser-upload' | 'publish-fallback';
}) {
    if (!env.IMAGES) {
        throw new Error('IMAGES R2 binding is not configured');
    }

    const fileName = getVideoFileName(params.video);
    const mimeType = getVideoMimeType(params.video);
    const key = buildR2VideoKey(params.pageId, fileName);
    const body = await params.video.arrayBuffer();

    await env.IMAGES.put(key, body, {
        httpMetadata: {
            contentType: mimeType,
        },
        customMetadata: {
            pageId: params.pageId,
            originalName: fileName,
            uploadSource: params.source,
            uploadedAt: new Date().toISOString(),
        },
    });

    return {
        key,
        fileName,
        mimeType,
        fileSize: params.video.size,
    };
}

async function getVideoFromR2(env: Env, key: string): Promise<{ blob: Blob; fileName: string; mimeType: string; fileSize?: number } | null> {
    if (!env.IMAGES) {
        throw new Error('IMAGES R2 binding is not configured');
    }

    const object = await env.IMAGES.get(key);
    if (!object) return null;

    const arrayBuffer = await object.arrayBuffer();
    const fileName =
        object.customMetadata?.originalName ||
        key.split('/').pop() ||
        'pubilo-reel.mp4';
    const mimeType =
        object.httpMetadata?.contentType ||
        object.customMetadata?.mimeType ||
        'video/mp4';
    const blob = new Blob([arrayBuffer], { type: mimeType });

    return {
        blob,
        fileName: sanitizeFileName(fileName),
        mimeType,
        fileSize: object.size,
    };
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

async function postAffiliateComment(params: {
    objectIds: string[];
    accessToken: string;
    message: string;
    headers?: Record<string, string>;
}): Promise<{ success: true; commentId: string; targetId: string } | { success: false; error: any }> {
    let lastError: any = null;

    for (const objectId of params.objectIds) {
        const normalizedId = String(objectId || '').trim();
        if (!normalizedId) continue;

        const body = new FormData();
        body.append('access_token', params.accessToken);
        body.append('message', params.message);

        const response = await fetch(`${FB_API}/${normalizedId}/comments`, {
            method: 'POST',
            ...(params.headers ? { headers: params.headers } : {}),
            body,
        });

        const data = await response.json() as any;
        if (data?.error) {
            lastError = {
                ...data.error,
                targetId: normalizedId,
            };
            continue;
        }

        const commentId = String(data?.id || '').trim();
        if (commentId) {
            return {
                success: true,
                commentId,
                targetId: normalizedId,
            };
        }

        lastError = {
            message: 'Facebook did not return comment id',
            targetId: normalizedId,
        };
    }

    return {
        success: false,
        error: lastError || { message: 'Failed to create affiliate comment' },
    };
}

app.post('/upload', async (c) => {
    try {
        const formData = await c.req.formData();
        const pageId = String(formData.get('pageId') || '').trim();
        const videoInput = formData.get('video') as unknown;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        if (!isUploadableBlob(videoInput)) {
            return c.json({ success: false, error: 'Missing video file' }, 400);
        }

        const videoFile = videoInput as Blob & { name?: string };
        if (!getVideoMimeType(videoFile).startsWith('video/')) {
            return c.json({ success: false, error: 'Invalid video file type' }, 400);
        }

        if (videoFile.size > REELS_V2_MAX_FILE_SIZE) {
            return c.json({
                success: false,
                error: `Video too large. Current limit is ${Math.round(REELS_V2_MAX_FILE_SIZE / (1024 * 1024))} MB`,
            }, 400);
        }

        const uploaded = await putVideoIntoR2(c.env, {
            pageId,
            video: videoFile,
            source: 'browser-upload',
        });

        await upsertReelUploadStage(c.env, {
            videoKey: uploaded.key,
            pageId,
            fileName: uploaded.fileName,
            mimeType: uploaded.mimeType,
            fileSize: uploaded.fileSize,
            uploadSource: 'browser-upload',
        });

        return c.json({
            success: true,
            videoKey: uploaded.key,
            fileName: uploaded.fileName,
            fileSize: uploaded.fileSize,
            mimeType: uploaded.mimeType,
        });
    } catch (error) {
        console.error('[publish-reel/upload] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/', async (c) => {
    try {
        const formData = await c.req.formData();
        const pageId = String(formData.get('pageId') || '').trim();
        const pageToken = String(formData.get('pageToken') || '').trim();
        const accessToken = String(formData.get('accessToken') || '').trim();
        const cookieData = String(formData.get('cookieData') || '').trim();
        const caption = String(formData.get('caption') || '').trim();
        const affiliateComment = String(formData.get('affiliateComment') || '').trim();
        const affiliateLink = String(formData.get('affiliateLink') || '').trim();
        const videoKey = String(formData.get('videoKey') || '').trim();
        const videoInput = formData.get('video') as unknown;

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        let videoFile: Blob & { name?: string } | null = null;
        let videoKeyUsed = videoKey;
        if (videoKey) {
            const storedVideo = await getVideoFromR2(c.env, videoKey);
            if (!storedVideo) {
                return c.json({ success: false, error: 'Uploaded video not found. Please re-upload the reel.' }, 400);
            }

            videoFile = Object.assign(storedVideo.blob, { name: storedVideo.fileName });
        } else if (isUploadableBlob(videoInput)) {
            videoFile = videoInput as Blob & { name?: string };

            if (videoFile.size > REELS_V2_MAX_FILE_SIZE) {
                return c.json({
                    success: false,
                    error: `Video too large. Current limit is ${Math.round(REELS_V2_MAX_FILE_SIZE / (1024 * 1024))} MB`,
                }, 400);
            }

            const uploaded = await putVideoIntoR2(c.env, {
                pageId,
                video: videoFile,
                source: 'publish-fallback',
            });
            videoKeyUsed = uploaded.key;

            await upsertReelUploadStage(c.env, {
                videoKey: uploaded.key,
                pageId,
                fileName: uploaded.fileName,
                mimeType: uploaded.mimeType,
                fileSize: uploaded.fileSize,
                uploadSource: 'publish-fallback',
            });
        }

        if (!videoFile) {
            return c.json({ success: false, error: 'Missing video file' }, 400);
        }

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

        if (videoKeyUsed) {
            await markReelUploadPublishing(c.env, videoKeyUsed);
        }

        for (const authToken of authCandidates) {
            const body = new FormData();
            body.append('access_token', authToken);
            body.append('source', videoFile, getVideoFileName(videoFile));
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
                hasVideoKey: !!videoKeyUsed,
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
            const affiliateCommentMessage = buildAffiliateCommentMessage(affiliateComment, affiliateLink);
            let affiliateCommentResult:
                | { success: true; commentId: string; targetId: string }
                | { success: false; error: any }
                | null = null;
            let deleteErrorMessage: string | null = null;
            let deletedFromR2 = false;

            if (affiliateCommentMessage) {
                affiliateCommentResult = await postAffiliateComment({
                    objectIds: [postId, videoId],
                    accessToken: authToken,
                    message: affiliateCommentMessage,
                    headers: facebookHeaders,
                });
            }

            if (videoKeyUsed) {
                try {
                    await c.env.IMAGES.delete(videoKeyUsed);
                    deletedFromR2 = true;
                } catch (error) {
                    deleteErrorMessage = error instanceof Error ? error.message : String(error);
                    console.error('[publish-reel] Failed to delete staged R2 object after publish:', {
                        videoKey: videoKeyUsed,
                        error: deleteErrorMessage,
                    });
                }
            }

            if (videoKeyUsed) {
                await markReelUploadCompleted(c.env, {
                    videoKey: videoKeyUsed,
                    postId: postId || videoId,
                    videoId,
                    facebookUrl: buildFacebookVideoUrl({
                        pageId,
                        videoId,
                        postId,
                        permalinkUrl,
                    }),
                    commentId: affiliateCommentResult?.success ? affiliateCommentResult.commentId : undefined,
                    commentTargetId: affiliateCommentResult?.success ? affiliateCommentResult.targetId : undefined,
                    warningMessage:
                        (affiliateCommentMessage && affiliateCommentResult && !affiliateCommentResult.success
                            ? `Affiliate comment failed: ${affiliateCommentResult.error?.message || 'Unknown error'}`
                            : null) ||
                        (deleteErrorMessage ? `R2 cleanup failed: ${deleteErrorMessage}` : null),
                    deleted: deletedFromR2,
                    deleteErrorMessage,
                });
            }

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
                    videoKey: videoKeyUsed || null,
                    processingStatus: status,
                    hasPermalink: !!permalinkUrl,
                    hasPostId: !!postId,
                },
                affiliateComment: affiliateCommentMessage
                    ? (
                        affiliateCommentResult?.success
                            ? {
                                success: true,
                                commentId: affiliateCommentResult.commentId,
                                targetId: affiliateCommentResult.targetId,
                            }
                            : {
                                success: false,
                                error: affiliateCommentResult?.error?.message || 'Failed to create affiliate comment',
                                errorCode: affiliateCommentResult?.error?.code,
                                errorSubcode: affiliateCommentResult?.error?.error_subcode,
                                errorType: affiliateCommentResult?.error?.type,
                            }
                    )
                    : null,
                warning:
                    affiliateCommentMessage && affiliateCommentResult && !affiliateCommentResult.success
                        ? `Reel posted but affiliate comment failed: ${affiliateCommentResult.error?.message || 'Unknown error'}`
                        : (deleteErrorMessage ? `Reel posted but cleanup failed: ${deleteErrorMessage}` : null),
            });
        }

        if (videoKeyUsed) {
            await markReelUploadFailed(c.env, {
                videoKey: videoKeyUsed,
                errorMessage: sawSessionExpired
                    ? 'Facebook session หมดอายุ กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง'
                    : (lastFacebookError?.message || 'Facebook API error'),
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
