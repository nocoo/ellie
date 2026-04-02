-- Migration 0016: Add maintenance_admin_bypass setting
INSERT OR IGNORE INTO settings (key, value, type, updated_at) VALUES ('features.access.maintenance_admin_bypass', 'false', 'boolean', strftime('%s','now'));
