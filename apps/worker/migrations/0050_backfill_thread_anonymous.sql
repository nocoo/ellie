-- 0050_backfill_thread_anonymous.sql — re-run the threads.anonymous_*
-- backfill now that posts.anonymous is populated.
--
-- Order matters: 0048 added the columns AND tried to backfill, but at that
-- point posts.anonymous still defaulted to 0 (0047 only added the column
-- without the historical flag values). The 8,474 anonymous pids only land
-- in 0049 — which means the 0048 backfill saw an empty set and flagged
-- zero threads on a fresh migration chain. This migration runs the same
-- two UPDATEs against the now-populated posts table.
--
-- Idempotent: 0048's backfill was a no-op on fresh DBs; on prod (already
-- hand-fixed) these UPDATEs are no-ops too.

UPDATE threads SET anonymous_author = 1
WHERE id IN (SELECT thread_id FROM posts WHERE anonymous = 1 AND is_first = 1);

UPDATE threads SET anonymous_last_poster = 1
WHERE last_poster_id != 0
  AND EXISTS (
    SELECT 1 FROM posts p
    WHERE p.thread_id = threads.id
      AND p.author_id = threads.last_poster_id
      AND p.invisible = 0
      AND p.anonymous = 1
      AND p.created_at = threads.last_post_at
  );
