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
