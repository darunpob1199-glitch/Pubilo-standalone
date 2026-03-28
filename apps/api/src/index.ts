import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pageSettingsRouter } from './routes/page-settings';
import { pagesRouter } from './routes/pages';
import { tokensRouter } from './routes/tokens';
import { promptsRouter } from './routes/prompts';
import { quotesRouter } from './routes/quotes';
import { globalSettingsRouter } from './routes/global-settings';
import { generateRouter } from './routes/generate';
import { publishRouter } from './routes/publish';
import { scheduledPostsRouter } from './routes/scheduled-posts';
import { deletePostRouter } from './routes/delete-post';
import { earningsRouter } from './routes/earnings';
import { autoPostConfigRouter } from './routes/auto-post-config';
import { autoHideConfigRouter } from './routes/auto-hide-config';
import { uploadImageRouter } from './routes/upload-image';
import { logsRouter } from './routes/logs';
import { migrateRouter } from './routes/migrate';
// Cron routes
import { cronAutoPostRouter } from './routes/cron-auto-post';
import { cronEarningsRouter } from './routes/cron-earnings';
import { autoHideRouter } from './routes/auto-hide';
import { cronHealthCheckRouter } from './routes/cron-health-check';
import { cronCleanupReelsRouter } from './routes/cron-cleanup-reels';
// Additional routes
import { lineWebhookRouter } from './routes/line-webhook';
import { checkPendingSharesRouter } from './routes/check-pending-shares';
import { checkRiskyQuotesRouter } from './routes/check-risky-quotes';
import { textPostRouter } from './routes/text-post';
import { updatePostTimeRouter } from './routes/update-post-time';
import { generateNewsRouter } from './routes/generate-news';
import { tokenHealthRouter } from './routes/token-health';
import { newsLinkRouter } from './routes/news-link';
import { publishReelRouter } from './routes/publish-reel';


export interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    GEMINI_API_KEY: string;
    FREEIMAGE_API_KEY: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_CHANNEL_SECRET?: string;
    LINE_USER_ID?: string;
    OG_IMAGE_BASE_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

type ScheduledQueueJob = {
    id: number;
    payload_json: string;
    scheduled_time: number;
    attempts: number;
};

async function ensureScheduledPublishQueueTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            batch_id TEXT,
            scheduled_time INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            post_id TEXT,
            facebook_url TEXT,
            error_message TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT
        )
    `).run();

    try {
        await env.DB.prepare(`
            ALTER TABLE scheduled_publish_queue
            ADD COLUMN batch_id TEXT
        `).run();
    } catch (_) {
        // Ignore duplicate-column errors on existing databases.
    }

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_status_time
        ON scheduled_publish_queue (status, scheduled_time)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_batch_id
        ON scheduled_publish_queue (batch_id, status, scheduled_time)
    `).run();
}

function parseQueuePayload(raw: string): Record<string, any> {
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
}

async function processScheduledPublishQueue(env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureScheduledPublishQueueTable(env);
    const nowTs = Math.floor(Date.now() / 1000);
    const dueRows = await env.DB.prepare(`
        SELECT id, payload_json, scheduled_time, attempts
        FROM scheduled_publish_queue
        WHERE status = 'pending' AND scheduled_time <= ?
        ORDER BY scheduled_time ASC
        LIMIT 15
    `).bind(nowTs).all<ScheduledQueueJob>();

    const jobs = dueRows.results || [];
    if (jobs.length === 0) {
        return;
    }

    console.log('[scheduled] Processing queued publishes:', jobs.length);

    for (const job of jobs) {
        try {
            const claim = await env.DB.prepare(`
                UPDATE scheduled_publish_queue
                SET status = 'processing',
                    attempts = attempts + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
            `).bind(job.id).run();

            if (!Number(claim.meta?.changes || 0)) {
                continue;
            }

            const payload = parseQueuePayload(job.payload_json);
            const queueRoute = payload?.queueRoute === '/api/publish-reel'
                ? '/api/publish-reel'
                : '/api/publish';
            const publishReq = new Request(`https://internal${queueRoute}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    scheduledTime: null,
                    scheduleInSystem: false,
                    internalRun: true,
                }),
            });

            const publishRes = await app.fetch(publishReq, env, ctx);
            const publishData = await publishRes.json() as any;

            if (publishRes.ok && publishData?.success) {
                await env.DB.prepare(`
                    UPDATE scheduled_publish_queue
                    SET status = 'published',
                        post_id = ?,
                        facebook_url = ?,
                        error_message = NULL,
                        updated_at = CURRENT_TIMESTAMP,
                        processed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    String(publishData.postId || ''),
                    String(publishData.url || ''),
                    job.id
                ).run();
            } else {
                await env.DB.prepare(`
                    UPDATE scheduled_publish_queue
                    SET status = 'failed',
                        error_message = ?,
                        updated_at = CURRENT_TIMESTAMP,
                        processed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    String(publishData?.error || `HTTP ${publishRes.status}`),
                    job.id
                ).run();
            }
        } catch (error) {
            console.error('[scheduled] queued publish job failed:', { id: job.id, error });
            await env.DB.prepare(`
                UPDATE scheduled_publish_queue
                SET status = 'failed',
                    error_message = ?,
                    updated_at = CURRENT_TIMESTAMP,
                    processed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(
                error instanceof Error ? error.message : String(error),
                job.id
            ).run();
        }
    }
}

// CORS
app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', (c) => c.json({
    success: true,
    message: 'Pubilo API v5.3 - Cloudflare Workers',
    timestamp: new Date().toISOString(),
}));

