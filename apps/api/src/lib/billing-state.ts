import { getBillingPlan, type BillingPlan } from '../config/plans';
import type { Env } from '../types';

export type SubscriptionRow = {
    id: string;
    workspace_id: string;
    plan_code: string;
    status: string;
    billing_interval: string;
    amount_thb: number;
    currency: string;
    started_at: string | null;
    current_period_end: string | null;
    created_at: string;
    updated_at: string;
};

export type PaymentOrderRow = {
    id: string;
    workspace_id: string;
    subscription_id: string | null;
    plan_code: string;
    billing_interval: string;
    amount_thb: number;
    currency: string;
    status: string;
    gateway: string | null;
    gateway_reference: string | null;
    qr_reference: string | null;
    expires_at: string | null;
    paid_at: string | null;
    payload_json: string | null;
    created_at: string;
    updated_at: string;
};

type CheckoutPayload = {
    checkoutSource?: 'billing' | 'onboarding';
    applyToSubscriptionId?: string | null;
    targetPlanCode?: string;
    targetBillingInterval?: string;
    targetDurationDays?: number;
    targetPeriodEnd?: string;
    basedOnSubscriptionId?: string | null;
    gatewayReady?: boolean;
    manualCheckout?: boolean;
    amountThb?: number;
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

function subscriptionRank(subscription: SubscriptionRow, reference: Date): number {
    if (subscription.status === 'active' && isFutureDate(subscription.current_period_end, reference)) return 0;
    if (subscription.status === 'cancelled' && isFutureDate(subscription.current_period_end, reference)) return 1;
    if (subscription.status === 'pending_payment') return 2;
    if (subscription.status === 'active') return 3;
    if (subscription.status === 'cancelled') return 4;
    return 5;
}

function sortByNewest<T extends { updated_at?: string | null; created_at?: string | null }>(items: T[]): T[] {
    return [...items].sort((a, b) => {
        const aUpdated = parseDate(a.updated_at || a.created_at || null)?.getTime() || 0;
        const bUpdated = parseDate(b.updated_at || b.created_at || null)?.getTime() || 0;
        return bUpdated - aUpdated;
    });
}

function parseCheckoutPayload(order: PaymentOrderRow | null | undefined): CheckoutPayload {
    if (!order?.payload_json) return {};
    try {
        const parsed = JSON.parse(order.payload_json);
        return parsed && typeof parsed === 'object' ? parsed as CheckoutPayload : {};
    } catch {
        return {};
    }
}

export function buildCheckoutPayload(input: {
    source: 'billing' | 'onboarding';
    subscriptionId: string | null;
    plan: BillingPlan;
    targetPeriodEnd: string;
    basedOnSubscriptionId?: string | null;
}) {
    return JSON.stringify({
        checkoutSource: input.source,
        applyToSubscriptionId: input.subscriptionId,
        targetPlanCode: input.plan.code,
        targetBillingInterval: input.plan.interval,
        targetDurationDays: input.plan.durationDays,
        targetPeriodEnd: input.targetPeriodEnd,
        basedOnSubscriptionId: input.basedOnSubscriptionId || null,
        gatewayReady: false,
        manualCheckout: true,
        amountThb: input.plan.amountThb,
    } satisfies CheckoutPayload);
}

export async function listWorkspaceSubscriptions(env: Env, workspaceId: string): Promise<SubscriptionRow[]> {
    const result = await env.DB.prepare(`
        SELECT id, workspace_id, plan_code, status, billing_interval, amount_thb, currency, started_at, current_period_end, created_at, updated_at
        FROM organization_subscriptions
        WHERE workspace_id = ?
    `).bind(workspaceId).all<SubscriptionRow>();
    return result.results || [];
}

export async function getEffectiveWorkspaceSubscription(env: Env, workspaceId: string): Promise<SubscriptionRow | null> {
    const now = new Date();
    const subscriptions = await listWorkspaceSubscriptions(env, workspaceId);
    if (!subscriptions.length) return null;
    return [...subscriptions].sort((left, right) => {
        const rankDiff = subscriptionRank(left, now) - subscriptionRank(right, now);
        if (rankDiff !== 0) return rankDiff;
        const leftUpdated = parseDate(left.updated_at || left.created_at)?.getTime() || 0;
        const rightUpdated = parseDate(right.updated_at || right.created_at)?.getTime() || 0;
        return rightUpdated - leftUpdated;
    })[0] || null;
}

export async function getActiveWorkspaceSubscription(env: Env, workspaceId: string): Promise<SubscriptionRow | null> {
    const now = new Date();
    const subscriptions = await listWorkspaceSubscriptions(env, workspaceId);
    return sortByNewest(
        subscriptions.filter((subscription) =>
            subscription.status === 'active' && isFutureDate(subscription.current_period_end, now),
        ),
    )[0] || null;
}

export async function getPendingWorkspaceSubscription(env: Env, workspaceId: string): Promise<SubscriptionRow | null> {
    const subscriptions = await listWorkspaceSubscriptions(env, workspaceId);
    return sortByNewest(
        subscriptions.filter((subscription) => subscription.status === 'pending_payment'),
    )[0] || null;
}

export async function getLatestWorkspacePaymentOrder(env: Env, workspaceId: string): Promise<PaymentOrderRow | null> {
    return await env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb, currency, status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE workspace_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
    `).bind(workspaceId).first<PaymentOrderRow>() || null;
}

async function findReusablePendingOrder(env: Env, workspaceId: string, planCode: string): Promise<PaymentOrderRow | null> {
    const now = new Date();
    const result = await env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb, currency, status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE workspace_id = ?
          AND status = 'pending'
          AND plan_code = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 5
    `).bind(workspaceId, planCode).all<PaymentOrderRow>();

    return (result.results || []).find((order) => !order.expires_at || isFutureDate(order.expires_at, now)) || null;
}

