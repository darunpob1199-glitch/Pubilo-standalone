import { Hono } from 'hono';
import { Env } from '../index';
import { recordPublishHistory } from '../lib/publish-history';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

const DOC_ID = "25358568403813021";

// Text post with optional GraphQL edit mode
app.post('/', async (c) => {
    try {
        const { pageId, message, shareToPages, userId, iUser } = await c.req.json();
        const workspaceId = getWorkspaceId(c);

        if (!pageId || !message || !userId) {
            return c.json({ error: 'Missing pageId, message, or userId' }, 400);
        }

        // Get user token
        const credential = await c.env.DB.prepare(`
            SELECT ads_token_encrypted, cookie_encrypted, fb_dtsg_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ? AND facebook_user_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
        `).bind(workspaceId, userId).first<{
            ads_token_encrypted: string | null;
            cookie_encrypted: string | null;
            fb_dtsg_encrypted: string | null;
        }>();

        const user = credential ? {
            post_token: await decryptSecret(c.env, credential.ads_token_encrypted),
            cookie: await decryptSecret(c.env, credential.cookie_encrypted),
            fb_dtsg: await decryptSecret(c.env, credential.fb_dtsg_encrypted),
        } : null;

        if (!user?.post_token) {
            return c.json({ error: 'Missing user token' }, 400);
        }

        // Get page token from Facebook
        const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&access_token=${user.post_token}`);
        const pagesData = await pagesRes.json() as any;
        const pageToken = pagesData.data?.find((p: any) => p.id === pageId)?.access_token;

        if (!pageToken) {
            return c.json({ error: 'Page token not found' }, 400);
        }

        let postId: string;
        let editSuccess = false;
        let editError: string | undefined;

        if (iUser && user.cookie && user.fb_dtsg) {
            // GraphQL edit mode
            const photoRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: 'https://picsum.photos/800/600', message, access_token: pageToken })
            });
            const photoData = await photoRes.json() as any;
            if (photoData.error) return c.json({ error: photoData.error.message }, 400);
            postId = photoData.post_id;

            await new Promise(r => setTimeout(r, 2000));

            const actualPostId = postId.split('_')[1];
            const storyId = btoa(`S:_I${iUser}:${actualPostId}:${actualPostId}`);

            const variables = {
                input: {
                    story_id: storyId, attachments: [],
                    audience: { privacy: { allow: [], base_state: 'EVERYONE', deny: [], tag_expansion_state: 'UNSPECIFIED' } },
                    message: { ranges: [], text: message },
                    text_format_preset_id: '0',
                    actor_id: iUser, client_mutation_id: '1'
                }
            };

            const editRes = await fetch('https://www.facebook.com/api/graphql/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': user.cookie, 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.facebook.com' },
                body: new URLSearchParams({ av: iUser, __user: iUser, __a: '1', fb_dtsg: user.fb_dtsg, fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: 'ComposerStoryEditMutation', variables: JSON.stringify(variables), doc_id: DOC_ID }).toString()
            });
            const editText = await editRes.text();
            editSuccess = editText.includes('"attachments":[]');
            if (!editSuccess) editError = editText.slice(0, 200);
        } else {
            // Simple text post
            const postRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, access_token: pageToken })
            });
            const postData = await postRes.json() as any;
            if (postData.error) return c.json({ error: postData.error.message }, 400);
            postId = postData.id;
        }

        // Log to auto_post_logs with Thai time
        const thaiTimestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        const logResult = await c.env.DB.prepare(`
            INSERT INTO auto_post_logs (organization_id, page_id, post_type, quote_text, status, facebook_post_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(workspaceId, pageId, 'text', message.slice(0, 500), 'success', postId, thaiTimestamp).run();
        const logId = Number(logResult.meta?.last_row_id || 0);

        await recordPublishHistory(c.env, {
            organizationId: workspaceId,
            externalKey: logId ? `auto-post-log:${logId}` : `publish:${pageId}:${postId}`,
            pageId,
            source: 'auto_post',
            sourceRef: logId ? String(logId) : postId,
            postType: 'text',
            messageText: message,
            mediaKind: 'text',
            facebookPostId: postId,
            facebookUrl: `https://www.facebook.com/${postId}`,
            publishedAt: thaiTimestamp,
        });

        // Queue share to other pages (will be processed by cron based on share_schedule_minutes)
        const queuedShares: { pageId: string; queued: boolean }[] = [];
        if (shareToPages?.length) {
            // Get share_schedule_minutes from page_settings
            const pageSettings = await c.env.DB.prepare(`
                SELECT share_schedule_minutes
                FROM page_settings
                WHERE organization_id = ? AND page_id = ?
            `).bind(workspaceId, pageId).first<{ share_schedule_minutes: string }>();
            const shareScheduleMinutes = pageSettings?.share_schedule_minutes || '';

            for (const targetPageId of shareToPages) {
                if (targetPageId === pageId) continue;
                try {
                    await c.env.DB.prepare(`
                        INSERT INTO share_queue (organization_id, source_page_id, target_page_id, facebook_post_id, post_type, share_schedule_minutes)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).bind(workspaceId, pageId, targetPageId, postId, 'text', shareScheduleMinutes).run();
                    queuedShares.push({ pageId: targetPageId, queued: true });
                } catch (err) {
                    queuedShares.push({ pageId: targetPageId, queued: false });
                }
            }
        }

        return c.json({ success: true, postId, editSuccess, editError, queuedShares });
    } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as textPostRouter };
