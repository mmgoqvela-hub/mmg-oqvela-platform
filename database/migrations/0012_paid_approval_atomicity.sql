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
