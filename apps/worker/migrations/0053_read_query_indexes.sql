-- Read-cost audit: prefix search, bounded attachment dates, and filtered digest lists.
CREATE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_attachments_created ON attachments(created_at);
CREATE INDEX IF NOT EXISTS idx_threads_forum_digest ON threads(forum_id, digest DESC, last_post_at DESC, id DESC) WHERE digest > 0 AND sticky >= 0;

-- Bounded planner statistics maintenance after index changes (D1 recommendation).
PRAGMA optimize;
