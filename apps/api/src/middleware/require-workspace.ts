import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

type WorkspaceContext = {
    Bindings: Env;
    Variables: {
        workspaceId: string | null;
    };
};

export const requireWorkspace: MiddlewareHandler<WorkspaceContext> = async (c, next) => {
    const workspaceId = c.get('workspaceId');
    if (!workspaceId) {
        return c.json({
            success: false,
            error: 'Workspace required',
            code: 'WORKSPACE_REQUIRED',
        }, 409);
    }

    await next();
};
