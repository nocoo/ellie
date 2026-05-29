-- Migration: Add stats counter settings
-- These counters are incremented on create operations and manually calibrated by admin.
-- Initial values are 0; admin should calibrate after deployment.

INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES
  ('stats.total_threads', '0', 'number', 0),
  ('stats.total_posts', '0', 'number', 0),
  ('stats.total_members', '0', 'number', 0),
  ('stats.yesterday_posts', '0', 'number', 0);
