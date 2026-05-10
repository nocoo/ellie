-- 0034_fix_threads_fts_triggers.sql — Fix FTS5 sync triggers for regular table
--
-- The threads_fts table is a regular (standalone) FTS5 table, not an
-- external-content table. The original triggers from 0023 used the
-- content-table "delete command" syntax:
--
--   INSERT INTO threads_fts(threads_fts, rowid, subject) VALUES ('delete', ...)
--
-- which is only valid for external-content FTS5 tables and causes
-- "SQL logic error: SQLITE_ERROR" on a regular FTS5 table. This broke
-- every DELETE FROM threads (including the nuke-user batch).
--
-- Fix: use standard DELETE FROM ... WHERE rowid = old.id for regular FTS5.

DROP TRIGGER IF EXISTS threads_fts_ad;
DROP TRIGGER IF EXISTS threads_fts_au;

CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
    DELETE FROM threads_fts WHERE rowid = old.id;
END;

CREATE TRIGGER threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
    DELETE FROM threads_fts WHERE rowid = old.id;
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;
