-- MMG OQVELA
-- Migration 0043: Guest customer identity, decision-only orders and post-delivery collection.

CREATE TABLE store_customer_identities (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_phone_key TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CHECK (length(customer_phone_key) BETWEEN 6 AND 30),
  CHECK (length(customer_name) BETWEEN 2 AND 120),
  CHECK (length(access_token_hash) = 64)
);

CREATE INDEX idx_store_customer_identities_phone
  ON store_customer_identities(store_id, customer_phone_key, created_at DESC);

CREATE TABLE store_order_decision_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_user_id TEXT,
  from_decision TEXT,
  to_decision TEXT NOT NULL CHECK (to_decision IN ('accepted','rejected')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id, store_id) REFERENCES store_orders(id, store_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 1000)
);

CREATE INDEX idx_store_order_decision_events
  ON store_order_decision_events(store_id, order_id, created_at);

CREATE TABLE store_customer_notifications (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_identity_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('order_accepted','order_rejected')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_identity_id) REFERENCES store_customer_identities(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id, store_id) REFERENCES store_orders(id, store_id) ON DELETE CASCADE,
  CHECK (length(title) BETWEEN 1 AND 160),
  CHECK (length(message) BETWEEN 1 AND 1000)
);

CREATE INDEX idx_store_customer_notifications_inbox
  ON store_customer_notifications(customer_identity_id, created_at DESC);

ALTER TABLE store_orders ADD COLUMN customer_identity_id TEXT
  REFERENCES store_customer_identities(id) ON DELETE SET NULL;
ALTER TABLE store_orders ADD COLUMN customer_decision TEXT NOT NULL DEFAULT 'pending'
  CHECK (customer_decision IN ('pending','accepted','rejected'));
ALTER TABLE store_orders ADD COLUMN rejection_reason TEXT;
ALTER TABLE store_orders ADD COLUMN accepted_at TEXT;
ALTER TABLE store_orders ADD COLUMN rejected_at TEXT;
ALTER TABLE store_orders ADD COLUMN delivered_at TEXT;
ALTER TABLE store_orders ADD COLUMN payment_collected_at TEXT;
ALTER TABLE store_orders ADD COLUMN payment_collected_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE store_orders ADD COLUMN customer_payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery'
  CHECK (customer_payment_method IN ('cash_on_delivery','shamcash'));
ALTER TABLE store_orders ADD COLUMN payment_reference TEXT;
ALTER TABLE store_orders ADD COLUMN payment_sender_name TEXT;
ALTER TABLE store_orders ADD COLUMN store_phone_snapshot TEXT;

CREATE INDEX idx_store_orders_customer_identity
  ON store_orders(store_id, customer_identity_id, created_at DESC);

-- Stock is no longer reserved when a customer merely submits an order.
-- It is reserved only after the store accepts it.
DROP TRIGGER IF EXISTS trg_order_item_reserve_variant_stock;
DROP TRIGGER IF EXISTS trg_order_item_reserve_product_stock;

CREATE TRIGGER trg_order_decision_reserve_stock
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision != 'accepted' AND NEW.customer_decision = 'accepted'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM store_order_items oi
    JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
    LEFT JOIN product_variants v ON v.id=oi.variant_id AND v.store_id=oi.store_id
    WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
      AND p.track_inventory=1
      AND COALESCE(v.stock_quantity,p.stock_quantity) < oi.quantity
  ) THEN RAISE(ABORT, 'Insufficient stock for accepted order') END;

  UPDATE product_variants
  SET stock_quantity = stock_quantity - (
    SELECT oi.quantity FROM store_order_items oi
    WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
      AND oi.variant_id=product_variants.id
  )
  WHERE store_id=NEW.store_id
    AND id IN (SELECT variant_id FROM store_order_items
      WHERE order_id=NEW.id AND store_id=NEW.store_id AND variant_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM products p
      WHERE p.id=product_variants.product_id AND p.store_id=NEW.store_id AND p.track_inventory=1);

  UPDATE products
  SET stock_quantity = stock_quantity - (
    SELECT oi.quantity FROM store_order_items oi
    WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
      AND oi.product_id=products.id AND oi.variant_id IS NULL
  )
  WHERE store_id=NEW.store_id
    AND id IN (SELECT product_id FROM store_order_items
      WHERE order_id=NEW.id AND store_id=NEW.store_id AND variant_id IS NULL)
    AND track_inventory=1;

  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes)
  SELECT lower(hex(randomblob(16))),NEW.store_id,oi.product_id,oi.variant_id,
    'sale',-oi.quantity,NEW.id,'Accepted customer order stock reservation'
  FROM store_order_items oi
  JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
  WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id AND p.track_inventory=1;
END;

