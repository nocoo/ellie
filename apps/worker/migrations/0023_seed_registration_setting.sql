-- Migration 0023: Seed registration control setting
-- Required for admin to disable user registration
-- Default to 'true' (registration allowed) for backward compatibility

INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES ('features.registration.allow_new_user', 'true', 'boolean', strftime('%s','now'));
