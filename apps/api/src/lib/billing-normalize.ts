import { getBillingPlan } from '../config/plans';
import type { Env } from '../types';
import type { PaymentOrderRow, SubscriptionRow } from './billing-state';

type CheckoutPayload = {
    applyToSubscriptionId?: string | null;
    targetPlanCode?: string;
    targetBillingInterval?: string;
    targetPeriodEnd?: string;
};

export type BillingNormalizeWorkspaceResult = {
    workspaceId: string;
    changed: number;
    actions: string[];
    errors: string[];
};

export type BillingNormalizeSummary = {
    success: true;
    dryRun: boolean;
    processed: number;
    changedWorkspaces: number;
    totalChanges: number;
    results: BillingNormalizeWorkspaceResult[];
};

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFutureDate(value: string | null | undefined, reference: Date): boolean {
    const parsed = parseDate(value);
    return !!parsed && parsed.getTime() > reference.getTime();
}

function parseCheckoutPayload(raw: string | null | undefined): CheckoutPayload {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as CheckoutPayload : {};
    } catch {
        return {};
    }
}

async function listWorkspaceIds(env: Env, limit: number): Promise<string[]> {
    const result = await env.DB.prepare(`
        SELECT workspace_id
        FROM (
            SELECT workspace_id FROM organization_subscriptions
            UNION
            SELECT workspace_id FROM payment_orders
        )
        WHERE workspace_id IS NOT NULL AND workspace_id != ''
        ORDER BY workspace_id ASC
        LIMIT ?
    `).bind(limit).all<{ workspace_id: string }>();

    return (result.results || []).map((row) => row.workspace_id);
}

async function listWorkspaceSubscriptions(env: Env, workspaceId: string): Promise<SubscriptionRow[]> {
    const result = await env.DB.prepare(`
        SELECT id, workspace_id, plan_code, status, billing_interval, amount_thb, currency,
               started_at, current_period_end, created_at, updated_at
        FROM organization_subscriptions
        WHERE workspace_id = ?
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, id DESC
    `).bind(workspaceId).all<SubscriptionRow>();

    return result.results || [];
}

