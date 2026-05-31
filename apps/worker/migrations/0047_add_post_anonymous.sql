-- 0047_add_post_anonymous.sql — restore the `anonymous` flag dropped during the
-- Discuz → D1 migration.
--
-- Original Discuz `pre_forum_post` had a `tinyint(1) anonymous` column (index 12
-- in the INSERT VALUES tuple). The migrator's POST_COLS map listed it but never
-- read it, so 8,474 anonymous posts (across ~1,617 threads) had their authors
-- exposed.
--
-- Default 0 = not anonymous. Backfill from the original dump runs separately.
ALTER TABLE posts ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0;

-- Partial index: only ~8.5k rows have anonymous=1 out of 9.5M, so a partial
-- index keeps it tiny while still serving "find anonymous posts" admin queries.
CREATE INDEX IF NOT EXISTS idx_posts_anonymous
  ON posts(id) WHERE anonymous = 1;
