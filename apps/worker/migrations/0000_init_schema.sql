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

-- ============================================================================
-- Indexes
-- ============================================================================

-- Users indexes
-- Admin analytics: daily new-registrations trend bucket. See migration
-- 0041_idx_analytics_trend.sql.
CREATE INDEX IF NOT EXISTS idx_users_reg_date ON users(reg_date);

-- Threads indexes
CREATE INDEX IF NOT EXISTS idx_threads_forum ON threads(forum_id, sticky DESC, last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_author ON threads(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_latest ON threads(last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_digest ON threads(digest, last_post_at DESC) WHERE digest > 0;
CREATE INDEX IF NOT EXISTS idx_threads_last_poster_id ON threads(last_poster_id);
-- Site-wide announcement (sticky=2) cross-forum lookup. See migration
-- 0037_idx_threads_sticky.sql for rationale; without this the OR'd
-- WHERE in /api/v1/threads scans ~1M rows per cache miss.
CREATE INDEX IF NOT EXISTS idx_threads_sticky ON threads(sticky, last_post_at DESC, id DESC);
-- Admin analytics: global new-threads trend (date bucket over created_at).
-- See migration 0041_idx_analytics_trend.sql.
CREATE INDEX IF NOT EXISTS idx_threads_created ON threads(created_at DESC);

-- Posts indexes
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, position);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);
-- Admin analytics: global posts trend + per-forum distribution. See
-- migration 0041_idx_analytics_trend.sql.
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_forum_created ON posts(forum_id, created_at DESC);

-- Attachments indexes
CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);

-- Forums indexes
CREATE INDEX IF NOT EXISTS idx_forums_last_poster_id ON forums(last_poster_id);
CREATE INDEX IF NOT EXISTS idx_forums_visibility ON forums(visibility);

-- IP Bans indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_bans_ip ON ip_bans(ip);

-- Censor Words indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_censor_words_find ON censor_words(find);

-- Settings indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- Reports indexes
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

-- Admin Logs indexes
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

-- Announcements indexes
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_dates ON announcements(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_announcements_sticky ON announcements(sticky DESC, created_at DESC);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);

-- ─── KV cache observability ───────────────────────────────────────
-- Per-minute hit/miss/error counters keyed by registry family. Written
-- by `lib/cache/metrics.ts` swap-then-flush; read by the admin KV
-- monitor page. Operational table — failures must never propagate to
-- the request path.

CREATE TABLE IF NOT EXISTS kv_cache_metrics_minute (
    family       TEXT    NOT NULL,
    ts_minute    INTEGER NOT NULL,
    op           TEXT    NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (family, ts_minute, op)
);

CREATE INDEX IF NOT EXISTS idx_kv_metrics_ts ON kv_cache_metrics_minute(ts_minute DESC);

-- ─── Check-in history (mirror of migration 0036) ──────────────────
-- Per-day audit log appended by `POST /api/v1/checkin` on success.
-- The aggregate `user_checkins` row from migration 0033 keeps rolling
-- totals; this table records one row per actual check-in keyed by
-- Asia/Shanghai local day (`YYYY-MM-DD` text). Composite PK gives the
-- at-most-one-per-day uniqueness the public POST handler relies on
-- via `ON CONFLICT(user_id, date_local) DO NOTHING`.
--
-- Mirrored here so a fresh DB built from 0000_init_schema.sql (or the
-- shared `packages/db/src/schema.ts`) has the table even before
-- migration 0036 runs — Phase E admin endpoints will refuse to start
-- against a schema missing this table.

CREATE TABLE IF NOT EXISTS checkin_history (
    user_id    INTEGER NOT NULL,
    date_local TEXT    NOT NULL,
    mood       TEXT    NOT NULL DEFAULT '',
    message    TEXT    NOT NULL DEFAULT '',
    reward     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date_local)
);

CREATE INDEX IF NOT EXISTS idx_checkin_history_date ON checkin_history(date_local);

-- ─── Login history (mirror of migration 0042) ─────────────────────
-- Per-attempt audit log appended by `auth.ts` login/register handlers
-- after trust-edge resolution. Powers the admin analytics "今日登录"
-- KPI + masked detail list + audit-logged reveal endpoint. Failures
-- are deferred onto `ctx.waitUntil` and MUST NEVER reach the response
-- path — see `apps/worker/src/lib/analytics/loginHistory.ts`.
--
-- Mirrored here so a fresh DB built from 0000_init_schema.sql (or the
-- shared `packages/db/src/schema.ts`) has the table even before
-- migration 0042 runs — Phase P4 admin endpoints will refuse to start
-- against a schema missing this table. Runtime-only audit table: NOT
-- imported from MySQL, so the loader mirrors intentionally skip it.

CREATE TABLE IF NOT EXISTS login_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    username    TEXT    NOT NULL,
    ok          INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    error_code  TEXT    NOT NULL DEFAULT '',
    ip          TEXT    NOT NULL DEFAULT '',
    user_agent  TEXT    NOT NULL DEFAULT '',
    bot_class   TEXT    NOT NULL DEFAULT 'unknown',
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_history_created
    ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user_created
    ON login_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_kind_created
    ON login_history(kind, created_at DESC);
-- Partial index over failure rows only — admin "失败明细" filter only
-- ever queries `error_code != ''`, so the partial WHERE keeps the
-- active subset tight instead of fattening every successful login.
CREATE INDEX IF NOT EXISTS idx_login_history_error_created
    ON login_history(error_code, created_at DESC)
    WHERE error_code != '';

-- ----------------------------------------------------------------------
-- analytics_daily_targets (mirror of migration 0043)
--
-- Phase P5 — admin analytics page-view aggregate. Per (date_local,
-- path_kind, target_id, user_id, bot_class) counter, written via UPSERT
-- by the worker collector flush sink and swept by a 48h cron. Powers
-- the admin "今日访问名单" KPI + list panel. Runtime-only counter table
-- — NOT imported from MySQL, so loader mirrors intentionally skip it.
-- Same posture pattern as login_history / checkin_history /
-- kv_cache_metrics_minute. See
-- apps/worker/src/lib/analytics/{flushSink-d1.ts, cleanup.ts}.

CREATE TABLE IF NOT EXISTS analytics_daily_targets (
    date_local      TEXT    NOT NULL,
    path_kind       TEXT    NOT NULL,
    target_id       INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    bot_class       TEXT    NOT NULL,
    count           INTEGER NOT NULL DEFAULT 0,
    first_seen_at   INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL,
    PRIMARY KEY (date_local, path_kind, target_id, user_id, bot_class)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_list
    ON analytics_daily_targets(date_local, path_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_last_seen
    ON analytics_daily_targets(last_seen_at);
