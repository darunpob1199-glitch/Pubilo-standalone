import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret } from '../lib/encryption';

const app = new Hono<{ Bindings: Env }>();

// Hide a post on Facebook
async function hidePost(postId: string, pageToken: string): Promise<boolean> {
    try {
        const response = await fetch(`https://graph.facebook.com/v21.0/${postId}?timeline_visibility=hidden&access_token=${pageToken}`, { method: 'POST' });
        const data = await response.json() as any;
        console.log(`[auto-hide] Hide post ${postId}:`, data);
        return data.success === true;
    } catch (err) {
        console.error(`[auto-hide] Error hiding post ${postId}:`, err);
        return false;
    }
}

// Get recent posts from a page
async function getRecentPosts(pageId: string, pageToken: string, hideTypes: string[]): Promise<string[]> {
    const postIds: string[] = [];
    try {
        // Limit to 20 posts to avoid timeout
        const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/posts?fields=id,status_type&limit=20&access_token=${pageToken}`);
        const data = await response.json() as any;

        for (const post of (data.data || [])) {
            if (hideTypes.includes(post.status_type)) {
                postIds.push(post.id);
            }
        }
    } catch (err) {
        console.error(`[auto-hide] Error fetching posts for page ${pageId}:`, err);
    }
    return postIds;
}

// Cron handler for auto-hide
app.get('/', async (c) => {
    try {
        // Get all pages with auto_hide enabled
        const configs = await c.env.DB.prepare(`
            SELECT organization_id, page_id, hide_token_encrypted, post_token_encrypted, hide_types 
            FROM page_settings 
            WHERE auto_hide = 1 AND hide_types IS NOT NULL AND hide_types != ''
        `).all<{
            organization_id: string;
            page_id: string;
            hide_token_encrypted: string | null;
            post_token_encrypted: string | null;
            hide_types: string;
        }>();

        if (!configs.results?.length) {
            return c.json({ success: true, message: 'No pages with auto-hide enabled', processed: 0 });
        }

        console.log(`[auto-hide] Processing ${configs.results.length} pages`);

        let totalHidden = 0;
        const results: any[] = [];

        for (const config of configs.results) {
            const token = (await decryptSecret(c.env, config.hide_token_encrypted))
                || (await decryptSecret(c.env, config.post_token_encrypted));

            if (!token) {
                results.push({ page_id: config.page_id, status: 'skipped', reason: 'no_token' });
                continue;
            }

            // Get recent posts from Facebook
            const hideTypes = config.hide_types.split(',').map(t => t.trim());
            const recentPosts = await getRecentPosts(config.page_id, token, hideTypes);

            // Check each post individually using point lookup (uses autoindex, reads 1 row each)
            const postsToHide: string[] = [];
            for (const postId of recentPosts) {
                const existing = await c.env.DB.prepare(`
                    SELECT 1
                    FROM hidden_posts
                    WHERE organization_id = ? AND page_id = ? AND post_id = ?
                    LIMIT 1
                `).bind(config.organization_id, config.page_id, postId).first();
                if (!existing) {
                    postsToHide.push(postId);
                }
            }

            // Limit to 5 posts per run to avoid timeout
            const maxHidePerRun = 5;
            const postsToProcess = postsToHide.slice(0, maxHidePerRun);

            let hiddenCount = 0;
            for (const postId of postsToProcess) {
                const success = await hidePost(postId, token);
                if (success) {
                    await c.env.DB.prepare(`
                        INSERT OR IGNORE INTO hidden_posts (organization_id, page_id, post_id, hidden_at)
                        VALUES (?, ?, ?, ?)
                    `).bind(config.organization_id, config.page_id, postId, new Date().toISOString()).run();
                    hiddenCount++;
                    totalHidden++;
                }
            }

            results.push({
                page_id: config.page_id,
                status: 'success',
                hidden: hiddenCount,
                pending: postsToHide.length - hiddenCount
            });
            console.log(`[auto-hide] Page ${config.page_id}: hidden ${hiddenCount} posts, ${postsToHide.length - hiddenCount} pending`);
        }

        return c.json({ success: true, processed: configs.results.length, totalHidden, results });

    } catch (err) {
        console.error('[auto-hide] Error:', err);
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as autoHideRouter };
