-- L2 Test Seed Data
-- Seed minimal data required for L2 integration tests
-- Run with: npx wrangler d1 execute tongjinet-db-test -c apps/worker/wrangler.toml --remote --file scripts/seed-test-db.sql

PRAGMA foreign_keys = OFF;

-- Clear existing test data (preserve _test_marker)
DELETE FROM messages;
DELETE FROM attachments;
DELETE FROM posts;
DELETE FROM threads;
DELETE FROM users WHERE id NOT IN (1, 2, 3);
DELETE FROM forums WHERE id > 2;

-- Ensure test marker
INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');

-- Seed users for L2 tests
INSERT OR REPLACE INTO users (id, username, email, password_hash, password_salt, role, status) VALUES
  (1, 'admin', 'admin@test.com', '', '', 2, 0),
  (2, 'moderator', 'mod@test.com', '', '', 1, 0),
  (3, 'testuser', 'test@test.com', '', '', 0, 0);

-- Seed forums for L2 tests
INSERT OR REPLACE INTO forums (id, parent_id, name, description, display_order, status, type) VALUES
  (1, 0, 'Test Forum 1', 'First test forum', 1, 0, 'forum'),
  (2, 0, 'Test Forum 2', 'Second test forum', 2, 0, 'forum');

-- Seed threads for L2 tests (sticky = 0 for normal visible threads)
INSERT OR REPLACE INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_name, last_poster_id) VALUES
  (1, 1, 3, 'testuser', 'Test Thread 1', 1700000000, 1700000000, 'testuser', 1, 10, 0, 0, 0, 0, 0, 0, 0, '', 0);

-- Seed posts for L2 tests (invisible = 0 for visible posts)
INSERT OR REPLACE INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES
  (1, 1, 1, 3, 'testuser', 'This is a test post content', 1700000000, 1, 1, 0);

PRAGMA foreign_keys = ON;
