import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';

function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/^data:(.*?);base64$/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType });
}

async function fetchFreshPageToken(pageId: string, accessToken?: string): Promise<string> {
    if (!accessToken) return '';

    try {
        const accountsRes = await fetch(
            `${FB_API}/me/accounts?access_token=${encodeURIComponent(accessToken)}&fields=id,access_token&limit=100`
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
            `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`
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

// POST /api/publish - Publish to Facebook
app.post('/', async (c) => {
    try {
        const { pageId, pageToken, accessToken, cookieData, message, imageUrl, scheduledTime, link,
            linkUrl, linkName, caption, description, primaryText, postMode, adAccountId, fbDtsg } = await c.req.json();

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

        const freshPageToken = await fetchFreshPageToken(pageId, accessToken);
        const authCandidates = buildAuthCandidates([
            accessToken,
            freshPageToken,
            storedPageToken,
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

        let lastFacebookError: any = null;

        for (const authToken of authCandidates) {
            let endpoint = `${FB_API}/${pageId}`;
            let params = new URLSearchParams({ access_token: authToken });
            let multipartBody: FormData | null = null;

            if (finalImageUrl && finalImageUrl.startsWith('data:')) {
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

            if (scheduleTimestamp) {
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

            const response = await fetch(endpoint, {
                method: 'POST',
                ...(multipartBody
                    ? { body: multipartBody }
                    : {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                    }),
            });

            const data = await response.json() as any;

            if (data.error) {
                lastFacebookError = data.error;
                console.warn('[publish] Facebook API error for token candidate:', data.error);
                continue;
            }

            console.log('[publish] Success! Post ID:', data.id || data.post_id);
            return c.json({ success: true, postId: data.id || data.post_id });
        }

        return c.json({
            success: false,
            error: lastFacebookError?.message || 'Facebook API error',
            errorCode: lastFacebookError?.code,
            errorSubcode: lastFacebookError?.error_subcode,
            errorType: lastFacebookError?.type,
        }, 400);
    } catch (error) {
        console.error('[publish] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishRouter };
