-- 0042_create_login_history.sql — admin analytics auth attempt audit log
--
-- Phase P4 of the admin analytics dashboard plan v3 (see #ellie-数据统计:010b1302).
-- Persists one row per **observable** auth attempt — successful and failed —
-- that the worker `auth.ts` handlers reach AFTER trust-edge resolution
-- (i.e. after `extractTrustedClientIp` has yielded a usable IP and a
-- candidate username/account branch has been chosen). The admin "今日
-- 登录" KPI card + masked detail list + audit-logged reveal endpoint
-- read out of this table.
--
-- Scope boundary — what gets written:
--   - login: INVALID_CREDENTIALS / USER_BANNED / RATE_LIMITED_IP /
--            LOCKED_OUT_IP / success (ok=1)
--   - register: REGISTRATION_DISABLED / USERNAME_BANNED / RATE_LIMITED /
--               EMAIL_ALREADY_IN_USE / USERNAME_TAKEN / success (ok=1)
--   NOT written: body-shape validation failures (INVALID_USERNAME /
--   INVALID_PASSWORD / INVALID_EMAIL / INVALID_BODY), trust-edge failures
--   (INVALID_REQUEST when client IP is missing), INTERNAL_ERROR catches.
--   These either lack a usable IP or lack a meaningful username and would
--   pollute the audit trail without adding signal — see
--   apps/worker/src/lib/analytics/loginHistory.ts for the call-site guard.
--
-- Privacy / trust posture:
--   - The collector mirrors the contract pattern from P3 (apps/worker/
--     src/lib/analytics/collect.ts) — the auth handler resolves IP via
--     the trusted-header path, then hands a fully-resolved row to
--     `scheduleLoginHistory(env, ctx?, row)`. The DB insert is deferred
--     onto `ctx.waitUntil`; failures are caught + warned and NEVER reach
--     the response path. If `ctx` is undefined (test stubs, internal
--     re-entries) the schedule is a documented no-op.
--   - `ip` rows longer than 64 chars are rejected at the helper (no
--     truncation: a >64-char "IP" indicates a header-shaping bug, not a
--     real client). `user_agent` is `slice(0, 256)` truncated.
--   - `bot_class` is the same 4-bucket classifier from P3
--     (parseBotClass): bot_search / bot_other / human / unknown.
--   - Detail list endpoint returns rows with `ip` and `user_agent`
--     masked. The "view full" reveal endpoint returns unmasked values
--     and writes a row into `admin_logs` with action
--     `analytics.login_history.reveal` (details intentionally exclude
--     the revealed IP/UA so admin_log itself doesn't become a sensitive
--     secondary store).
--
-- Retention:
--   - 30 days rolling, enforced by a scheduled cron handler
--     `cleanupLoginHistory(env)` registered on `0 19 * * *` UTC = 03:00
--     Asia/Shanghai. Existing `aggregateOnlineStats` cron stays on
--     `*/5 * * * *`; the worker `scheduled(event, env, ctx)` handler
--     switches on `event.cron` to dispatch.
--
-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------
-- `user_id` is nullable: failed-username login (user not found) and
-- USERNAME_BANNED register attempts have no matching `users` row yet.
-- `username` is always non-null because the success / failure branches
-- we instrument all run AFTER username has been parsed from the request
-- body.
-- `ok` (0|1) + `kind` ('login'|'register') give the KPI card its 5
-- counters in a single GROUP BY.
-- `error_code` is TEXT NOT NULL DEFAULT '' — empty on success, set to a
-- documented enum string on failure. Tests in
-- tests/unit/handlers/auth-login-history-instrumentation.test.ts pin
-- every enum value back to a real auth.ts return branch so the UI never
-- shows a code that the writer never produces.

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

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
-- 1) idx_login_history_created — today/range KPI scan + masked list scan.
--    DESC matches both the recency window the KPI counts over (last 24h
--    in Asia/Shanghai) and the natural sort order of the detail list.
CREATE INDEX IF NOT EXISTS idx_login_history_created
    ON login_history(created_at DESC);

-- 2) idx_login_history_user_created — per-user audit lookup ("show me
--    user X's recent login attempts"). user_id is nullable so the
--    "guest miss" rows (failed username, user not found) bucket under
--    NULL and are excluded from the per-user path; admin queries
--    looking for specific users use this covering shape.
CREATE INDEX IF NOT EXISTS idx_login_history_user_created
    ON login_history(user_id, created_at DESC);

-- 3) idx_login_history_kind_created — top-level "logins vs registrations"
--    counter scan + per-kind detail list. The KPI card groups counts
--    by (kind, ok) over a 24h window; this index keeps that scan
--    sequential on the recency axis.
CREATE INDEX IF NOT EXISTS idx_login_history_kind_created
    ON login_history(kind, created_at DESC);

-- 4) idx_login_history_error_created — PARTIAL index over failure rows.
--    The admin "失败明细" filter only ever queries `error_code != ''`,
--    so a partial index keeps the active subset tight (~hundreds of
--    rows/day in steady state) instead of fattening every successful
--    login. Drift guard pins the partial WHERE clause exactly: a
--    regression that drops `WHERE error_code != ''` would explode the
--    index to full-table size for no read win.
CREATE INDEX IF NOT EXISTS idx_login_history_error_created
    ON login_history(error_code, created_at DESC)
    WHERE error_code != '';

-- ---------------------------------------------------------------------
-- Drift guard
-- ---------------------------------------------------------------------
-- tests/unit/migration-0042-schema.test.ts pins the table column shape
-- + every index above + the partial WHERE clause against all 3 schema
-- mirrors:
--   1. apps/worker/migrations/0042_create_login_history.sql (this file)
--   2. apps/worker/migrations/0000_init_schema.sql (baseline)
--   3. packages/db/src/schema.ts (TABLES + INDEXES)
--
-- login_history is a runtime-only audit table — it is NOT imported from
-- the legacy Discuz MySQL source, so the loader mirrors
-- (packages/migrate/src/load/schema.ts + scripts/migrate/load/schema.ts)
-- intentionally do NOT carry it. Same pattern as checkin_history /
-- kv_cache_metrics_minute.
