-- MMG OQVELA
-- Migration 0002: Billing and Store Subscriptions

CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL CHECK (price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE store_subscriptions (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'active',
            'expired',
            'suspended',
            'cancelled'
        )),
    starts_at TEXT,
    expires_at TEXT,
    auto_renew INTEGER NOT NULL DEFAULT 0
        CHECK (auto_renew IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE RESTRICT,

    FOREIGN KEY (plan_id)
        REFERENCES subscription_plans(id) ON DELETE RESTRICT
);

CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method TEXT NOT NULL,
    transaction_reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'approved',
            'rejected',
            'refunded'
        )),
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (subscription_id)
        REFERENCES store_subscriptions(id) ON DELETE RESTRICT
);

CREATE TABLE subscription_history (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    action TEXT NOT NULL
        CHECK (action IN (
            'created',
            'activated',
            'renewed',
            'expired',
            'suspended',
            'reactivated',
            'cancelled'
        )),
    details TEXT,
    performed_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (subscription_id)
        REFERENCES store_subscriptions(id) ON DELETE RESTRICT,

    FOREIGN KEY (performed_by)
        REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    payment_id TEXT,
    invoice_number TEXT NOT NULL UNIQUE,
    subtotal REAL NOT NULL CHECK (subtotal >= 0),
    tax REAL NOT NULL DEFAULT 0 CHECK (tax >= 0),
    total REAL NOT NULL CHECK (total >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'paid', 'void')),
    issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at TEXT,

    FOREIGN KEY (subscription_id)
        REFERENCES store_subscriptions(id) ON DELETE RESTRICT,

    FOREIGN KEY (payment_id)
        REFERENCES payments(id) ON DELETE SET NULL
);

CREATE INDEX idx_subscriptions_store
    ON store_subscriptions(store_id);

CREATE INDEX idx_subscriptions_status_expiry
    ON store_subscriptions(status, expires_at);

CREATE INDEX idx_payments_subscription
    ON payments(subscription_id);

CREATE INDEX idx_payments_status
    ON payments(status);

CREATE INDEX idx_subscription_history
    ON subscription_history(subscription_id, created_at);

CREATE INDEX idx_invoices_subscription
    ON invoices(subscription_id);