app.get('/health', async (c) => {
    try {
        await c.env.DB.prepare('SELECT 1').run();
        return c.json({ success: true, database: 'connected' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Core API Routes
app.route('/api/pages', pagesRouter);
app.route('/api/page-settings', pageSettingsRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/prompts', promptsRouter);
app.route('/api/quotes', quotesRouter);
app.route('/api/global-settings', globalSettingsRouter);
app.route('/api/generate', generateRouter);
app.route('/api/publish', publishRouter);
app.route('/api/publish-reel', publishReelRouter);
app.route('/api/scheduled-posts', scheduledPostsRouter);
app.route('/api/delete-post', deletePostRouter);
app.route('/api/earnings', earningsRouter);
app.route('/api/auto-post-config', autoPostConfigRouter);
app.route('/api/auto-hide-config', autoHideConfigRouter);
app.route('/api/upload-image', uploadImageRouter);
app.route('/api/auto-post-logs', logsRouter);
app.route('/api/view-logs', logsRouter);
app.route('/api/logs', logsRouter);
app.route('/api/migrate', migrateRouter);

// Additional API Routes
app.route('/api/text-post', textPostRouter);
app.route('/api/update-post-time', updatePostTimeRouter);
app.route('/api/generate-news', generateNewsRouter);
app.route('/api/news-link', newsLinkRouter);
app.route('/api/check-pending-shares', checkPendingSharesRouter);
app.route('/api/check-risky-quotes', checkRiskyQuotesRouter);
app.route('/api/line-webhook', lineWebhookRouter);
app.route('/api/token-health', tokenHealthRouter);

// Cron Routes
app.route('/api/cron/auto-post', cronAutoPostRouter);
app.route('/api/cron/auto-hide', autoHideRouter);
app.route('/api/cron/earnings', cronEarningsRouter);
app.route('/api/cron/health-check', cronHealthCheckRouter);
app.route('/api/cron/cleanup-reels', cronCleanupReelsRouter);



// Scheduled handler for Cloudflare Cron Triggers
export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        const triggerTime = new Date(event.scheduledTime);
        const utcHour = triggerTime.getUTCHours();
        const utcMinute = triggerTime.getUTCMinutes();
        const cron = event.cron;
        console.log('[scheduled] Cron trigger fired at', triggerTime.toISOString(), 'cron:', cron);

        // Every minute: Run auto-post and auto-hide
        if (cron === '* * * * *') {
            console.log('[scheduled] Every minute - Processing scheduled publish queue');
            try {
                await processScheduledPublishQueue(env, ctx);
            } catch (err) {
                console.error('[scheduled] scheduled publish queue error:', err);
            }

            console.log('[scheduled] Every minute - Running auto-post');
            try {
                const autoPostReq = new Request('https://internal/api/cron/auto-post');
                const autoPostRes = await app.fetch(autoPostReq, env, ctx);
                const autoPostData = await autoPostRes.json();
                console.log('[scheduled] auto-post result:', autoPostData);
            } catch (err) {
                console.error('[scheduled] auto-post error:', err);
            }

            // Run auto-hide
            console.log('[scheduled] Every minute - Running auto-hide');
            try {
                const autoHideReq = new Request('https://internal/api/cron/auto-hide');
                const autoHideRes = await app.fetch(autoHideReq, env, ctx);
                const autoHideData = await autoHideRes.json();
                console.log('[scheduled] auto-hide result:', autoHideData);
            } catch (err) {
                console.error('[scheduled] auto-hide error:', err);
            }
        }

        // Every hour: Run health check (only alert if something is wrong)
        if (cron === '0 * * * *') {
            console.log('[scheduled] Every hour - Running health check');
            try {
                const healthReq = new Request('https://internal/api/cron/health-check');
                const healthRes = await app.fetch(healthReq, env, ctx);
                const healthData = await healthRes.json();
                console.log('[scheduled] health-check result:', healthData);
            } catch (err) {
                console.error('[scheduled] health-check error:', err);
            }

            console.log('[scheduled] Every hour - Cleaning up stale reel uploads');
            try {
                const cleanupReq = new Request('https://internal/api/cron/cleanup-reels');
                const cleanupRes = await app.fetch(cleanupReq, env, ctx);
                const cleanupData = await cleanupRes.json();
                console.log('[scheduled] cleanup-reels result:', cleanupData);
            } catch (err) {
                console.error('[scheduled] cleanup-reels error:', err);
            }
        }

        // 17:00 UTC = 00:00 Thailand - Fetch earnings only (no notification)
        if (utcHour === 17 && utcMinute === 0) {
            console.log('[scheduled] 00:00 TH - Fetching earnings (no notify)');
            try {
                const earningsReq = new Request('https://internal/api/cron/earnings?notify=false');
                const earningsRes = await app.fetch(earningsReq, env, ctx);
                const earningsData = await earningsRes.json();
                console.log('[scheduled] earnings fetch result:', earningsData);
            } catch (err) {
                console.error('[scheduled] earnings fetch error:', err);
            }
        }

        // 09:00 UTC = 16:00 Thailand - Fetch earnings and send notification
        if (utcHour === 9 && utcMinute === 0) {
            console.log('[scheduled] 16:00 TH - Fetching earnings WITH notification');
            try {
                const earningsReq = new Request('https://internal/api/cron/earnings?notify=true');
                const earningsRes = await app.fetch(earningsReq, env, ctx);
                const earningsData = await earningsRes.json();
                console.log('[scheduled] earnings notify result:', earningsData);
            } catch (err) {
                console.error('[scheduled] earnings notify error:', err);
            }
        }
    },
};
