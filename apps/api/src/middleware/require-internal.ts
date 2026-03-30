import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

export const requireInternal: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    const secret = c.req.header('x-internal-secret')?.trim();
    if (!c.env.INTERNAL_API_SECRET || secret !== c.env.INTERNAL_API_SECRET) {
        return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    await next();
};
