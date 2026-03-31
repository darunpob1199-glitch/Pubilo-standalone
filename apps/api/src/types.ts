export interface Env {
    DB: D1Database;
    IMAGES: R2Bucket;
    GEMINI_API_KEY?: string;
    FREEIMAGE_API_KEY?: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_CHANNEL_SECRET?: string;
    LINE_USER_ID?: string;
    OG_IMAGE_BASE_URL?: string;
    APP_ORIGIN?: string;
    API_ORIGIN?: string;
    AUTH_SECRET: string;
    DATA_ENCRYPTION_KEY: string;
    INTERNAL_API_SECRET?: string;
    BILLING_ADMIN_KEY?: string;
    TMW_USERNAME?: string;
    TMW_PASSWORD?: string;
    TMW_CON_ID?: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type AuthSession = {
    id: string;
    user_id: string;
    active_workspace_id: string | null;
    expires_at: string;
};

export type AuthUser = {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
};

export type WorkspaceMembership = {
    workspace_id: string;
    role: WorkspaceRole;
    workspace_name: string;
    slug: string;
    subscription_status: string | null;
    plan_code: string | null;
};
