import type { Env } from '../types';

export type LineIdTokenPayload = {
    iss: string;
    sub: string;
    aud: string;
    exp: number;
    iat: number;
    nonce?: string;
    name?: string;
    picture?: string;
    email?: string;
};

export type LineUserInfo = {
    sub: string;
    name?: string;
    picture?: string;
    email?: string;
};

function base64UrlEncode(bytes: Uint8Array) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length: number) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let output = '';

    for (const byte of bytes) {
        output += alphabet[byte % alphabet.length];
    }

    return output;
}

export function createLineNonce() {
    return randomString(48);
}

export function createCodeVerifier() {
    return randomString(64);
}

export async function createCodeChallenge(codeVerifier: string) {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(codeVerifier),
    );
    return base64UrlEncode(new Uint8Array(digest));
}

export function buildLineAuthUrl(params: {
    channelId: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
}) {
    const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.channelId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('scope', 'openid profile');
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
}

export async function exchangeLineCode(params: {
    env: Env;
    code: string;
    redirectUri: string;
    codeVerifier: string;
}) {
    const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: params.code,
            redirect_uri: params.redirectUri,
            client_id: params.env.LINE_LOGIN_CHANNEL_ID,
            client_secret: params.env.LINE_LOGIN_CHANNEL_SECRET,
            code_verifier: params.codeVerifier,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`LINE token exchange failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<{
        access_token: string;
        expires_in: number;
        id_token?: string;
        refresh_token?: string;
        scope?: string;
        token_type: string;
    }>;
}

export async function verifyLineIdToken(params: {
    env: Env;
    idToken: string;
    nonce?: string | null;
}) {
    const body = new URLSearchParams({
        id_token: params.idToken,
        client_id: params.env.LINE_LOGIN_CHANNEL_ID,
    });

    if (params.nonce) {
        body.set('nonce', params.nonce);
    }

    const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`LINE ID token verify failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<LineIdTokenPayload>;
}

export async function fetchLineUserInfo(accessToken: string): Promise<LineUserInfo> {
    const response = await fetch('https://api.line.me/oauth2/v2.1/userinfo', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`LINE userinfo failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<LineUserInfo>;
}
