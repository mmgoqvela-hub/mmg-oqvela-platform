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
