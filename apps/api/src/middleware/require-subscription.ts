import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { getEffectiveWorkspaceSubscription } from '../lib/billing-state';

const SKIP_SUBSCRIPTION_ENFORCEMENT = false;

type SubscriptionContext = {
    Bindings: Env;
    Variables: {
        userId: string;
        sessionId: string;
        workspaceId: string | null;
    };
};

export const requireActiveSubscription: MiddlewareHandler<SubscriptionContext> = async (c, next) => {
    if (SKIP_SUBSCRIPTION_ENFORCEMENT) {
        await next();
        return;
    }

    // Bypass สำหรับ internal requests (cron jobs)
    if (c.get('sessionId') === 'internal') {
        await next();
        return;
    }

    const workspaceId = c.get('workspaceId');
    if (!workspaceId) {
        return c.json({ success: false, error: 'Workspace required', code: 'WORKSPACE_REQUIRED' }, 409);
    }

    const sub = await getEffectiveWorkspaceSubscription(c.env as Env, workspaceId);

    if (!sub) {
        return c.json({ success: false, error: 'No subscription found', code: 'SUBSCRIPTION_REQUIRED', reason: 'no_subscription' }, 402);
    }

    if (sub.status === 'pending_payment') {
        return c.json({ success: false, error: 'Payment pending', code: 'SUBSCRIPTION_REQUIRED', reason: 'pending_payment' }, 402);
    }

    if (sub.status === 'cancelled') {
        if (sub.current_period_end && new Date(sub.current_period_end) > new Date()) {
            await next();
            return;
        }
        return c.json({ success: false, error: 'Subscription cancelled', code: 'SUBSCRIPTION_REQUIRED', reason: 'cancelled' }, 402);
    }

    if (sub.status === 'active') {
        if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
            return c.json({ success: false, error: 'Subscription expired', code: 'SUBSCRIPTION_REQUIRED', reason: 'expired' }, 402);
        }
        await next();
        return;
    }

    return c.json({ success: false, error: 'Subscription inactive', code: 'SUBSCRIPTION_REQUIRED', reason: sub.status }, 402);
};
