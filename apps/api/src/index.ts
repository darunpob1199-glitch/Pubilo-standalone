import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
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
import { uploadImageRouter } from './routes/upload-image';
import { logsRouter } from './routes/logs';
import { publishedPostsRouter } from './routes/published-posts';
import { postActionJobsRouter } from './routes/post-action-jobs';
import { migrateRouter } from './routes/migrate';
import { processPendingPostActionJobs } from './lib/post-action-jobs';
// Cron routes
import { cronEarningsRouter } from './routes/cron-earnings';
import { cronHealthCheckRouter } from './routes/cron-health-check';
import { cronCleanupReelsRouter } from './routes/cron-cleanup-reels';
import { cronReconcilePaymentsRouter } from './routes/cron-reconcile-payments';
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
import { authRouter } from './routes/auth';
import { billingRouter } from './routes/billing';
import { adminRouter } from './routes/admin';
import { ensureAppSchema } from './lib/schema';
import { requireAuth } from './middleware/require-auth';
import { requireWorkspace } from './middleware/require-workspace';
import { requireInternal } from './middleware/require-internal';
import { requireActiveSubscription } from './middleware/require-subscription';

const app = new Hono<{ Bindings: Env }>();
export type { Env } from './types';

type ScheduledQueueJob = {
    id: number;
    organization_id: string;
    payload_json: string;
    scheduled_time: number;
    attempts: number;
};

function parseQueuePayload(raw: string): Record<string, any> {
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
}

