-- Migration 0015: Seed feature settings for access control and posting restrictions
-- These keys are required for the admin features settings page

-- features.access — access control
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.access.require_login', 'false', 'boolean', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.access.maintenance_mode', 'false', 'boolean', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.access.maintenance_message', '系统维护中，请稍后再试...', 'string', strftime('%s','now'));

-- features.content — content controls
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.content.allow_new_thread', 'true', 'boolean', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.content.allow_reply', 'true', 'boolean', strftime('%s','now'));

-- features.posting — new user posting restrictions
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.posting.enabled', 'true', 'boolean', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.posting.min_registration_days', '1', 'number', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.posting.require_email_verified', 'false', 'boolean', strftime('%s','now'));
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.posting.require_avatar', 'true', 'boolean', strftime('%s','now'));
