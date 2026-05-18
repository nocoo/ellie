-- 0040_create_post_ratings.sql — Post rating (评分) feature, see docs/22-post-rating.md §5.1
--
-- Restores Discuz `pre_forum_ratelog` semantics in the new system:
--   * Per-post rating events transferring `credits` (extcredits1) or
--     `coins` (extcredits2) from rater → post author.
--   * `dupkarmarate=0` equivalence: at most ONE active (un-revoked) rating
--     per (rater_id, post_id, dimension).
--   * Soft revoke via `revoked_at` / `revoked_by` — the partial unique
--     index below intentionally limits the constraint to active rows so
--     an Admin/SuperMod can revoke a rating and the same user can later
--     rate the same post in the same dimension again. This also lets us
--     compute the rolling 24h quota (SUM(ABS(score)) WHERE revoked_at=0)
--     so revoking automatically refunds the rater's quota — matching
--     Discuz's "delete the ratelog row" semantics.
--
-- Aggregates (count / sum per dimension) are computed on-demand: §5.2 of
-- the doc deliberately rejects adding redundant `rate / rate_times`
-- columns on `posts` so we never have a write that has to keep two rows
-- in sync. The posts-list handler (Phase 3) batches the aggregate in one
-- GROUP BY per page; per-post hover detail goes through the read API.
--
-- Field notes:
--   * `thread_id` is denormalised so a future thread-level summary
--     ("this thread received N ratings") can be served from a single
--     index without joining `posts`.
--   * `rater_name` is a snapshot at insert time so a rename / tombstone
--     does not break historical UI rows. Display still resolves the
--     current `users.username` for the rater id when available.
--   * `dimension` is the small INTEGER discriminant matching Discuz
--     extcredits ids: 1 = credits (积分), 2 = coins (同钱). Future
--     dimensions can be added without altering the table.

CREATE TABLE IF NOT EXISTS post_ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL,
    thread_id   INTEGER NOT NULL,
    rater_id    INTEGER NOT NULL,
    rater_name  TEXT    NOT NULL,
    dimension   INTEGER NOT NULL,        -- 1=credits, 2=coins
    score       INTEGER NOT NULL,        -- signed; perVoteMax bounds applied in app
    reason      TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    revoked_at  INTEGER NOT NULL DEFAULT 0,
    revoked_by  INTEGER NOT NULL DEFAULT 0
);

-- Hot path: per-post aggregate + hover-list reads. The composite covers
-- the (post_id, revoked_at=0) filter and orders by created_at for the
-- "latest first" hover list.
CREATE INDEX IF NOT EXISTS idx_post_ratings_post
    ON post_ratings(post_id, revoked_at, created_at);

-- Reserved for future thread-level summaries / admin scans.
CREATE INDEX IF NOT EXISTS idx_post_ratings_thread
    ON post_ratings(thread_id, revoked_at, created_at);

-- Rolling-24h quota query: SUM(ABS(score)) WHERE rater_id=? AND
-- dimension=? AND created_at>=now-86400 AND revoked_at=0. Partial index
-- keeps the active-row scan tight.
CREATE INDEX IF NOT EXISTS idx_post_ratings_rater_dim_time
    ON post_ratings(rater_id, dimension, created_at)
    WHERE revoked_at = 0;

-- §3 "one active rating per (rater, post, dimension)" constraint. The
-- partial predicate intentionally allows multiple revoked rows for the
-- same key — that's what enables "rate → revoke → rate again".
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_ratings_active
    ON post_ratings(rater_id, post_id, dimension)
    WHERE revoked_at = 0;
