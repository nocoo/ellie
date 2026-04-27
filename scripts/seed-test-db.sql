-- L2 + L3 Test Seed Data
-- Seed minimal data required for L2 integration tests AND L3 browser E2E specs
-- (tests/e2e/navigation.spec.ts references forum 114, thread 662174, user 64495).
-- Run with: npx wrangler d1 execute tongjinet-db-test -c apps/worker/wrangler.toml --remote --file scripts/seed-test-db.sql

PRAGMA foreign_keys = OFF;

-- Clear existing test data (preserve _test_marker)
DELETE FROM messages;
DELETE FROM attachments;
DELETE FROM posts;
DELETE FROM threads;
-- Drop any preexisting fixture users by username so we can re-seed them under
-- deterministic IDs (username has UNIQUE constraint).
DELETE FROM users WHERE username IN ('e2etest', 'e2eprofile');
DELETE FROM users WHERE id NOT IN (1, 2, 3);
DELETE FROM forums WHERE id NOT IN (1, 2);

-- Ensure test marker
INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');

-- Seed users for L2 tests + L3 e2etest user + L3 profile target user
-- e2etest password is "e2etest123" hashed with Discuz legacy format md5(md5(pwd)+salt)
-- (matches verifyDiscuzPassword in apps/worker/src/lib/password.ts).
INSERT OR REPLACE INTO users (id, username, email, password_hash, password_salt, role, status, threads, posts, digest_posts, credits) VALUES
  (1, 'admin', 'admin@test.com', '', '', 2, 0, 0, 0, 0, 0),
  (2, 'moderator', 'mod@test.com', '', '', 1, 0, 0, 0, 0, 0),
  (3, 'testuser', 'test@test.com', '', '', 0, 0, 0, 0, 0, 0),
  (100, 'e2etest', 'e2etest@test.com', 'c03883cd846c081766bed1b6748d3bd3', 'e2esalt0', 0, 0, 0, 0, 0, 0),
  (64495, 'e2eprofile', 'e2eprofile@test.com', '', '', 0, 0, 1, 1, 0, 100);

-- Seed forums for L2 + L3 (status = 1 for active/visible)
INSERT OR REPLACE INTO forums (id, parent_id, name, description, display_order, status, type) VALUES
  (1, 0, 'Test Forum 1', 'First test forum', 1, 1, 'forum'),
  (2, 0, 'Test Forum 2', 'Second test forum', 2, 1, 'forum'),
  (114, 0, '同济闲话', 'L3 navigation target forum', 3, 1, 'forum');

-- Seed threads: thread 1 for L2; thread 662174 for L3 NV-03 (in forum 114, by user 64495)
INSERT OR REPLACE INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_name, last_poster_id) VALUES
  (1, 1, 3, 'testuser', 'Test Thread 1', 1700000000, 1700000000, 'testuser', 1, 10, 0, 0, 0, 0, 0, 0, 0, '', 0),
  (662174, 114, 64495, 'e2eprofile', 'L3 navigation thread', 1700000000, 1700000000, 'e2eprofile', 1, 10, 0, 0, 0, 0, 0, 0, 0, '', 64495);

-- Seed posts (invisible = 0)
INSERT OR REPLACE INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES
  (1, 1, 1, 3, 'testuser', 'This is a test post content', 1700000000, 1, 1, 0),
  (662174, 662174, 114, 64495, 'e2eprofile', 'L3 navigation thread first post', 1700000000, 1, 1, 0);

PRAGMA foreign_keys = ON;
