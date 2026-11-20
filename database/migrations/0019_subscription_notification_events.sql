-- MMG OQVELA Platform
-- Migration 0019: Transactional subscription lifecycle notifications

-- Notify the account owner when a Sham Cash subscription request is submitted.
CREATE TRIGGER trg_notify_subscription_request
AFTER INSERT ON payments
WHEN NEW.status = 'pending'
BEGIN
    INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
    )
    SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        'subscription_payment_submitted',
        'Subscription payment request submitted',
        'Your subscription request for ' || s.name || ' has been submitted and is awaiting review.',
        'subscription',
        ss.id,
        'subscription-payment-submitted:' || NEW.id
    FROM store_subscriptions ss
    JOIN stores s ON s.id = ss.store_id
    JOIN accounts a ON a.id = s.account_id
    WHERE ss.id = NEW.subscription_id;
END;

-- Notify the owner only after the atomic approval trigger has activated the subscription.
CREATE TRIGGER trg_notify_subscription_approved
AFTER UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'approved'
BEGIN
    INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
    )
    SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        'subscription_payment_approved',
        'Subscription payment approved',
        'Your payment for ' || s.name || ' was approved. The subscription is now active.',
        'subscription',
        ss.id,
        'subscription-payment-approved:' || NEW.id
    FROM store_subscriptions ss
    JOIN stores s ON s.id = ss.store_id
    JOIN accounts a ON a.id = s.account_id
    WHERE ss.id = NEW.subscription_id;
END;

-- Rejection notifications include the reason already recorded by the review flow.
CREATE TRIGGER trg_notify_subscription_rejected
AFTER UPDATE OF status ON payments
WHEN OLD.status = 'pending' AND NEW.status = 'rejected'
BEGIN
    INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
    )
    SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        'subscription_payment_rejected',
        'Subscription payment request rejected',
        'Your payment request for ' || s.name || ' was rejected. Reason: ' || COALESCE(NEW.rejection_reason, 'Please contact platform support.'),
        'subscription',
        ss.id,
        'subscription-payment-rejected:' || NEW.id
    FROM store_subscriptions ss
    JOIN stores s ON s.id = ss.store_id
    JOIN accounts a ON a.id = s.account_id
    WHERE ss.id = NEW.subscription_id;
END;

-- Notify the account owner when the one-time trial is created.
CREATE TRIGGER trg_notify_trial_started
AFTER INSERT ON store_subscriptions
WHEN NEW.is_trial = 1
BEGIN
    INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
    )
    SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        'trial_started',
        'Free trial started',
        'Your free trial for ' || s.name || ' has started. You can manage your store during the trial period.',
        'subscription',
        NEW.id,
        'trial-started:' || NEW.id
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.id = NEW.store_id;
END;
