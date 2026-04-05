-- 0000_init_schema.sql — Base schema for tongjinet forum
-- This migration creates the core tables that existed before migration system was added.
-- Required for new database instances (including test DB).

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL DEFAULT '',
  password_salt TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  status        INTEGER NOT NULL DEFAULT 0,
  role          INTEGER NOT NULL DEFAULT 0,
  reg_date      INTEGER NOT NULL DEFAULT 0,
  last_login    INTEGER NOT NULL DEFAULT 0,
  threads       INTEGER NOT NULL DEFAULT 0,
  posts         INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 0,
  signature     TEXT    NOT NULL DEFAULT '',
  group_title   TEXT    NOT NULL DEFAULT '',
  group_stars   INTEGER NOT NULL DEFAULT 0,
  group_color   TEXT    NOT NULL DEFAULT '',
  custom_title  TEXT    NOT NULL DEFAULT '',
  digest_posts  INTEGER NOT NULL DEFAULT 0,
  ol_time       INTEGER NOT NULL DEFAULT 0,
  gender        INTEGER NOT NULL DEFAULT 0,
  birth_year    INTEGER NOT NULL DEFAULT 0,
  birth_month   INTEGER NOT NULL DEFAULT 0,
  birth_day     INTEGER NOT NULL DEFAULT 0,
  reside_province TEXT  NOT NULL DEFAULT '',
  reside_city   TEXT    NOT NULL DEFAULT '',
  graduate_school TEXT  NOT NULL DEFAULT '',
  bio           TEXT    NOT NULL DEFAULT '',
  interest      TEXT    NOT NULL DEFAULT '',
  qq            TEXT    NOT NULL DEFAULT '',
  site          TEXT    NOT NULL DEFAULT '',
  last_activity INTEGER NOT NULL DEFAULT 0,
  reg_ip        TEXT    NOT NULL DEFAULT '',
  last_ip       TEXT    NOT NULL DEFAULT ''
);

-- Forums table
CREATE TABLE IF NOT EXISTS forums (
  id              INTEGER PRIMARY KEY,
  parent_id       INTEGER NOT NULL DEFAULT 0,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  icon            TEXT    NOT NULL DEFAULT '',
  display_order   INTEGER NOT NULL DEFAULT 0,
  threads         INTEGER NOT NULL DEFAULT 0,
  posts           INTEGER NOT NULL DEFAULT 0,
  type            TEXT    NOT NULL DEFAULT 'forum',
  status          INTEGER NOT NULL DEFAULT 1,
  last_thread_id  INTEGER NOT NULL DEFAULT 0,
  last_post_at    INTEGER NOT NULL DEFAULT 0,
  last_poster     TEXT    NOT NULL DEFAULT '',
  last_thread_subject TEXT NOT NULL DEFAULT '',
  moderators      TEXT    NOT NULL DEFAULT '',
  last_poster_id  INTEGER NOT NULL DEFAULT 0,
  moderator_ids   TEXT    NOT NULL DEFAULT '',
  visibility      TEXT    NOT NULL DEFAULT 'public'
    CHECK(visibility IN ('public', 'members', 'staff', 'admin'))
);

-- Threads table
CREATE TABLE IF NOT EXISTS threads (
  id            INTEGER PRIMARY KEY,
  forum_id      INTEGER NOT NULL REFERENCES forums(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  subject       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT 0,
  last_post_at  INTEGER NOT NULL DEFAULT 0,
  last_poster   TEXT    NOT NULL DEFAULT '',
  replies       INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  closed        INTEGER NOT NULL DEFAULT 0,
  sticky        INTEGER NOT NULL DEFAULT 0,
  digest        INTEGER NOT NULL DEFAULT 0,
  special       INTEGER NOT NULL DEFAULT 0,
  highlight     INTEGER NOT NULL DEFAULT 0,
  recommends    INTEGER NOT NULL DEFAULT 0,
  post_table_id INTEGER NOT NULL DEFAULT 0,
  type_name     TEXT    NOT NULL DEFAULT '',
  last_poster_id INTEGER NOT NULL DEFAULT 0
);

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER NOT NULL REFERENCES threads(id),
  forum_id      INTEGER NOT NULL REFERENCES forums(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  author_name   TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT 0,
  is_first      INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  invisible     INTEGER NOT NULL DEFAULT 0
);

-- Attachments table
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id),
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

-- IP Bans table
CREATE TABLE IF NOT EXISTS ip_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Censor Words table
CREATE TABLE IF NOT EXISTS censor_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  find TEXT NOT NULL,
  replacement TEXT NOT NULL DEFAULT '**',
  action TEXT NOT NULL DEFAULT 'replace' CHECK(action IN ('ban', 'replace')),
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT '',
  type  TEXT NOT NULL DEFAULT 'string'
        CHECK(type IN ('string', 'number', 'boolean', 'json')),
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('thread', 'post', 'user')),
  target_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reporter_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK(status IN ('pending', 'resolved', 'dismissed')),
  handler_id INTEGER,
  handler_name TEXT NOT NULL DEFAULT '',
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Admin Logs table
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  admin_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  details TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  forum_ids TEXT NOT NULL DEFAULT '',
  sticky INTEGER NOT NULL DEFAULT 0,
  start_at INTEGER,
  end_at INTEGER,
  status INTEGER NOT NULL DEFAULT 1,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  receiver_id INTEGER NOT NULL,
  receiver_name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  sender_deleted INTEGER NOT NULL DEFAULT 0,
  receiver_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Test marker table (D1 isolation verification)
-- Used by L2/L3 tests to verify they're running against test DB, not production.
CREATE TABLE IF NOT EXISTS _test_marker (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR REPLACE INTO _test_marker (key, value) VALUES ('env', 'test');
