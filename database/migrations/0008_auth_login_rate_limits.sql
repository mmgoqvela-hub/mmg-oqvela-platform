-- MMG OQVELA Platform
-- Migration 0008: Persistent Login Rate Limiting

CREATE TABLE auth_login_attempts (
    key_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    blocked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_login_attempts_updated
ON auth_login_attempts(updated_at);

