import { Context, Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const FB_API = 'https://graph.facebook.com/v21.0';

async function handleScheduledPosts(pageId: string | undefined, pageToken: string | undefined, c: Context<{ Bindings: Env }>) {
    if (!pageId || !pageToken) {
        return c.json({ success: false, error: 'Missing pageId or pageToken' }, 400);
    }

    try {
        const fields = 'id,message,scheduled_publish_time,created_time,status_type,full_picture,attachments{media,subattachments},permalink_url';
        const url = `${FB_API}/${pageId}/scheduled_posts?access_token=${pageToken}&fields=${fields}`;

        const response = await fetch(url);
        const data = await response.json() as any;

        if (data.error) {
            return c.json({ success: false, error: data.error.message }, 400);
        }

        const posts = (data.data || []).map((post: any) => {
            const imageUrl = post.full_picture || post.attachments?.data?.[0]?.media?.image?.src || '';
            const scheduledTime = post.scheduled_publish_time || 0;
            const type = post.status_type || 'unknown';
            const permalink = post.permalink_url || '';

            return {
                id: post.id,
                message: post.message || '',
                scheduled_publish_time: scheduledTime,
                created_time: post.created_time,
                type,
                image_url: imageUrl,
                permalink,
                // Backward-compatible aliases for the legacy web dashboard.
                scheduledTime,
                postType: type,
                imageUrl,
                fullImageUrl: imageUrl,
            };
        });

        return c.json({ success: true, posts });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
}

// GET /api/scheduled-posts?pageId=xxx&pageToken=xxx
app.get('/', async (c) => {
    const pageId = c.req.query('pageId');
    const pageToken = c.req.query('pageToken');
    return handleScheduledPosts(pageId, pageToken, c);
});

// POST /api/scheduled-posts { pageId, pageToken }
app.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { pageId?: string; pageToken?: string };
    return handleScheduledPosts(body.pageId, body.pageToken, c);
});

export { app as scheduledPostsRouter };
