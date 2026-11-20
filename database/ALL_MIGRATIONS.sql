-- MMG OQVELA Platform
-- Migration 0001: Core Identity and Multi-Tenant Foundation

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'pending')),
    email_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (owner_user_id)
        REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE account_users (
    account_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (account_id, user_id),

    FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    business_type TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN (
            'active',
            'suspended',
            'maintenance',
            'closed'
        )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON DELETE RESTRICT,

    UNIQUE (id, account_id)
);

CREATE TABLE store_members (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,

    UNIQUE (store_id, user_id)
);

CREATE TABLE permissions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0
        CHECK (is_system IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    UNIQUE (store_id, name),
    UNIQUE (id, store_id)
);

CREATE TABLE role_permissions (
    role_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,

    PRIMARY KEY (role_id, permission_id),

    FOREIGN KEY (role_id)
        REFERENCES roles(id) ON DELETE CASCADE,

    FOREIGN KEY (permission_id)
        REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE member_roles (
    store_member_id TEXT NOT NULL,
    role_id TEXT NOT NULL,

    PRIMARY KEY (store_member_id, role_id),

    FOREIGN KEY (store_member_id)
        REFERENCES store_members(id) ON DELETE CASCADE,

    FOREIGN KEY (role_id)
        REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE platform_admins (
    user_id TEXT PRIMARY KEY,
    admin_level TEXT NOT NULL DEFAULT 'admin'
        CHECK (admin_level IN ('super_admin', 'admin', 'support')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE RESTRICT
);

-- Indexes

CREATE INDEX idx_accounts_owner
    ON accounts(owner_user_id);

CREATE INDEX idx_account_users_user
    ON account_users(user_id);

CREATE INDEX idx_stores_account
    ON stores(account_id);

CREATE INDEX idx_store_members_user
    ON store_members(user_id);

CREATE INDEX idx_roles_store
    ON roles(store_id);

CREATE INDEX idx_member_roles_role
    ON member_roles(role_id);
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
-- MMG OQVELA
-- Migration 0003: Catalog and Inventory

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (parent_id)
        REFERENCES categories(id) ON DELETE SET NULL,

    UNIQUE (store_id, slug),
    UNIQUE (id, store_id)
);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    category_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    product_type TEXT NOT NULL DEFAULT 'physical'
        CHECK (product_type IN (
            'physical', 'digital', 'service'
        )),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'active', 'archived'
        )),
    base_price REAL NOT NULL DEFAULT 0
        CHECK (base_price >= 0),
    compare_at_price REAL
        CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    sku TEXT,
    track_inventory INTEGER NOT NULL DEFAULT 1
        CHECK (track_inventory IN (0, 1)),
    stock_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (stock_quantity >= 0),
    is_featured INTEGER NOT NULL DEFAULT 0
        CHECK (is_featured IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (category_id)
        REFERENCES categories(id) ON DELETE SET NULL,

    UNIQUE (store_id, slug),
    UNIQUE (store_id, sku),
    UNIQUE (id, store_id)
);

CREATE TABLE product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    price REAL NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (stock_quantity >= 0),
    attributes_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE,

    UNIQUE (store_id, sku),
    UNIQUE (id, store_id)
);

CREATE TABLE product_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    alt_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE
);

CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN (
            'initial',
            'purchase',
            'sale',
            'return',
            'adjustment',
            'damage'
        )),
    quantity_change INTEGER NOT NULL
        CHECK (quantity_change != 0),
    reference_id TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE,

    FOREIGN KEY (variant_id, store_id)
        REFERENCES product_variants(id, store_id) ON DELETE RESTRICT,

    FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_categories_store
    ON categories(store_id);

CREATE INDEX idx_products_store_status
    ON products(store_id, status);

CREATE INDEX idx_products_category
    ON products(store_id, category_id);

CREATE INDEX idx_variants_product
    ON product_variants(store_id, product_id);

CREATE INDEX idx_product_images_product
    ON product_images(store_id, product_id);

CREATE INDEX idx_inventory_product
    ON inventory_movements(store_id, product_id, created_at);
-- MMG OQVELA
-- Migration 0004: Tenant Isolation Integrity

-- Prevent categories from using a parent in another store.
CREATE TRIGGER trg_category_parent_insert
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.parent_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store category parent is forbidden');
END;

CREATE TRIGGER trg_category_parent_update
BEFORE UPDATE OF parent_id, store_id ON categories
WHEN NEW.parent_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.parent_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store category parent is forbidden');
END;

-- Prevent products from using another store's category.
CREATE TRIGGER trg_product_category_insert
BEFORE INSERT ON products
WHEN NEW.category_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store product category is forbidden');
END;

CREATE TRIGGER trg_product_category_update
BEFORE UPDATE OF category_id, store_id ON products
WHEN NEW.category_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store product category is forbidden');
END;

-- A stock movement variant must belong to the same product.
CREATE TRIGGER trg_inventory_variant_insert
BEFORE INSERT ON inventory_movements
WHEN NEW.variant_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id
    AND store_id = NEW.store_id
    AND product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Inventory variant does not belong to product');
