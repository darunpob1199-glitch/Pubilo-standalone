import type { Env } from '../index';
import { decryptSecret } from './encryption';
import { encryptSecret } from './encryption';

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

function buildFacebookHeaders(cookieData?: string): Record<string, string> | undefined {
    const normalizedCookie = String(cookieData || '').trim();
    if (!normalizedCookie) return undefined;
    return {
        Cookie: normalizedCookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
}

async function getWorkspaceCookieCandidates(env: Env, organizationId: string): Promise<Array<Record<string, string>>> {
    try {
        const rows = await env.DB.prepare(`
            SELECT cookie_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
        `).bind(organizationId).all<{ cookie_encrypted?: string | null }>();

        const seen = new Set<string>();
        const headersList: Array<Record<string, string>> = [];
        for (const row of rows.results || []) {
            const cookie = String(await decryptSecret(env, row?.cookie_encrypted) || '').trim();
            if (!cookie || seen.has(cookie)) continue;
            const headers = buildFacebookHeaders(cookie);
            if (!headers) continue;
            seen.add(cookie);
            headersList.push(headers);
        }
        return headersList;
    } catch (error) {
        console.warn('[post-action-jobs] cookie candidates fetch failed:', error);
        return [];
    }
}

function isSessionOrTokenInvalidError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
        normalized.includes('error validating access token')
        || normalized.includes('session has been invalidated')
        || normalized.includes('oauthexception')
        || normalized.includes('invalid oauth')
        || normalized.includes('the access token')
    );
}

function isPostGoneOrInvalidIdError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
        (normalized.includes('invalid post id') && normalized.includes('code=100'))
        || (normalized.includes('unsupported get request') && normalized.includes('code=100'))
    );
}

async function fetchFreshPageToken(pageId: string, accessToken?: string, cookieData?: string): Promise<string> {
    const headers = buildFacebookHeaders(cookieData);
    if (accessToken) {
        try {
            const accountsRes = await fetch(
                `${FB_API}/me/accounts?access_token=${encodeURIComponent(accessToken)}&fields=id,access_token&limit=100`,
                headers ? { headers } : undefined,
            );
            const accountsData = await accountsRes.json() as any;
            const matchedPage = accountsData?.data?.find((page: any) => String(page.id) === String(pageId));
            if (matchedPage?.access_token) return String(matchedPage.access_token).trim();
        } catch (_) {
            // Continue to next fallback.
        }

        try {
            const tokenRes = await fetch(
                `${FB_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`,
                headers ? { headers } : undefined,
            );
            const tokenData = await tokenRes.json() as any;
            if (tokenData?.access_token) return String(tokenData.access_token).trim();
        } catch (_) {
            // Continue to next fallback.
        }
    }

    if (headers) {
        try {
            const cookieRes = await fetch(
                `${FB_API}/me/accounts?fields=id,access_token&limit=100`,
                { headers },
            );
            const cookieData2 = await cookieRes.json() as any;
            if (cookieData2?.data) {
                const matchedPage = cookieData2.data.find((page: any) => String(page.id) === String(pageId));
                if (matchedPage?.access_token) return String(matchedPage.access_token).trim();
            }
        } catch (_) {
            // Ignore and return empty.
        }
    }

    return '';
}

async function recoverActionTokenFromWorkspaceCredentials(
    env: Env,
    organizationId: string,
    pageId: string,
    action: PostActionType,
): Promise<string> {
    try {
        const rows = await env.DB.prepare(`
            SELECT ads_token_encrypted, cookie_encrypted
            FROM facebook_credentials
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT 5
        `).bind(organizationId).all<{ ads_token_encrypted?: string | null; cookie_encrypted?: string | null }>();

        for (const row of rows.results || []) {
            const accessToken = String(await decryptSecret(env, row?.ads_token_encrypted) || '').trim();
            const cookie = String(await decryptSecret(env, row?.cookie_encrypted) || '').trim();
            const freshToken = await fetchFreshPageToken(pageId, accessToken, cookie);
            if (!freshToken) continue;

            await env.DB.prepare(`
                INSERT INTO page_settings (organization_id, page_id, post_token_encrypted, hide_token_encrypted, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(organization_id, page_id) DO UPDATE SET
                    post_token_encrypted = COALESCE(excluded.post_token_encrypted, page_settings.post_token_encrypted),
                    hide_token_encrypted = COALESCE(excluded.hide_token_encrypted, page_settings.hide_token_encrypted),
                    updated_at = CURRENT_TIMESTAMP
            `).bind(
                organizationId,
                pageId,
                await encryptSecret(env, freshToken),
                action === 'hide' ? await encryptSecret(env, freshToken) : null,
            ).run();

            return freshToken;
        }
    } catch (error) {
        console.warn('[post-action-jobs] token recovery failed:', error);
    }

    return '';
}

