import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();
const FB_API = 'https://graph.facebook.com/v21.0';

type AutoHideConfig = {
    organization_id: string;
    page_id: string;
    hide_token_encrypted: string | null;
    post_token_encrypted: string | null;
    hide_types: string;
};

// Hide a post on Facebook
async function hidePost(postId: string, pageToken: string): Promise<{ success: boolean; error?: string }> {
    try {
        const response = await fetch(`${FB_API}/${postId}?timeline_visibility=hidden&access_token=${pageToken}`, { method: 'POST' });
        const data = await response.json() as any;
        console.log(`[auto-hide] Hide post ${postId}:`, data);
        if (data?.success === true) {
            return { success: true };
        }
        return {
            success: false,
            error: String(data?.error?.message || data?.message || 'Graph API hide failed'),
        };
    } catch (err) {
        console.error(`[auto-hide] Error hiding post ${postId}:`, err);
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

function shouldHidePost(post: any, hideTypes: string[]): boolean {
    const normalizedHideTypes = new Set(
        (hideTypes || []).map((type) => String(type || "").trim()).filter(Boolean),
    );
    if (!normalizedHideTypes.size) return false;

    const statusType = String(post?.status_type || "").trim();
    if (statusType && normalizedHideTypes.has(statusType)) {
        return true;
    }

    const attachments = Array.isArray(post?.attachments?.data) ? post.attachments.data : [];
    const firstAttachment = attachments[0] || {};
    const attachmentType = String(firstAttachment?.type || "").trim().toLowerCase();
    const mediaType = String(firstAttachment?.media_type || "").trim().toLowerCase();
    const hasAttachments = attachments.length > 0;
    const hasPhotoLikeAttachment =
        mediaType === "photo" ||
        attachmentType === "photo" ||
        attachmentType === "album";
    const hasShareLikeAttachment =
        attachmentType === "share" ||
        attachmentType === "link" ||
        mediaType === "link";

    // Fallback classification when Facebook omits/changes status_type.
    if (normalizedHideTypes.has("added_photos") && hasPhotoLikeAttachment) {
        return true;
    }
    if (normalizedHideTypes.has("shared_story") && hasShareLikeAttachment) {
        return true;
    }
    if (normalizedHideTypes.has("mobile_status_update") && !hasAttachments) {
        return true;
    }

    return false;
}

// Get recent posts from a page
async function getRecentPosts(pageId: string, pageToken: string, hideTypes: string[]): Promise<string[]> {
    const postIds: string[] = [];
    try {
        // Limit to 20 posts to avoid timeout
        const response = await fetch(
            `${FB_API}/${pageId}/posts?fields=id,status_type,attachments{type,media_type}&limit=30&access_token=${pageToken}`,
        );
        const data = await response.json() as any;

        for (const post of (data.data || [])) {
            if (shouldHidePost(post, hideTypes)) {
                postIds.push(post.id);
            }
        }
    } catch (err) {
        console.error(`[auto-hide] Error fetching posts for page ${pageId}:`, err);
    }
    return postIds;
}

async function processAutoHide(c: any, configs: AutoHideConfig[], maxHidePerRun: number) {
    let totalHidden = 0;
    const results: any[] = [];

    for (const config of configs) {
        const token = (await decryptSecret(c.env, config.hide_token_encrypted))
            || (await decryptSecret(c.env, config.post_token_encrypted));

        if (!token) {
            results.push({ page_id: config.page_id, status: 'skipped', reason: 'no_token' });
            continue;
        }

        // Get recent posts from Facebook
        const hideTypes = String(config.hide_types || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
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

        const postsToProcess = postsToHide.slice(0, Math.max(1, maxHidePerRun));

        let hiddenCount = 0;
        let failedCount = 0;
        const failedSamples: Array<{ post_id: string; reason: string }> = [];
        for (const postId of postsToProcess) {
            const hideResult = await hidePost(postId, token);
            if (hideResult.success) {
                await c.env.DB.prepare(`
                    INSERT OR IGNORE INTO hidden_posts (organization_id, page_id, post_id, hidden_at)
                    VALUES (?, ?, ?, ?)
                `).bind(config.organization_id, config.page_id, postId, new Date().toISOString()).run();
                hiddenCount++;
                totalHidden++;
            } else {
                failedCount++;
                if (failedSamples.length < 3) {
                    failedSamples.push({
                        post_id: postId,
                        reason: String(hideResult.error || 'unknown_error'),
                    });
                }
            }
        }

        results.push({
            page_id: config.page_id,
            status: failedCount > 0 && hiddenCount === 0 ? 'failed' : 'success',
            hidden: hiddenCount,
            pending: Math.max(0, postsToHide.length - hiddenCount),
            failed: failedCount,
            failed_samples: failedSamples,
        });
        console.log(`[auto-hide] Page ${config.page_id}: hidden ${hiddenCount} posts, failed ${failedCount}, ${postsToHide.length - hiddenCount} pending`);
    }

    return { totalHidden, results };
}

// Manual handler for immediate hide (single page)
app.post('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const body = await c.req.json().catch(() => ({} as any));
        const pageId = String(body?.pageId || '').trim();
        const maxHidePerRun = Math.min(Number(body?.maxHidePerRun || 20) || 20, 50);

        if (!pageId) {
            return c.json({ success: false, error: 'Missing pageId' }, 400);
        }

        const config = await c.env.DB.prepare(`
            SELECT organization_id, page_id, hide_token_encrypted, post_token_encrypted, hide_types
            FROM page_settings
            WHERE organization_id = ? AND page_id = ? AND hide_types IS NOT NULL AND hide_types != ''
            LIMIT 1
        `).bind(workspaceId, pageId).first<AutoHideConfig>();

        if (!config) {
            return c.json({ success: false, error: 'Auto-hide not configured for this page' }, 400);
        }

        const processed = await processAutoHide(c, [config], maxHidePerRun);
        return c.json({
            success: true,
            processed: 1,
            totalHidden: processed.totalHidden,
            results: processed.results,
            mode: 'manual',
        });
    } catch (err) {
        console.error('[auto-hide] Manual error:', err);
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

// Cron handler for auto-hide
app.get('/', async (c) => {
    try {
        // Get all pages with auto_hide enabled
        const configs = await c.env.DB.prepare(`
            SELECT organization_id, page_id, hide_token_encrypted, post_token_encrypted, hide_types 
            FROM page_settings 
            WHERE auto_hide = 1 AND hide_types IS NOT NULL AND hide_types != ''
        `).all<AutoHideConfig>();

        if (!configs.results?.length) {
            return c.json({ success: true, message: 'No pages with auto-hide enabled', processed: 0 });
        }

        console.log(`[auto-hide] Processing ${configs.results.length} pages`);
        const processed = await processAutoHide(c, configs.results, 5);
        return c.json({ success: true, processed: configs.results.length, totalHidden: processed.totalHidden, results: processed.results });

    } catch (err) {
        console.error('[auto-hide] Error:', err);
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as autoHideRouter };
