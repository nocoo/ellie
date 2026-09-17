-- 0051_idx_threads_forum_latest.sql
-- Optimizes forum summary latest thread lookup:
-- SELECT t.id FROM threads t WHERE t.forum_id = f.id AND t.sticky >= 0 ORDER BY t.last_post_at DESC, t.id DESC LIMIT 1
-- By providing a partial index on (forum_id, last_post_at DESC, id DESC) WHERE sticky >= 0,
-- SQLite can satisfy the ORDER BY and LIMIT 1 directly via index scan without a temp b-tree.

CREATE INDEX IF NOT EXISTS idx_threads_forum_latest
  ON threads(forum_id, last_post_at DESC, id DESC)
  WHERE sticky >= 0;
