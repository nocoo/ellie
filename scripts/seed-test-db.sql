-- L2 + L3 Test Seed Data
-- Seed minimal data required for L2 integration tests AND L3 browser E2E specs
-- (tests/e2e/navigation.spec.ts references forum 114, thread 662174, user 64495).
-- Run with: npx wrangler d1 execute tongjinet-db-test -c apps/worker/wrangler.toml --remote --file scripts/seed-test-db.sql
--
-- NOTE: D1 remote does NOT honor `PRAGMA foreign_keys = OFF`, and `DELETE
-- FROM threads` triggers an FTS5 SQLITE_ERROR via the threads_fts_ad
-- trigger (0023_create_threads_fts.sql). We avoid both by relying on
-- deterministic IDs + `INSERT OR REPLACE`, never deleting parent rows.
-- Order: parents (forums, users) → children (threads, posts) → FTS.

-- Ensure test marker
INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');

-- ─── Forums (parents of threads/posts) ────────────────────────────────────
INSERT OR REPLACE INTO forums (id, parent_id, name, description, display_order, status, type) VALUES
  (1, 0, 'Test Forum 1', 'First test forum', 1, 1, 'forum'),
  (2, 0, 'Test Forum 2', 'Second test forum', 2, 1, 'forum'),
  (114, 0, '同济闲话', 'L3 navigation target forum', 3, 1, 'forum');

-- ─── Users (parents of threads/posts) ─────────────────────────────────────
-- e2etest password is "e2etest123" hashed with Discuz legacy format
-- md5(md5(pwd)+salt) (matches verifyDiscuzPassword in apps/worker/src/lib/password.ts).
-- email_verified_at = 1 marks every seeded user as verified so existing E2E
-- specs that exercise write paths keep working without going through the
-- email-verification flow (docs/17-email-verification.md §10).
INSERT OR REPLACE INTO users (id, username, email, password_hash, password_salt, role, status, threads, posts, digest_posts, credits, email_verified_at, email_normalized, email_changed_at) VALUES
  (1, 'admin', 'admin@test.com', '', '', 2, 0, 0, 0, 0, 0, 1, 'admin@test.com', 0),
  (2, 'moderator', 'mod@test.com', '', '', 1, 0, 0, 0, 0, 0, 1, 'mod@test.com', 0),
  (3, 'testuser', 'test@test.com', '', '', 0, 0, 0, 0, 0, 0, 1, 'test@test.com', 0),
  (100, 'e2etest', 'e2etest@test.com', 'c03883cd846c081766bed1b6748d3bd3', 'e2esalt0', 0, 0, 0, 0, 0, 0, 1, 'e2etest@test.com', 0),
  (64495, 'e2eprofile', 'e2eprofile@test.com', '', '', 0, 0, 1, 1, 0, 100, 1, 'e2eprofile@test.com', 0);

-- ─── Threads (25 in forum 114 for pagination, 1 in forum 1) ──────────────
-- Thread 662174 is the primary L3 target; threads 662175-662197 fill pagination.
-- Thread 662198 is a digest thread (digest=1).
INSERT OR REPLACE INTO threads (id, forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, replies, views, closed, sticky, digest, special, highlight, recommends, post_table_id, type_name, last_poster_id) VALUES
  (1, 1, 3, 'testuser', 'Test Thread 1', 1700000000, 1700000000, 'testuser', 1, 10, 0, 0, 0, 0, 0, 0, 0, '', 0),
  (662174, 114, 64495, 'e2eprofile', 'L3 navigation thread', 1700000000, 1700000100, 'e2eprofile', 25, 100, 0, 0, 0, 0, 0, 0, 0, '', 64495),
  (662175, 114, 100, 'e2etest', '同济闲话讨论帖 01', 1700001000, 1700001000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662176, 114, 100, 'e2etest', '同济闲话讨论帖 02', 1700002000, 1700002000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662177, 114, 100, 'e2etest', '同济闲话讨论帖 03', 1700003000, 1700003000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662178, 114, 100, 'e2etest', '同济闲话讨论帖 04', 1700004000, 1700004000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662179, 114, 100, 'e2etest', '同济闲话讨论帖 05', 1700005000, 1700005000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662180, 114, 100, 'e2etest', '同济闲话讨论帖 06', 1700006000, 1700006000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662181, 114, 100, 'e2etest', '同济闲话讨论帖 07', 1700007000, 1700007000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662182, 114, 100, 'e2etest', '同济闲话讨论帖 08', 1700008000, 1700008000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662183, 114, 100, 'e2etest', '同济闲话讨论帖 09', 1700009000, 1700009000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662184, 114, 100, 'e2etest', '同济闲话讨论帖 10', 1700010000, 1700010000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662185, 114, 100, 'e2etest', '同济闲话讨论帖 11', 1700011000, 1700011000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662186, 114, 100, 'e2etest', '同济闲话讨论帖 12', 1700012000, 1700012000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662187, 114, 100, 'e2etest', '同济闲话讨论帖 13', 1700013000, 1700013000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662188, 114, 100, 'e2etest', '同济闲话讨论帖 14', 1700014000, 1700014000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662189, 114, 100, 'e2etest', '同济闲话讨论帖 15', 1700015000, 1700015000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662190, 114, 100, 'e2etest', '同济闲话讨论帖 16', 1700016000, 1700016000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662191, 114, 100, 'e2etest', '同济闲话讨论帖 17', 1700017000, 1700017000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662192, 114, 100, 'e2etest', '同济闲话讨论帖 18', 1700018000, 1700018000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662193, 114, 100, 'e2etest', '同济闲话讨论帖 19', 1700019000, 1700019000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662194, 114, 100, 'e2etest', '同济闲话讨论帖 20', 1700020000, 1700020000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662195, 114, 100, 'e2etest', '同济闲话讨论帖 21', 1700021000, 1700021000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662196, 114, 100, 'e2etest', '同济闲话讨论帖 22', 1700022000, 1700022000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662197, 114, 100, 'e2etest', '同济闲话讨论帖 23', 1700023000, 1700023000, 'e2etest', 0, 5, 0, 0, 0, 0, 0, 0, 0, '', 100),
  (662198, 114, 100, 'e2etest', 'L3 精华帖 digest level 1', 1700024000, 1700024000, 'e2etest', 0, 20, 0, 0, 1, 0, 0, 0, 0, '', 100);

