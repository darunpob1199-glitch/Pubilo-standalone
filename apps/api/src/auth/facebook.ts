import type { Env } from '../types';

const DEFAULT_GRAPH_VERSION = 'v21.0';

export type FacebookUserProfile = {
    id: string;
    name: string;
    pictureUrl: string;
};

export type FacebookPageAccess = {
    id: string;
    name: string;
    accessToken: string;
    category: string;
    tasks: string[];
    pictureUrl: string;
};

type GraphErrorPayload = {
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
    };
};

function normalizeGraphVersion(env: Env): string {
    const raw = String(env.FACEBOOK_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
    if (!raw) return DEFAULT_GRAPH_VERSION;
    return raw.startsWith('v') ? raw : `v${raw}`;
}

function graphBaseUrl(env: Env): string {
    return `https://graph.facebook.com/${normalizeGraphVersion(env)}`;
}

function normalizeGraphError(payload: GraphErrorPayload | any, fallback: string): Error {
    const graphError = payload?.error || {};
    const parts = [
        graphError.message,
        graphError.code ? `code=${graphError.code}` : '',
        graphError.type ? `type=${graphError.type}` : '',
        graphError.error_subcode ? `subcode=${graphError.error_subcode}` : '',
    ].filter(Boolean);
    return new Error(parts.length ? parts.join(' ') : fallback);
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
        throw normalizeGraphError(payload, fallbackMessage);
    }
    return payload as T;
}

async function getGraphJson<T>(env: Env, path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${graphBaseUrl(env)}${path}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
        }
    });
    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Pubilo/1.0 (+https://pubilo.com)',
        },
    });
    return readJsonResponse<T>(response, 'Facebook Graph API request failed');
}

export function hasFacebookLoginConfig(env: Env): boolean {
    return Boolean(String(env.FACEBOOK_APP_ID || '').trim())
        && Boolean(String(env.FACEBOOK_APP_SECRET || '').trim());
}

export function buildFacebookAuthUrl(input: {
    env: Env;
    redirectUri: string;
    state: string;
    scopes?: string[];
}): string {
    const scopes = input.scopes || [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
    ];
    const url = new URL(`https://www.facebook.com/${normalizeGraphVersion(input.env)}/dialog/oauth`);
    url.searchParams.set('client_id', String(input.env.FACEBOOK_APP_ID || '').trim());
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(','));
    url.searchParams.set('auth_type', 'rerequest');
    return url.toString();
}

export async function exchangeFacebookCode(input: {
    env: Env;
    code: string;
    redirectUri: string;
}): Promise<{ accessToken: string; tokenType: string; expiresIn: number | null }> {
    const payload = await getGraphJson<{
        access_token?: string;
        token_type?: string;
        expires_in?: number;
    }>(input.env, '/oauth/access_token', {
        client_id: String(input.env.FACEBOOK_APP_ID || '').trim(),
        client_secret: String(input.env.FACEBOOK_APP_SECRET || '').trim(),
        redirect_uri: input.redirectUri,
        code: input.code,
    });

    const accessToken = String(payload.access_token || '').trim();
    if (!accessToken) {
        throw new Error('Facebook code exchange did not return an access token');
    }

    return {
        accessToken,
        tokenType: String(payload.token_type || '').trim(),
        expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    };
}

export async function exchangeLongLivedFacebookUserToken(input: {
    env: Env;
    accessToken: string;
}): Promise<{ accessToken: string; tokenType: string; expiresIn: number | null }> {
    const payload = await getGraphJson<{
        access_token?: string;
        token_type?: string;
        expires_in?: number;
    }>(input.env, '/oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: String(input.env.FACEBOOK_APP_ID || '').trim(),
        client_secret: String(input.env.FACEBOOK_APP_SECRET || '').trim(),
        fb_exchange_token: input.accessToken,
    });

    const accessToken = String(payload.access_token || '').trim();
    if (!accessToken) {
        throw new Error('Facebook long-lived token exchange did not return an access token');
    }

    return {
        accessToken,
        tokenType: String(payload.token_type || '').trim(),
        expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    };
}

export async function fetchFacebookMe(env: Env, accessToken: string): Promise<FacebookUserProfile> {
    const payload = await getGraphJson<{
        id?: string;
        name?: string;
        picture?: { data?: { url?: string } };
    }>(env, '/me', {
        fields: 'id,name,picture{url}',
        access_token: accessToken,
    });

    const id = String(payload.id || '').trim();
    if (!id) throw new Error('Facebook profile response is missing id');

    return {
        id,
        name: String(payload.name || id).trim(),
        pictureUrl: String(payload.picture?.data?.url || '').trim(),
    };
}

export async function fetchFacebookPages(env: Env, accessToken: string): Promise<FacebookPageAccess[]> {
    const pages: FacebookPageAccess[] = [];
    let nextUrl: string | null = null;
    const firstUrl = new URL(`${graphBaseUrl(env)}/me/accounts`);
    firstUrl.searchParams.set('fields', 'id,name,access_token,category,tasks,picture{url}');
    firstUrl.searchParams.set('limit', '200');
    firstUrl.searchParams.set('access_token', accessToken);
    nextUrl = firstUrl.toString();

    for (let guard = 0; nextUrl && guard < 10; guard += 1) {
        const response = await fetch(nextUrl, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Pubilo/1.0 (+https://pubilo.com)',
            },
        });
        const payload = await readJsonResponse<{
            data?: Array<{
                id?: string;
                name?: string;
                access_token?: string;
                category?: string;
                tasks?: string[];
                picture?: { data?: { url?: string } };
            }>;
            paging?: { next?: string };
        }>(response, 'Facebook page list request failed');

        for (const page of payload.data || []) {
            const id = String(page.id || '').trim();
            if (!id) continue;
            pages.push({
                id,
                name: String(page.name || id).trim(),
                accessToken: String(page.access_token || '').trim(),
                category: String(page.category || '').trim(),
                tasks: Array.isArray(page.tasks) ? page.tasks.map((task) => String(task || '').trim()).filter(Boolean) : [],
                pictureUrl: String(page.picture?.data?.url || '').trim(),
            });
        }

        nextUrl = payload.paging?.next || null;
    }

    return pages;
}
