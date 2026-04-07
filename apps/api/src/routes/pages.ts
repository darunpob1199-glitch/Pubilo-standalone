import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

type PageAggregate = {
    id: string;
    name: string;
    pictureUrl: string;
    color: string;
    autoSchedule: boolean;
    hasToken: boolean;
    lastSeenAt: number;
    sourcePriority: number;
};

function normalizeTimestamp(value: unknown): number {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        ? `${raw.replace(' ', 'T')}Z`
        : raw;
    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isGenericPageName(value: unknown, pageId: string): boolean {
    const name = String(value || '').trim();
    if (!name) return true;
    const lowered = name.toLowerCase();
    if (
        lowered === 'page'
        || lowered === 'unknown page'
        || lowered === 'saved page'
        || lowered === 'เพจไม่ทราบชื่อ'
    ) return true;
    if (name === pageId) return true;
    if (/^page\s+\d+$/i.test(name)) {
        return lowered === `page ${String(pageId || '').trim()}`.toLowerCase();
    }
    if (/^เพจ\s+\d+$/i.test(name)) {
        return lowered === `เพจ ${String(pageId || '').trim()}`.toLowerCase();
    }
    return false;
}

function resolvePageName(value: unknown, pageId: string): string {
    const normalizedPageId = String(pageId || '').trim();
    const name = String(value || '').trim();
    if (!isGenericPageName(name, normalizedPageId)) return name;
    return normalizedPageId ? `เพจ ${normalizedPageId}` : 'เพจไม่ทราบชื่อ';
}

// GET /api/pages - list all pages with settings
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        const pagesById = new Map<string, PageAggregate>();
        const upsertPage = (input: {
            id?: unknown;
            name?: unknown;
            pictureUrl?: unknown;
            color?: unknown;
            autoSchedule?: unknown;
            hasToken?: unknown;
            lastSeenRaw?: unknown;
            sourcePriority: number;
        }) => {
            const pageId = String(input.id || '').trim();
            if (!pageId) return;

            const nextName = String(input.name || '').trim();
            const nextPictureUrl = String(input.pictureUrl || '').trim();
            const nextColor = String(input.color || '').trim();
            const nextLastSeenAt = normalizeTimestamp(input.lastSeenRaw);
            const existing = pagesById.get(pageId);

            if (!existing) {
                pagesById.set(pageId, {
                    id: pageId,
                    name: resolvePageName(nextName, pageId),
                    pictureUrl: nextPictureUrl,
                    color: nextColor || '#f59e0b',
                    autoSchedule: Boolean(input.autoSchedule),
                    hasToken: Boolean(input.hasToken),
                    lastSeenAt: nextLastSeenAt,
                    sourcePriority: input.sourcePriority,
                });
                return;
            }

            const existingName = String(existing.name || '').trim();
            const shouldReplaceName = !!nextName
                && !isGenericPageName(nextName, pageId)
                && isGenericPageName(existingName, pageId);
            if (shouldReplaceName) {
                existing.name = nextName;
            }
            if (nextPictureUrl && !existing.pictureUrl) {
                existing.pictureUrl = nextPictureUrl;
            }
            if (nextColor && (!existing.color || existing.color === '#f59e0b')) {
                existing.color = nextColor;
            }
            if (nextLastSeenAt > existing.lastSeenAt) {
                existing.lastSeenAt = nextLastSeenAt;
            }
            if (Boolean(input.autoSchedule)) {
                existing.autoSchedule = true;
            }
            if (Boolean(input.hasToken)) {
                existing.hasToken = true;
            }
            if (input.sourcePriority < existing.sourcePriority) {
                existing.sourcePriority = input.sourcePriority;
            }
        };

        const settingsResults = await c.env.DB.prepare(`
            SELECT page_id, page_name, page_color, picture_url, auto_schedule, post_token_encrypted
            FROM page_settings 
            WHERE organization_id = ?
            ORDER BY page_name ASC
        `).bind(workspaceId).all();

        (settingsResults.results || []).forEach((row: any) => {
            upsertPage({
                id: row.page_id,
                name: row.page_name,
                pictureUrl: row.picture_url,
                color: row.page_color,
                autoSchedule: row.auto_schedule,
                hasToken: !!row.post_token_encrypted,
                sourcePriority: 0,
            });
        });

        // Include pages that already have publish history in this workspace,
        // so delete/hide tools can still work even if page_settings is still empty.
        try {
            const historyResults = await c.env.DB.prepare(`
                SELECT page_id, MAX(datetime(COALESCE(published_at, created_at))) AS last_seen
                FROM publish_history
                WHERE organization_id = ?
                  AND page_id IS NOT NULL
                  AND TRIM(page_id) != ''
                GROUP BY page_id
                ORDER BY datetime(last_seen) DESC
                LIMIT 300
            `).bind(workspaceId).all();

            (historyResults.results || []).forEach((row: any) => {
                upsertPage({
                    id: row.page_id,
                    lastSeenRaw: row.last_seen,
                    sourcePriority: 1,
                });
            });
        } catch (error) {
            console.warn('[pages] publish_history lookup failed:', error);
        }

        // Include hidden-post records too (for workspaces that cleaned history rows).
        try {
            const hiddenResults = await c.env.DB.prepare(`
                SELECT page_id, MAX(datetime(hidden_at)) AS last_seen
                FROM hidden_posts
                WHERE organization_id = ?
                  AND page_id IS NOT NULL
                  AND TRIM(page_id) != ''
                GROUP BY page_id
                ORDER BY datetime(last_seen) DESC
                LIMIT 300
            `).bind(workspaceId).all();

            (hiddenResults.results || []).forEach((row: any) => {
                upsertPage({
                    id: row.page_id,
                    lastSeenRaw: row.last_seen,
                    sourcePriority: 2,
                });
            });
        } catch (error) {
            console.warn('[pages] hidden_posts lookup failed:', error);
        }

        const pages = Array.from(pagesById.values())
            .sort((a, b) => {
                if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
                if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
                return a.name.localeCompare(b.name, 'th');
            })
            .map((page) => ({
                id: page.id,
                name: resolvePageName(page.name, page.id),
                picture: page.pictureUrl ? { data: { url: page.pictureUrl } } : null,
                color: page.color || '#f59e0b',
                auto_schedule: page.autoSchedule,
                has_token: page.hasToken,
            }));

        return c.json({ success: true, pages });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as pagesRouter };
