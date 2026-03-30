import type { Env } from '../index';
import { decryptSecret } from './encryption';

const FB_API = 'https://graph.facebook.com/v21.0';

export type PostActionType = 'hide' | 'delete';

export type PostActionJobInput = {
    organizationId: string;
    pageId: string;
    action: PostActionType;
    posts: Array<{
        id: string;
        messageText?: string | null;
        postType?: string | null;
        publishedAt?: string | null;
        facebookUrl?: string | null;
        mediaUrl?: string | null;
    }>;
    requestedFiltersJson?: string | null;
};

type PostActionJobRow = {
    id: number;
    organization_id: string;
    page_id: string;
    action: PostActionType;
    status: string;
};

type PostActionItemRow = {
    id: number;
    post_id: string;
};

function nowSql(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normalizePostType(value?: string | null): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'link';
    if (normalized.includes('reel') || normalized.includes('video')) return 'reels';
    if (normalized.includes('image') || normalized.includes('photo')) return 'image';
    if (normalized.includes('text')) return 'text';
    return 'link';
}

function normalizeMessage(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 2000) : null;
}

function normalizeUrl(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
}

async function runGraphAction(action: PostActionType, postId: string, token: string) {
    const endpoint = action === 'hide'
        ? `${FB_API}/${postId}?timeline_visibility=hidden&access_token=${encodeURIComponent(token)}`
        : `${FB_API}/${postId}?access_token=${encodeURIComponent(token)}`;

    const response = await fetch(endpoint, {
        method: action === 'hide' ? 'POST' : 'DELETE',
    });
    const data = await response.json() as any;

    if (!response.ok || data?.error || data?.success !== true) {
        throw new Error(String(data?.error?.message || data?.message || `Graph API ${action} failed`));
    }
}

