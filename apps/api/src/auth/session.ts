import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthSession, AuthUser, Env, WorkspaceMembership } from '../types';
import { getEffectiveWorkspaceSubscription } from '../lib/billing-state';

export const SESSION_COOKIE_NAME = 'pubilo_session';
const SESSION_TTL_DAYS = 45;

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeOrigin(origin: string | undefined, fallback: string): string {
    const value = typeof origin === 'string' ? origin.trim() : '';
    return value ? value.replace(/\/+$/g, '') : fallback;
}

export function getAppOrigin(env: Env, requestUrl: string): string {
    return normalizeOrigin(env.APP_ORIGIN, 'http://localhost:8787');
}

export function getApiOrigin(env: Env, requestUrl: string): string {
    if (env.API_ORIGIN) {
        return normalizeOrigin(env.API_ORIGIN, requestUrl);
    }

    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
}

export function resolveCookieDomain(appOrigin: string, apiOrigin: string): string | undefined {
    try {
        const appHost = new URL(appOrigin).hostname;
        const apiHost = new URL(apiOrigin).hostname;
        const isLocalOrIp = (host: string) => host === 'localhost'
            || host === '127.0.0.1'
            || host === '::1'
            || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
        if (isLocalOrIp(appHost) || isLocalOrIp(apiHost)) return undefined;

        const appParts = appHost.split('.');
        const apiParts = apiHost.split('.');

        if (appParts.length < 2 || apiParts.length < 2) return undefined;

        const appRoot = appParts.slice(-2).join('.');
        const apiRoot = apiParts.slice(-2).join('.');
        return appRoot === apiRoot ? `.${appRoot}` : undefined;
    } catch {
        return undefined;
    }
}

function rootSite(origin: string): string | null {
    try {
        const host = new URL(origin).hostname;
        if (host === 'localhost') return 'localhost';
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
        if (host === '127.0.0.1' || host === '::1') return host;
        const parts = host.split('.');
        if (parts.length < 2) return host;
        return parts.slice(-2).join('.');
    } catch {
        return null;
    }
}

function resolveSameSite(appOrigin: string, apiOrigin: string): 'Lax' | 'None' {
    const appSite = rootSite(appOrigin);
    const apiSite = rootSite(apiOrigin);
    return appSite && apiSite && appSite === apiSite ? 'Lax' : 'None';
}

export async function hashToken(secret: string, token: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${secret}:${token}`),
    );
    return toHex(new Uint8Array(digest));
}

export async function createSession(env: Env, userId: string, activeWorkspaceId: string | null) {
    const rawToken = crypto.randomUUID();
    const tokenHash = await hashToken(env.AUTH_SECRET, rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = crypto.randomUUID();

    await env.DB.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, active_workspace_id, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(sessionId, userId, tokenHash, activeWorkspaceId, expiresAt).run();

    return {
        sessionId,
        rawToken,
        expiresAt,
    };
}

export function setSessionCookie(
    c: Context<{ Bindings: Env }>,
    token: string,
    expiresAt: string,
    appOrigin: string,
    apiOrigin: string,
) {
    const sameSite = resolveSameSite(appOrigin, apiOrigin);
    setCookie(c, SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: appOrigin.startsWith('https://') || apiOrigin.startsWith('https://'),
        sameSite,
        path: '/',
        expires: new Date(expiresAt),
        domain: resolveCookieDomain(appOrigin, apiOrigin),
    });
}

export function clearSessionCookie(
    c: Context<{ Bindings: Env }>,
    appOrigin: string,
    apiOrigin: string,
) {
    deleteCookie(c, SESSION_COOKIE_NAME, {
        path: '/',
        domain: resolveCookieDomain(appOrigin, apiOrigin),
    });
}

export async function getSessionFromRequest(c: Context<any>): Promise<{
    session: AuthSession;
    user: AuthUser;
    memberships: WorkspaceMembership[];
} | null> {
    const env = c.env as Env;
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) return null;

    const tokenHash = await hashToken(env.AUTH_SECRET, rawToken);
    const sessionRow = await env.DB.prepare(`
        SELECT s.id, s.user_id, s.active_workspace_id, s.expires_at, u.email, u.name, u.avatar_url
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND datetime(s.expires_at) > datetime('now')
        LIMIT 1
    `).bind(tokenHash).first<{
        id: string;
        user_id: string;
        active_workspace_id: string | null;
        expires_at: string;
        email: string;
        name: string | null;
        avatar_url: string | null;
    }>();

    if (!sessionRow) {
        return null;
    }

    const membershipsResult = await env.DB.prepare(`
        SELECT
            wm.workspace_id,
            wm.role,
            w.name as workspace_name,
            w.slug
        FROM workspace_members wm
        JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ?
        ORDER BY w.created_at ASC
    `).bind(sessionRow.user_id).all<Pick<WorkspaceMembership, 'workspace_id' | 'role' | 'workspace_name' | 'slug'>>();

    const memberships = await Promise.all(
        (membershipsResult.results || []).map(async (membership) => {
            const subscription = await getEffectiveWorkspaceSubscription(env, membership.workspace_id);
            return {
                ...membership,
                subscription_status: subscription?.status || null,
                plan_code: subscription?.plan_code || null,
                subscription_period_end: subscription?.current_period_end || null,
            } satisfies WorkspaceMembership;
        }),
    );

    return {
        session: {
            id: sessionRow.id,
            user_id: sessionRow.user_id,
            active_workspace_id: sessionRow.active_workspace_id,
            expires_at: sessionRow.expires_at,
        },
        user: {
            id: sessionRow.user_id,
            email: sessionRow.email,
            name: sessionRow.name,
            avatar_url: sessionRow.avatar_url,
        },
        memberships,
    };
}

export async function updateSessionWorkspace(env: Env, sessionId: string, workspaceId: string) {
    await env.DB.prepare(`
        UPDATE sessions
        SET active_workspace_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).bind(workspaceId, sessionId).run();
}

export async function deleteSessionByToken(env: Env, rawToken: string) {
    const tokenHash = await hashToken(env.AUTH_SECRET, rawToken);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}