CREATE TRIGGER trg_order_decision_restore_stock
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision='accepted' AND NEW.customer_decision='rejected'
BEGIN
  UPDATE product_variants
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(-SUM(im.quantity_change),0)
    FROM inventory_movements im
    WHERE im.store_id=NEW.store_id AND im.reference_id=NEW.id
      AND im.movement_type IN ('sale','return') AND im.product_id=product_variants.product_id
      AND im.variant_id=product_variants.id
  )
  WHERE store_id=NEW.store_id AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.store_id=NEW.store_id AND im.reference_id=NEW.id
      AND im.movement_type IN ('sale','return') AND im.product_id=product_variants.product_id
      AND im.variant_id=product_variants.id
  );

  UPDATE products
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(-SUM(im.quantity_change),0)
    FROM inventory_movements im
    WHERE im.store_id=NEW.store_id AND im.reference_id=NEW.id
      AND im.movement_type IN ('sale','return') AND im.product_id=products.id AND im.variant_id IS NULL
  )
  WHERE store_id=NEW.store_id AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.store_id=NEW.store_id AND im.reference_id=NEW.id
      AND im.movement_type IN ('sale','return') AND im.product_id=products.id AND im.variant_id IS NULL
  );

  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes)
  SELECT lower(hex(randomblob(16))),NEW.store_id,im.product_id,im.variant_id,
    'return',-SUM(im.quantity_change),NEW.id,'Rejected accepted customer order stock restoration'
  FROM inventory_movements im
  WHERE im.store_id=NEW.store_id AND im.reference_id=NEW.id
    AND im.movement_type IN ('sale','return')
  GROUP BY im.product_id,im.variant_id
  HAVING SUM(im.quantity_change)<0;
END;

-- Preserve the full decision history; never overwrite earlier decisions.
CREATE TRIGGER trg_store_order_decision_event
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision != NEW.customer_decision
 AND NEW.customer_decision IN ('accepted','rejected')
BEGIN
  INSERT INTO store_order_decision_events
    (id,order_id,store_id,actor_user_id,from_decision,to_decision,rejection_reason)
  VALUES (lower(hex(randomblob(16))),NEW.id,NEW.store_id,NEW.updated_by,
    OLD.customer_decision,NEW.customer_decision,NEW.rejection_reason);
END;

-- Notify the guest identity only about the final customer-facing decision.
CREATE TRIGGER trg_notify_customer_order_decision
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision != NEW.customer_decision
 AND NEW.customer_decision IN ('accepted','rejected')
 AND NEW.customer_identity_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO store_customer_notifications
    (id,store_id,customer_identity_id,order_id,notification_type,title,message,dedupe_key)
  VALUES (
    lower(hex(randomblob(16))),NEW.store_id,NEW.customer_identity_id,NEW.id,
    CASE WHEN NEW.customer_decision='accepted' THEN 'order_accepted' ELSE 'order_rejected' END,
    CASE WHEN NEW.customer_decision='accepted' THEN 'تم قبول طلبك' ELSE 'نعتذر، تم رفض طلبك' END,
    CASE WHEN NEW.customer_decision='accepted' THEN
      'تم قبول طلبك رقم ' || NEW.order_number
    ELSE
      'تم رفض طلبك رقم ' || NEW.order_number || '. السبب: ' || COALESCE(NEW.rejection_reason,'لم يحدد المتجر سبباً')
    END,
    'customer-order-decision:' || NEW.id || ':' || lower(hex(randomblob(8)))
  );
END;

-- Decision is separate from fulfillment. A confirmed order may be closed directly
-- after handover and immediate collection.
DROP TRIGGER IF EXISTS trg_store_order_status_transition_guard;
CREATE TRIGGER trg_store_order_status_transition_guard
BEFORE UPDATE OF order_status ON store_orders
WHEN OLD.order_status != NEW.order_status
 AND NOT (
   (OLD.order_status='pending' AND NEW.order_status IN ('confirmed','completed'))
   OR (OLD.order_status='confirmed' AND NEW.order_status='completed')
   OR (OLD.order_status='processing' AND NEW.order_status='completed')
   OR (OLD.order_status='shipped' AND NEW.order_status='completed')
 )
BEGIN
  SELECT RAISE(ABORT, 'Invalid order status transition');
END;

DROP TRIGGER IF EXISTS trg_store_order_payment_consistency_guard;
CREATE TRIGGER trg_store_order_payment_consistency_guard
BEFORE UPDATE OF order_status, payment_status ON store_orders
WHEN
  (NEW.order_status='completed' AND (NEW.payment_status!='paid' OR NEW.payment_collected_at IS NULL))
  OR (NEW.payment_status='refunded' AND NEW.order_status!='cancelled')
BEGIN
  SELECT RAISE(ABORT, 'Order must be delivered and paid before completion');
END;
