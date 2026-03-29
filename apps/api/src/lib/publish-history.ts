import type { Env } from '../index';

export type PublishHistoryInput = {
    externalKey: string;
    pageId: string;
    source: 'publish' | 'scheduled_queue' | 'reel' | 'auto_post';
    sourceRef?: string | null;
    batchId?: string | null;
    queueJobId?: number | null;
    postType?: string | null;
    messageText?: string | null;
    mediaKind?: string | null;
    mediaUrl?: string | null;
    mediaThumbUrl?: string | null;
    facebookPostId?: string | null;
    facebookUrl?: string | null;
    scheduledTime?: number | null;
    publishedAt?: string | null;
    warningMessage?: string | null;
    extraJson?: string | null;
};

function normalizeText(value?: string | null, maxLength = 2000): string | null {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

function normalizeUrl(value?: string | null): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizePostType(value?: string | null): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('reel') || normalized.includes('video')) return 'reels';
    if (normalized.includes('image') || normalized.includes('photo')) return 'image';
    if (normalized.includes('text')) return 'text';
    if (normalized.includes('link') || normalized.includes('news')) return 'link';
    return normalized;
}

async function hasTable(env: Env, tableName: string): Promise<boolean> {
    const result = await env.DB.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
    `).bind(tableName).first<{ name: string }>();

    return !!result?.name;
}

export async function ensurePublishHistoryTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS publish_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            external_key TEXT NOT NULL UNIQUE,
            page_id TEXT NOT NULL,
            source TEXT NOT NULL,
            source_ref TEXT,
            batch_id TEXT,
            queue_job_id INTEGER,
            post_type TEXT,
            message_text TEXT,
            media_kind TEXT,
            media_url TEXT,
            media_thumb_url TEXT,
            facebook_post_id TEXT,
            facebook_url TEXT,
            scheduled_time INTEGER,
            published_at TEXT,
            warning_message TEXT,
            extra_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_publish_history_page_published
        ON publish_history (page_id, published_at DESC)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_publish_history_source_ref
        ON publish_history (source, source_ref)
    `).run();
}

export async function recordPublishHistory(env: Env, input: PublishHistoryInput): Promise<void> {
    const externalKey = String(input.externalKey || '').trim();
    const pageId = String(input.pageId || '').trim();

    if (!externalKey || !pageId) {
        return;
    }

    await ensurePublishHistoryTable(env);

    const publishedAt = normalizeText(input.publishedAt, 64) || new Date().toISOString().replace('T', ' ').slice(0, 19);
    const postType = normalizePostType(input.postType);
    const mediaKind = normalizePostType(input.mediaKind || input.postType);

    await env.DB.prepare(`
        INSERT INTO publish_history (
            external_key,
            page_id,
            source,
            source_ref,
            batch_id,
            queue_job_id,
            post_type,
            message_text,
            media_kind,
            media_url,
            media_thumb_url,
            facebook_post_id,
            facebook_url,
            scheduled_time,
            published_at,
            warning_message,
            extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(external_key) DO UPDATE SET
            page_id = excluded.page_id,
            source = excluded.source,
            source_ref = excluded.source_ref,
            batch_id = excluded.batch_id,
            queue_job_id = excluded.queue_job_id,
            post_type = excluded.post_type,
            message_text = excluded.message_text,
            media_kind = excluded.media_kind,
            media_url = excluded.media_url,
            media_thumb_url = excluded.media_thumb_url,
            facebook_post_id = excluded.facebook_post_id,
            facebook_url = excluded.facebook_url,
            scheduled_time = excluded.scheduled_time,
            published_at = excluded.published_at,
            warning_message = excluded.warning_message,
            extra_json = excluded.extra_json
    `).bind(
        externalKey,
        pageId,
        input.source,
        normalizeText(input.sourceRef, 255),
        normalizeText(input.batchId, 255),
        typeof input.queueJobId === 'number' ? input.queueJobId : null,
        postType,
        normalizeText(input.messageText),
        mediaKind,
        normalizeUrl(input.mediaUrl),
        normalizeUrl(input.mediaThumbUrl),
        normalizeText(input.facebookPostId, 255),
        normalizeUrl(input.facebookUrl),
        typeof input.scheduledTime === 'number' ? input.scheduledTime : null,
        publishedAt,
        normalizeText(input.warningMessage),
        normalizeText(input.extraJson, 16000),
    ).run();
}

