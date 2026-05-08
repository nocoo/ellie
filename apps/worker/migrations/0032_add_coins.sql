-- 0032_add_coins.sql — Add coins column to users table
-- Stores extcredits2 ("同钱") from the old Discuz forum, separate from
-- credits (extcredits1 / "积分") which was already migrated.
-- Backfill: pre_common_member_count.extcredits2 → users.coins

ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