async function listWorkspaceOrders(env: Env, workspaceId: string): Promise<PaymentOrderRow[]> {
    const result = await env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb, currency,
               status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE workspace_id = ?
        ORDER BY
            datetime(COALESCE(paid_at, created_at)) DESC,
            datetime(created_at) DESC,
            id DESC
    `).bind(workspaceId).all<PaymentOrderRow>();

    return result.results || [];
}

function newestByUpdated<T extends { updated_at?: string | null; created_at?: string | null }>(items: T[]): T[] {
    return [...items].sort((a, b) => {
        const aTs = parseDate(a.updated_at || a.created_at || null)?.getTime() || 0;
        const bTs = parseDate(b.updated_at || b.created_at || null)?.getTime() || 0;
        return bTs - aTs;
    });
}

function latestOrderBySubscriptionId(orders: PaymentOrderRow[]): Map<string, PaymentOrderRow> {
    const latest = new Map<string, PaymentOrderRow>();
    for (const order of newestByUpdated(orders)) {
        const subscriptionId = String(order.subscription_id || '').trim();
        if (!subscriptionId || latest.has(subscriptionId)) continue;
        latest.set(subscriptionId, order);
    }
    return latest;
}

function isSettledOrDeadOrder(order: PaymentOrderRow | null | undefined, now: Date): boolean {
    if (!order) return false;
    if (order.status === 'paid' || order.status === 'cancelled' || order.status === 'expired' || order.status === 'failed') {
        return true;
    }
    return order.status === 'pending' && !!order.expires_at && !isFutureDate(order.expires_at, now);
}

function resolveInactivePeriodEnd(order: PaymentOrderRow | null | undefined, now: Date): string {
    const orderEnd = parseDate(order?.expires_at || null);
    if (orderEnd) {
        return orderEnd.toISOString();
    }
    return now.toISOString();
}

function chooseCanonicalActiveSubscription(subscriptions: SubscriptionRow[], now: Date): SubscriptionRow | null {
    return [...subscriptions]
        .filter((subscription) => subscription.status === 'active' && isFutureDate(subscription.current_period_end, now))
        .sort((left, right) => {
            const leftEnd = parseDate(left.current_period_end)?.getTime() || 0;
            const rightEnd = parseDate(right.current_period_end)?.getTime() || 0;
            if (rightEnd !== leftEnd) return rightEnd - leftEnd;
            return (parseDate(right.updated_at || right.created_at || null)?.getTime() || 0)
                - (parseDate(left.updated_at || left.created_at || null)?.getTime() || 0);
        })[0] || null;
}

async function normalizeWorkspace(env: Env, workspaceId: string, dryRun: boolean, now: Date): Promise<BillingNormalizeWorkspaceResult> {
    const actions: string[] = [];
    const errors: string[] = [];
    let changed = 0;

    const subscriptions = await listWorkspaceSubscriptions(env, workspaceId);
    const orders = await listWorkspaceOrders(env, workspaceId);
    const latestOrderBySubscription = latestOrderBySubscriptionId(orders);

    const canonicalActive = chooseCanonicalActiveSubscription(subscriptions, now);
    const paidOrders = orders.filter((order) => order.status === 'paid');
    const latestPaidOrder = newestByUpdated(paidOrders)[0] || null;

    for (const order of orders) {
        if (order.status === 'pending' && order.expires_at && !isFutureDate(order.expires_at, now)) {
            actions.push(`expire pending order ${order.id}`);
            changed += 1;
            order.status = 'expired';
            if (!dryRun) {
                await env.DB.prepare(`
                    UPDATE payment_orders
                    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'pending'
                `).bind(order.id).run();
            }
        }
    }

    if (latestPaidOrder) {
        const payload = parseCheckoutPayload(latestPaidOrder.payload_json);
        const targetPlan = getBillingPlan(payload.targetPlanCode || latestPaidOrder.plan_code);
        const targetPeriodEnd = payload.targetPeriodEnd || canonicalActive?.current_period_end || latestPaidOrder.paid_at || latestPaidOrder.created_at;
        const canonicalSubscriptionId = String(
            payload.applyToSubscriptionId ||
            latestPaidOrder.subscription_id ||
            canonicalActive?.id ||
            crypto.randomUUID(),
        ).trim();

        const linkedSubscription = subscriptions.find((subscription) => subscription.id === canonicalSubscriptionId) || null;

        if (!linkedSubscription) {
            actions.push(`create active subscription ${canonicalSubscriptionId} from paid order ${latestPaidOrder.id}`);
            changed += 1;
            if (!dryRun) {
                await env.DB.prepare(`
                    INSERT INTO organization_subscriptions (
                        id, workspace_id, plan_code, status, billing_interval, amount_thb, currency,
                        started_at, current_period_end, created_at, updated_at
                    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `).bind(
                    canonicalSubscriptionId,
                    workspaceId,
                    targetPlan?.code || latestPaidOrder.plan_code,
                    targetPlan?.interval || latestPaidOrder.billing_interval,
                    latestPaidOrder.amount_thb,
                    latestPaidOrder.currency || 'THB',
                    latestPaidOrder.paid_at || latestPaidOrder.created_at,
                    targetPeriodEnd,
                ).run();
            }
        } else {
            const safePeriodEnd = (() => {
                const targetTs = parseDate(targetPeriodEnd)?.getTime() || 0;
                const existingTs = parseDate(linkedSubscription.current_period_end)?.getTime() || 0;
                return existingTs > targetTs ? linkedSubscription.current_period_end : targetPeriodEnd;
            })();
            const needsActivation =
                linkedSubscription.status !== 'active' ||
                linkedSubscription.plan_code !== (targetPlan?.code || latestPaidOrder.plan_code) ||
                linkedSubscription.billing_interval !== (targetPlan?.interval || latestPaidOrder.billing_interval) ||
                linkedSubscription.amount_thb !== latestPaidOrder.amount_thb ||
                (safePeriodEnd && String(linkedSubscription.current_period_end || '') !== String(safePeriodEnd));

            if (needsActivation) {
                actions.push(`sync subscription ${linkedSubscription.id} from paid order ${latestPaidOrder.id}`);
                changed += 1;
                if (!dryRun) {
                    await env.DB.prepare(`
                        UPDATE organization_subscriptions
                        SET plan_code = ?,
                            status = 'active',
                            billing_interval = ?,
                            amount_thb = ?,
                            currency = ?,
                            started_at = COALESCE(started_at, ?),
                            current_period_end = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).bind(
                        targetPlan?.code || latestPaidOrder.plan_code,
                        targetPlan?.interval || latestPaidOrder.billing_interval,
                        latestPaidOrder.amount_thb,
                        latestPaidOrder.currency || 'THB',
                        latestPaidOrder.paid_at || latestPaidOrder.created_at,
                        safePeriodEnd,
                        linkedSubscription.id,
                    ).run();
                }
            }
        }
    }

    const freshActiveId = latestPaidOrder
        ? String(parseCheckoutPayload(latestPaidOrder.payload_json).applyToSubscriptionId || latestPaidOrder.subscription_id || canonicalActive?.id || '').trim()
        : canonicalActive?.id || '';

    for (const subscription of subscriptions) {
        if (subscription.status !== 'pending_payment') continue;
        if (subscription.id === freshActiveId) continue;

        const linkedOrder = latestOrderBySubscription.get(subscription.id) || null;
        const hasLivePendingOrder =
            linkedOrder?.status === 'pending' &&
            (!linkedOrder.expires_at || isFutureDate(linkedOrder.expires_at, now));

        if (hasLivePendingOrder) continue;

        const shouldCancel =
            isSettledOrDeadOrder(linkedOrder, now) ||
            (!linkedOrder && !!freshActiveId);

        if (!shouldCancel) continue;

        const reason = linkedOrder
            ? `linked order ${linkedOrder.id} is ${linkedOrder.status}`
            : 'workspace already has a fresher active entitlement';

        actions.push(`cancel stale pending subscription ${subscription.id} (${reason})`);
        changed += 1;
        if (!dryRun) {
            await env.DB.prepare(`
                UPDATE organization_subscriptions
                SET status = 'cancelled',
                    current_period_end = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending_payment'
            `).bind(resolveInactivePeriodEnd(linkedOrder, now), subscription.id).run();
        }
    }

    for (const subscription of subscriptions) {
        if (subscription.status !== 'cancelled') continue;
        if (!isFutureDate(subscription.current_period_end, now)) continue;

        const linkedOrder = latestOrderBySubscription.get(subscription.id) || null;
        const hasPaidOrder = orders.some((order) => order.subscription_id === subscription.id && order.status === 'paid');

        if (!linkedOrder || hasPaidOrder) continue;

        actions.push(`shrink cancelled subscription ${subscription.id} to ${resolveInactivePeriodEnd(linkedOrder, now)}`);
        changed += 1;
        if (!dryRun) {
            await env.DB.prepare(`
                UPDATE organization_subscriptions
                SET current_period_end = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'cancelled'
            `).bind(resolveInactivePeriodEnd(linkedOrder, now), subscription.id).run();
        }
    }

    return {
        workspaceId,
        changed,
        actions,
        errors,
    };
}

export async function normalizeBillingData(env: Env, options?: {
    workspaceId?: string | null;
    limit?: number;
    dryRun?: boolean;
}): Promise<BillingNormalizeSummary> {
    const now = new Date();
    const dryRun = options?.dryRun !== false;
    const limit = Math.max(1, Math.min(Number(options?.limit || 200), 1000));
    const workspaceIds = options?.workspaceId
        ? [String(options.workspaceId)]
        : await listWorkspaceIds(env, limit);

    const results: BillingNormalizeWorkspaceResult[] = [];
    for (const workspaceId of workspaceIds) {
        try {
            results.push(await normalizeWorkspace(env, workspaceId, dryRun, now));
        } catch (error) {
            results.push({
                workspaceId,
                changed: 0,
                actions: [],
                errors: [error instanceof Error ? error.message : String(error)],
            });
        }
    }

    return {
        success: true,
        dryRun,
        processed: results.length,
        changedWorkspaces: results.filter((result) => result.changed > 0).length,
        totalChanges: results.reduce((sum, result) => sum + result.changed, 0),
        results,
    };
}
