-- Migration: Create announcements table for site-wide announcements
-- Supports scheduling (start_at/end_at), targeting specific forums, and sticky sorting

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    forum_ids TEXT NOT NULL DEFAULT '',
    sticky INTEGER NOT NULL DEFAULT 0,
    start_at INTEGER,
    end_at INTEGER,
    status INTEGER NOT NULL DEFAULT 1,
    author_id INTEGER NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_dates ON announcements(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_announcements_sticky ON announcements(sticky DESC, created_at DESC);
