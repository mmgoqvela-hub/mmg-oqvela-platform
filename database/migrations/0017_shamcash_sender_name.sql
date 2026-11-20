-- MMG OQVELA Platform
-- Migration 0017: Sham Cash sender identity for subscription payment review

ALTER TABLE payments
ADD COLUMN sender_name TEXT;

DROP TRIGGER IF EXISTS trg_payment_financial_fields_guard;

CREATE TRIGGER trg_payment_financial_fields_guard
BEFORE UPDATE OF
    subscription_id,
    amount,
    currency,
    payment_method,
    transaction_reference,
    sender_name
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
    OR NEW.sender_name IS NOT OLD.sender_name
)
BEGIN
    SELECT RAISE(ABORT, 'Payment financial details are immutable');
END;
