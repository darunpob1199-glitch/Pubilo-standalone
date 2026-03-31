import type { Env } from '../types';

const TMW_API_URL = 'https://tmwallet.thaighost.net/api_mn.php';

type TmwCreatePayResponse = {
    status: number;
    id_pay?: string;
    msg?: string;
};

type TmwDetailPayResponse = {
    status: number;
    ref1?: string;
    amount?: number;
    urlpay?: string;
    time_out?: number;
    qr_base64_image?: string;
    msg?: string;
};

type TmwConfirmResponse = {
    status: number;
    ref1?: string;
    amount?: number;
    msg?: string;
};

type TmwCancelResponse = {
    status: number;
    msg?: string;
};

function buildUrl(env: Env, params: Record<string, string>): string {
    const url = new URL(TMW_API_URL);
    url.searchParams.set('username', env.TMW_USERNAME || '');
    url.searchParams.set('password', env.TMW_PASSWORD || '');
    url.searchParams.set('con_id', env.TMW_CON_ID || '');
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

export function hasTmwConfig(env: Env): boolean {
    return !!(env.TMW_USERNAME && env.TMW_PASSWORD && env.TMW_CON_ID);
}

export async function createPay(env: Env, amount: number, ref1: string): Promise<TmwCreatePayResponse> {
    const url = buildUrl(env, {
        method: 'create_pay',
        amount: String(Math.floor(amount)),
        ref1,
    });

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMW create_pay failed: HTTP ${response.status}`);
    }
    return response.json() as Promise<TmwCreatePayResponse>;
}

export async function detailPay(env: Env, idPay: string, withQr: boolean = true): Promise<TmwDetailPayResponse> {
    const url = buildUrl(env, {
        method: 'detail_pay',
        id_pay: idPay,
        qr: withQr ? '1' : '0',
    });

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMW detail_pay failed: HTTP ${response.status}`);
    }
    return response.json() as Promise<TmwDetailPayResponse>;
}

export async function confirmPay(env: Env, idPay: string, ip: string): Promise<TmwConfirmResponse> {
    const url = buildUrl(env, {
        method: 'confirm',
        id_pay: idPay,
        ip,
    });

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMW confirm failed: HTTP ${response.status}`);
    }
    return response.json() as Promise<TmwConfirmResponse>;
}

export async function cancelPay(env: Env, idPay: string): Promise<TmwCancelResponse> {
    const url = buildUrl(env, {
        method: 'cancel',
        id_pay: idPay,
    });

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMW cancel failed: HTTP ${response.status}`);
    }
    return response.json() as Promise<TmwCancelResponse>;
}