async function processScheduledPublishQueue(env: Env, ctx: ExecutionContext): Promise<void> {
    const nowTs = Math.floor(Date.now() / 1000);
    const dueRows = await env.DB.prepare(`
        SELECT id, organization_id, payload_json, scheduled_time, attempts
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
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-secret': env.INTERNAL_API_SECRET || '',
                    'x-workspace-id': job.organization_id,
                },
                body: JSON.stringify({
                    ...payload,
                    organizationId: job.organization_id,
                    scheduledTime: null,
                    scheduleInSystem: false,
                    internalRun: true,
                    historyExternalKey: `scheduled-queue:${job.id}`,
                    historySource: 'scheduled_queue',
                    historySourceRef: String(job.id),
                    historyQueueJobId: job.id,
                    historyScheduledTime: job.scheduled_time,
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

function isAllowedOrigin(origin: string, env: Env): boolean {
    const normalized = origin.trim().replace(/\/+$/, '');
    const explicitOrigins = [
        env.APP_ORIGIN,
        'http://localhost:3000',
        'http://localhost:4173',
        'http://localhost:8788',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:4173',
    ].filter(Boolean).map((value) => String(value).replace(/\/+$/, ''));

    if (explicitOrigins.includes(normalized)) return true;

    try {
        const hostname = new URL(normalized).hostname;
        return hostname.endsWith('.pages.dev') || hostname.endsWith('.pubilo.com');
    } catch {
        return false;
    }
}

app.use('*', cors({
    origin: (origin, c) => {
        if (!origin) return c.env.APP_ORIGIN || origin || '*';
        return isAllowedOrigin(origin, c.env) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-internal-secret'],
    credentials: true,
}));

let schemaWarmupPromise: Promise<void> | null = null;

function ensureSchemaInBackground(c: Context<{ Bindings: Env }>) {
    if (!schemaWarmupPromise) {
        schemaWarmupPromise = ensureAppSchema(c.env).catch((error) => {
            console.error('[schema] background warmup failed:', error);
            schemaWarmupPromise = null;
            throw error;
        });
    }

    c.executionCtx.waitUntil(schemaWarmupPromise.catch(() => undefined));
}

app.use('*', async (c, next) => {
    // Do not block requests on schema bootstrap; run in background to prevent
    // auth/login endpoints from hanging when migrations are slow.
    ensureSchemaInBackground(c);
    await next();
});

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

// Billing routes: auth + workspace only (ให้จ่ายเงินได้แม้ subscription หมดอายุ)
const billingOnlyPaths = [
    '/api/billing/current',
    '/api/billing/checkout-intent',
    '/api/billing/create-payment',
    '/api/billing/payment-status',
    '/api/billing/cancel-payment',
    '/api/billing/cancel',
    '/api/billing/check-status',
];

for (const path of billingOnlyPaths) {
    app.use(path, requireAuth, requireWorkspace);
    app.use(`${path}/*`, requireAuth, requireWorkspace);
}

// All other routes: auth + workspace + active subscription
const subscriptionProtectedPaths = [
    '/api/pages',
    '/api/page-settings',
    '/api/tokens',
    '/api/prompts',
    '/api/quotes',
    '/api/global-settings',
    '/api/generate',
    '/api/publish',
    '/api/publish-reel',
    '/api/scheduled-posts',
    '/api/delete-post',
    '/api/earnings',
    '/api/upload-image',
    '/api/auto-post-logs',
    '/api/view-logs',
    '/api/logs',
    '/api/published-posts',
    '/api/post-action-jobs',
    '/api/text-post',
    '/api/update-post-time',
    '/api/generate-news',
    '/api/check-pending-shares',
    '/api/check-risky-quotes',
    '/api/token-health',
];

for (const path of subscriptionProtectedPaths) {
    app.use(path, requireAuth, requireWorkspace, requireActiveSubscription);
    app.use(`${path}/*`, requireAuth, requireWorkspace, requireActiveSubscription);
}

app.use('/api/line-webhook', requireInternal);
app.use('/api/line-webhook/*', requireInternal);
app.use('/api/migrate', requireInternal);
app.use('/api/migrate/*', requireInternal);
app.use('/api/cron/*', requireInternal);

app.route('/api/auth', authRouter);
app.route('/api/billing', billingRouter);

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
app.route('/api/upload-image', uploadImageRouter);
app.route('/api/auto-post-logs', logsRouter);
app.route('/api/view-logs', logsRouter);
app.route('/api/logs', logsRouter);
app.route('/api/published-posts', publishedPostsRouter);
app.route('/api/post-action-jobs', postActionJobsRouter);
app.route('/api/migrate', migrateRouter);
app.route('/api/text-post', textPostRouter);
app.route('/api/update-post-time', updatePostTimeRouter);
app.route('/api/generate-news', generateNewsRouter);
app.route('/api/news-link', newsLinkRouter);
app.route('/api/check-pending-shares', checkPendingSharesRouter);
app.route('/api/check-risky-quotes', checkRiskyQuotesRouter);
app.route('/api/line-webhook', lineWebhookRouter);
app.route('/api/token-health', tokenHealthRouter);

app.route('/api/cron/earnings', cronEarningsRouter);
app.route('/api/cron/health-check', cronHealthCheckRouter);
app.route('/api/cron/cleanup-reels', cronCleanupReelsRouter);
app.route('/api/cron/reconcile-payments', cronReconcilePaymentsRouter);

// Admin dashboard routes
app.route('/api/admin', adminRouter);



// Scheduled handler for Cloudflare Cron Triggers
export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        await ensureAppSchema(env);
        const triggerTime = new Date(event.scheduledTime);
        const utcHour = triggerTime.getUTCHours();
        const utcMinute = triggerTime.getUTCMinutes();
        const cron = event.cron;
        console.log('[scheduled] Cron trigger fired at', triggerTime.toISOString(), 'cron:', cron);
        const internalHeaders = { 'x-internal-secret': env.INTERNAL_API_SECRET || '' };

        // Every minute: Run scheduled publish queue and post action jobs
        if (cron === '* * * * *') {
            console.log('[scheduled] Every minute - Processing scheduled publish queue');
            try {
                await processScheduledPublishQueue(env, ctx);
            } catch (err) {
                console.error('[scheduled] scheduled publish queue error:', err);
            }

            console.log('[scheduled] Every minute - Processing post action jobs');
            try {
                await processPendingPostActionJobs(env, { perJobLimit: 20, maxJobs: 3 });
            } catch (err) {
                console.error('[scheduled] post action jobs error:', err);
            }

            console.log('[scheduled] Every minute - Reconciling pending payment orders');
            try {
                const reconcileReq = new Request('https://internal/api/cron/reconcile-payments?limit=20', { headers: internalHeaders });
                const reconcileRes = await app.fetch(reconcileReq, env, ctx);
                const reconcileData = await reconcileRes.json();
                console.log('[scheduled] reconcile-payments result:', reconcileData);
            } catch (err) {
                console.error('[scheduled] reconcile-payments error:', err);
            }
        }

        // Every hour: clean up stale reel uploads
        if (cron === '0 * * * *') {
            console.log('[scheduled] Every hour - Cleaning up stale reel uploads');
            try {
                const cleanupReq = new Request('https://internal/api/cron/cleanup-reels', { headers: internalHeaders });
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
                const earningsReq = new Request('https://internal/api/cron/earnings?notify=false', { headers: internalHeaders });
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
                const earningsReq = new Request('https://internal/api/cron/earnings?notify=true', { headers: internalHeaders });
                const earningsRes = await app.fetch(earningsReq, env, ctx);
                const earningsData = await earningsRes.json();
                console.log('[scheduled] earnings notify result:', earningsData);
            } catch (err) {
                console.error('[scheduled] earnings notify error:', err);
            }
        }
    },
};
