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

// POST /api/publish - Publish to Facebook
app.post('/', async (c) => {
    try {
        const { pageId, pageToken, accessToken, cookieData, message, imageUrl, scheduledTime, link,
            linkUrl, linkName, caption, description, primaryText, postMode, adAccountId, fbDtsg } = await c.req.json();

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        // Resolve Page Token in priority order:
        // 1. Directly provided pageToken
        // 2. From page_settings.post_token in D1 (same as cron-auto-post)
        // 3. Fetch from Facebook using accessToken (User Token)
        let resolvedPageToken = pageToken;

        if (!resolvedPageToken) {
            // Try D1 database first
            console.log('[publish] No pageToken provided, checking D1 page_settings...');
            try {
                const dbResult = await c.env.DB.prepare(
                    'SELECT post_token FROM page_settings WHERE page_id = ? LIMIT 1'
                ).bind(pageId).first<{ post_token: string | null }>();

                if (dbResult?.post_token) {
                    resolvedPageToken = dbResult.post_token;
                    console.log('[publish] Got Page Token from D1 page_settings');
                }
            } catch (dbErr) {
                console.error('[publish] D1 error:', dbErr);
            }
        }

        if (!resolvedPageToken && accessToken) {
            // Fallback: try to fetch from Facebook using accessToken (User Token)
            console.log('[publish] Trying to fetch Page Token from Facebook using accessToken...');
            try {
                const tokenRes = await fetch(
                    `${FB_API}/${pageId}?fields=access_token&access_token=${accessToken}`
                );
                const tokenData = await tokenRes.json() as any;

                if (tokenData.access_token) {
                    resolvedPageToken = tokenData.access_token;
                    console.log('[publish] Got Page Token from Facebook Graph API');
                } else if (tokenData.error) {
                    console.warn('[publish] Facebook token fetch failed:', tokenData.error.message);
                }
            } catch (fetchErr) {
                console.warn('[publish] Error fetching from Facebook:', fetchErr);
            }
        }

        if (!resolvedPageToken) {
            return c.json({
                success: false,
                error: 'ไม่พบ Page Token - กรุณาใส่ใน Settings > 🔑 Page Token'
            }, 400);
        }

        let endpoint = `${FB_API}/${pageId}`;
        let params = new URLSearchParams({ access_token: resolvedPageToken });
        let multipartBody: FormData | null = null;

        // Determine post type
        const finalMessage = message || primaryText || '';
        const finalLink = link || linkUrl || '';
        let finalImageUrl = imageUrl || '';

        const captionParts = [];
        if (finalMessage) captionParts.push(finalMessage);
        if (linkName) captionParts.push(linkName);
        else if (description) captionParts.push(`พิกัด : ${description}`);
        if (caption) captionParts.push(caption);
        if (finalLink) captionParts.push(finalLink);
        const finalCaption = captionParts.join('\n\n');

        // If image is base64, upload it directly to Facebook from the worker.
        if (finalImageUrl && finalImageUrl.startsWith('data:')) {
            endpoint += '/photos';
            multipartBody = new FormData();
            multipartBody.append('access_token', resolvedPageToken);
            multipartBody.append('source', dataUrlToBlob(finalImageUrl), 'pubilo-upload.jpg');
            if (finalCaption) multipartBody.append('caption', finalCaption);
            console.log('[publish] Using worker multipart upload for data URL image');
        }

        if (multipartBody) {
            // Endpoint/body already prepared for direct multipart upload above.
        } else if (finalImageUrl && finalImageUrl.startsWith('http')) {
            // Photo post — include link in caption if available
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

        // Schedule if time provided
        if (scheduledTime) {
            const timestamp = typeof scheduledTime === 'number'
                ? scheduledTime
                : Math.floor(new Date(scheduledTime).getTime() / 1000);
            if (multipartBody) {
                multipartBody.append('scheduled_publish_time', String(timestamp));
                multipartBody.append('published', 'false');
            } else {
                params.append('scheduled_publish_time', String(timestamp));
                params.append('published', 'false');
            }
        }

        console.log('[publish] Posting to:', endpoint);
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
            console.error('[publish] Facebook API error:', data.error);
            return c.json({ success: false, error: data.error.message }, 400);
        }

        console.log('[publish] Success! Post ID:', data.id || data.post_id);
        return c.json({ success: true, postId: data.id || data.post_id });
    } catch (error) {
        console.error('[publish] Server error:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as publishRouter };