function calculateTargetPeriodEnd(plan: BillingPlan, activeSubscription: SubscriptionRow | null, now: Date): string {
    const activePeriodEnd = parseDate(activeSubscription?.current_period_end || null);
    const base = activePeriodEnd && activePeriodEnd.getTime() > now.getTime() ? activePeriodEnd : now;
    return new Date(base.getTime() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function createCheckoutIntent(env: Env, input: {
    workspaceId: string;
    plan: BillingPlan;
    source: 'billing' | 'onboarding';
}): Promise<{
    subscription: SubscriptionRow;
    paymentOrder: PaymentOrderRow;
    reusedOrder: boolean;
}> {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const activeSubscription = await getActiveWorkspaceSubscription(env, input.workspaceId);
    const pendingSubscription = activeSubscription ? null : await getPendingWorkspaceSubscription(env, input.workspaceId);
    const targetPeriodEnd = calculateTargetPeriodEnd(input.plan, activeSubscription, now);

    let subscription: SubscriptionRow;
    if (activeSubscription) {
        subscription = activeSubscription;
    } else if (pendingSubscription) {
        await env.DB.prepare(`
            UPDATE organization_subscriptions
            SET plan_code = ?, billing_interval = ?, amount_thb = ?, currency = 'THB',
                started_at = COALESCE(started_at, ?),
                current_period_end = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(
            input.plan.code,
            input.plan.interval,
            input.plan.amountThb,
            nowIso,
            targetPeriodEnd,
            nowIso,
            pendingSubscription.id,
        ).run();
        subscription = {
            ...pendingSubscription,
            plan_code: input.plan.code,
            billing_interval: input.plan.interval,
            amount_thb: input.plan.amountThb,
            currency: 'THB',
            started_at: pendingSubscription.started_at || nowIso,
            current_period_end: targetPeriodEnd,
            updated_at: nowIso,
        };
    } else {
        subscription = {
            id: crypto.randomUUID(),
            workspace_id: input.workspaceId,
            plan_code: input.plan.code,
            status: 'pending_payment',
            billing_interval: input.plan.interval,
            amount_thb: input.plan.amountThb,
            currency: 'THB',
            started_at: nowIso,
            current_period_end: targetPeriodEnd,
            created_at: nowIso,
            updated_at: nowIso,
        };
        await env.DB.prepare(`
            INSERT INTO organization_subscriptions (
                id, workspace_id, plan_code, status, billing_interval, amount_thb, currency,
                started_at, current_period_end, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            subscription.id,
            subscription.workspace_id,
            subscription.plan_code,
            subscription.status,
            subscription.billing_interval,
            subscription.amount_thb,
            subscription.currency,
            subscription.started_at,
            subscription.current_period_end,
            subscription.created_at,
            subscription.updated_at,
        ).run();
    }

    const reusableOrder = await findReusablePendingOrder(env, input.workspaceId, input.plan.code);
    if (reusableOrder) {
        await env.DB.prepare(`
            UPDATE payment_orders
            SET subscription_id = ?,
                billing_interval = ?,
                amount_thb = ?,
                expires_at = ?,
                payload_json = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(
            subscription.id,
            input.plan.interval,
            input.plan.amountThb,
            expiresAt,
            buildCheckoutPayload({
                source: input.source,
                subscriptionId: subscription.id,
                plan: input.plan,
                targetPeriodEnd,
                basedOnSubscriptionId: activeSubscription?.id || pendingSubscription?.id || null,
            }),
            nowIso,
            reusableOrder.id,
        ).run();

        return {
            subscription,
            paymentOrder: {
                ...reusableOrder,
                subscription_id: subscription.id,
                billing_interval: input.plan.interval,
                amount_thb: input.plan.amountThb,
                expires_at: expiresAt,
                payload_json: buildCheckoutPayload({
                    source: input.source,
                    subscriptionId: subscription.id,
                    plan: input.plan,
                    targetPeriodEnd,
                    basedOnSubscriptionId: activeSubscription?.id || pendingSubscription?.id || null,
                }),
                updated_at: nowIso,
            },
            reusedOrder: true,
        };
    }

    const paymentOrder: PaymentOrderRow = {
        id: crypto.randomUUID(),
        workspace_id: input.workspaceId,
        subscription_id: subscription.id,
        plan_code: input.plan.code,
        billing_interval: input.plan.interval,
        amount_thb: input.plan.amountThb,
        currency: 'THB',
        status: 'pending',
        gateway: null,
        gateway_reference: null,
        qr_reference: null,
        expires_at: expiresAt,
        paid_at: null,
        payload_json: buildCheckoutPayload({
            source: input.source,
            subscriptionId: subscription.id,
            plan: input.plan,
            targetPeriodEnd,
            basedOnSubscriptionId: activeSubscription?.id || pendingSubscription?.id || null,
        }),
        created_at: nowIso,
        updated_at: nowIso,
    };

    await env.DB.prepare(`
        INSERT INTO payment_orders (
            id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb,
            currency, status, expires_at, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        paymentOrder.id,
        paymentOrder.workspace_id,
        paymentOrder.subscription_id,
        paymentOrder.plan_code,
        paymentOrder.billing_interval,
        paymentOrder.amount_thb,
        paymentOrder.currency,
        paymentOrder.status,
        paymentOrder.expires_at,
        paymentOrder.payload_json,
        paymentOrder.created_at,
        paymentOrder.updated_at,
    ).run();

    return { subscription, paymentOrder, reusedOrder: false };
}

export async function applyPaidPaymentOrder(env: Env, orderId: string, options?: {
    paidAt?: string;
    gateway?: string | null;
}) {
    const order = await env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb, currency, status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE id = ?
        LIMIT 1
    `).bind(orderId).first<PaymentOrderRow>();

    if (!order) {
        throw new Error('Order not found');
    }

    if (order.status === 'paid') {
        const subscriptionId = String(order.subscription_id || '').trim();
        if (!subscriptionId) {
            throw new Error('Paid order missing subscription_id');
        }

        const existingSubscription = await env.DB.prepare(`
            SELECT id, workspace_id, plan_code, status, billing_interval, amount_thb, currency, started_at, current_period_end, created_at, updated_at
            FROM organization_subscriptions
            WHERE id = ?
            LIMIT 1
        `).bind(subscriptionId).first<SubscriptionRow>();

        if (!existingSubscription) {
            throw new Error('Paid order subscription not found');
        }

        return {
            order,
            subscription: existingSubscription,
        };
    }

    const nowIso = options?.paidAt || new Date().toISOString();
    const payload = parseCheckoutPayload(order);
    const plan = getBillingPlan(payload.targetPlanCode || order.plan_code);
    if (!plan) {
        throw new Error('Invalid plan for order');
    }

    const targetPeriodEnd = payload.targetPeriodEnd || calculateTargetPeriodEnd(
        plan,
        await getActiveWorkspaceSubscription(env, order.workspace_id),
        new Date(nowIso),
    );
    const subscriptionId = String(payload.applyToSubscriptionId || order.subscription_id || crypto.randomUUID()).trim();

    let subscription = await env.DB.prepare(`
        SELECT id, workspace_id, plan_code, status, billing_interval, amount_thb, currency, started_at, current_period_end, created_at, updated_at
        FROM organization_subscriptions
        WHERE id = ?
        LIMIT 1
    `).bind(subscriptionId).first<SubscriptionRow>();

    if (subscription) {
        await env.DB.prepare(`
            UPDATE organization_subscriptions
            SET plan_code = ?, status = 'active', billing_interval = ?, amount_thb = ?, currency = ?,
                started_at = COALESCE(started_at, ?),
                current_period_end = ?,
                updated_at = ?
            WHERE id = ?
        `).bind(
            plan.code,
            plan.interval,
            order.amount_thb,
            order.currency || 'THB',
            nowIso,
            targetPeriodEnd,
            nowIso,
            subscription.id,
        ).run();
        subscription = {
            ...subscription,
            plan_code: plan.code,
            status: 'active',
            billing_interval: plan.interval,
            amount_thb: order.amount_thb,
            currency: order.currency || 'THB',
            started_at: subscription.started_at || nowIso,
            current_period_end: targetPeriodEnd,
            updated_at: nowIso,
        };
    } else {
        subscription = {
            id: subscriptionId,
            workspace_id: order.workspace_id,
            plan_code: plan.code,
            status: 'active',
            billing_interval: plan.interval,
            amount_thb: order.amount_thb,
            currency: order.currency || 'THB',
            started_at: nowIso,
            current_period_end: targetPeriodEnd,
            created_at: nowIso,
            updated_at: nowIso,
        };
        await env.DB.prepare(`
            INSERT INTO organization_subscriptions (
                id, workspace_id, plan_code, status, billing_interval, amount_thb, currency,
                started_at, current_period_end, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            subscription.id,
            subscription.workspace_id,
            subscription.plan_code,
            subscription.status,
            subscription.billing_interval,
            subscription.amount_thb,
            subscription.currency,
            subscription.started_at,
            subscription.current_period_end,
            subscription.created_at,
            subscription.updated_at,
        ).run();
    }

    await env.DB.batch([
        env.DB.prepare(`
            UPDATE payment_orders
            SET status = 'paid',
                paid_at = ?,
                gateway = COALESCE(?, gateway),
                updated_at = ?
            WHERE id = ?
        `).bind(nowIso, options?.gateway || null, nowIso, order.id),
        env.DB.prepare(`
            UPDATE organization_subscriptions
            SET status = 'cancelled', updated_at = ?
            WHERE workspace_id = ?
              AND id != ?
              AND status = 'pending_payment'
        `).bind(nowIso, order.workspace_id, subscription.id),
    ]);

    return {
        order: {
            ...order,
            status: 'paid',
            paid_at: nowIso,
            gateway: options?.gateway || order.gateway,
            updated_at: nowIso,
        },
        subscription,
    };
}

export async function markPaymentOrderExpired(env: Env, orderId: string) {
    await env.DB.prepare(`
        UPDATE payment_orders
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'pending'
    `).bind(orderId).run();
}
