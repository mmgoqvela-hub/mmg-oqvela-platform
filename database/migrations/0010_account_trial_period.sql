-- MMG OQVELA
-- Migration 0010: One-time account trial period

ALTER TABLE accounts
ADD COLUMN trial_used_at TEXT;

ALTER TABLE store_subscriptions
ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0
CHECK (is_trial IN (0, 1));

ALTER TABLE store_subscriptions
ADD COLUMN trial_account_id TEXT
REFERENCES accounts(id);

CREATE UNIQUE INDEX idx_one_trial_per_account
ON store_subscriptions(trial_account_id)
WHERE trial_account_id IS NOT NULL;

CREATE TABLE platform_trial_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),
    duration_days INTEGER NOT NULL DEFAULT 14
        CHECK (duration_days BETWEEN 1 AND 365),
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_trial_settings (id, enabled, duration_days)
VALUES (1, 1, 14);

INSERT OR IGNORE INTO subscription_plans (
    id, name, description, price, currency, duration_days, is_active
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'الفترة التجريبية',
    'اشتراك تجريبي مجاني لمرة واحدة لكل حساب',
    0,
    'USD',
    14,
    1
);