END;

CREATE TRIGGER trg_inventory_variant_update
BEFORE UPDATE OF variant_id, product_id, store_id
ON inventory_movements
WHEN NEW.variant_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id
    AND store_id = NEW.store_id
    AND product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Inventory variant does not belong to product');
END;

-- Prevent assigning a role from another store to a member.
CREATE TRIGGER trg_member_role_insert
BEFORE INSERT ON member_roles
WHEN NOT EXISTS (
    SELECT 1
    FROM store_members sm
    JOIN roles r ON r.id = NEW.role_id
    WHERE sm.id = NEW.store_member_id
    AND sm.store_id = r.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store role assignment is forbidden');
END;

CREATE TRIGGER trg_member_role_update
BEFORE UPDATE OF store_member_id, role_id ON member_roles
WHEN NOT EXISTS (
    SELECT 1
    FROM store_members sm
    JOIN roles r ON r.id = NEW.role_id
    WHERE sm.id = NEW.store_member_id
    AND sm.store_id = r.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store role assignment is forbidden');
END;
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
-- MMG OQVELA Platform
-- Migration 0006: Tenant Mutation Integrity Guards

-- Prevent moving a category when it would invalidate
-- existing child categories or product references.
CREATE TRIGGER trg_category_store_update_guard
BEFORE UPDATE OF store_id ON categories
WHEN NEW.store_id != OLD.store_id
AND (
    EXISTS (
        SELECT 1
        FROM categories child
        WHERE child.parent_id = OLD.id
        AND child.store_id != NEW.store_id
    )
    OR
    EXISTS (
        SELECT 1
        FROM products p
        WHERE p.category_id = OLD.id
        AND p.store_id != NEW.store_id
    )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move category while dependent records belong to another store'
    );
END;

-- Prevent moving a role when assigned members belong
-- to a different store.
CREATE TRIGGER trg_role_store_update_guard
BEFORE UPDATE OF store_id ON roles
WHEN NEW.store_id != OLD.store_id
AND EXISTS (
    SELECT 1
    FROM member_roles mr
    JOIN store_members sm
        ON sm.id = mr.store_member_id
    WHERE mr.role_id = OLD.id
    AND sm.store_id != NEW.store_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move role while assigned members belong to another store'
    );
END;

-- Prevent moving a store member when assigned roles
-- belong to a different store.
CREATE TRIGGER trg_store_member_update_guard
BEFORE UPDATE OF store_id ON store_members
WHEN NEW.store_id != OLD.store_id
AND EXISTS (
    SELECT 1
    FROM member_roles mr
    JOIN roles r
        ON r.id = mr.role_id
    WHERE mr.store_member_id = OLD.id
    AND r.store_id != NEW.store_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move member while assigned roles belong to another store'
    );
END;
-- MMG OQVELA Platform
-- Migration 0007: Payment Integrity and Financial Protection

CREATE UNIQUE INDEX idx_payments_unique_reference
ON payments (
    payment_method,
    LOWER(TRIM(transaction_reference))
)
WHERE transaction_reference IS NOT NULL
  AND TRIM(transaction_reference) != '';

CREATE INDEX idx_payments_created
ON payments(created_at);

CREATE TRIGGER trg_payment_status_transition
BEFORE UPDATE OF status ON payments
WHEN NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'refunded')
)
BEGIN
    SELECT RAISE(ABORT, 'Invalid payment status transition');
END;

CREATE TRIGGER trg_payment_financial_fields_guard
BEFORE UPDATE OF
    subscription_id,
    amount,
    currency,
    payment_method,
    transaction_reference
ON payments
WHEN (
    OLD.status != 'pending'
    OR NEW.status != 'pending'
)
AND (
    NEW.subscription_id IS NOT OLD.subscription_id
    OR NEW.amount IS NOT OLD.amount
    OR NEW.currency IS NOT OLD.currency
    OR NEW.payment_method IS NOT OLD.payment_method
    OR NEW.transaction_reference IS NOT OLD.transaction_reference
)
BEGIN
    SELECT RAISE(ABORT, 'Payment financial details are immutable');
END;

CREATE TRIGGER trg_payment_delete_guard
BEFORE DELETE ON payments
WHEN OLD.status IN ('approved', 'refunded')
BEGIN
    SELECT RAISE(ABORT, 'Approved financial records cannot be deleted');
END;

CREATE UNIQUE INDEX idx_one_active_subscription_per_store
ON store_subscriptions(store_id)
WHERE status = 'active';
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


-- MMG OQVELA
-- Migration 0011: Paid subscription request integrity

ALTER TABLE payments
ADD COLUMN rejection_reason TEXT;

-- A store may have only one pending subscription request.
CREATE UNIQUE INDEX idx_one_pending_subscription_per_store
ON store_subscriptions(store_id)
WHERE status = 'pending';

-- Fast lookup for subscription requests.
CREATE INDEX idx_subscriptions_store_created
ON store_subscriptions(store_id, created_at DESC);

