-- 0048_add_thread_anonymous.sql — denormalize anonymous flags onto threads.
--
-- Background: migration 0047 restored `posts.anonymous`, and toPost() masks
-- the author for non-staff/non-self viewers. But threads carry denormalized
-- copies of (a) the first post's author into threads.author_id/author_name
-- and (b) the latest visible post's author into threads.last_poster*. Those
-- columns drive forum index, thread list, search, profile listings, and
-- forum.last_poster — none of which JOIN posts on the read path. Without
-- mirroring the anonymous flag onto threads, an anonymous opening post or
-- anonymous last reply still leaks the real identity through every list
-- surface.
--
-- Two TINYINT flags:
--   anonymous_author       1 = first post of this thread was posted anonymously
--   anonymous_last_poster  1 = the post currently denormalized as last_poster
--                              was posted anonymously
--
-- Default 0 makes existing threads safe at ALTER time; the backfill below
-- mirrors the current state of `posts.anonymous` so a fresh apply on a
-- populated DB ends up with the same flags as a hand-run script. Without
-- this, every list surface would still leak historical anonymous authors
-- until an out-of-band recalc happened.
ALTER TABLE threads ADD COLUMN anonymous_author INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN anonymous_last_poster INTEGER NOT NULL DEFAULT 0;

-- Optional partial index for staff/admin "list all anonymous threads" queries.
-- Cardinality is small (~1.6k rows expected) so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_threads_anonymous_author
  ON threads(id) WHERE anonymous_author = 1;

-- Backfill: anonymous_author = 1 for any thread whose first post is anonymous.
UPDATE threads SET anonymous_author = 1
WHERE id IN (SELECT thread_id FROM posts WHERE anonymous = 1 AND is_first = 1);

-- Backfill: anonymous_last_poster = 1 when the post currently denormalized as
-- the last poster was anonymous. We match on (thread_id, author_id, created_at,
-- visible) — same shape recalcThreadMetadata uses to write the row, so the two
-- agree on what counts as "the latest visible post". A small number of edge
-- cases (e.g. the last visible post was deleted post-recalc) remain at 0;
-- recalcThreadMetadata fixes them on the next write.
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
