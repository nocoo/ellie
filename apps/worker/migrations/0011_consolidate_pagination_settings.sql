-- Migration: Consolidate pagination settings into single page_size
-- Replaces: threads_per_page, posts_per_page, user_history_per_page

-- Add new unified setting
INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES ('general.pagination.page_size', '20', 'number', strftime('%s','now'));

-- Remove old settings (they may not exist in fresh installs)
DELETE FROM settings WHERE key = 'general.pagination.threads_per_page';
DELETE FROM settings WHERE key = 'general.pagination.posts_per_page';
DELETE FROM settings WHERE key = 'general.pagination.user_history_per_page';
