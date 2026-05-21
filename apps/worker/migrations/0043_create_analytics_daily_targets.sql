-- 0043_create_analytics_daily_targets.sql — admin analytics page-view aggregate
--
-- Phase P5 of the admin analytics dashboard plan v3 (see #ellie-数据统计:010b1302).
-- Persists per-day rolled-up "who saw what" counts emitted by the Next.js
-- web proxy via POST /api/internal/analytics/ingest, then aggregated
-- in-isolate by the worker collector (apps/worker/src/lib/analytics/
-- collect.ts) and flushed to D1 via the P5 D1 sink. The admin "今日访问
-- 名单" KPI card + list panel read out of this table.
--
-- Scope boundary — what gets written:
--   - One PRIMARY KEY tuple per (date_local, path_kind, target_id,
--     user_id, bot_class) — `count` is incremented per ingest sample
--     via INSERT ... ON CONFLICT(...) DO UPDATE.
--   - `date_local` is the Asia/Shanghai local-day key (`YYYY-MM-DD`)
--     computed server-side at ingest time, NOT trusted from the client
--     body. Same TZ semantics as `checkin_history.date_local`
--     (LOCAL_TZ_OFFSET_SEC = 8 * 3600).
--   - `path_kind` is one of the 10 PathKind enum string literals
--     declared in apps/worker/src/lib/analytics/types.ts:
--       thread | forum | user | home | digest | search | checkin |
--       messages | auth_page | other
--     UI / list endpoint targets shape its rendering off this column.
--   - `target_id` is the numeric id for thread/forum/user buckets and
--     `0` for non-resource pages. The collector NEVER writes a NULL
--     here so the composite PK stays comparable.
--   - `user_id`: `0` for anonymous; a positive integer for an
--     authenticated forum user (`session.user.provider === "credentials"`
--     in the web proxy gate). OAuth-only sessions (e.g. Google without a
--     linked forum account) are treated as anonymous to avoid leaking
--     non-forum identity into the page-view aggregate.
--   - `bot_class` is the same 4-bucket classifier from P3 (parseBotClass
--     on the inbound UA, server-side at the ingest handler): bot_search
--     / bot_other / human / unknown. The web client body's bot label
--     (if any) is rejected at body validation (400 INVALID_REQUEST) —
--     this column is authoritative server-side.
--
-- Privacy / trust posture:
--   - NO label columns (forum/thread/user name). The list endpoint
--     resolves labels by batched lookup against the source tables at
--     read time. Renames in source data therefore do NOT corrupt
--     historical aggregates and the audit footprint stays minimal.
--   - NO ip / ua columns. The collector receives an extracted IP +
--     parsed bot class via the trusted P3 in-isolate path and only
--     persists the derived bucket counters. Anonymous "visitor count"
--     is therefore a near-UV approximation (distinct user_id > 0 ∪
--     anonymous bucket present) — the visitor handler / UI MUST avoid
--     the "独立访客" wording (see UI copy "活跃用户 + 含匿名访客").
--
-- Retention:
--   - 48h rolling, enforced by a scheduled cron handler
--     `cleanupAnalyticsDailyTargets(env, retentionHours = 48)` registered
--     on `0 19 * * *` UTC = 03:00 Asia/Shanghai (the existing daily cron
--     branch already runs `cleanupLoginHistory`; the new helper joins it).
--   - Cutoff: `last_seen_at < now - 48*3600`. Rows from a current day
--     that have not been touched in 48h are still removed — the table
--     is an opportunistic rolling counter, NOT an audit log.
--
-- Boundaries this table does NOT cross:
--   - Not imported from MySQL. Runtime-only counter; the loader mirrors
--     intentionally do NOT carry it (same pattern as login_history /
--     checkin_history / kv_cache_metrics_minute).
--
-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------
-- Composite PRIMARY KEY pins one (target × user_bucket × bot_bucket)
-- row per local day; the UPSERT path in flushSink-d1.ts uses this PK as
-- its ON CONFLICT target. All five PK columns are NOT NULL by SQLite
-- composite-PK semantics, so the PK doubles as the not-null guard.

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

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
-- 1) idx_analytics_daily_targets_list — list endpoint shape. The admin
--    "今日访问名单" filter scans `WHERE date_local=? AND path_kind=?`
--    then GROUP BY target_id; this covering index keeps the scan
--    sequential and bounded.
CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_list
    ON analytics_daily_targets(date_local, path_kind, target_id);

-- 2) idx_analytics_daily_targets_last_seen — 48h retention sweep. The
--    cron handler runs `DELETE FROM analytics_daily_targets WHERE
--    last_seen_at < ?`; a leading index on last_seen_at lets the
--    DELETE walk the eligible subset in order without scanning the PK.
CREATE INDEX IF NOT EXISTS idx_analytics_daily_targets_last_seen
    ON analytics_daily_targets(last_seen_at);

-- ---------------------------------------------------------------------
-- Drift guard
-- ---------------------------------------------------------------------
-- tests/unit/migration-0043-schema.test.ts pins the table column shape
-- + composite PK column order + both indexes above against all 3 schema
-- mirrors:
--   1. apps/worker/migrations/0043_create_analytics_daily_targets.sql (this file)
--   2. apps/worker/migrations/0000_init_schema.sql (baseline)
--   3. packages/db/src/schema.ts (TABLES + INDEXES)
--
-- analytics_daily_targets is a runtime-only counter table — it is NOT
-- imported from the legacy Discuz MySQL source, so the loader mirrors
-- (packages/migrate/src/load/schema.ts + scripts/migrate/load/schema.ts)
-- intentionally do NOT carry it. Same pattern as login_history /
-- checkin_history / kv_cache_metrics_minute. The drift guard asserts
-- this exclusion so a future refactor that re-introduces it cannot
-- ship silently.
