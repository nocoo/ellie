-- 0030_user_tombstone.sql — D4-a tombstone columns
--
-- Adds purged_at/purged_by to track admin "彻底清除" (purge) operations.
-- D4-a wires schema/types/guards only. Actual content cleanup + purge success
-- path lands in D4-b/D4-c. Status sentinel -99 ("已清除") is documented in
-- packages/types/src/types.ts UserStatus enum and surfaced via statusLabel.
--
-- Both columns are NOT NULL DEFAULT 0 so existing rows backfill cleanly and
-- the worker mapper can treat them as plain numbers (no nullability gymnastics).
--   purged_at = 0 → not purged (active, banned, archived, …).
--   purged_at > 0 → unix seconds at the moment of purge.
--   purged_by    → admin user id who issued the purge (0 if not purged).

ALTER TABLE users ADD COLUMN purged_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN purged_by INTEGER NOT NULL DEFAULT 0;
