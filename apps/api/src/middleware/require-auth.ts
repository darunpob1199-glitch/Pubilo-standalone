import type { MiddlewareHandler } from 'hono';
import { getSessionFromRequest, updateSessionWorkspace } from '../auth/session';
import type { Env } from '../types';

type AuthContext = {
    Bindings: Env;
    Variables: {
        userId: string;
        sessionId: string;
        workspaceId: string | null;
    };
};

export const requireAuth: MiddlewareHandler<AuthContext> = async (c, next) => {
    const internalSecret = c.req.header('x-internal-secret')?.trim();
    const internalWorkspaceId = c.req.header('x-workspace-id')?.trim();
    if (
        c.env.INTERNAL_API_SECRET
        && internalSecret === c.env.INTERNAL_API_SECRET
        && internalWorkspaceId
    ) {
        c.set('sessionId', 'internal');
        c.set('userId', 'internal');
        c.set('workspaceId', internalWorkspaceId);
        await next();
        return;
    }

    const authState = await getSessionFromRequest(c);
    if (!authState) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const { session, user, memberships } = authState;
    let workspaceId = session.active_workspace_id;

    if (!workspaceId && memberships.length > 0) {
        workspaceId = memberships[0].workspace_id;
        await updateSessionWorkspace(c.env, session.id, workspaceId);
    }

    c.set('sessionId', session.id);
    c.set('userId', user.id);
    c.set('workspaceId', workspaceId ?? null);

    await next();
};
