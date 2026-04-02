import type { Env } from '../types';
import { applyPaidPaymentOrder, markPaymentOrderExpired, type PaymentOrderRow } from './billing-state';
import { confirmPay, detailPay, hasTmwConfig } from './tmw-gateway';

type PendingPaymentOrder = PaymentOrderRow & {
    workspace_id: string;
};

export type PaymentReconcileItem = {
    orderId: string;
    workspaceId: string;
    status: 'paid' | 'expired' | 'pending' | 'skipped' | 'error';
    reason: string;
    gatewayReference?: string | null;
};

export type PaymentReconcileSummary = {
    success: true;
    processed: number;
    paid: number;
    expired: number;
    pending: number;
    skipped: number;
    errors: number;
    results: PaymentReconcileItem[];
};

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPast(value: string | null | undefined, reference: Date): boolean {
    const parsed = parseDate(value);
    return !!parsed && parsed.getTime() <= reference.getTime();
}

async function listPendingPaymentOrders(env: Env, limit: number): Promise<PendingPaymentOrder[]> {
    const result = await env.DB.prepare(`
        SELECT id, workspace_id, subscription_id, plan_code, billing_interval, amount_thb, currency,
               status, gateway, gateway_reference, qr_reference, expires_at, paid_at, payload_json, created_at, updated_at
        FROM payment_orders
        WHERE status = 'pending'
        ORDER BY
            CASE WHEN gateway_reference IS NULL OR gateway_reference = '' THEN 1 ELSE 0 END ASC,
            datetime(updated_at) ASC,
            datetime(created_at) ASC
        LIMIT ?
    `).bind(limit).all<PendingPaymentOrder>();

    return result.results || [];
}

async function reconcileOnePendingOrder(
    env: Env,
    order: PendingPaymentOrder,
    clientIp: string,
    now: Date,
): Promise<PaymentReconcileItem> {
    if (order.status !== 'pending') {
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'skipped',
            reason: `order_already_${order.status}`,
            gatewayReference: order.gateway_reference,
        };
    }

    if (isPast(order.expires_at, now)) {
        await markPaymentOrderExpired(env, order.id);
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'expired',
            reason: 'expired_by_local_timeout',
            gatewayReference: order.gateway_reference,
        };
    }

    if (!order.gateway_reference) {
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'pending',
            reason: 'awaiting_qr_generation',
            gatewayReference: null,
        };
    }

    if (!hasTmwConfig(env)) {
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'skipped',
            reason: 'gateway_not_configured',
            gatewayReference: order.gateway_reference,
        };
    }

    const confirm = await confirmPay(env, order.gateway_reference, clientIp);
    if (Number(confirm.status) === 1) {
        await applyPaidPaymentOrder(env, order.id, {
            paidAt: now.toISOString(),
            gateway: order.gateway || 'tmw_maemanee',
        });
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'paid',
            reason: 'gateway_confirmed',
            gatewayReference: order.gateway_reference,
        };
    }

    const detail = await detailPay(env, order.gateway_reference, false);
    if (typeof detail.time_out === 'number' && detail.time_out < 0) {
        await markPaymentOrderExpired(env, order.id);
        return {
            orderId: order.id,
            workspaceId: order.workspace_id,
            status: 'expired',
            reason: 'gateway_timeout_expired',
            gatewayReference: order.gateway_reference,
        };
    }

    return {
        orderId: order.id,
        workspaceId: order.workspace_id,
        status: 'pending',
        reason: Number(detail.status) === 1 ? 'gateway_pending' : String(detail.msg || 'gateway_not_confirmed'),
        gatewayReference: order.gateway_reference,
    };
}

export async function reconcilePendingPaymentOrders(env: Env, options?: {
    limit?: number;
    clientIp?: string;
}): Promise<PaymentReconcileSummary> {
    const limit = Math.max(1, Math.min(Number(options?.limit || 20), 100));
    const clientIp = options?.clientIp || '127.0.0.1';
    const now = new Date();
    const orders = await listPendingPaymentOrders(env, limit);
    const results: PaymentReconcileItem[] = [];

    for (const order of orders) {
        try {
            const item = await reconcileOnePendingOrder(env, order, clientIp, now);
            results.push(item);
        } catch (error) {
            results.push({
                orderId: order.id,
                workspaceId: order.workspace_id,
                status: 'error',
                reason: error instanceof Error ? error.message : String(error),
                gatewayReference: order.gateway_reference,
            });
        }
    }

    return {
        success: true,
        processed: results.length,
        paid: results.filter((item) => item.status === 'paid').length,
        expired: results.filter((item) => item.status === 'expired').length,
        pending: results.filter((item) => item.status === 'pending').length,
        skipped: results.filter((item) => item.status === 'skipped').length,
        errors: results.filter((item) => item.status === 'error').length,
        results,
    };
}
