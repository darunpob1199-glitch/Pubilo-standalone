import { Hono } from 'hono';
import type { Env } from '../index';
import { cleanupStaleReelUploads } from '../lib/reel-uploads';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
    try {
        const result = await cleanupStaleReelUploads(c.env, 48, 50);
        return c.json({
            success: true,
            message: 'Reel cleanup completed',
            ...result,
        });
    } catch (error) {
        console.error('[cron-cleanup-reels] error:', error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

export { app as cronCleanupReelsRouter };
