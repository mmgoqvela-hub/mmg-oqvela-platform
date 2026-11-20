from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"

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

    print(f"PASS: {len(files)} migrations applied; schema and foreign keys valid.")
    connection.close()

if __name__ == "__main__":
    main()
