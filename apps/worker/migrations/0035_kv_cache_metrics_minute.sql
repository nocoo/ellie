-- 0035_kv_cache_metrics_minute.sql — Per-minute KV cache hit/miss/error
-- counters for the admin KV monitor page.
--
-- Shape:
--   - One row per (family, ts_minute). `family` matches the stable
--     identifier in `apps/worker/src/lib/cache/kv-registry.ts`.
--   - `ts_minute` is the floor of `unix_seconds / 60` (i.e. the minute
--     bucket as an integer). UTC; the admin UI converts to local.
--   - Counters are monotonically incremented by the in-isolate
--     accumulator + swap-then-clear flush (`lib/cache/metrics.ts`). The
--     accumulator runs UPSERTs so concurrent isolates merge cleanly.
--
-- Retention:
--   - Trim is the responsibility of a future scheduled job; the table
--     is small (one row per family per minute, ≈10 families × 1440 min
--     ≈ 14k rows/day) so we let it grow until then.
--
-- IMPORTANT: this is an OPERATIONAL table. Failures to write must NEVER
-- propagate to the request path — the metrics writer logs and swallows.

CREATE TABLE IF NOT EXISTS kv_cache_metrics_minute (
    family       TEXT    NOT NULL,
    ts_minute    INTEGER NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    misses       INTEGER NOT NULL DEFAULT 0,
    errors       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (family, ts_minute)
);

-- Reverse-time index for the admin "last N minutes" query.
CREATE INDEX IF NOT EXISTS idx_kv_metrics_ts ON kv_cache_metrics_minute(ts_minute DESC);