CREATE INDEX idx_payments_reference_lookup
ON payments(transaction_reference);
-- MMG OQVELA
-- Migration 0012: Atomic paid subscription approval

-- A payment may have only one invoice.
CREATE UNIQUE INDEX idx_one_invoice_per_payment
ON invoices(payment_id)
WHERE payment_id IS NOT NULL;

-- Approval must have all required records before payment status changes.
CREATE TRIGGER trg_paid_approval_guard
BEFORE UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'approved'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM store_subscriptions ss
        JOIN invoices i
          ON i.subscription_id = ss.id
         AND i.payment_id = NEW.id
        WHERE ss.id = NEW.subscription_id
          AND ss.status = 'pending'
          AND i.status = 'issued'
          AND i.subtotal = NEW.amount
          AND i.total = NEW.amount
          AND i.currency = NEW.currency
    ) THEN RAISE(ABORT, 'Required invoice is missing or invalid') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM subscription_history
        WHERE subscription_id = NEW.subscription_id
          AND action IN ('activated', 'renewed')
    ) THEN RAISE(ABORT, 'Approval history is missing') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM admin_activity_logs
        WHERE target_type = 'subscription_payment'
          AND target_id = NEW.id
          AND action = 'approve'
          AND admin_user_id IS NOT NULL
    ) THEN RAISE(ABORT, 'Approval audit log is missing') END;

    SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM store_subscriptions current
        JOIN store_subscriptions target
          ON target.id = NEW.subscription_id
        WHERE current.store_id = target.store_id
          AND current.status = 'active'
          AND current.id != target.id
    ) THEN RAISE(ABORT, 'Another active subscription exists') END;
END;

-- Complete invoice payment and subscription activation after approval.
CREATE TRIGGER trg_paid_approval_complete
AFTER UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'approved'
BEGIN
    UPDATE invoices
    SET status = 'paid'
    WHERE payment_id = NEW.id
      AND status = 'issued';

    UPDATE store_subscriptions
    SET status = 'active',
        starts_at = CURRENT_TIMESTAMP,
        expires_at = datetime(
            'now',
            '+' || (
                SELECT duration_days
                FROM subscription_plans
                WHERE id = store_subscriptions.plan_id
            ) || ' days'
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.subscription_id
      AND status = 'pending';
END;

-- Prevent direct activation without a complete approved payment.
CREATE TRIGGER trg_subscription_activation_guard
BEFORE UPDATE OF status ON store_subscriptions
WHEN NEW.status = 'active'
 AND OLD.status != 'active'
 AND COALESCE(NEW.is_trial, 0) = 0
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM payments p
        JOIN invoices i ON i.payment_id = p.id
        WHERE p.subscription_id = NEW.id
          AND p.status = 'approved'
          AND i.status = 'paid'
    ) THEN RAISE(ABORT, 'Activation requires approved payment and paid invoice') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM subscription_history
        WHERE subscription_id = NEW.id
          AND action IN ('activated', 'renewed')
    ) THEN RAISE(ABORT, 'Activation history is missing') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM admin_activity_logs al
        JOIN payments p ON p.id = al.target_id
        WHERE p.subscription_id = NEW.id
          AND p.status = 'approved'
          AND al.target_type = 'subscription_payment'
          AND al.action = 'approve'
          AND al.admin_user_id IS NOT NULL
    ) THEN RAISE(ABORT, 'Activation audit is missing') END;
END;


-- Rejection must be recorded before changing payment status.
CREATE TRIGGER trg_paid_rejection_guard
BEFORE UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'rejected'
BEGIN
    SELECT CASE WHEN NEW.rejection_reason IS NULL
        OR length(trim(NEW.rejection_reason)) = 0
        THEN RAISE(ABORT, 'Rejection reason is required') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM store_subscriptions
        WHERE id = NEW.subscription_id AND status = 'pending'
    ) THEN RAISE(ABORT, 'Pending subscription is required') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM subscription_history
        WHERE subscription_id = NEW.subscription_id
          AND action = 'cancelled'
    ) THEN RAISE(ABORT, 'Rejection history is missing') END;

    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM admin_activity_logs
        WHERE target_type = 'subscription_payment'
          AND target_id = NEW.id
          AND action = 'reject'
          AND admin_user_id IS NOT NULL
    ) THEN RAISE(ABORT, 'Rejection audit log is missing') END;
END;

CREATE TRIGGER trg_paid_rejection_complete
AFTER UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'rejected'
BEGIN
    UPDATE store_subscriptions
    SET status = 'cancelled',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.subscription_id
      AND status = 'pending';
END;


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

-- MMG OQVELA
-- Migration 0024: Public contact and service request inbox

CREATE TABLE platform_service_requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('support','advertising','store_setup','website_design','contact')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','accepted','rejected','completed')),
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_platform_service_requests_status_created ON platform_service_requests(status, created_at DESC);
CREATE INDEX idx_platform_service_requests_type_created ON platform_service_requests(request_type, created_at DESC);
