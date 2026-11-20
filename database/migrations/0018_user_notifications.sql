-- MMG OQVELA Platform
-- Migration 0018: Persistent user notification inbox

CREATE TABLE user_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    dedupe_key TEXT UNIQUE,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (length(title) BETWEEN 1 AND 160),
    CHECK (length(message) BETWEEN 1 AND 2000)
);

CREATE INDEX idx_user_notifications_inbox
    ON user_notifications(user_id, created_at DESC);

CREATE INDEX idx_user_notifications_unread
    ON user_notifications(user_id, read_at, created_at DESC);
