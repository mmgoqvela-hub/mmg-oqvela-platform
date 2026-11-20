-- MMG OQVELA
-- Migration 0005: Secure Authentication Sessions

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_user
    ON auth_sessions(user_id);

CREATE INDEX idx_auth_sessions_expiry
    ON auth_sessions(expires_at);

CREATE INDEX idx_auth_sessions_active
    ON auth_sessions(token_hash, expires_at)
    WHERE revoked_at IS NULL;
