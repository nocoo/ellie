-- 0025_create_post_comments.sql — Create post_comments table for 点评 feature
-- Maps from Discuz pre_forum_postcomment table

CREATE TABLE IF NOT EXISTS post_comments (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL DEFAULT '',
  score         INTEGER NOT NULL DEFAULT 0,
  reply_post_id INTEGER NOT NULL DEFAULT 0,
  ip            TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_thread ON post_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_author ON post_comments(author_id);
