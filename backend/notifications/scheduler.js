export async function scheduleSubscriptionNotifications(env) {
  const statements = [
    env.DB.prepare(`
      INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
      )
      SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        CASE WHEN ss.is_trial = 1 THEN 'trial_expiry_3d' ELSE 'subscription_expiry_3d' END,
        'Subscription expires in 3 days',
        CASE WHEN ss.is_trial = 1
          THEN 'Your free trial for ' || s.name || ' expires in 3 days. Choose a paid plan and submit your Sham Cash payment to avoid interruption.'
          ELSE 'Your subscription for ' || s.name || ' expires in 3 days. Submit a renewal request to avoid interruption.'
        END,
        'subscription',
        ss.id,
        'subscription-expiry-3d:' || ss.id
      FROM store_subscriptions ss
      JOIN stores s ON s.id = ss.store_id
      JOIN accounts a ON a.id = s.account_id
      WHERE ss.status = 'active'
        AND ss.expires_at IS NOT NULL
        AND date(ss.expires_at) = date('now', '+3 days')
    `),
    env.DB.prepare(`
      INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
      )
      SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        CASE WHEN ss.is_trial = 1 THEN 'trial_expiry_1d' ELSE 'subscription_expiry_1d' END,
        'Subscription expires tomorrow',
        CASE WHEN ss.is_trial = 1
          THEN 'Your free trial for ' || s.name || ' expires tomorrow. Choose a paid plan and submit your Sham Cash payment.'
          ELSE 'Your subscription for ' || s.name || ' expires tomorrow. Submit a renewal request.'
        END,
        'subscription',
        ss.id,
        'subscription-expiry-1d:' || ss.id
      FROM store_subscriptions ss
      JOIN stores s ON s.id = ss.store_id
      JOIN accounts a ON a.id = s.account_id
      WHERE ss.status = 'active'
        AND ss.expires_at IS NOT NULL
        AND date(ss.expires_at) = date('now', '+1 day')
    `),
    env.DB.prepare(`
      INSERT OR IGNORE INTO user_notifications (
        id, user_id, notification_type, title, message,
        entity_type, entity_id, dedupe_key
      )
      SELECT
        lower(hex(randomblob(16))),
        a.owner_user_id,
        CASE WHEN ss.is_trial = 1 THEN 'trial_expired' ELSE 'subscription_expired' END,
        'Subscription has expired',
        CASE WHEN ss.is_trial = 1
          THEN 'Your free trial for ' || s.name || ' has expired. Your public store is hidden. Choose a paid plan and submit your Sham Cash payment; it will return after approval.'
          ELSE 'Your subscription for ' || s.name || ' has expired. Your public store is hidden. Submit a Sham Cash renewal request; it will return after approval.'
        END,
        'subscription',
        ss.id,
        'subscription-expired:' || ss.id
      FROM store_subscriptions ss
      JOIN stores s ON s.id = ss.store_id
      JOIN accounts a ON a.id = s.account_id
      WHERE ss.status = 'active'
        AND ss.expires_at IS NOT NULL
        AND ss.expires_at <= CURRENT_TIMESTAMP
    `)
  ];

  const results = await env.DB.batch(statements);
  return results.reduce((total, result) => total + (result.meta?.changes || 0), 0);
}
