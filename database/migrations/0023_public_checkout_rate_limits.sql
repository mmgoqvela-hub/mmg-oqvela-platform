-- MMG OQVELA
-- Migration 0023: Rate-limit public checkout attempts per store and IP hash.
-- Raw IP addresses are never stored; expired buckets are pruned by the daily scheduler.

CREATE TABLE public_checkout_rate_limits (
  store_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (store_id, ip_hash),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE INDEX idx_public_checkout_rate_limits_window
  ON public_checkout_rate_limits(window_started_at);
