import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// GET /api/tokens?userId=xxx
app.get('/', async (c) => {
    const userId = c.req.query('userId');
    if (!userId) return c.json({ success: false, error: 'Missing userId' }, 400);

    try {
        const results = await c.env.DB.prepare(`
            SELECT * FROM tokens WHERE user_id = ?
        `).bind(userId).all();

        return c.json({ success: true, tokens: results.results || [] });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/tokens
app.post('/', async (c) => {
    try {
        const { userId, adsToken, cookie, fbDtsg } = await c.req.json();
        if (!userId) return c.json({ success: false, error: 'Missing userId' }, 400);

        const now = new Date().toISOString();
        const normalizedToken = adsToken || null;

        await c.env.DB.prepare(`
            INSERT INTO tokens (user_id, ads_token, post_token, cookie, fb_dtsg, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                ads_token = excluded.ads_token,
                post_token = excluded.post_token,
                cookie = excluded.cookie,
                fb_dtsg = excluded.fb_dtsg,
                updated_at = excluded.updated_at
        `).bind(userId, normalizedToken, normalizedToken, cookie || null, fbDtsg || null, now).run();

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as tokensRouter };
