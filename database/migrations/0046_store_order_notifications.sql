-- MMG OQVELA
-- Migration 0046: Correct store-owner order notifications for post-handover payment.

-- Migration 0043 introduced customer_payment_method because the payment is collected
-- only when the accepted order is handed over. The legacy notification trigger
-- inspected payment_method (kept as cash_on_delivery for lifecycle compatibility),
-- which could incorrectly label every Sham Cash order as cash on delivery.
DROP TRIGGER IF EXISTS trg_notify_store_order_created;

CREATE TRIGGER trg_notify_store_order_created
AFTER INSERT ON store_orders
BEGIN
  INSERT OR IGNORE INTO user_notifications
    (id,user_id,notification_type,title,message,entity_type,entity_id,dedupe_key)
  SELECT
    lower(hex(randomblob(16))),
    a.owner_user_id,
    'store_order',
    'طلب جديد في متجرك',
    CASE WHEN NEW.customer_payment_method = 'shamcash'
      THEN 'تم استلام طلب جديد. طريقة الدفع المختارة شام كاش، ويتم تحصيل المبلغ بعد تسليم الطلب.'
      ELSE 'تم استلام طلب جديد. طريقة الدفع المختارة نقداً عند الاستلام، ويتم تحصيل المبلغ عند التسليم.'
    END,
    'store_order',
    NEW.id,
    'store-order-created:' || NEW.id
  FROM stores s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.id = NEW.store_id
    AND a.owner_user_id IS NOT NULL;
END;
