import { BILLING_PLANS } from '../config/plans';
import type { Env } from '../types';

export const LEGACY_WORKSPACE_ID = 'ws_legacy';
const LEGACY_WORKSPACE_NAME = 'Legacy Workspace';

let bootstrapPromise: Promise<void> | null = null;

async function tableExists(env: Env, tableName: string) {
    const row = await env.DB.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1
    `).bind(tableName).first<{ name: string }>();
    return !!row?.name;
}

async function columnExists(env: Env, tableName: string, columnName: string) {
    const result = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all<{
        name: string;
    }>();
    return (result.results || []).some((row) => row.name === columnName);
}

async function hasMigration(env: Env, name: string) {
    const row = await env.DB.prepare(`
        SELECT name FROM app_migrations WHERE name = ? LIMIT 1
    `).bind(name).first<{ name: string }>();
    return !!row?.name;
}

async function markMigration(env: Env, name: string) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO app_migrations (name, created_at)
        VALUES (?, CURRENT_TIMESTAMP)
    `).bind(name).run();
}

async function runMigration(env: Env, name: string, task: () => Promise<void>) {
    if (await hasMigration(env, name)) return;
    await task();
    await markMigration(env, name);
}

async function ensureBaseTables(env: Env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS app_migrations (
            name TEXT PRIMARY KEY,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT,
            avatar_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login_at TEXT
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS line_accounts (
            line_user_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            email TEXT,
            display_name TEXT,
            picture_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS oauth_states (
            state TEXT PRIMARY KEY,
            return_to TEXT,
            expires_at TEXT NOT NULL,
            nonce TEXT,
            code_verifier TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS workspace_members (
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (workspace_id, user_id)
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            active_workspace_id TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS organization_settings (
            workspace_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (workspace_id, setting_key)
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS facebook_credentials (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            facebook_user_id TEXT,
            ads_token_encrypted TEXT,
            cookie_encrypted TEXT,
            fb_dtsg_encrypted TEXT,
            account_name TEXT,
            avatar_url TEXT,
            created_by_user_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS billing_plans (
            code TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            interval TEXT NOT NULL,
            amount_thb INTEGER NOT NULL,
            duration_days INTEGER NOT NULL,
            description TEXT,
            active INTEGER NOT NULL DEFAULT 1
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS organization_subscriptions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            plan_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_payment',
            billing_interval TEXT NOT NULL,
            amount_thb INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'THB',
            started_at TEXT,
            current_period_end TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS payment_orders (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            subscription_id TEXT,
            plan_code TEXT NOT NULL,
            billing_interval TEXT NOT NULL,
            amount_thb INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'THB',
            status TEXT NOT NULL DEFAULT 'pending',
            gateway TEXT,
            gateway_reference TEXT,
            qr_reference TEXT,
            expires_at TEXT,
            paid_at TEXT,
            payload_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS usage_counters (
            workspace_id TEXT NOT NULL,
            metric TEXT NOT NULL,
            period_key TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (workspace_id, metric, period_key)
        )
    `).run();

    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            user_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id TEXT,
            metadata_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    await env.DB.prepare(`
        INSERT OR IGNORE INTO workspaces (id, name, slug)
        VALUES (?, ?, 'legacy')
    `).bind(LEGACY_WORKSPACE_ID, LEGACY_WORKSPACE_NAME).run();

    for (const plan of BILLING_PLANS) {
        await env.DB.prepare(`
            INSERT INTO billing_plans (code, label, interval, amount_thb, duration_days, description, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(code) DO UPDATE SET
                label = excluded.label,
                interval = excluded.interval,
                amount_thb = excluded.amount_thb,
                duration_days = excluded.duration_days,
                description = excluded.description,
                active = 1
        `).bind(
            plan.code,
            plan.label,
            plan.interval,
            plan.amountThb,
            plan.durationDays,
            plan.description,
        ).run();
    }
}

async function ensureOauthStateColumns(env: Env) {
    if (!(await tableExists(env, 'oauth_states'))) return;

    if (!(await columnExists(env, 'oauth_states', 'nonce'))) {
        await env.DB.prepare(`ALTER TABLE oauth_states ADD COLUMN nonce TEXT`).run();
    }

    if (!(await columnExists(env, 'oauth_states', 'code_verifier'))) {
        await env.DB.prepare(`ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT`).run();
    }
}

async function migratePageSettings(env: Env) {
    const exists = await tableExists(env, 'page_settings');
    if (!exists) {
        await env.DB.prepare(`
            CREATE TABLE page_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                page_name TEXT,
                page_color TEXT,
                picture_url TEXT,
                post_token_encrypted TEXT,
                hide_token_encrypted TEXT,
                comment_token_encrypted TEXT,
                auto_schedule INTEGER NOT NULL DEFAULT 0,
                auto_hide INTEGER NOT NULL DEFAULT 0,
                hide_on_publish INTEGER NOT NULL DEFAULT 0,
                schedule_minutes TEXT DEFAULT '00,15,30,45',
                working_hours_start INTEGER DEFAULT 6,
                working_hours_end INTEGER DEFAULT 24,
                post_mode TEXT,
                last_post_type TEXT,
                color_bg INTEGER NOT NULL DEFAULT 0,
                color_bg_presets TEXT,
                color_bg_index INTEGER NOT NULL DEFAULT 0,
                share_page_id TEXT,
                share_mode TEXT DEFAULT 'both',
                share_schedule_minutes TEXT,
                image_source TEXT DEFAULT 'ai',
                og_background_url TEXT,
                og_font TEXT,
                ai_model TEXT DEFAULT 'gemini-2.0-flash-exp',
                ai_resolution TEXT DEFAULT '2K',
                link_image_size TEXT DEFAULT '1:1',
                image_image_size TEXT DEFAULT '1:1',
                news_analysis_prompt TEXT,
                news_generation_prompt TEXT,
                news_image_size TEXT,
                news_variation_count INTEGER,
                hide_types TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (organization_id, page_id)
            )
        `).run();
    } else {
        await env.DB.prepare('ALTER TABLE page_settings RENAME TO page_settings_legacy').run();
        await env.DB.prepare(`
            CREATE TABLE page_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                page_name TEXT,
                page_color TEXT,
                picture_url TEXT,
                post_token_encrypted TEXT,
                hide_token_encrypted TEXT,
                comment_token_encrypted TEXT,
                auto_schedule INTEGER NOT NULL DEFAULT 0,
                auto_hide INTEGER NOT NULL DEFAULT 0,
                hide_on_publish INTEGER NOT NULL DEFAULT 0,
                schedule_minutes TEXT DEFAULT '00,15,30,45',
                working_hours_start INTEGER DEFAULT 6,
                working_hours_end INTEGER DEFAULT 24,
                post_mode TEXT,
                last_post_type TEXT,
                color_bg INTEGER NOT NULL DEFAULT 0,
                color_bg_presets TEXT,
                color_bg_index INTEGER NOT NULL DEFAULT 0,
                share_page_id TEXT,
                share_mode TEXT DEFAULT 'both',
                share_schedule_minutes TEXT,
                image_source TEXT DEFAULT 'ai',
                og_background_url TEXT,
                og_font TEXT,
                ai_model TEXT DEFAULT 'gemini-2.0-flash-exp',
                ai_resolution TEXT DEFAULT '2K',
                link_image_size TEXT DEFAULT '1:1',
                image_image_size TEXT DEFAULT '1:1',
                news_analysis_prompt TEXT,
                news_generation_prompt TEXT,
                news_image_size TEXT,
                news_variation_count INTEGER,
                hide_types TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (organization_id, page_id)
            )
        `).run();

        const legacyHasPostToken = await columnExists(env, 'page_settings_legacy', 'post_token');
        const legacyHasHideToken = await columnExists(env, 'page_settings_legacy', 'hide_token');
        const legacyHasCommentToken = await columnExists(env, 'page_settings_legacy', 'comment_token');
        const legacyHasHideOnPublish = await columnExists(env, 'page_settings_legacy', 'hide_on_publish');

        await env.DB.prepare(`
            INSERT INTO page_settings (
                organization_id, page_id, page_name, page_color, picture_url,
                post_token_encrypted, hide_token_encrypted, comment_token_encrypted,
                auto_schedule, auto_hide, hide_on_publish, schedule_minutes, working_hours_start, working_hours_end,
                post_mode, last_post_type, color_bg, color_bg_presets, color_bg_index,
                share_page_id, share_mode, share_schedule_minutes, image_source,
                og_background_url, og_font, ai_model, ai_resolution, link_image_size,
                image_image_size, news_analysis_prompt, news_generation_prompt, news_image_size,
                news_variation_count, hide_types, created_at, updated_at
            )
            SELECT
                ?, page_id, page_name, page_color, picture_url,
                ${legacyHasPostToken ? 'post_token' : 'NULL'},
                ${legacyHasHideToken ? 'hide_token' : 'NULL'},
                ${legacyHasCommentToken ? 'comment_token' : 'NULL'},
                COALESCE(auto_schedule, 0), COALESCE(auto_hide, 0), ${legacyHasHideOnPublish ? 'COALESCE(hide_on_publish, 0)' : '0'}, schedule_minutes,
                working_hours_start, working_hours_end, post_mode, last_post_type,
                COALESCE(color_bg, 0), color_bg_presets, COALESCE(color_bg_index, 0),
                share_page_id, COALESCE(share_mode, 'both'), share_schedule_minutes,
                COALESCE(image_source, 'ai'), og_background_url, og_font,
                COALESCE(ai_model, 'gemini-2.0-flash-exp'), COALESCE(ai_resolution, '2K'),
                COALESCE(link_image_size, '1:1'), COALESCE(image_image_size, '1:1'),
                news_analysis_prompt, news_generation_prompt, news_image_size, news_variation_count,
                hide_types, created_at, updated_at
            FROM page_settings_legacy
        `).bind(LEGACY_WORKSPACE_ID).run();

        await env.DB.prepare('DROP TABLE page_settings_legacy').run();
    }

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_page_settings_org_auto_schedule
        ON page_settings (organization_id, auto_schedule)
    `).run();

    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_page_settings_share_page_id
        ON page_settings (organization_id, share_page_id)
    `).run();
}

async function ensureWorkspaceColumn(env: Env, tableName: string, columnName = 'organization_id') {
    const exists = await tableExists(env, tableName);
    if (!exists) return false;
    if (await columnExists(env, tableName, columnName)) return true;
    await env.DB.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} TEXT`).run();
    return true;
}

async function ensureScopedTables(env: Env) {
    if (!(await tableExists(env, 'prompts'))) {
        await env.DB.prepare(`
            CREATE TABLE prompts (
                id TEXT PRIMARY KEY,
                organization_id TEXT NOT NULL,
                page_id TEXT,
                prompt_type TEXT,
                prompt_text TEXT,
                name TEXT,
                prompt TEXT,
                category TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'prompts')) {
        await env.DB.prepare(`UPDATE prompts SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_prompts_org_page_type ON prompts (organization_id, page_id, prompt_type)`).run();

    if (!(await tableExists(env, 'quotes'))) {
        await env.DB.prepare(`
            CREATE TABLE quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                quote_text TEXT NOT NULL,
                used_by_pages TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'quotes')) {
        await env.DB.prepare(`UPDATE quotes SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_quotes_org_created_at ON quotes (organization_id, created_at)`).run();

    if (!(await tableExists(env, 'auto_post_logs'))) {
        await env.DB.prepare(`
            CREATE TABLE auto_post_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                post_type TEXT,
                quote_text TEXT,
                status TEXT NOT NULL,
                facebook_post_id TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'auto_post_logs')) {
        await env.DB.prepare(`UPDATE auto_post_logs SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_auto_post_logs_org_page_created ON auto_post_logs (organization_id, page_id, created_at)`).run();

    if (!(await tableExists(env, 'publish_history'))) {
        await env.DB.prepare(`
            CREATE TABLE publish_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                external_key TEXT NOT NULL UNIQUE,
                page_id TEXT NOT NULL,
                source TEXT NOT NULL,
                source_ref TEXT,
                batch_id TEXT,
                queue_job_id INTEGER,
                post_type TEXT,
                message_text TEXT,
                media_kind TEXT,
                media_url TEXT,
                media_thumb_url TEXT,
                facebook_post_id TEXT,
                facebook_url TEXT,
                scheduled_time INTEGER,
                published_at TEXT,
                warning_message TEXT,
                extra_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'publish_history')) {
        await env.DB.prepare(`UPDATE publish_history SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_publish_history_org_page_published ON publish_history (organization_id, page_id, published_at)`).run();

    if (!(await tableExists(env, 'share_queue'))) {
        await env.DB.prepare(`
            CREATE TABLE share_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                source_page_id TEXT NOT NULL,
                target_page_id TEXT NOT NULL,
                facebook_post_id TEXT NOT NULL,
                post_type TEXT,
                share_schedule_minutes TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                shared_post_id TEXT,
                shared_at TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'share_queue')) {
        await env.DB.prepare(`UPDATE share_queue SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_share_queue_org_status_created_at ON share_queue (organization_id, status, created_at)`).run();

    if (!(await tableExists(env, 'scheduled_publish_queue'))) {
        await env.DB.prepare(`
            CREATE TABLE scheduled_publish_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                batch_id TEXT,
                scheduled_time INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                post_id TEXT,
                facebook_url TEXT,
                error_message TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                processed_at TEXT
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'scheduled_publish_queue')) {
        await env.DB.prepare(`UPDATE scheduled_publish_queue SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_org_status_time ON scheduled_publish_queue (organization_id, status, scheduled_time)`).run();

    if (!(await tableExists(env, 'post_action_jobs'))) {
        await env.DB.prepare(`
            CREATE TABLE post_action_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                action TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                total_count INTEGER NOT NULL DEFAULT 0,
                processed_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                requested_filters_json TEXT,
                last_error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                started_at TEXT,
                finished_at TEXT
            )
        `).run();
    } else if (await ensureWorkspaceColumn(env, 'post_action_jobs')) {
        await env.DB.prepare(`UPDATE post_action_jobs SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
            .bind(LEGACY_WORKSPACE_ID).run();
    }
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_post_action_jobs_org_status_created ON post_action_jobs (organization_id, status, created_at)`).run();

    if (!(await tableExists(env, 'hidden_posts'))) {
        await env.DB.prepare(`
            CREATE TABLE hidden_posts (
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                post_id TEXT NOT NULL,
                hidden_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (organization_id, page_id, post_id)
            )
        `).run();
    } else {
        await runMigration(env, 'hidden_posts_workspace_scope_v1', async () => {
            await env.DB.prepare('ALTER TABLE hidden_posts RENAME TO hidden_posts_legacy').run();
            await env.DB.prepare(`
                CREATE TABLE hidden_posts (
                    organization_id TEXT NOT NULL,
                    page_id TEXT NOT NULL,
                    post_id TEXT NOT NULL,
                    hidden_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (organization_id, page_id, post_id)
                )
            `).run();
            await env.DB.prepare(`
                INSERT INTO hidden_posts (organization_id, page_id, post_id, hidden_at)
                SELECT ?, page_id, post_id, hidden_at FROM hidden_posts_legacy
            `).bind(LEGACY_WORKSPACE_ID).run();
            await env.DB.prepare('DROP TABLE hidden_posts_legacy').run();
        });
    }
}

async function migrateEarningsTables(env: Env) {
    await runMigration(env, 'earnings_workspace_scope_v1', async () => {
        if (await tableExists(env, 'earnings')) {
            await env.DB.prepare('ALTER TABLE earnings RENAME TO earnings_legacy').run();
        }
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS earnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                date TEXT NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT DEFAULT 'THB',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (organization_id, page_id, date)
            )
        `).run();
        if (await tableExists(env, 'earnings_legacy')) {
            await env.DB.prepare(`
                INSERT INTO earnings (organization_id, page_id, date, amount, currency, created_at)
                SELECT ?, page_id, date, amount, currency, created_at FROM earnings_legacy
            `).bind(LEGACY_WORKSPACE_ID).run();
            await env.DB.prepare('DROP TABLE earnings_legacy').run();
        }

        if (await tableExists(env, 'earnings_history')) {
            await env.DB.prepare('ALTER TABLE earnings_history RENAME TO earnings_history_legacy').run();
        }
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS earnings_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL,
                page_id TEXT NOT NULL,
                page_name TEXT,
                date TEXT NOT NULL,
                daily_earnings REAL NOT NULL DEFAULT 0,
                weekly_earnings REAL NOT NULL DEFAULT 0,
                monthly_earnings REAL NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (organization_id, page_id, date)
            )
        `).run();
        if (await tableExists(env, 'earnings_history_legacy')) {
            await env.DB.prepare(`
                INSERT INTO earnings_history (
                    organization_id, page_id, page_name, date, daily_earnings,
                    weekly_earnings, monthly_earnings, created_at
                )
                SELECT ?, page_id, page_name, date, daily_earnings, weekly_earnings, monthly_earnings, created_at
                FROM earnings_history_legacy
            `).bind(LEGACY_WORKSPACE_ID).run();
            await env.DB.prepare('DROP TABLE earnings_history_legacy').run();
        }
    });

    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_earnings_org_date ON earnings (organization_id, date)`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_earnings_history_org_date ON earnings_history (organization_id, date)`).run();
}

async function migrateTokens(env: Env) {
    await runMigration(env, 'tokens_to_facebook_credentials_v1', async () => {
        if (!(await tableExists(env, 'tokens'))) {
            return;
        }

        const rows = await env.DB.prepare(`
            SELECT user_id, ads_token, cookie, fb_dtsg, created_at, updated_at
            FROM tokens
        `).all<{
            user_id: string;
            ads_token: string | null;
            cookie: string | null;
            fb_dtsg: string | null;
            created_at?: string;
            updated_at?: string;
        }>();

        for (const row of rows.results || []) {
            await env.DB.prepare(`
                INSERT OR IGNORE INTO facebook_credentials (
                    id, workspace_id, facebook_user_id, ads_token_encrypted, cookie_encrypted, fb_dtsg_encrypted,
                    account_name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                crypto.randomUUID(),
                LEGACY_WORKSPACE_ID,
                row.user_id,
                row.ads_token,
                row.cookie,
                row.fb_dtsg,
                row.user_id,
                row.created_at || new Date().toISOString(),
                row.updated_at || new Date().toISOString(),
            ).run();
        }
    });
}

async function migrateGlobalSettings(env: Env) {
    await runMigration(env, 'global_settings_to_org_settings_v1', async () => {
        if (!(await tableExists(env, 'global_settings'))) return;

        const rows = await env.DB.prepare(`
            SELECT setting_key, setting_value, updated_at
            FROM global_settings
        `).all<{ setting_key: string; setting_value: string | null; updated_at?: string }>();

        for (const row of rows.results || []) {
            await env.DB.prepare(`
                INSERT INTO organization_settings (workspace_id, setting_key, setting_value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(workspace_id, setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
            `).bind(
                LEGACY_WORKSPACE_ID,
                row.setting_key,
                row.setting_value,
                row.updated_at || new Date().toISOString(),
            ).run();
        }
    });
}

async function ensureReelUploadsWorkspaceColumn(env: Env) {
    if (!(await tableExists(env, 'reel_uploads'))) return;
    if (await columnExists(env, 'reel_uploads', 'organization_id')) return;
    await env.DB.prepare(`ALTER TABLE reel_uploads ADD COLUMN organization_id TEXT`).run();
    await env.DB.prepare(`UPDATE reel_uploads SET organization_id = ? WHERE organization_id IS NULL OR organization_id = ''`)
        .bind(LEGACY_WORKSPACE_ID).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_reel_uploads_org_status_updated ON reel_uploads (organization_id, status, updated_at)`).run();
}

async function ensureSchemaInternal(env: Env) {
    await ensureBaseTables(env);
    await ensureOauthStateColumns(env);
    await runMigration(env, 'page_settings_workspace_scope_v1', async () => {
        await migratePageSettings(env);
    });
    await ensureScopedTables(env);
    await migrateEarningsTables(env);
    await migrateTokens(env);
    await migrateGlobalSettings(env);
    await ensureReelUploadsWorkspaceColumn(env);

    await env.DB.prepare(`
        DELETE FROM oauth_states
        WHERE datetime(expires_at) <= datetime('now')
    `).run();

    await env.DB.prepare(`
        DELETE FROM sessions
        WHERE datetime(expires_at) <= datetime('now')
    `).run();
}

export async function ensureAppSchema(env: Env) {
    if (!bootstrapPromise) {
        bootstrapPromise = ensureSchemaInternal(env).catch((error) => {
            bootstrapPromise = null;
            throw error;
        });
    }
    await bootstrapPromise;
}