async function graphDeleteWithToken(targetId: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const endpoint = `${FB_API}/${encodeURIComponent(targetId)}?access_token=${encodeURIComponent(token)}`;
    const response = await fetch(endpoint, { method: 'DELETE' });
    const data = await response.json() as any;
    if (response.ok && data?.success === true) {
        return { ok: true };
    }
    const code = data?.error?.code ? ` code=${data.error.code}` : '';
    const type = data?.error?.type ? ` type=${data.error.type}` : '';
    const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
    return {
        ok: false,
        error: String(data?.error?.message || data?.message || 'Graph delete failed') + code + type + subcode,
    };
}

async function graphHideWithToken(targetId: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const hideAttempts = [
        new URLSearchParams({ access_token: token, is_hidden: 'true' }),
        new URLSearchParams({ access_token: token, timeline_visibility: 'hidden' }),
        new URLSearchParams({ access_token: token, is_published: 'false' }),
        new URLSearchParams({ access_token: token, published: 'false' }),
    ];
    let lastError = '';
    for (const body of hideAttempts) {
        const response = await fetch(`${FB_API}/${encodeURIComponent(targetId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = await response.json() as any;
        if (response.ok && !data?.error) {
            return { ok: true };
        }
        const code = data?.error?.code ? ` code=${data.error.code}` : '';
        const type = data?.error?.type ? ` type=${data.error.type}` : '';
        const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
        lastError = String(data?.error?.message || data?.message || 'Graph hide failed') + code + type + subcode;
    }
    return { ok: false, error: lastError || 'Graph hide failed' };
}

async function graphDeleteWithCookie(
    targetId: string,
    headers: Record<string, string>,
    token?: string,
): Promise<{ ok: boolean; error?: string }> {
    const authToken = String(token || '').trim();
    const endpoint = authToken
        ? `${FB_API}/${encodeURIComponent(targetId)}?access_token=${encodeURIComponent(authToken)}`
        : `${FB_API}/${encodeURIComponent(targetId)}`;
    const response = await fetch(endpoint, { method: 'DELETE', headers });
    const data = await response.json() as any;
    if (response.ok && data?.success === true) {
        return { ok: true };
    }
    const code = data?.error?.code ? ` code=${data.error.code}` : '';
    const type = data?.error?.type ? ` type=${data.error.type}` : '';
    const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
    return {
        ok: false,
        error: String(data?.error?.message || data?.message || 'Graph delete (cookie) failed') + code + type + subcode,
    };
}

async function graphHideWithCookie(
    targetId: string,
    headers: Record<string, string>,
    token?: string,
): Promise<{ ok: boolean; error?: string }> {
    const authToken = String(token || '').trim();
    const hideAttempts = [
        new URLSearchParams({
            ...(authToken ? { access_token: authToken } : {}),
            is_hidden: 'true',
        }),
        new URLSearchParams({
            ...(authToken ? { access_token: authToken } : {}),
            timeline_visibility: 'hidden',
        }),
        new URLSearchParams({
            ...(authToken ? { access_token: authToken } : {}),
            is_published: 'false',
        }),
        new URLSearchParams({
            ...(authToken ? { access_token: authToken } : {}),
            published: 'false',
        }),
    ];
    let lastError = '';
    for (const body of hideAttempts) {
        const response = await fetch(`${FB_API}/${encodeURIComponent(targetId)}`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        const data = await response.json() as any;
        if (response.ok && !data?.error) {
            return { ok: true };
        }
        const code = data?.error?.code ? ` code=${data.error.code}` : '';
        const type = data?.error?.type ? ` type=${data.error.type}` : '';
        const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : '';
        lastError = String(data?.error?.message || data?.message || 'Graph hide (cookie) failed') + code + type + subcode;
    }
    return { ok: false, error: lastError || 'Graph hide (cookie) failed' };
}

async function resolveDeleteObjectCandidates(postId: string, token: string): Promise<string[]> {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (value?: string | null) => {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    const normalizedPostId = String(postId || '').trim();
    pushCandidate(normalizedPostId);
    if (normalizedPostId.includes('_')) {
        pushCandidate(normalizedPostId.split('_').pop() || '');
    }

    try {
        const fields = 'id,object_id,attachments{target{id},subattachments{target{id}}}';
        const response = await fetch(
            `${FB_API}/${encodeURIComponent(normalizedPostId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
        );
        const data = await response.json() as any;
        if (!data?.error) {
            pushCandidate(data?.object_id);
            pushCandidate(data?.attachments?.data?.[0]?.target?.id);
            const sub = Array.isArray(data?.attachments?.data?.[0]?.subattachments?.data)
                ? data.attachments.data[0].subattachments.data
                : [];
            sub.forEach((item: any) => pushCandidate(item?.target?.id));
        }
    } catch (_) {
        // Ignore lookup failures and keep existing candidates.
    }

    return candidates;
}

async function resolveTimelineHideTarget(
    postId: string,
    token: string,
    cookieHeadersCandidates: Array<Record<string, string>> = [],
): Promise<string> {
    const normalizedPostId = String(postId || '').trim();
    if (!normalizedPostId) return '';
    if (normalizedPostId.includes('_')) return normalizedPostId;

    const extractPostId = (payload: any): string => {
        const postIdValue = String(payload?.post_id || '').trim();
        if (postIdValue) return postIdValue;
        const idValue = String(payload?.id || '').trim();
        if (idValue.includes('_')) return idValue;
        return '';
    };

    try {
        const response = await fetch(
            `${FB_API}/${encodeURIComponent(normalizedPostId)}?fields=id,post_id&access_token=${encodeURIComponent(token)}`,
        );
        const data = await response.json() as any;
        const resolved = extractPostId(data);
        if (resolved) return resolved;
    } catch (_) {
        // Continue cookie lookup.
    }

    for (const headers of cookieHeadersCandidates) {
        try {
            const response = await fetch(
                `${FB_API}/${encodeURIComponent(normalizedPostId)}?fields=id,post_id`,
                { headers },
            );
            const data = await response.json() as any;
            const resolved = extractPostId(data);
            if (resolved) return resolved;
        } catch (_) {
            // Continue.
        }
    }

    return normalizedPostId;
}

async function runGraphAction(
    action: PostActionType,
    postId: string,
    token: string,
    cookieHeadersCandidates: Array<Record<string, string>> = [],
) {
    const normalizedPostId = String(postId || '').trim();
    if (!normalizedPostId) {
        throw new Error('Missing post id');
    }

    if (action === 'hide') {
        const hideTarget = await resolveTimelineHideTarget(normalizedPostId, token, cookieHeadersCandidates);
        const hideResult = await graphHideWithToken(hideTarget, token);
        if (hideResult.ok) return;
        let hideError = hideResult.error || '';
        for (const headers of cookieHeadersCandidates) {
            const cookieHide = await graphHideWithCookie(hideTarget, headers, token);
            if (cookieHide.ok) return;
            hideError = cookieHide.error || hideError;
        }
        throw new Error(hideError || 'Graph API hide failed');
    }

    const deleteCandidates = await resolveDeleteObjectCandidates(normalizedPostId, token);

    let lastError = '';
    for (const candidate of deleteCandidates) {
        const deleteResult = await graphDeleteWithToken(candidate, token);
        if (deleteResult.ok) return;
        lastError = deleteResult.error || lastError;
    }

    // Token fallback: if hard delete denied, attempt hide with token.
    const hideTarget = await resolveTimelineHideTarget(normalizedPostId, token, cookieHeadersCandidates);
    const hideFallback = await graphHideWithToken(hideTarget, token);
    if (hideFallback.ok) {
        return;
    }
    lastError = lastError || hideFallback.error || '';

    // Cookie fallback: try delete first, then hide.
    for (const headers of cookieHeadersCandidates) {
        for (const candidate of deleteCandidates) {
            const cookieDelete = await graphDeleteWithCookie(candidate, headers, token);
            if (cookieDelete.ok) return;
            lastError = cookieDelete.error || lastError;
        }

        const cookieHide = await graphHideWithCookie(hideTarget, headers, token);
        if (cookieHide.ok) return;
        lastError = cookieHide.error || lastError;
    }

    throw new Error(lastError || 'Graph API delete failed');
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
        const cookieHeadersCandidates = await getWorkspaceCookieCandidates(env, job.organization_id);
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

        let token = await resolvePageActionToken(env, job.organization_id, job.page_id, job.action);
        if (!token) {
            token = await recoverActionTokenFromWorkspaceCredentials(
                env,
                job.organization_id,
                job.page_id,
                job.action,
            );
        }
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
                await runGraphAction(job.action, item.post_id, token, cookieHeadersCandidates);
                await env.DB.prepare(`
                    UPDATE post_action_items
                    SET status = 'success',
                        error_message = NULL,
                        processed_at = ?
                    WHERE id = ?
                `).bind(nowSql(), item.id).run();
            } catch (error) {
                let message = error instanceof Error ? error.message : String(error);
                if (isPostGoneOrInvalidIdError(message)) {
                    // Treat already-removed/invalid IDs as success so bulk jobs don't fail whole batches.
                    await env.DB.prepare(`
                        UPDATE post_action_items
                        SET status = 'success',
                            error_message = NULL,
                            processed_at = ?
                        WHERE id = ?
                    `).bind(nowSql(), item.id).run();
                    continue;
                }
                if (isSessionOrTokenInvalidError(message)) {
                    const recoveredToken = await recoverActionTokenFromWorkspaceCredentials(
                        env,
                        job.organization_id,
                        job.page_id,
                        job.action,
                    );
                    if (recoveredToken) {
                        token = recoveredToken;
                        try {
                            await runGraphAction(job.action, item.post_id, token, cookieHeadersCandidates);
                            await env.DB.prepare(`
                                UPDATE post_action_items
                                SET status = 'success',
                                    error_message = NULL,
                                    processed_at = ?
                                WHERE id = ?
                            `).bind(nowSql(), item.id).run();
                            continue;
                        } catch (retryError) {
                            message = retryError instanceof Error ? retryError.message : String(retryError);
                            if (isPostGoneOrInvalidIdError(message)) {
                                await env.DB.prepare(`
                                    UPDATE post_action_items
                                    SET status = 'success',
                                        error_message = NULL,
                                        processed_at = ?
                                    WHERE id = ?
                                `).bind(nowSql(), item.id).run();
                                continue;
                            }
                        }
                    }
                }
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
