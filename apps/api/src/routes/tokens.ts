import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/encryption';
import { getUserId, getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

// GET /api/tokens?userId=xxx
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const userId = c.req.query('userId');
        const results = await c.env.DB.prepare(`
            SELECT *
            FROM facebook_credentials
            WHERE workspace_id = ?
              AND (? IS NULL OR facebook_user_id = ?)
            ORDER BY updated_at DESC
        `).bind(workspaceId, userId || null, userId || null).all<any>();

        const tokens = await Promise.all((results.results || []).map(async (row: any) => ({
            user_id: row.facebook_user_id,
            ads_token: await decryptSecret(c.env, row.ads_token_encrypted),
            post_token: await decryptSecret(c.env, row.ads_token_encrypted),
            cookie: await decryptSecret(c.env, row.cookie_encrypted),
            fb_dtsg: await decryptSecret(c.env, row.fb_dtsg_encrypted),
            user_name: row.account_name,
            avatar_url: row.avatar_url,
            updated_at: row.updated_at,
        })));

        return c.json({ success: true, tokens });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/tokens
app.post('/', async (c) => {
    try {
        const { userId, adsToken, cookie, fbDtsg, userName, avatarUrl } = await c.req.json();
        if (!userId) return c.json({ success: false, error: 'Missing userId' }, 400);

        const workspaceId = getWorkspaceId(c);
        const createdByUserId = getUserId(c);
        const now = new Date().toISOString();
        const normalizedToken = adsToken || null;

        await c.env.DB.prepare(`
            INSERT INTO facebook_credentials (
                id, workspace_id, facebook_user_id, ads_token_encrypted, cookie_encrypted, fb_dtsg_encrypted,
                account_name, avatar_url, created_by_user_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                ads_token_encrypted = excluded.ads_token_encrypted,
                cookie_encrypted = excluded.cookie_encrypted,
                fb_dtsg_encrypted = excluded.fb_dtsg_encrypted,
                account_name = excluded.account_name,
                avatar_url = excluded.avatar_url,
                updated_at = excluded.updated_at
        `).bind(
            `${workspaceId}:${userId}`,
            workspaceId,
            userId,
            await encryptSecret(c.env, normalizedToken),
            await encryptSecret(c.env, cookie || null),
            await encryptSecret(c.env, fbDtsg || null),
            userName || userId,
            avatarUrl || null,
            createdByUserId,
            now,
            now,
        ).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as tokensRouter };
