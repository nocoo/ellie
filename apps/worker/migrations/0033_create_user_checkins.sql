-- 0033_create_user_checkins.sql — Daily check-in (签到) state per user
-- Replaces Discuz dsu_paulsign plugin tables (pre_dsu_paulsign / pre_dsu_paulsign2).
-- One row per user who has ever checked in; tracks cumulative stats + last action.
-- Import: Step 2 will merge pre_dsu_paulsign + pre_dsu_paulsign2 into this table.
-- API:    Step 3 will read/update via /api/v1/checkin endpoints.

CREATE TABLE IF NOT EXISTS user_checkins (
    user_id         INTEGER PRIMARY KEY,
    total_days      INTEGER NOT NULL DEFAULT 0,
    month_days      INTEGER NOT NULL DEFAULT 0,
    streak_days     INTEGER NOT NULL DEFAULT 0,
    reward_total    INTEGER NOT NULL DEFAULT 0,
    last_reward     INTEGER NOT NULL DEFAULT 0,
    mood            TEXT    NOT NULL DEFAULT '',
    message         TEXT    NOT NULL DEFAULT '',
    last_checkin_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_checkins_last ON user_checkins(last_checkin_at);
