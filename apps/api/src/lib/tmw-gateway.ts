import type { Env } from '../types';

const TMW_API_URL = 'https://tmwallet.thaighost.net/api_mn.php';
const TMW_API_FALLBACK_URL = 'https://www.tmweasy.com/api_mn.php';
const TMW_API_ALT_URL = 'https://www.tmweasyapi.com/api_mn.php';

type TmwCreatePayResponse = {
    status: number | string;
    id_pay?: string;
    msg?: string;
    _meta?: {
        endpoint: string;
        httpStatus: number;
        raw: string;
    };
};

type TmwDetailPayResponse = {
    status: number | string;
    ref1?: string;
    amount?: number;
    urlpay?: string;
    time_out?: number;
    qr_base64_image?: string;
    msg?: string;
    _meta?: {
        endpoint: string;
        httpStatus: number;
        raw: string;
    };
};

type TmwConfirmResponse = {
    status: number | string;
    ref1?: string;
    amount?: number;
    msg?: string;
    _meta?: {
        endpoint: string;
        httpStatus: number;
        raw: string;
    };
};

type TmwCancelResponse = {
    status: number | string;
    msg?: string;
    _meta?: {
        endpoint: string;
        httpStatus: number;
        raw: string;
    };
};

function isTmwSuccess(status: unknown): boolean {
    return Number(status) === 1;
}

function normalizeSecret(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const quoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
    return quoted ? raw.slice(1, -1).trim() : raw;
}

function buildUrl(baseUrl: string, env: Env, params: Record<string, string>): string {
    const url = new URL(baseUrl);
    const username = normalizeSecret(env.TMW_USERNAME);
    const password = normalizeSecret(env.TMW_PASSWORD);
    const conId = normalizeSecret(env.TMW_CON_ID);
    url.searchParams.set('username', username);
    // Compatibility alias used by some TMW gateway variants.
    url.searchParams.set('tmweasy_user', username);
    url.searchParams.set('password', password);
    url.searchParams.set('con_id', conId);
    // Compatibility alias used by some gateway docs/examples.
    url.searchParams.set('conid', conId);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

export function hasTmwConfig(env: Env): boolean {
    return !!(env.TMW_USERNAME && env.TMW_PASSWORD && env.TMW_CON_ID);
}

async function callTmw<T extends { status: number | string; msg?: string; _meta?: any }>(
    env: Env,
    params: Record<string, string>,
    options?: { requireSuccessStatus?: boolean },
): Promise<T> {
    const endpoints = [TMW_API_URL, TMW_API_FALLBACK_URL, TMW_API_ALT_URL];
    let lastError: Error | null = null;
    let lastParsed: T | null = null;

    for (const endpoint of endpoints) {
        try {
            const url = buildUrl(endpoint, env, params);
            const response = await fetch(url);
            const raw = await response.text();

            if (!response.ok) {
                lastError = new Error(`HTTP ${response.status} from ${endpoint}`);
                continue;
            }

            let parsed: T;
            try {
                parsed = JSON.parse(raw) as T;
            } catch {
                lastError = new Error(`Invalid JSON from ${endpoint}`);
                continue;
            }

            if (parsed && typeof parsed === 'object') {
                parsed._meta = {
                    endpoint,
                    httpStatus: response.status,
                    raw: raw.slice(0, 300),
                };
                if (options?.requireSuccessStatus && !isTmwSuccess(parsed.status)) {
                    lastParsed = parsed;
                    continue;
                }
                return parsed;
            }
            lastError = new Error(`Unexpected payload from ${endpoint}`);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }

    if (lastParsed) {
        return lastParsed;
    }

    throw new Error(lastError?.message || 'TMW request failed');
}

export async function createPay(env: Env, amount: number, ref1: string): Promise<TmwCreatePayResponse> {
    return callTmw<TmwCreatePayResponse>(env, {
        method: 'create_pay',
        amount: String(Math.floor(amount)),
        ref1,
    }, { requireSuccessStatus: true });
}

export async function detailPay(env: Env, idPay: string, withQr: boolean = true): Promise<TmwDetailPayResponse> {
    return callTmw<TmwDetailPayResponse>(env, {
        method: 'detail_pay',
        id_pay: idPay,
        qr: withQr ? '1' : '0',
    });
}

export async function confirmPay(env: Env, idPay: string, ip: string): Promise<TmwConfirmResponse> {
    return callTmw<TmwConfirmResponse>(env, {
        method: 'confirm',
        id_pay: idPay,
        ip,
    });
}

export async function cancelPay(env: Env, idPay: string): Promise<TmwCancelResponse> {
    return callTmw<TmwCancelResponse>(env, {
        method: 'cancel',
        id_pay: idPay,
    });
}
