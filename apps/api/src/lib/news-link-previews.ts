import type { Env } from '../types';

export type NewsLinkPreviewRecord = {
    id: string;
    target_url: string;
    image_url: string | null;
    title: string | null;
    description: string | null;
    site_name: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

export async function ensureNewsLinkPreviewsTable(env: Env): Promise<void> {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS news_link_previews (
            id TEXT PRIMARY KEY,
            target_url TEXT NOT NULL,
            image_url TEXT,
            title TEXT,
            description TEXT,
            site_name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

export async function createNewsLinkPreview(
    env: Env,
    payload: {
        targetUrl: string;
        imageUrl?: string;
        title?: string;
        description?: string;
        siteName?: string;
    },
): Promise<string> {
    await ensureNewsLinkPreviewsTable(env);

    const id = crypto.randomUUID();
    await env.DB.prepare(`
        INSERT INTO news_link_previews (
            id,
            target_url,
            image_url,
            title,
            description,
            site_name,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
        id,
        payload.targetUrl,
        payload.imageUrl || null,
        payload.title || null,
        payload.description || null,
        payload.siteName || null,
    ).run();

    return id;
}

export async function getNewsLinkPreview(
    env: Env,
    id: string,
): Promise<NewsLinkPreviewRecord | null> {
    await ensureNewsLinkPreviewsTable(env);

    const row = await env.DB.prepare(`
        SELECT id, target_url, image_url, title, description, site_name, created_at, updated_at
        FROM news_link_previews
        WHERE id = ?
        LIMIT 1
    `).bind(id).first<NewsLinkPreviewRecord>();

    return row || null;
}