export async function ensurePostActionTables(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS post_action_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id TEXT NOT NULL,
            action TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            total_count INTEGER NOT NULL DEFAULT 0,
            processed_count INTEGER NOT NULL DEFAULT 0,
            success_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            requested_filters_json TEXT,
            last_error TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            started_at TEXT,
            finished_at TEXT
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS post_action_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            post_id TEXT NOT NULL,
            post_message TEXT,
            post_type TEXT,
            post_created_at TEXT,
            post_permalink TEXT,
            post_picture_url TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            processed_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(job_id, post_id)
        )
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_post_action_jobs_page_action_created
        ON post_action_jobs (page_id, action, created_at DESC)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_post_action_jobs_status_created
        ON post_action_jobs (status, created_at ASC)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_post_action_items_job_status
        ON post_action_items (job_id, status, id ASC)
    `).run();
}

async function resolvePageActionToken(env: Env, organizationId: string, pageId: string, action: PostActionType): Promise<string> {
    const result = await env.DB.prepare(`
        SELECT post_token_encrypted, hide_token_encrypted
        FROM page_settings
        WHERE organization_id = ? AND page_id = ?
        LIMIT 1
    `).bind(organizationId, pageId).first<{ post_token_encrypted?: string | null; hide_token_encrypted?: string | null }>();

    if (action === 'hide') {
        return String(
            (await decryptSecret(env, result?.hide_token_encrypted))
            || (await decryptSecret(env, result?.post_token_encrypted))
            || ''
        ).trim();
    }

    return String(await decryptSecret(env, result?.post_token_encrypted) || '').trim();
}

async function refreshPostActionJobStats(env: Env, jobId: number): Promise<void> {
    const counts = await env.DB.prepare(`
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS processed_count,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
        FROM post_action_items
        WHERE job_id = ?
    `).bind(jobId).first<{
        total_count?: number;
        processed_count?: number;
        success_count?: number;
        failed_count?: number;
        pending_count?: number;
    }>();

    const totalCount = Number(counts?.total_count || 0);
    const processedCount = Number(counts?.processed_count || 0);
    const successCount = Number(counts?.success_count || 0);
    const failedCount = Number(counts?.failed_count || 0);
    const pendingCount = Number(counts?.pending_count || 0);

    const currentJob = await env.DB.prepare(`
        SELECT status
        FROM post_action_jobs
        WHERE id = ?
        LIMIT 1
    `).bind(jobId).first<{ status?: string | null }>();

    const currentStatus = String(currentJob?.status || '').trim();
    const nextStatus = currentStatus === 'cancelled'
        ? 'cancelled'
        : pendingCount > 0
            ? 'processing'
            : (failedCount > 0 && successCount === 0 ? 'failed' : 'completed');

    await env.DB.prepare(`
        UPDATE post_action_jobs
        SET status = ?,
            total_count = ?,
            processed_count = ?,
            success_count = ?,
            failed_count = ?,
            updated_at = CURRENT_TIMESTAMP,
            finished_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = ?
    `).bind(
        nextStatus,
        totalCount,
        processedCount,
        successCount,
        failedCount,
        pendingCount,
        jobId,
    ).run();
}

export async function createPostActionJob(env: Env, input: PostActionJobInput) {
    await ensurePostActionTables(env);

    const pageId = String(input.pageId || '').trim();
    const action = input.action;
    const posts = Array.isArray(input.posts) ? input.posts : [];

    if (!pageId || !posts.length) {
        throw new Error('Missing pageId or posts');
    }

    const jobResult = await env.DB.prepare(`
        INSERT INTO post_action_jobs (
            organization_id,
            page_id,
            action,
            total_count,
            requested_filters_json,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
        input.organizationId,
        pageId,
        action,
        posts.length,
        input.requestedFiltersJson || null,
    ).run();

    const jobId = Number(jobResult.meta?.last_row_id || 0);
    if (!jobId) {
        throw new Error('Failed to create post action job');
    }

    for (const post of posts) {
        const postId = String(post.id || '').trim();
        if (!postId) continue;

        await env.DB.prepare(`
            INSERT OR IGNORE INTO post_action_items (
                job_id,
                post_id,
                post_message,
                post_type,
                post_created_at,
                post_permalink,
                post_picture_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
            jobId,
            postId,
            normalizeMessage(post.messageText),
            normalizePostType(post.postType),
            String(post.publishedAt || '').trim() || null,
            normalizeUrl(post.facebookUrl),
            normalizeUrl(post.mediaUrl),
        ).run();
    }

    await refreshPostActionJobStats(env, jobId);
    return jobId;
}

export async function listPostActionJobs(env: Env, params: {
    organizationId: string;
    pageId?: string;
    action?: PostActionType | '';
    limit?: number;
}) {
    await ensurePostActionTables(env);

    const pageId = String(params.pageId || '').trim();
    const action = String(params.action || '').trim();
    const limit = Math.min(Number(params.limit || 20) || 20, 100);

    const rows = await env.DB.prepare(`
        SELECT
            id,
            organization_id,
            page_id,
            action,
            status,
            total_count,
            processed_count,
            success_count,
            failed_count,
            requested_filters_json,
            last_error,
            created_at,
            updated_at,
            started_at,
            finished_at
        FROM post_action_jobs
        WHERE organization_id = ?
          AND (? = '' OR page_id = ?)
          AND (? = '' OR action = ?)
        ORDER BY id DESC
        LIMIT ?
    `).bind(params.organizationId, pageId, pageId, action, action, limit).all<Record<string, any>>();

    return rows.results || [];
}

export async function getPostActionJobDetail(env: Env, organizationId: string, jobId: number) {
    await ensurePostActionTables(env);

    const job = await env.DB.prepare(`
        SELECT
            id,
            organization_id,
            page_id,
            action,
            status,
            total_count,
            processed_count,
            success_count,
            failed_count,
            requested_filters_json,
            last_error,
            created_at,
            updated_at,
            started_at,
            finished_at
        FROM post_action_jobs
        WHERE organization_id = ? AND id = ?
        LIMIT 1
    `).bind(organizationId, jobId).first<Record<string, any>>();

    if (!job?.id) {
        throw new Error('Job not found');
    }

    const itemsResult = await env.DB.prepare(`
        SELECT
            id,
            post_id,
            post_message,
            post_type,
            post_created_at,
            post_permalink,
            post_picture_url,
            status,
            error_message,
            processed_at,
            created_at
        FROM post_action_items
        WHERE job_id = ?
        ORDER BY
            CASE status
                WHEN 'failed' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'success' THEN 2
                ELSE 3
            END,
            id ASC
    `).bind(jobId).all<Record<string, any>>();

    return {
        job: {
            ...job,
            requested_filters: (() => {
                try {
                    return job.requested_filters_json ? JSON.parse(String(job.requested_filters_json)) : null;
                } catch {
                    return null;
                }
            })(),
        },
        items: itemsResult.results || [],
    };
}

export async function cancelPostActionJob(env: Env, organizationId: string, jobId: number) {
    await ensurePostActionTables(env);

    await env.DB.prepare(`
        UPDATE post_action_jobs
        SET status = 'cancelled',
            updated_at = CURRENT_TIMESTAMP,
            finished_at = CURRENT_TIMESTAMP
        WHERE organization_id = ? AND id = ? AND status IN ('pending', 'processing')
    `).bind(organizationId, jobId).run();

    await env.DB.prepare(`
        UPDATE post_action_items
        SET status = 'failed',
            error_message = 'Cancelled by user',
            processed_at = CURRENT_TIMESTAMP
        WHERE job_id = ? AND status = 'pending'
    `).bind(jobId).run();

    await refreshPostActionJobStats(env, jobId);
}

export async function retryFailedPostActionJob(env: Env, organizationId: string, jobId: number, itemIds?: number[]) {
    await ensurePostActionTables(env);

    const job = await env.DB.prepare(`
        SELECT id, status, failed_count
        FROM post_action_jobs
        WHERE organization_id = ? AND id = ?
        LIMIT 1
    `).bind(organizationId, jobId).first<{ id?: number; status?: string | null; failed_count?: number | null }>();

    if (!job?.id) {
        throw new Error('Job not found');
    }

    const status = String(job.status || '').trim();
    if (status === 'pending' || status === 'processing') {
        throw new Error('Job is already running');
    }

    const failedCount = Number(job.failed_count || 0);
    if (failedCount <= 0) {
        throw new Error('No failed items to retry');
    }

    const targetItemIds = Array.isArray(itemIds)
        ? itemIds.filter((id) => Number.isFinite(id) && id > 0)
        : [];

    if (targetItemIds.length > 0) {
        const placeholders = targetItemIds.map(() => '?').join(', ');
        const availableFailed = await env.DB.prepare(`
            SELECT id
            FROM post_action_items
            WHERE job_id = ?
              AND status = 'failed'
              AND id IN (${placeholders})
        `).bind(jobId, ...targetItemIds).all<{ id: number }>();

        const matchedIds = (availableFailed.results || []).map((row) => Number(row.id)).filter((id) => id > 0);
        if (!matchedIds.length) {
            throw new Error('No matching failed items to retry');
        }

        const matchedPlaceholders = matchedIds.map(() => '?').join(', ');
        await env.DB.prepare(`
            UPDATE post_action_items
            SET status = 'pending',
                error_message = NULL,
                processed_at = NULL
            WHERE job_id = ?
              AND id IN (${matchedPlaceholders})
        `).bind(jobId, ...matchedIds).run();
    } else {
        await env.DB.prepare(`
            UPDATE post_action_items
            SET status = 'pending',
                error_message = NULL,
                processed_at = NULL
            WHERE job_id = ? AND status = 'failed'
        `).bind(jobId).run();
    }

    await env.DB.prepare(`
        UPDATE post_action_jobs
        SET status = 'pending',
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP,
            finished_at = NULL
        WHERE id = ?
    `).bind(jobId).run();

    await refreshPostActionJobStats(env, jobId);
}

export async function processPendingPostActionJobs(env: Env, options?: {
    jobIds?: number[];
    perJobLimit?: number;
    maxJobs?: number;
}) {
    await ensurePostActionTables(env);

    const targetJobIds = Array.isArray(options?.jobIds)
        ? options!.jobIds.filter((id) => Number.isFinite(id) && id > 0)
        : [];
    const perJobLimit = Math.min(Number(options?.perJobLimit || 15) || 15, 50);
    const maxJobs = Math.min(Number(options?.maxJobs || 3) || 3, 10);

    const jobsQuery = targetJobIds.length > 0
        ? `
            SELECT id, organization_id, page_id, action, status
            FROM post_action_jobs
            WHERE id IN (${targetJobIds.map(() => '?').join(', ')})
              AND status IN ('pending', 'processing')
            ORDER BY id ASC
        `
        : `
            SELECT id, organization_id, page_id, action, status
            FROM post_action_jobs
            WHERE status IN ('pending', 'processing')
            ORDER BY id ASC
            LIMIT ?
        `;

    const jobRows = targetJobIds.length > 0
        ? await env.DB.prepare(jobsQuery).bind(...targetJobIds).all<PostActionJobRow>()
        : await env.DB.prepare(jobsQuery).bind(maxJobs).all<PostActionJobRow>();

    for (const job of jobRows.results || []) {
        if (job.status === 'pending') {
            const claim = await env.DB.prepare(`
                UPDATE post_action_jobs
                SET status = 'processing',
                    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
            `).bind(job.id).run();

            if (!Number(claim.meta?.changes || 0)) {
                continue;
            }
        }

        const token = await resolvePageActionToken(env, job.organization_id, job.page_id, job.action);
        if (!token) {
            await env.DB.prepare(`
                UPDATE post_action_items
                SET status = 'failed',
                    error_message = ?,
                    processed_at = CURRENT_TIMESTAMP
                WHERE job_id = ? AND status = 'pending'
            `).bind(
                job.action === 'hide'
                    ? 'Missing hide token for this page'
                    : 'Missing post token for this page',
                job.id,
            ).run();
            await env.DB.prepare(`
                UPDATE post_action_jobs
                SET last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(
                job.action === 'hide'
                    ? 'Missing hide token for this page'
                    : 'Missing post token for this page',
                job.id,
            ).run();
            await refreshPostActionJobStats(env, job.id);
            continue;
        }

        const itemRows = await env.DB.prepare(`
            SELECT id, post_id
            FROM post_action_items
            WHERE job_id = ? AND status = 'pending'
            ORDER BY id ASC
            LIMIT ?
        `).bind(job.id, perJobLimit).all<PostActionItemRow>();

        for (const item of itemRows.results || []) {
            try {
                await runGraphAction(job.action, item.post_id, token);
                await env.DB.prepare(`
                    UPDATE post_action_items
                    SET status = 'success',
                        error_message = NULL,
                        processed_at = ?
                    WHERE id = ?
                `).bind(nowSql(), item.id).run();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await env.DB.prepare(`
                    UPDATE post_action_items
                    SET status = 'failed',
                        error_message = ?,
                        processed_at = ?
                    WHERE id = ?
                `).bind(message, nowSql(), item.id).run();
                await env.DB.prepare(`
                    UPDATE post_action_jobs
                    SET last_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(message, job.id).run();
            }
        }

        await refreshPostActionJobStats(env, job.id);
    }
}
