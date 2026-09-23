-- Latest visible non-anonymous topic lookup:
-- forum_id = ? AND sticky >= 0 AND anonymous_author = 0
-- ORDER BY created_at DESC, id DESC LIMIT 1
-- The query must use INDEXED BY idx_threads_forum_visible_created.
-- Unhinted, the fixture planner chose idx_threads_forum and USE TEMP B-TREE
-- FOR ORDER BY. With the hint: SEARCH t USING INDEX
-- idx_threads_forum_visible_created (forum_id=?), no temporary sort.
CREATE INDEX IF NOT EXISTS idx_threads_forum_visible_created
  ON threads(forum_id, created_at DESC, id DESC)
  WHERE sticky >= 0 AND anonymous_author = 0;

-- Recently active members:
-- status = 0 AND last_activity >= ?
-- EXPLAIN without a hint uses idx_users_status. INDEXED BY this partial index
-- is SEARCH users USING COVERING INDEX idx_users_active_last_activity (last_activity>?),
-- which does not scan every user.
CREATE INDEX IF NOT EXISTS idx_users_active_last_activity
  ON users(last_activity)
  WHERE status = 0;
