-- 0035_kv_cache_metrics_minute.sql — Per-minute KV cache op counters
-- for the admin KV monitor page.
--
-- Shape (B.1):
--   - One row per (family, ts_minute, op). `family` matches the stable
--     identifier in `apps/worker/src/lib/cache/kv-registry.ts`.
--   - `op` is the discrete operation observed; whitelist (enforced in
--     `lib/cache/metrics.ts`):
--       read    — every KV.get attempt against this family.
--       hit     — read returned a payload that passed validation.
--       miss    — read returned null OR validator rejected it.
--       write   — successful KV.put (including write-back).
--       bump    — `bumpGen` invalidation against this family's gen key.
--       delete  — single-key KV.delete invalidation against this family.
--       error   — KV.get / KV.put failure.
--   - `count` is the monotonic counter for that bucket. UPSERT-merged so
--     concurrent isolates collapse cleanly into the same minute row.
--   - `ts_minute` is the floor of `unix_seconds / 60`. UTC.
--
-- Retention:
--   - Trim is the responsibility of a future scheduled job. Estimated
--     ceiling: ~10 families × 7 ops × 1440 min ≈ 100k rows/day. Cheap.
--
-- IMPORTANT: this is an OPERATIONAL table. Failures to write must NEVER
-- propagate to the request path — the metrics writer logs and swallows.

CREATE TABLE IF NOT EXISTS kv_cache_metrics_minute (
    family       TEXT    NOT NULL,
    ts_minute    INTEGER NOT NULL,
    op           TEXT    NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (family, ts_minute, op)
);

-- Reverse-time index for the admin "last N minutes" query.
CREATE INDEX IF NOT EXISTS idx_kv_metrics_ts ON kv_cache_metrics_minute(ts_minute DESC);
