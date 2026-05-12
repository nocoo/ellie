-- 0036_create_checkin_history.sql — Per-day check-in (签到) audit log
--
-- The pre-existing `user_checkins` table (migration 0033) only stores rolling
-- aggregates (total_days, month_days, streak_days, last_checkin_at). That
-- shape is enough for the public homepage badge but cannot answer:
--   * "What days did user N actually check in?"
--   * "Did user N check in on day D?" (admin gap inspection)
--   * "Recompute streak / month_days from history" (admin recompute helper)
--
-- This migration adds a per-day history table. Each row is one
-- (user_id, date_local) check-in. `date_local` is the local-day string
-- in `YYYY-MM-DD` format computed in Asia/Shanghai (matching the existing
-- `shanghaiTodayStartUnix()` window used by the public POST handler).
-- Storing the day as text keeps the unique constraint trivial and
-- timezone-stable across the DST-free CN locale.
--
-- We intentionally DO NOT backfill historical `user_checkins.last_checkin_at`
-- into this table. Pre-existing aggregates remain authoritative for legacy
-- streaks; new POSTs (and any future admin "fill day" actions) write to
-- `checkin_history`. The recompute helper in Phase E will treat a missing
-- history row as "no recorded check-in on that day" — old aggregates are
-- preserved by the recompute reading both tables and taking the max.

CREATE TABLE IF NOT EXISTS checkin_history (
    user_id    INTEGER NOT NULL,
    -- Asia/Shanghai local day, stored as 'YYYY-MM-DD'. Text rather than an
    -- integer day-key so admin queries (`WHERE date_local BETWEEN ?, ?`)
    -- read naturally and the unique constraint is collation-stable.
    date_local TEXT    NOT NULL,
    mood       TEXT    NOT NULL DEFAULT '',
    message    TEXT    NOT NULL DEFAULT '',
    reward     INTEGER NOT NULL DEFAULT 0,
    -- Server-side unix seconds at insert time. Useful for "when did this
    -- check-in actually arrive" audits independent of Shanghai-day rollover
    -- (e.g. a 23:59:55 POST that lands at 00:00:01 server time).
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date_local)
);

-- Admin date-range queries (gap detection, "who checked in on D") read by
-- date first; the composite PK is already (user_id, date_local) so a
-- standalone index on `date_local` covers the cross-user lookup path.
CREATE INDEX IF NOT EXISTS idx_checkin_history_date
    ON checkin_history(date_local);
