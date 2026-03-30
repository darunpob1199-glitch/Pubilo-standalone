import { Hono } from 'hono';
import { clearSessionCookie, createSession, deleteSessionByToken, getApiOrigin, getAppOrigin, getSessionFromRequest, SESSION_COOKIE_NAME, setSessionCookie, updateSessionWorkspace } from '../auth/session';
import { buildLineAuthUrl, createCodeChallenge, createCodeVerifier, createLineNonce, exchangeLineCode, fetchLineUserInfo, verifyLineIdToken } from '../auth/line';
import type { Env } from '../types';
import { getBillingPlan } from '../config/plans';
import { getCookie } from 'hono/cookie';

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

app.get('/login/line', async (c) => {
    const returnTo = c.req.query('returnTo') || `${getAppOrigin(c.env, c.req.url)}/`;
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

        return c.redirect(stateRow.return_to || `${appOrigin}/`);
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
        paymentOrder = await c.env.DB.prepare(`
            SELECT id, plan_code, billing_interval, amount_thb, status, gateway, gateway_reference, qr_reference, expires_at, created_at
            FROM payment_orders
            WHERE workspace_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).bind(activeWorkspaceId).first();
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
        } : null,
        memberships: memberships.map((membership) => ({
            id: membership.workspace_id,
            name: membership.workspace_name,
            slug: membership.slug,
            role: membership.role,
            subscriptionStatus: membership.subscription_status,
            planCode: membership.plan_code,
            plan: getBillingPlan(membership.plan_code),
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
    const subscriptionId = crypto.randomUUID();
    const paymentOrderId = crypto.randomUUID();
    const now = new Date();
    const slug = await uniqueWorkspaceSlug(c.env, makeSlug(name));
    const periodEnd = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const paymentExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    await c.env.DB.batch([
        c.env.DB.prepare(`
            INSERT INTO workspaces (id, name, slug, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).bind(workspaceId, name, slug, now.toISOString(), now.toISOString()),
        c.env.DB.prepare(`
            INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
        `).bind(workspaceId, authState.user.id, now.toISOString()),
        c.env.DB.prepare(`
            INSERT INTO organization_subscriptions (
                id, workspace_id, plan_code, status, billing_interval, amount_thb,
                currency, started_at, current_period_end, created_at, updated_at
            ) VALUES (?, ?, ?, 'pending_payment', ?, ?, 'THB', ?, ?, ?, ?)
        `).bind(
            subscriptionId,
            workspaceId,
            plan.code,
            plan.interval,
            plan.amountThb,
            now.toISOString(),
            periodEnd,
            now.toISOString(),
            now.toISOString(),
        ),
        c.env.DB.prepare(`
            INSERT INTO payment_orders (
                id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb,
                currency, status, expires_at, payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'THB', 'pending', ?, ?, ?, ?)
        `).bind(
            paymentOrderId,
            workspaceId,
            subscriptionId,
            plan.code,
            plan.interval,
            plan.amountThb,
            paymentExpiry,
            JSON.stringify({
                manualCheckout: true,
                amountThb: plan.amountThb,
                durationDays: plan.durationDays,
            }),
            now.toISOString(),
            now.toISOString(),
        ),
    ]);

    await updateSessionWorkspace(c.env, authState.session.id, workspaceId);

    return c.json({
        success: true,
        workspace: {
            id: workspaceId,
            name,
            slug,
            role: 'owner',
        },
        subscription: {
            id: subscriptionId,
            status: 'pending_payment',
            planCode: plan.code,
            interval: plan.interval,
            amountThb: plan.amountThb,
            currentPeriodEnd: periodEnd,
        },
        paymentOrder: {
            id: paymentOrderId,
            status: 'pending',
            amountThb: plan.amountThb,
            expiresAt: paymentExpiry,
        },
    });
});

export { app as authRouter };
