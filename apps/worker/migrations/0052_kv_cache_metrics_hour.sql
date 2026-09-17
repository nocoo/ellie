-- Hourly observations replace minute-level metric writes. Historical minute
-- rows keep their existing retention; no business table is scanned or copied.
CREATE TABLE IF NOT EXISTS kv_cache_metrics_hour (
  family TEXT NOT NULL,
  ts_hour INTEGER NOT NULL,
  op TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (family, ts_hour, op)
);

CREATE INDEX IF NOT EXISTS idx_kv_metrics_hour_ts ON kv_cache_metrics_hour(ts_hour DESC);
