CREATE TABLE IF NOT EXISTS page_settings (
    page_id TEXT PRIMARY KEY,
    page_name TEXT,
    page_color TEXT,
    picture_url TEXT,
    post_token TEXT,
    hide_token TEXT,
    comment_token TEXT,
    auto_schedule INTEGER NOT NULL DEFAULT 0,
    auto_hide INTEGER NOT NULL DEFAULT 0,
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
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tokens (
    user_id TEXT PRIMARY KEY,
    ads_token TEXT,
    post_token TEXT,
    cookie TEXT,
    fb_dtsg TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    page_id TEXT,
    prompt_type TEXT,
    prompt_text TEXT,
    name TEXT,
    prompt TEXT,
    category TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_text TEXT NOT NULL,
    used_by_pages TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS global_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'THB',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, date)
);

CREATE TABLE IF NOT EXISTS earnings_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    page_name TEXT,
    date TEXT NOT NULL,
    daily_earnings REAL NOT NULL DEFAULT 0,
    weekly_earnings REAL NOT NULL DEFAULT 0,
    monthly_earnings REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, date)
);

CREATE TABLE IF NOT EXISTS earnings_notifications (
    date TEXT PRIMARY KEY,
    sent INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT
);

CREATE TABLE IF NOT EXISTS auto_post_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    post_type TEXT,
    quote_text TEXT,
    status TEXT NOT NULL,
    facebook_post_id TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS share_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
);

CREATE TABLE IF NOT EXISTS hidden_posts (
    page_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    hidden_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (page_id, post_id)
);

CREATE TABLE IF NOT EXISTS scheduled_publish_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    scheduled_time INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    post_id TEXT,
    facebook_url TEXT,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_page_settings_auto_schedule ON page_settings (auto_schedule);
CREATE INDEX IF NOT EXISTS idx_page_settings_share_page_id ON page_settings (share_page_id);
CREATE INDEX IF NOT EXISTS idx_prompts_page_type ON prompts (page_id, prompt_type);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes (created_at);
CREATE INDEX IF NOT EXISTS idx_auto_post_logs_page_id ON auto_post_logs (page_id);
CREATE INDEX IF NOT EXISTS idx_auto_post_logs_created_at ON auto_post_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_share_queue_status_created_at ON share_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_share_queue_target_page_id ON share_queue (target_page_id);
CREATE INDEX IF NOT EXISTS idx_earnings_history_date ON earnings_history (date);
CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_status_time ON scheduled_publish_queue (status, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_scheduled_publish_queue_page_status ON scheduled_publish_queue (page_id, status, scheduled_time);
