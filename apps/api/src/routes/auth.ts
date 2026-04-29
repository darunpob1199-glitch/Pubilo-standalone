import { Hono, type Context } from 'hono';
import { clearSessionCookie, createSession, deleteSessionByToken, getApiOrigin, getAppOrigin, getSessionFromRequest, SESSION_COOKIE_NAME, setSessionCookie, updateSessionWorkspace } from '../auth/session';
import { buildFacebookAuthUrl, exchangeFacebookCode, exchangeLongLivedFacebookUserToken, fetchFacebookMe, fetchFacebookPages, hasFacebookLoginConfig } from '../auth/facebook';
import { buildLineAuthUrl, createCodeChallenge, createCodeVerifier, createLineNonce, exchangeLineCode, fetchLineUserInfo, verifyLineIdToken } from '../auth/line';
import type { Env } from '../types';
import { getBillingPlan } from '../config/plans';
import { getCookie } from 'hono/cookie';
import { createCheckoutIntent, getLatestWorkspacePaymentOrder } from '../lib/billing-state';
import { encryptSecret } from '../lib/encryption';
import { ensureAppSchema } from '../lib/schema';

const app = new Hono<{ Bindings: Env }>();

function makeSlug(input: string) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9ก-๙]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || `workspace-${Date.now()}`;
}

async function uniqueWorkspaceSlug(env: Env, baseSlug: string) {
    let slug = baseSlug;
    let suffix = 1;

    while (true) {
        const exists = await env.DB.prepare(`
            SELECT id FROM workspaces WHERE slug = ? LIMIT 1
        `).bind(slug).first<{ id: string }>();

        if (!exists) return slug;
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
    }
}