export async function backfillLegacyPublishHistory(env: Env): Promise<void> {
    await ensurePublishHistoryTable(env);

    if (await hasTable(env, 'auto_post_logs')) {
        await env.DB.prepare(`
            INSERT OR IGNORE INTO publish_history (
                external_key,
                page_id,
                source,
                source_ref,
                post_type,
                message_text,
                media_kind,
                facebook_post_id,
                facebook_url,
                published_at,
                created_at
            )
            SELECT
                'auto-post-log:' || apl.id,
                apl.page_id,
                'auto_post',
                CAST(apl.id AS TEXT),
                CASE
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%reel%' THEN 'reels'
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%image%' THEN 'image'
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%text%' THEN 'text'
                    ELSE 'link'
                END,
                apl.quote_text,
                CASE
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%reel%' THEN 'reels'
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%image%' THEN 'image'
                    WHEN LOWER(COALESCE(apl.post_type, '')) LIKE '%text%' THEN 'text'
                    ELSE 'link'
                END,
                apl.facebook_post_id,
                CASE
                    WHEN COALESCE(apl.facebook_post_id, '') != '' THEN 'https://www.facebook.com/' || apl.facebook_post_id
                    ELSE NULL
                END,
                apl.created_at,
                apl.created_at
            FROM auto_post_logs apl
            WHERE apl.status = 'success'
        `).run();
    }

    if (await hasTable(env, 'scheduled_publish_queue')) {
        await env.DB.prepare(`
            INSERT OR IGNORE INTO publish_history (
                external_key,
                page_id,
                source,
                source_ref,
                batch_id,
                queue_job_id,
                post_type,
                message_text,
                media_kind,
                media_url,
                facebook_post_id,
                facebook_url,
                scheduled_time,
                published_at,
                extra_json,
                created_at
            )
            SELECT
                'scheduled-queue:' || q.id,
                q.page_id,
                'scheduled_queue',
                CAST(q.id AS TEXT),
                q.batch_id,
                q.id,
                CASE
                    WHEN json_extract(q.payload_json, '$.queueRoute') = '/api/publish-reel' THEN 'reels'
                    WHEN LOWER(COALESCE(json_extract(q.payload_json, '$.postMode'), '')) LIKE '%reel%' THEN 'reels'
                    WHEN COALESCE(json_extract(q.payload_json, '$.imageUrl'), '') != '' THEN 'image'
                    WHEN COALESCE(json_extract(q.payload_json, '$.link'), '') != '' OR COALESCE(json_extract(q.payload_json, '$.linkUrl'), '') != '' THEN 'link'
                    WHEN COALESCE(json_extract(q.payload_json, '$.message'), '') != '' OR COALESCE(json_extract(q.payload_json, '$.primaryText'), '') != '' THEN 'text'
                    ELSE 'link'
                END,
                COALESCE(
                    json_extract(q.payload_json, '$.message'),
                    json_extract(q.payload_json, '$.primaryText'),
                    json_extract(q.payload_json, '$.caption'),
                    ''
                ),
                CASE
                    WHEN json_extract(q.payload_json, '$.queueRoute') = '/api/publish-reel' THEN 'reels'
                    WHEN COALESCE(json_extract(q.payload_json, '$.imageUrl'), '') != '' THEN 'image'
                    WHEN COALESCE(json_extract(q.payload_json, '$.link'), '') != '' OR COALESCE(json_extract(q.payload_json, '$.linkUrl'), '') != '' THEN 'link'
                    ELSE 'text'
                END,
                COALESCE(json_extract(q.payload_json, '$.imageUrl'), json_extract(q.payload_json, '$.linkUrl'), json_extract(q.payload_json, '$.link')),
                q.post_id,
                q.facebook_url,
                q.scheduled_time,
                COALESCE(q.processed_at, q.updated_at, q.created_at),
                q.payload_json,
                q.created_at
            FROM scheduled_publish_queue q
            WHERE q.status = 'published'
        `).run();
    }

    if (await hasTable(env, 'reel_uploads')) {
        await env.DB.prepare(`
            INSERT OR IGNORE INTO publish_history (
                external_key,
                page_id,
                source,
                source_ref,
                post_type,
                message_text,
                media_kind,
                media_url,
                facebook_post_id,
                facebook_url,
                published_at,
                warning_message,
                created_at
            )
            SELECT
                'reel:' || COALESCE(NULLIF(ru.video_key, ''), NULLIF(ru.post_id, ''), NULLIF(ru.video_id, ''), CAST(ru.id AS TEXT)),
                ru.page_id,
                'reel',
                COALESCE(NULLIF(ru.video_key, ''), NULLIF(ru.post_id, ''), NULLIF(ru.video_id, ''), CAST(ru.id AS TEXT)),
                'reels',
                NULL,
                'reels',
                NULL,
                COALESCE(NULLIF(ru.post_id, ''), NULLIF(ru.video_id, ''), NULL),
                ru.facebook_url,
                COALESCE(ru.published_at, ru.updated_at, ru.created_at),
                ru.warning_message,
                ru.created_at
            FROM reel_uploads ru
            WHERE ru.status IN ('published', 'deleted')
        `).run();
    }
}
