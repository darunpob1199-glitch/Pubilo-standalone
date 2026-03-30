import type { Env } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64Url(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function importKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        decodeBase64Url(secret),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptSecret(env: Env, value: string | null | undefined): Promise<string | null> {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return null;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await importKey(env.DATA_ENCRYPTION_KEY);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(normalized),
    );

    const payload = new Uint8Array(iv.length + encrypted.byteLength);
    payload.set(iv, 0);
    payload.set(new Uint8Array(encrypted), iv.length);
    return encodeBase64Url(payload);
}

export async function decryptSecret(env: Env, value: string | null | undefined): Promise<string | null> {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return null;

    const payload = decodeBase64Url(normalized);
    const iv = payload.slice(0, 12);
    const ciphertext = payload.slice(12);
    const key = await importKey(env.DATA_ENCRYPTION_KEY);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext,
    );

    return decoder.decode(decrypted);
}

export function maskSecret(value: string | null | undefined, visible = 4): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return '';
    if (normalized.length <= visible * 2) return normalized;
    return `${normalized.slice(0, visible)}...${normalized.slice(-visible)}`;
}
