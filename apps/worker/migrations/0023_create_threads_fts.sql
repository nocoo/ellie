-- 0023_create_threads_fts.sql — Full-text search for thread subjects
-- Uses FTS5 with unicode61 tokenizer for Chinese support

-- Create FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
    subject,
    tokenize='unicode61'
);

-- Populate from existing data
INSERT INTO threads_fts(rowid, subject)
SELECT id, subject FROM threads;

-- Sync triggers
CREATE TRIGGER IF NOT EXISTS threads_fts_ai AFTER INSERT ON threads BEGIN
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;

CREATE TRIGGER IF NOT EXISTS threads_fts_ad AFTER DELETE ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject)
    VALUES ('delete', old.id, old.subject);
END;

CREATE TRIGGER IF NOT EXISTS threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject)
    VALUES ('delete', old.id, old.subject);
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;

-- Seed search setting (default: enabled)
INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES ('general.search.enabled', 'true', 'boolean', strftime('%s', 'now'));
