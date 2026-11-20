-- MMG OQVELA
-- Migration 0009: Platform Admin Settings and Audit Logs

CREATE TABLE platform_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (updated_by)
        REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO platform_settings
    (setting_key, setting_value)
VALUES
    ('shamcash_link', ''),
    ('shamcash_recipient', ''),
    ('shamcash_instructions', ''),
    ('shamcash_enabled', '0');

CREATE TABLE admin_activity_logs (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (admin_user_id)
        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_activity_logs_created
ON admin_activity_logs(created_at);

CREATE INDEX idx_admin_activity_logs_admin
ON admin_activity_logs(admin_user_id, created_at);

-- Preserve ShamCash payment details as they were when the request was created.
ALTER TABLE payments
ADD COLUMN payment_details_snapshot TEXT;
