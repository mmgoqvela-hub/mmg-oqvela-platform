-- MMG OQVELA
-- Migration 0025: Public service request abuse protection
-- Store only a SHA-256 hash of the edge-provided client IP, never the raw address.

CREATE TABLE public_service_request_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE INDEX idx_public_service_request_rate_limits_window
  ON public_service_request_rate_limits(window_started_at);
