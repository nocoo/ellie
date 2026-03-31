-- Migration 0007: Create settings table for site-wide configuration
-- Key-value store with type metadata for admin-managed settings

CREATE TABLE IF NOT EXISTS settings (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    key   TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '',
    type  TEXT NOT NULL DEFAULT 'string'
          CHECK(type IN ('string', 'number', 'boolean', 'json')),
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- Seed default settings (18 keys across 4 namespaces)

-- general.site
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.site.name', 'Ellie', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.site.subtitle', 'Ellie admin console', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.site.copyright', '同济网', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.site.powered_by', 'Powered by Ellie', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.site.version', 'v0.1', 'string', strftime('%s','now'));

-- general.og
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.title', '', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.description', '', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.site_name', '', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.image', '', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.url', '', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.twitter_card', 'summary', 'string', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.og.twitter_site', '', 'string', strftime('%s','now'));

-- general.pagination
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.pagination.threads_per_page', '100', 'number', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.pagination.posts_per_page', '20', 'number', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.pagination.user_history_per_page', '20', 'number', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.pagination.max_post_length', '50000', 'number', strftime('%s','now'));
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.pagination.admin_page_size', '20', 'number', strftime('%s','now'));

-- general.assets
INSERT INTO settings (key, value, type, updated_at) VALUES ('general.assets.avatar_cdn_base', 'https://t.no.mt/avatar', 'string', strftime('%s','now'));
