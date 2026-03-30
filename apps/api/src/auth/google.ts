import type { Env } from '../types';

export type GoogleProfile = {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
};

export function buildGoogleAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
}) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', params.state);
    return url.toString();
}

export async function exchangeGoogleCode(params: {
    env: Env;
    code: string;
    redirectUri: string;
}) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code: params.code,
            client_id: params.env.GOOGLE_CLIENT_ID,
            client_secret: params.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: params.redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google token exchange failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
        id_token?: string;
    }>;
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google userinfo failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<GoogleProfile>;
}
