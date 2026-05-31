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
-- Default 0 makes existing threads safe; the next backfill pass + the
-- recalcMetadata write path keep these in sync.
ALTER TABLE threads ADD COLUMN anonymous_author INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN anonymous_last_poster INTEGER NOT NULL DEFAULT 0;

-- Optional partial index for staff/admin "list all anonymous threads" queries.
-- Cardinality is small (~1.6k rows expected) so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_threads_anonymous_author
  ON threads(id) WHERE anonymous_author = 1;