-- ─── Posts (25 in thread 662174 for pagination, 1 in thread 1) ───────────
-- Post 662174 is position 1 (first post); posts 700001-700024 are replies.
INSERT OR REPLACE INTO posts (id, thread_id, forum_id, author_id, author_name, content, created_at, is_first, position, invisible) VALUES
  (1, 1, 1, 3, 'testuser', 'This is a test post content', 1700000000, 1, 1, 0),
  (662174, 662174, 114, 64495, 'e2eprofile', 'L3 navigation thread first post', 1700000000, 1, 1, 0),
  (700001, 662174, 114, 100, 'e2etest', 'Reply 01 to L3 thread', 1700000010, 0, 2, 0),
  (700002, 662174, 114, 100, 'e2etest', 'Reply 02 to L3 thread', 1700000020, 0, 3, 0),
  (700003, 662174, 114, 100, 'e2etest', 'Reply 03 to L3 thread', 1700000030, 0, 4, 0),
  (700004, 662174, 114, 100, 'e2etest', 'Reply 04 to L3 thread', 1700000040, 0, 5, 0),
  (700005, 662174, 114, 100, 'e2etest', 'Reply 05 to L3 thread', 1700000050, 0, 6, 0),
  (700006, 662174, 114, 100, 'e2etest', 'Reply 06 to L3 thread', 1700000060, 0, 7, 0),
  (700007, 662174, 114, 100, 'e2etest', 'Reply 07 to L3 thread', 1700000070, 0, 8, 0),
  (700008, 662174, 114, 100, 'e2etest', 'Reply 08 to L3 thread', 1700000080, 0, 9, 0),
  (700009, 662174, 114, 100, 'e2etest', 'Reply 09 to L3 thread', 1700000090, 0, 10, 0),
  (700010, 662174, 114, 100, 'e2etest', 'Reply 10 to L3 thread', 1700000100, 0, 11, 0),
  (700011, 662174, 114, 100, 'e2etest', 'Reply 11 to L3 thread', 1700000110, 0, 12, 0),
  (700012, 662174, 114, 100, 'e2etest', 'Reply 12 to L3 thread', 1700000120, 0, 13, 0),
  (700013, 662174, 114, 100, 'e2etest', 'Reply 13 to L3 thread', 1700000130, 0, 14, 0),
  (700014, 662174, 114, 100, 'e2etest', 'Reply 14 to L3 thread', 1700000140, 0, 15, 0),
  (700015, 662174, 114, 100, 'e2etest', 'Reply 15 to L3 thread', 1700000150, 0, 16, 0),
  (700016, 662174, 114, 100, 'e2etest', 'Reply 16 to L3 thread', 1700000160, 0, 17, 0),
  (700017, 662174, 114, 100, 'e2etest', 'Reply 17 to L3 thread', 1700000170, 0, 18, 0),
  (700018, 662174, 114, 100, 'e2etest', 'Reply 18 to L3 thread', 1700000180, 0, 19, 0),
  (700019, 662174, 114, 100, 'e2etest', 'Reply 19 to L3 thread', 1700000190, 0, 20, 0),
  (700020, 662174, 114, 100, 'e2etest', 'Reply 20 to L3 thread', 1700000200, 0, 21, 0),
  (700021, 662174, 114, 100, 'e2etest', 'Reply 21 to L3 thread', 1700000210, 0, 22, 0),
  (700022, 662174, 114, 100, 'e2etest', 'Reply 22 to L3 thread', 1700000220, 0, 23, 0),
  (700023, 662174, 114, 100, 'e2etest', 'Reply 23 to L3 thread', 1700000230, 0, 24, 0),
  (700024, 662174, 114, 100, 'e2etest', 'Reply 24 to L3 thread', 1700000240, 0, 25, 0),
  (700025, 662198, 114, 100, 'e2etest', 'Digest thread first post', 1700024000, 1, 1, 0);

-- ─── Post Comments (点评 on posts in thread 662174) ─────────────────────────
INSERT OR REPLACE INTO post_comments (id, thread_id, post_id, author_id, author_name, content, score, created_at) VALUES
  (1, 662174, 662174, 100, 'e2etest', '写得好！', 0, 1700000300),
  (2, 662174, 662174, 64495, 'e2eprofile', '同意楼上', 0, 1700000400);

-- ─── Settings (ensure search is enabled) ─────────────────────────────────
INSERT OR REPLACE INTO settings (key, value, type, updated_at)
VALUES ('general.search.enabled', 'true', 'boolean', 1700000000);
