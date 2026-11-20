from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"

def expect_integrity_error(action, description):
    try:
        action()
    except sqlite3.IntegrityError:
        return
    raise SystemExit(f"Tenant isolation guard failed: {description}")


def seed_identity(connection):
    connection.execute(
        "INSERT INTO users (id, full_name, email, password_hash) VALUES (?, ?, ?, ?)",
        ("user-1", "Test Admin", "admin@example.test", "test-hash")
    )
    connection.execute(
        "INSERT INTO accounts (id, name, owner_user_id) VALUES (?, ?, ?)",
        ("account-1", "Test Account", "user-1")
    )
    connection.execute(
        "INSERT INTO account_users (account_id, user_id, role) VALUES (?, ?, 'owner')",
        ("account-1", "user-1")
    )
    connection.execute(
        "INSERT INTO subscription_plans (id, name, price, currency, duration_days) VALUES (?, ?, ?, ?, ?)",
        ("plan-paid", "Test Plan", 10, "USD", 30)
    )

def create_pending_payment(connection, suffix):
    store_id = "store-" + suffix
    subscription_id = "subscription-" + suffix
    payment_id = "payment-" + suffix
    connection.execute(
        "INSERT INTO stores (id, account_id, name, slug) VALUES (?, ?, ?, ?)",
        (store_id, "account-1", "Store " + suffix, "store-" + suffix)
    )
    connection.execute(
        "INSERT INTO store_subscriptions (id, store_id, plan_id, status, is_trial) VALUES (?, ?, ?, 'pending', 0)",
        (subscription_id, store_id, "plan-paid")
    )
    connection.execute(
        "INSERT INTO payments (id, subscription_id, amount, currency, payment_method, transaction_reference, status) VALUES (?, ?, 10, 'USD', 'shamcash', ?, 'pending')",
        (payment_id, subscription_id, "REF-" + suffix)
    )
    return store_id, subscription_id, payment_id

