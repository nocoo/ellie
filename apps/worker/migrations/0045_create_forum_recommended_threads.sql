-- 0045_create_forum_recommended_threads.sql — restore per-forum "推荐主题" card
--
-- Restores the legacy Discuz `pre_forum_forumrecommend(position=1)`
-- relation: a per-forum allowlist of threads moderators want to spotlight
-- on the forum-page top card (under the announcement card) and at the
-- thread-detail right-side action area.
--
-- # Cardinality
--
-- The DATA layer allows N recommendations per forum (no cap). The
-- DISPLAY layer (`GET /api/v1/forums/:id/recommended-threads`) always
-- returns at most 6 rows ordered by `thread_id DESC`. Per reviewer
-- contract (msg ba15ea9f / a629d81c): cap belongs in the read path, not
-- in the write path — `POST /recommend` MUST NOT auto-evict an older
-- recommendation just because the visible set has reached 6.
--
-- # Composite PK (forum_id, thread_id)
--
-- A thread can be recommended in at most one (forum_id, thread_id) row
-- per forum; if the thread is moved to a different forum, the row in the
-- old forum is dropped (see `moveThread` in handlers/moderation.ts).
-- `POST /recommend` uses `INSERT OR IGNORE` to make repeat clicks
-- idempotent.
--
-- # FK posture
--
-- We do NOT declare `ON DELETE CASCADE` on either side. D1's foreign-key
-- enforcement is off by default and our handlers already enumerate child
-- cleanup explicitly (see `buildDeleteThreadChildStatements`). The
-- `deleteThread` and `moveThread` batches add a `DELETE FROM
-- forum_recommended_threads WHERE thread_id = ?` step so dangling rows
-- can never accumulate.
--
-- # recommended_by sentinel
--
-- `recommended_by = 0` is the SYSTEM-IMPORT sentinel used by the legacy
-- backfill (`scripts/import-forum-recommended-threads-2026-05-22.ts`).
-- Live moderator actions write the authenticated `users.id` directly.
-- The column is `NOT NULL` so the sentinel is observable; reads can
-- distinguish "moderator click" (positive int) from "imported"
-- (zero) without a separate flag.
--
-- # Source data
--
-- Discuz `pre_forum_forumrecommend(fid, tid, position, ...)` with
-- `position = 1` (active recommendation, excluding `position = 0`
-- archived rows). 193 active rows / 38 forums in the source snapshot
-- collected 2026-05-22. The `expiration` / `displayorder` columns are
-- intentionally dropped — the modern card has no expiration semantics
-- and order is `thread_id DESC` only.
-- IF NOT EXISTS on both the table and index so this incremental migration
-- coexists with the cumulative mirror in 0000_init_schema.sql. Wrangler
-- applies migrations sequentially against a fresh D1, so 0000 creates the
-- table first and 0045 must be a no-op in that path while still creating
-- the table on databases that were initialized before 0000 was updated.
CREATE TABLE IF NOT EXISTS forum_recommended_threads (
  forum_id        INTEGER NOT NULL,
  thread_id       INTEGER NOT NULL,
  recommended_at  INTEGER NOT NULL,
  recommended_by  INTEGER NOT NULL,
  PRIMARY KEY (forum_id, thread_id)
);

-- Display index: per-forum "newest 6" lookup is the only read pattern;
-- ORDER BY thread_id DESC LIMIT 6 hits this index without a table read.
CREATE INDEX IF NOT EXISTS idx_forum_recommended_threads_forum_tid
  ON forum_recommended_threads(forum_id, thread_id DESC);

-- Thread-detail `isRecommended` lookup uses (forum_id, thread_id) which
-- is already covered by the PK, so no secondary thread_id-only index is
-- needed; `EXISTS(... WHERE forum_id=? AND thread_id=?)` is a PK probe.
