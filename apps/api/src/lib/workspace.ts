import type { Context } from 'hono';

export function getWorkspaceId(c: Context<any>): string {
    return String(c.get('workspaceId'));
}

export function getUserId(c: Context<any>): string {
    return String(c.get('userId'));
}

export function getSessionId(c: Context<any>): string {
    return String(c.get('sessionId'));
}