def main():
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")

    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise SystemExit("No SQL migrations found")

    for migration in files:
        print(f"APPLY {migration.name}")
        connection.executescript(migration.read_text(encoding="utf-8"))

    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise SystemExit(f"Foreign key violations: {violations}")

    expected_tables = {
        "users", "accounts", "account_users", "stores",
        "store_subscriptions", "subscription_plans", "payments",
        "invoices", "subscription_history", "platform_settings",
        "platform_trial_settings", "admin_activity_logs"
    }
    actual_tables = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    missing = sorted(expected_tables - actual_tables)
    if missing:
        raise SystemExit(f"Missing expected tables: {missing}")

    payment_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(payments)")
    }
    required_payment_columns = {
        "payment_details_snapshot", "rejection_reason"
    }
    if not required_payment_columns.issubset(payment_columns):
        raise SystemExit("Required payment integrity columns are missing")

    user_language_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(users)")
    }
    if "preferred_language" not in user_language_columns:
        raise SystemExit("User language preference column is missing")

    store_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(stores)")
    }
    if not {"template_key", "whatsapp_phone"}.issubset(store_columns):
        raise SystemExit("Store template or WhatsApp contact column is missing")

    seed_identity(connection)
    default_language = connection.execute(
        "SELECT preferred_language FROM users WHERE id = 'user-1'"
    ).fetchone()
    if default_language != ("ar",):
        raise SystemExit(f"New users must default to Arabic: {default_language}")

    connection.execute(
        "UPDATE users SET preferred_language = 'en' WHERE id = 'user-1'"
    )
    if connection.execute(
        "SELECT preferred_language FROM users WHERE id = 'user-1'"
    ).fetchone() != ("en",):
        raise SystemExit("English language preference was not saved")

    try:
        connection.execute(
            "UPDATE users SET preferred_language = 'fr' WHERE id = 'user-1'"
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise SystemExit("Unsupported language preference was accepted")

    connection.execute(
        "INSERT INTO stores (id, account_id, name, slug) VALUES ('template-default-store', 'account-1', 'Default Template', 'template-default')"
    )
    template_default = connection.execute(
        "SELECT template_key FROM stores WHERE id='template-default-store'"
    ).fetchone()
    if template_default != ("modern",):
        raise SystemExit(f"New stores must use the modern template by default: {template_default}")
    connection.execute(
        "UPDATE stores SET template_key='boutique' WHERE id='template-default-store'"
    )
    if connection.execute(
        "SELECT template_key FROM stores WHERE id='template-default-store'"
    ).fetchone() != ("boutique",):
        raise SystemExit("Store template selection was not persisted")
    try:
        connection.execute(
            "UPDATE stores SET template_key='unknown' WHERE id='template-default-store'"
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise SystemExit("Unsupported storefront template was accepted")

    required_permissions = {
        "catalog.read", "catalog.manage", "inventory.read",
        "inventory.manage", "team.manage"
    }
    seeded_permissions = {
        row[0] for row in connection.execute(
            "SELECT code FROM permissions WHERE code IN ('catalog.read','catalog.manage','inventory.read','inventory.manage','team.manage')"
        )
    }
    if seeded_permissions != required_permissions:
        raise SystemExit(f"Store team permission catalogue is incomplete: {seeded_permissions}")

    connection.execute(
        "UPDATE stores SET whatsapp_phone='963944123456' WHERE id='template-default-store'"
    )
    if connection.execute(
        "SELECT whatsapp_phone FROM stores WHERE id='template-default-store'"
    ).fetchone() != ("963944123456",):
        raise SystemExit("Store WhatsApp contact was not persisted")

    # Verify database-level tenant boundaries for catalog, inventory and staff roles.
    connection.executemany(
        "INSERT INTO stores (id, account_id, name, slug) VALUES (?, 'account-1', ?, ?)",
        [
            ("tenant-store-a", "Tenant A", "tenant-a"),
            ("tenant-store-b", "Tenant B", "tenant-b")
        ]
    )
    connection.executemany(
        "INSERT INTO categories (id, store_id, name, slug) VALUES (?, ?, ?, ?)",
        [
            ("tenant-category-a", "tenant-store-a", "Category A", "category-a"),
            ("tenant-category-b", "tenant-store-b", "Category B", "category-b")
        ]
    )
    expect_integrity_error(
        lambda: connection.execute(
            "INSERT INTO categories (id, store_id, parent_id, name, slug) VALUES (?, ?, ?, ?, ?)",
            ("tenant-category-cross", "tenant-store-a", "tenant-category-b", "Cross", "cross")
        ),
        "a category cannot use a parent category from another store"
    )

    connection.executemany(
        "INSERT INTO products (id, store_id, name, slug, base_price) VALUES (?, ?, ?, ?, 1)",
        [
            ("tenant-product-a", "tenant-store-a", "Product A", "product-a"),
            ("tenant-product-b", "tenant-store-b", "Product B", "product-b")
        ]
    )
    expect_integrity_error(
        lambda: connection.execute(
            "INSERT INTO products (id, store_id, category_id, name, slug) VALUES (?, ?, ?, ?, ?)",
            ("tenant-product-cross", "tenant-store-a", "tenant-category-b", "Cross", "cross-product")
        ),
        "a product cannot reference another store's category"
    )
    connection.executemany(
        "INSERT INTO product_variants (id, product_id, store_id, name, price) VALUES (?, ?, ?, ?, 1)",
        [
            ("tenant-variant-a", "tenant-product-a", "tenant-store-a", "Variant A"),
            ("tenant-variant-b", "tenant-product-b", "tenant-store-b", "Variant B")
        ]
    )
    expect_integrity_error(
        lambda: connection.execute(
            "INSERT INTO inventory_movements (id, store_id, product_id, variant_id, movement_type, quantity_change) VALUES (?, ?, ?, ?, 'adjustment', 1)",
            ("tenant-movement-cross", "tenant-store-a", "tenant-product-a", "tenant-variant-b")
        ),
        "an inventory movement cannot use another store's product variant"
    )
    expect_integrity_error(
        lambda: connection.execute(
            "INSERT INTO product_images (id, product_id, store_id, file_key) VALUES (?, ?, ?, ?)",
            ("tenant-image-cross", "tenant-product-a", "tenant-store-b", "cross-store-image")
        ),
        "a product image cannot cross store boundaries"
    )

    connection.execute(
        "INSERT INTO roles (id, store_id, name) VALUES ('tenant-role-a', 'tenant-store-a', 'Staff A')"
    )
    connection.execute(
        "INSERT INTO roles (id, store_id, name) VALUES ('tenant-role-b', 'tenant-store-b', 'Staff B')"
    )
    connection.execute(
        "INSERT INTO store_members (id, store_id, user_id) VALUES ('tenant-member-a', 'tenant-store-a', 'user-1')"
    )
    expect_integrity_error(
        lambda: connection.execute(
            "INSERT INTO member_roles (store_member_id, role_id) VALUES (?, ?)",
            ("tenant-member-a", "tenant-role-b")
        ),
        "a store member cannot receive a role from another store"
    )

    # Verify a complete approval activates the subscription and pays its invoice.
    _, approval_subscription, approval_payment = create_pending_payment(connection, "approve")
    connection.execute(
        "INSERT INTO invoices (id, subscription_id, payment_id, invoice_number, subtotal, tax, total, currency, status) VALUES (?, ?, ?, ?, 10, 0, 10, 'USD', 'issued')",
        ("invoice-approve", approval_subscription, approval_payment, "INV-APPROVE")
    )
    connection.execute(
        "INSERT INTO subscription_history (id, subscription_id, action, performed_by) VALUES (?, ?, 'activated', ?)",
        ("history-approve", approval_subscription, "user-1")
    )
    connection.execute(
        "INSERT INTO admin_activity_logs (id, admin_user_id, action, target_type, target_id) VALUES (?, ?, 'approve', 'subscription_payment', ?)",
        ("audit-approve", "user-1", approval_payment)
    )
    connection.execute(
        "UPDATE payments SET status='approved', paid_at=CURRENT_TIMESTAMP WHERE id=?",
        (approval_payment,)
    )
    approval_state = connection.execute(
        "SELECT ss.status, i.status FROM store_subscriptions ss JOIN invoices i ON i.subscription_id=ss.id WHERE ss.id=?",
        (approval_subscription,)
    ).fetchone()
    if approval_state != ("active", "paid"):
        raise SystemExit(f"Approval trigger flow failed: {approval_state}")

    # Verify rejection requires reason/history/audit and cancels the subscription.
    _, rejection_subscription, rejection_payment = create_pending_payment(connection, "reject")
    connection.execute(
        "INSERT INTO subscription_history (id, subscription_id, action, performed_by) VALUES (?, ?, 'cancelled', ?)",
        ("history-reject", rejection_subscription, "user-1")
    )
    connection.execute(
        "INSERT INTO admin_activity_logs (id, admin_user_id, action, target_type, target_id) VALUES (?, ?, 'reject', 'subscription_payment', ?)",
        ("audit-reject", "user-1", rejection_payment)
    )
    connection.execute(
        "UPDATE payments SET status='rejected', rejection_reason='Invalid transfer' WHERE id=?",
        (rejection_payment,)
    )
    rejection_state = connection.execute(
        "SELECT status FROM store_subscriptions WHERE id=?",
        (rejection_subscription,)
    ).fetchone()
    if rejection_state != ("cancelled",):
        raise SystemExit(f"Rejection trigger flow failed: {rejection_state}")

    print(f"PASS: {len(files)} migrations applied; foreign keys, tenant isolation, approval, and rejection flows valid.")
    connection.close()

if __name__ == "__main__":
    main()
