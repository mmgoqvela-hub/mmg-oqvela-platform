from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"

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

    seed_identity(connection)

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

    print(f"PASS: {len(files)} migrations applied; foreign keys, approval, and rejection flows valid.")
    connection.close()

if __name__ == "__main__":
    main()
