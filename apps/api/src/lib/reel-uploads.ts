import type { Env } from '../index';

export type ReelUploadCleanupResult = {
    scanned: number;
    deletedObjects: number;
    missingObjects: number;
    updatedRows: number;
};

export async function ensureReelUploadsTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS reel_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_key TEXT NOT NULL UNIQUE,
            page_id TEXT NOT NULL,
            file_name TEXT,
            mime_type TEXT,
            file_size INTEGER,
            upload_source TEXT,
            status TEXT NOT NULL DEFAULT 'staged',
            post_id TEXT,
            video_id TEXT,
            facebook_url TEXT,
            comment_id TEXT,
            comment_target_id TEXT,
            warning_message TEXT,
            error_message TEXT,
            delete_error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            published_at TEXT,
            deleted_at TEXT
        )
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_reel_uploads_status_updated
        ON reel_uploads (status, updated_at)
    `).run();
}

export async function upsertReelUploadStage(env: Env, params: {
    videoKey: string;
    pageId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    uploadSource: string;
}) {
    await ensureReelUploadsTable(env);
    await env.DB.prepare(`
        INSERT INTO reel_uploads (
            video_key, page_id, file_name, mime_type, file_size, upload_source, status,
            error_message, delete_error_message, warning_message, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'staged', NULL, NULL, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(video_key) DO UPDATE SET
            page_id = excluded.page_id,
            file_name = excluded.file_name,
            mime_type = excluded.mime_type,
            file_size = excluded.file_size,
            upload_source = excluded.upload_source,
            status = 'staged',
            error_message = NULL,
            delete_error_message = NULL,
            warning_message = NULL,
            updated_at = CURRENT_TIMESTAMP
    `).bind(
        params.videoKey,
        params.pageId,
        params.fileName,
        params.mimeType,
        params.fileSize,
        params.uploadSource,
    ).run();
}

export async function markReelUploadPublishing(env: Env, videoKey: string) {
    await ensureReelUploadsTable(env);
    await env.DB.prepare(`
        UPDATE reel_uploads
        SET status = 'publishing',
            error_message = NULL,
            warning_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE video_key = ?
    `).bind(videoKey).run();
}

export async function markReelUploadFailed(env: Env, params: {
    videoKey: string;
    errorMessage: string;
}) {
    await ensureReelUploadsTable(env);
    await env.DB.prepare(`
        UPDATE reel_uploads
        SET status = 'failed',
            error_message = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE video_key = ?
    `).bind(
        params.errorMessage,
        params.videoKey,
    ).run();
}

export async function markReelUploadCompleted(env: Env, params: {
    videoKey: string;
    postId?: string;
    videoId?: string;
    facebookUrl?: string;
    commentId?: string;
    commentTargetId?: string;
    warningMessage?: string | null;
    deleted: boolean;
    deleteErrorMessage?: string | null;
}) {
    await ensureReelUploadsTable(env);
    await env.DB.prepare(`
        UPDATE reel_uploads
        SET status = ?,
            post_id = ?,
            video_id = ?,
            facebook_url = ?,
            comment_id = ?,
            comment_target_id = ?,
            warning_message = ?,
            error_message = NULL,
            delete_error_message = ?,
            published_at = CURRENT_TIMESTAMP,
            deleted_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE video_key = ?
    `).bind(
        params.deleted ? 'deleted' : 'published',
        params.postId || null,
        params.videoId || null,
        params.facebookUrl || null,
        params.commentId || null,
        params.commentTargetId || null,
        params.warningMessage || null,
        params.deleteErrorMessage || null,
        params.deleted ? 1 : 0,
        params.videoKey,
    ).run();
}

export async function cleanupStaleReelUploads(env: Env, maxAgeHours = 48, limit = 50): Promise<ReelUploadCleanupResult> {
    await ensureReelUploadsTable(env);

    const rows = await env.DB.prepare(`
        SELECT video_key
        FROM reel_uploads
        WHERE status IN ('staged', 'publishing', 'failed')
          AND updated_at <= datetime('now', ?)
        ORDER BY updated_at ASC
        LIMIT ?
    `).bind(`-${maxAgeHours} hours`, limit).all<{ video_key: string }>();

    let deletedObjects = 0;
    let missingObjects = 0;
    let updatedRows = 0;

    for (const row of rows.results || []) {
        const videoKey = String(row.video_key || '').trim();
        if (!videoKey) continue;

        try {
            const object = await env.IMAGES.get(videoKey);
            if (object) {
                await env.IMAGES.delete(videoKey);
                deletedObjects += 1;
            } else {
                missingObjects += 1;
            }

            await env.DB.prepare(`
                UPDATE reel_uploads
                SET status = 'deleted',
                    delete_error_message = NULL,
                    warning_message = 'Cleanup deleted stale staged reel upload',
                    deleted_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE video_key = ?
            `).bind(videoKey).run();
            updatedRows += 1;
        } catch (error) {
            await env.DB.prepare(`
                UPDATE reel_uploads
                SET delete_error_message = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE video_key = ?
            `).bind(
                error instanceof Error ? error.message : String(error),
                videoKey,
            ).run();
        }
    }

    return {
        scanned: rows.results?.length || 0,
        deletedObjects,
        missingObjects,
        updatedRows,
    };
}