function makeFallbackEmail(lineUserId: string) {
    return `line-${lineUserId}@users.pubilo.local`;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasLineLoginConfig(env: Env) {
    return isNonEmptyString(env.LINE_LOGIN_CHANNEL_ID)
        && isNonEmptyString(env.LINE_LOGIN_CHANNEL_SECRET);
}

function sanitizeReturnTo(rawReturnTo: string | null | undefined, appOrigin: string) {
    try {
        const safeUrl = new URL(rawReturnTo || `${appOrigin}/`, appOrigin);
        if (safeUrl.origin !== appOrigin) {
            return `${appOrigin}/`;
        }

        if (safeUrl.pathname.startsWith('/api/')) {
            const fallbackUrl = new URL('/', appOrigin);
            fallbackUrl.search = safeUrl.search;
            fallbackUrl.hash = safeUrl.hash;
            return fallbackUrl.toString();
        }

        return safeUrl.toString();
    } catch {
        return `${appOrigin}/`;
    }
}

function appendAuthResult(returnTo: string | null | undefined, appOrigin: string, params: Record<string, string | number | boolean>) {
    const url = new URL(sanitizeReturnTo(returnTo, appOrigin));
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function stripAuthErrorReturnTo(returnTo: string | null | undefined, appOrigin: string) {
    const url = new URL(sanitizeReturnTo(returnTo, appOrigin));
    url.searchParams.delete('auth_error');
    return url.toString();
}

function isLocalHostName(hostname: string) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isDevelopmentLocalAuthAllowed(env: Env, requestUrl: string) {
    if (String(env.NODE_ENV || '').trim() !== 'development') return false;

    try {
        const requestHost = new URL(requestUrl).hostname;
        const appHost = new URL(getAppOrigin(env, requestUrl)).hostname;
        return isLocalHostName(requestHost) && isLocalHostName(appHost);
    } catch {
        return false;
    }
}

async function createDevelopmentSession(c: Context<{ Bindings: Env }>, returnTo: string) {
    await ensureAppSchema(c.env);

    const now = new Date().toISOString();
    const userId = 'dev-local-user';
    const workspaceId = 'dev-local-workspace';

    await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO users (id, email, name, avatar_url, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                updated_at = excluded.updated_at,
                last_login_at = excluded.last_login_at
        `).bind(
            userId,
            'dev-local@users.pubilo.local',
            'Local Dev',
            null,
            now,
            now,
            now,
        ),
        c.env.DB.prepare(`
            INSERT INTO workspaces (id, name, slug, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                slug = excluded.slug,
                updated_at = excluded.updated_at
        `).bind(workspaceId, 'Local Dev Workspace', 'local-dev', now, now),
        c.env.DB.prepare(`
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
            ON CONFLICT(workspace_id, user_id) DO UPDATE SET
                role = excluded.role
        `).bind(workspaceId, userId, now),
    ]);

    const session = await createSession(c.env, userId, workspaceId);
    const appOrigin = getAppOrigin(c.env, c.req.url);
    const apiOrigin = getApiOrigin(c.env, c.req.url);
    setSessionCookie(c, session.rawToken, session.expiresAt, appOrigin, apiOrigin);
    return c.redirect(stripAuthErrorReturnTo(returnTo, appOrigin));
}

async function resolveActiveWorkspace(authState: Awaited<ReturnType<typeof getSessionFromRequest>>, env: Env) {
    if (!authState) return null;
    const activeWorkspaceId = authState.session.active_workspace_id
        || authState.memberships[0]?.workspace_id
        || null;
    if (!activeWorkspaceId) return null;

    if (!authState.session.active_workspace_id) {
        await updateSessionWorkspace(env, authState.session.id, activeWorkspaceId);
    }

    const membership = authState.memberships.find((item) => item.workspace_id === activeWorkspaceId);
    if (!membership) return null;

    return {
        workspaceId: activeWorkspaceId,
        userId: authState.user.id,
    };
}

function facebookRedirectUri(env: Env, requestUrl: string) {
    return `${getApiOrigin(env, requestUrl)}/api/auth/facebook/callback`;
}

async function syncFacebookConnectionToWorkspace(input: {
    env: Env;
    workspaceId: string;
    userId: string;
    userToken: string;
}) {
    const profile = await fetchFacebookMe(input.env, input.userToken);
    const pages = await fetchFacebookPages(input.env, input.userToken);
    const now = new Date().toISOString();
    const encryptedUserToken = await encryptSecret(input.env, input.userToken);

    await input.env.DB.prepare(`
        INSERT INTO facebook_credentials (
            id, workspace_id, facebook_user_id, ads_token_encrypted,
            account_name, avatar_url, created_by_user_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            facebook_user_id = excluded.facebook_user_id,
            ads_token_encrypted = excluded.ads_token_encrypted,
            account_name = excluded.account_name,
            avatar_url = COALESCE(excluded.avatar_url, facebook_credentials.avatar_url),
            created_by_user_id = COALESCE(facebook_credentials.created_by_user_id, excluded.created_by_user_id),
            updated_at = excluded.updated_at
    `).bind(
        `${input.workspaceId}:${profile.id}`,
        input.workspaceId,
        profile.id,
        encryptedUserToken,
        profile.name,
        profile.pictureUrl || null,
        input.userId,
        now,
        now,
    ).run();

    let syncedPages = 0;
    let syncedPageTokens = 0;
    for (const page of pages) {
        const pageId = String(page.id || '').trim();
        if (!pageId) continue;
        const encryptedPageToken = await encryptSecret(input.env, page.accessToken || null);
        if (encryptedPageToken) syncedPageTokens += 1;

        await input.env.DB.prepare(`
            INSERT INTO page_settings (
                organization_id, page_id, page_name, picture_url,
                post_token_encrypted, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, page_id) DO UPDATE SET
                page_name = excluded.page_name,
                picture_url = COALESCE(excluded.picture_url, page_settings.picture_url),
                post_token_encrypted = COALESCE(excluded.post_token_encrypted, page_settings.post_token_encrypted),
                updated_at = excluded.updated_at
        `).bind(
            input.workspaceId,
            pageId,
            page.name || pageId,
            page.pictureUrl || null,
            encryptedPageToken,
            now,
        ).run();

        syncedPages += 1;
    }

    return {
        profile,
        pages,
        syncedPages,
        syncedPageTokens,
    };
}

app.get('/login/facebook', async (c) => {
    const appOrigin = getAppOrigin(c.env, c.req.url);
    const returnTo = sanitizeReturnTo(c.req.query('returnTo'), appOrigin);

    if (!hasFacebookLoginConfig(c.env)) {
        console.error('[auth] Facebook login is not configured: missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET');
        return c.redirect(appendAuthResult(returnTo, appOrigin, { facebook_auth_error: 'facebook_not_configured' }));
    }

    await ensureAppSchema(c.env);
    const authState = await getSessionFromRequest(c);
    const active = await resolveActiveWorkspace(authState, c.env);
    if (!active) {
        return c.redirect(appendAuthResult(returnTo, appOrigin, { facebook_auth_error: 'pubilo_login_required' }));
    }

    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await c.env.DB.prepare(`
        INSERT INTO oauth_states (state, return_to, expires_at, provider, user_id, workspace_id, created_at)
        VALUES (?, ?, ?, 'facebook', ?, ?, CURRENT_TIMESTAMP)
    `).bind(state, returnTo, expiresAt, active.userId, active.workspaceId).run();

    return c.redirect(buildFacebookAuthUrl({
        env: c.env,
        redirectUri: facebookRedirectUri(c.env, c.req.url),
        state,
    }));
});

async function handleFacebookCallback(c: Context<{ Bindings: Env }>) {
    const appOrigin = getAppOrigin(c.env, c.req.url);

    if (!hasFacebookLoginConfig(c.env)) {
        return c.redirect(`${appOrigin}/?facebook_auth_error=facebook_not_configured`);
    }

    const oauthError = c.req.query('error');
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (oauthError) {
        return c.redirect(`${appOrigin}/?facebook_auth_error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
        return c.redirect(`${appOrigin}/?facebook_auth_error=missing_code`);
    }

    await ensureAppSchema(c.env);
    const stateRow = await c.env.DB.prepare(`
        SELECT state, return_to, user_id, workspace_id
        FROM oauth_states
        WHERE state = ?
          AND provider = 'facebook'
          AND datetime(expires_at) > datetime('now')
        LIMIT 1
    `).bind(state).first<{
        state: string;
        return_to: string | null;
        user_id: string | null;
        workspace_id: string | null;
    }>();

    if (!stateRow?.user_id || !stateRow?.workspace_id) {
        return c.redirect(`${appOrigin}/?facebook_auth_error=invalid_state`);
    }

    await c.env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run();

    try {
        const redirectUri = facebookRedirectUri(c.env, c.req.url);
        const shortToken = await exchangeFacebookCode({
            env: c.env,
            code,
            redirectUri,
        });
        const longToken = await exchangeLongLivedFacebookUserToken({
            env: c.env,
            accessToken: shortToken.accessToken,
        }).catch((error) => {
            console.warn('[auth] Facebook long-lived token exchange failed, using short-lived token:', error);
            return shortToken;
        });

        const synced = await syncFacebookConnectionToWorkspace({
            env: c.env,
            workspaceId: stateRow.workspace_id,
            userId: stateRow.user_id,
            userToken: longToken.accessToken,
        });

        return c.redirect(appendAuthResult(stateRow.return_to, appOrigin, {
            facebook_auth: 'connected',
            facebook_pages: synced.syncedPages,
            facebook_page_tokens: synced.syncedPageTokens,
            facebook_user: synced.profile.id,
        }));
    } catch (error) {
        console.error('[auth] Facebook callback failed:', error);
        return c.redirect(appendAuthResult(stateRow.return_to, appOrigin, { facebook_auth_error: 'facebook_callback' }));
    }
}

app.get('/facebook/callback', handleFacebookCallback);
app.get('/callback/facebook', handleFacebookCallback);

app.get('/facebook/status', async (c) => {
    await ensureAppSchema(c.env);
    const authState = await getSessionFromRequest(c);
    const active = await resolveActiveWorkspace(authState, c.env);
    if (!active) {
        return c.json({
            success: false,
            configured: hasFacebookLoginConfig(c.env),
            authenticated: false,
            error: 'Unauthorized',
        }, 401);
    }

    const [credentials, pages] = await Promise.all([
        c.env.DB.prepare(`
            SELECT COUNT(*) AS count
            FROM facebook_credentials
            WHERE workspace_id = ?
              AND ads_token_encrypted IS NOT NULL
              AND TRIM(ads_token_encrypted) != ''
        `).bind(active.workspaceId).first<{ count: number }>(),
        c.env.DB.prepare(`
            SELECT COUNT(*) AS count
            FROM page_settings
            WHERE organization_id = ?
              AND post_token_encrypted IS NOT NULL
              AND TRIM(post_token_encrypted) != ''
        `).bind(active.workspaceId).first<{ count: number }>(),
    ]);

    return c.json({
        success: true,
        configured: hasFacebookLoginConfig(c.env),
        authenticated: true,
        redirectUri: facebookRedirectUri(c.env, c.req.url),
        credentialCount: Number(credentials?.count || 0),
        connectedPages: Number(pages?.count || 0),
    });
});

app.get('/login/line', async (c) => {
    const appOrigin = getAppOrigin(c.env, c.req.url);
    const returnTo = sanitizeReturnTo(c.req.query('returnTo'), appOrigin);

    if (!hasLineLoginConfig(c.env)) {
        if (isDevelopmentLocalAuthAllowed(c.env, c.req.url)) {
            console.warn('[auth] LINE login is not configured; using local development session fallback');
            return createDevelopmentSession(c, returnTo);
        }

        console.error('[auth] LINE login is not configured: missing LINE_LOGIN_CHANNEL_ID or LINE_LOGIN_CHANNEL_SECRET');
        return c.redirect(`${appOrigin}/?auth_error=line_not_configured`);
    }

    const state = crypto.randomUUID();
    const nonce = createLineNonce();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const redirectUri = `${getApiOrigin(c.env, c.req.url)}/api/auth/callback/line`;

    await c.env.DB.prepare(`
        INSERT INTO oauth_states (state, return_to, expires_at, nonce, code_verifier, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(state, returnTo, expiresAt, nonce, codeVerifier).run();

    return c.redirect(buildLineAuthUrl({
        channelId: c.env.LINE_LOGIN_CHANNEL_ID,
        redirectUri,
        state,
        nonce,
        codeChallenge,
    }));
});

app.get('/callback/line', async (c) => {
    if (!hasLineLoginConfig(c.env)) {
        console.error('[auth] LINE callback is not configured: missing LINE_LOGIN_CHANNEL_ID or LINE_LOGIN_CHANNEL_SECRET');
        return c.redirect(`${getAppOrigin(c.env, c.req.url)}/?auth_error=line_not_configured`);
    }

    const oauthError = c.req.query('error');
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (oauthError) {
        return c.redirect(`${getAppOrigin(c.env, c.req.url)}/?auth_error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
        return c.redirect(`${getAppOrigin(c.env, c.req.url)}/?auth_error=missing_code`);
    }

    const stateRow = await c.env.DB.prepare(`
        SELECT state, return_to, nonce, code_verifier
        FROM oauth_states
        WHERE state = ?
          AND datetime(expires_at) > datetime('now')
        LIMIT 1
    `).bind(state).first<{
        state: string;
        return_to: string | null;
        nonce: string | null;
        code_verifier: string | null;
    }>();

    if (!stateRow) {
        return c.redirect(`${getAppOrigin(c.env, c.req.url)}/?auth_error=invalid_state`);
    }

    await c.env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run();

    try {
        const redirectUri = `${getApiOrigin(c.env, c.req.url)}/api/auth/callback/line`;
        const token = await exchangeLineCode({
            env: c.env,
            code,
            redirectUri,
            codeVerifier: stateRow.code_verifier || '',
        });

        if (!token.id_token) {
            throw new Error('LINE response missing id_token');
        }

        const verified = await verifyLineIdToken({
            env: c.env,
            idToken: token.id_token,
            nonce: stateRow.nonce,
        });
        const profile = await fetchLineUserInfo(token.access_token).catch(() => null);

        if (profile?.sub && verified.sub && profile.sub !== verified.sub) {
            throw new Error('LINE userinfo subject mismatch');
        }

        const lineUserId = verified.sub || profile?.sub;
        if (!lineUserId) {
            throw new Error('LINE account is missing sub');
        }

        const realEmail = verified.email || profile?.email || null;
        const accountEmail = realEmail || makeFallbackEmail(lineUserId);
        const accountName = profile?.name || verified.name || `LINE User ${lineUserId.slice(0, 6)}`;
        const avatarUrl = profile?.picture || verified.picture || null;

        const existingAccount = await c.env.DB.prepare(`
            SELECT la.user_id
            FROM line_accounts la
            WHERE la.line_user_id = ?
            LIMIT 1
        `).bind(lineUserId).first<{ user_id: string }>();

        const existingUserByEmail = realEmail
            ? await c.env.DB.prepare(`
                SELECT id
                FROM users
                WHERE email = ?
                LIMIT 1
            `).bind(realEmail).first<{ id: string }>()
            : null;

        const userId = existingAccount?.user_id || existingUserByEmail?.id || crypto.randomUUID();
        const now = new Date().toISOString();

        await c.env.DB.prepare(`
            INSERT INTO users (id, email, name, avatar_url, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                avatar_url = excluded.avatar_url,
                updated_at = excluded.updated_at,
                last_login_at = excluded.last_login_at
        `).bind(
            userId,
            accountEmail,
            accountName,
            avatarUrl,
            now,
            now,
            now,
        ).run();

        await c.env.DB.prepare(`
            INSERT INTO line_accounts (line_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(line_user_id) DO UPDATE SET
                user_id = excluded.user_id,
                email = excluded.email,
                display_name = excluded.display_name,
                picture_url = excluded.picture_url,
                updated_at = excluded.updated_at
        `).bind(lineUserId, userId, realEmail, accountName, avatarUrl, now, now).run();

        const memberships = await c.env.DB.prepare(`
            SELECT workspace_id
            FROM workspace_members
            WHERE user_id = ?
            ORDER BY created_at ASC
        `).bind(userId).all<{ workspace_id: string }>();

        const activeWorkspaceId = memberships.results?.[0]?.workspace_id ?? null;
        const session = await createSession(c.env, userId, activeWorkspaceId);
        const appOrigin = getAppOrigin(c.env, c.req.url);
        const apiOrigin = getApiOrigin(c.env, c.req.url);
        setSessionCookie(c, session.rawToken, session.expiresAt, appOrigin, apiOrigin);

        return c.redirect(sanitizeReturnTo(stateRow.return_to, appOrigin));
    } catch (error) {
        console.error('[auth] LINE callback failed:', error);
        return c.redirect(`${getAppOrigin(c.env, c.req.url)}/?auth_error=line_callback`);
    }
});

app.get('/me', async (c) => {
    const authState = await getSessionFromRequest(c);
    if (!authState) {
        return c.json({ authenticated: false });
    }

    let { session, user, memberships } = authState;
    let activeWorkspaceId = session.active_workspace_id;

    if (!activeWorkspaceId && memberships.length > 0) {
        activeWorkspaceId = memberships[0].workspace_id;
        await updateSessionWorkspace(c.env, session.id, activeWorkspaceId);
        session = { ...session, active_workspace_id: activeWorkspaceId };
    }

    const activeWorkspace = activeWorkspaceId
        ? memberships.find((membership) => membership.workspace_id === activeWorkspaceId) || null
        : null;

    let paymentOrder = null;
    if (activeWorkspaceId) {
        paymentOrder = await getLatestWorkspacePaymentOrder(c.env, activeWorkspaceId);
    }

    return c.json({
        authenticated: true,
        user,
        session: {
            id: session.id,
            activeWorkspaceId,
            expiresAt: session.expires_at,
        },
        onboardingRequired: memberships.length === 0,
        workspace: activeWorkspace ? {
            id: activeWorkspace.workspace_id,
            name: activeWorkspace.workspace_name,
            slug: activeWorkspace.slug,
            role: activeWorkspace.role,
            subscriptionStatus: activeWorkspace.subscription_status,
            planCode: activeWorkspace.plan_code,
            plan: getBillingPlan(activeWorkspace.plan_code),
            subscriptionPeriodEnd: activeWorkspace.subscription_period_end,
        } : null,
        memberships: memberships.map((membership) => ({
            id: membership.workspace_id,
            name: membership.workspace_name,
            slug: membership.slug,
            role: membership.role,
            subscriptionStatus: membership.subscription_status,
            planCode: membership.plan_code,
            plan: getBillingPlan(membership.plan_code),
            subscriptionPeriodEnd: membership.subscription_period_end,
        })),
        latestPaymentOrder: paymentOrder,
    });
});

app.post('/logout', async (c) => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (rawToken) {
        await deleteSessionByToken(c.env, rawToken);
    }

    clearSessionCookie(c, getAppOrigin(c.env, c.req.url), getApiOrigin(c.env, c.req.url));
    return c.json({ success: true });
});

app.post('/select-workspace', async (c) => {
    const authState = await getSessionFromRequest(c);
    if (!authState) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const workspaceId = String(body.workspaceId || '').trim();
    if (!workspaceId) {
        return c.json({ success: false, error: 'Missing workspaceId' }, 400);
    }

    const membership = authState.memberships.find((item) => item.workspace_id === workspaceId);
    if (!membership) {
        return c.json({ success: false, error: 'Workspace not found' }, 404);
    }

    await updateSessionWorkspace(c.env, authState.session.id, workspaceId);
    return c.json({
        success: true,
        workspace: {
            id: membership.workspace_id,
            name: membership.workspace_name,
            slug: membership.slug,
            role: membership.role,
        },
    });
});

app.post('/onboarding/workspace', async (c) => {
    const authState = await getSessionFromRequest(c);
    if (!authState) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const name = String(body.name || '').trim();
    const planCode = String(body.planCode || '').trim();
    const plan = getBillingPlan(planCode);

    if (!name) return c.json({ success: false, error: 'Missing workspace name' }, 400);
    if (!plan) return c.json({ success: false, error: 'Invalid planCode' }, 400);
    if (authState.memberships.length > 0) {
        return c.json({ success: false, error: 'Workspace already exists for this account' }, 409);
    }

    const workspaceId = crypto.randomUUID();
    const now = new Date();
    const slug = await uniqueWorkspaceSlug(c.env, makeSlug(name));

    await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO workspaces (id, name, slug, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).bind(workspaceId, name, slug, now.toISOString(), now.toISOString()),
        c.env.DB.prepare(`
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
        `).bind(workspaceId, authState.user.id, now.toISOString()),
    ]);

    await updateSessionWorkspace(c.env, authState.session.id, workspaceId);
    const intent = await createCheckoutIntent(c.env, {
        workspaceId,
        plan,
        source: 'onboarding',
    });

    return c.json({
        success: true,
        workspace: {
            id: workspaceId,
            name,
            slug,
            role: 'owner',
        },
        subscription: {
            id: intent.subscription.id,
            status: intent.subscription.status,
            planCode: intent.subscription.plan_code,
            interval: intent.subscription.billing_interval,
            amountThb: intent.subscription.amount_thb,
            currentPeriodEnd: intent.subscription.current_period_end,
        },
        paymentOrder: {
            id: intent.paymentOrder.id,
            status: intent.paymentOrder.status,
            amountThb: intent.paymentOrder.amount_thb,
            expiresAt: intent.paymentOrder.expires_at,
        },
    });
});

export { app as authRouter };
