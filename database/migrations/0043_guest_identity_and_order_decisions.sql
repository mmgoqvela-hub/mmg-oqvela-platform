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
CREATE UNIQUE INDEX idx_store_orders_unique_payment_reference
  ON store_orders(store_id,payment_reference)
  WHERE payment_reference IS NOT NULL;

-- Preserve reservations created by the previous checkout workflow.
-- Existing open orders already reduced stock at checkout, so carry those reservations
-- forward instead of reserving them a second time when they are accepted.
CREATE TABLE store_order_stock_reservations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  FOREIGN KEY (order_id,store_id) REFERENCES store_orders(id,store_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id,store_id) REFERENCES products(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id,store_id) REFERENCES product_variants(id,store_id) ON DELETE RESTRICT
);

CREATE INDEX idx_store_order_stock_reservations_active
  ON store_order_stock_reservations(store_id,order_id,is_active);

UPDATE store_orders
SET customer_decision=CASE
      WHEN order_status IN ('confirmed','processing','shipped','completed') THEN 'accepted'
      WHEN order_status='cancelled' THEN 'rejected'
      ELSE 'pending' END,
    rejection_reason=CASE WHEN order_status='cancelled'
      THEN COALESCE(rejection_reason,'طلب سابق ملغي') ELSE rejection_reason END,
    accepted_at=CASE WHEN order_status IN ('confirmed','processing','shipped','completed')
      THEN COALESCE(accepted_at,updated_at) ELSE accepted_at END,
    rejected_at=CASE WHEN order_status='cancelled'
      THEN COALESCE(rejected_at,updated_at) ELSE rejected_at END,
    customer_payment_method=CASE WHEN payment_method='shamcash'
      THEN 'shamcash' ELSE customer_payment_method END,
    payment_reference=COALESCE(payment_reference,transaction_reference),
    payment_sender_name=COALESCE(payment_sender_name,sender_name),
    store_phone_snapshot=COALESCE(store_phone_snapshot,
      (SELECT whatsapp_phone FROM stores WHERE stores.id=store_orders.store_id));

INSERT INTO store_order_stock_reservations
  (id,store_id,order_id,product_id,variant_id,quantity,is_active,created_at)
SELECT lower(hex(randomblob(16))),o.store_id,oi.order_id,oi.product_id,oi.variant_id,
  oi.quantity,1,o.created_at
FROM store_orders o
JOIN store_order_items oi ON oi.order_id=o.id AND oi.store_id=o.store_id
JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
WHERE p.track_inventory=1
  AND o.order_status IN ('pending','confirmed','processing','shipped');

-- New orders do not reserve stock until the store accepts them.
-- A legacy open order already has an active reservation and is therefore skipped.
DROP TRIGGER IF EXISTS trg_order_item_reserve_variant_stock;
DROP TRIGGER IF EXISTS trg_order_item_reserve_product_stock;

CREATE TRIGGER trg_order_decision_reserve_stock
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision != 'accepted'
 AND NEW.customer_decision = 'accepted'
 AND NOT EXISTS (
   SELECT 1 FROM store_order_stock_reservations
   WHERE order_id=NEW.id AND store_id=NEW.store_id AND is_active=1
 )
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
    SELECT SUM(oi.quantity) FROM store_order_items oi
    WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
      AND oi.variant_id=product_variants.id
  )
  WHERE store_id=NEW.store_id
    AND id IN (SELECT oi.variant_id FROM store_order_items oi
      JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
      WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
        AND oi.variant_id IS NOT NULL AND p.track_inventory=1);

  UPDATE products
  SET stock_quantity = stock_quantity - (
    SELECT SUM(oi.quantity) FROM store_order_items oi
    WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id
      AND oi.product_id=products.id AND oi.variant_id IS NULL
  )
  WHERE store_id=NEW.store_id AND track_inventory=1
    AND id IN (SELECT product_id FROM store_order_items
      WHERE order_id=NEW.id AND store_id=NEW.store_id AND variant_id IS NULL);

  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes)
  SELECT lower(hex(randomblob(16))),NEW.store_id,oi.product_id,oi.variant_id,
    'sale',-oi.quantity,NEW.id,'Accepted customer order stock reservation'
  FROM store_order_items oi
  JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
  WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id AND p.track_inventory=1;

  INSERT INTO store_order_stock_reservations
    (id,store_id,order_id,product_id,variant_id,quantity,is_active)
  SELECT lower(hex(randomblob(16))),NEW.store_id,oi.order_id,oi.product_id,oi.variant_id,
    oi.quantity,1
  FROM store_order_items oi
  JOIN products p ON p.id=oi.product_id AND p.store_id=oi.store_id
  WHERE oi.order_id=NEW.id AND oi.store_id=NEW.store_id AND p.track_inventory=1;
END;

-- Rejecting a previously reserved order restores exactly its active reservation.
-- This also safely releases reservations made by the legacy checkout workflow.
CREATE TRIGGER trg_order_decision_restore_stock
AFTER UPDATE OF customer_decision ON store_orders
WHEN OLD.customer_decision != 'rejected'
 AND NEW.customer_decision = 'rejected'
 AND EXISTS (
   SELECT 1 FROM store_order_stock_reservations
   WHERE order_id=NEW.id AND store_id=NEW.store_id AND is_active=1
 )
BEGIN
  UPDATE product_variants
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(SUM(r.quantity),0)
    FROM store_order_stock_reservations r
    WHERE r.order_id=NEW.id AND r.store_id=NEW.store_id
      AND r.product_id=product_variants.product_id
      AND r.variant_id=product_variants.id AND r.is_active=1
  )
  WHERE store_id=NEW.store_id AND EXISTS (
    SELECT 1 FROM store_order_stock_reservations r
    WHERE r.order_id=NEW.id AND r.store_id=NEW.store_id
      AND r.product_id=product_variants.product_id
      AND r.variant_id=product_variants.id AND r.is_active=1
  );

  UPDATE products
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(SUM(r.quantity),0)
    FROM store_order_stock_reservations r
    WHERE r.order_id=NEW.id AND r.store_id=NEW.store_id
      AND r.product_id=products.id AND r.variant_id IS NULL AND r.is_active=1
  )
  WHERE store_id=NEW.store_id AND EXISTS (
    SELECT 1 FROM store_order_stock_reservations r
    WHERE r.order_id=NEW.id AND r.store_id=NEW.store_id
      AND r.product_id=products.id AND r.variant_id IS NULL AND r.is_active=1
  );

  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes)
  SELECT lower(hex(randomblob(16))),NEW.store_id,r.product_id,r.variant_id,
    'return',r.quantity,NEW.id,'Rejected customer order stock restoration'
  FROM store_order_stock_reservations r
  WHERE r.order_id=NEW.id AND r.store_id=NEW.store_id AND r.is_active=1;

  UPDATE store_order_stock_reservations
  SET is_active=0,released_at=CURRENT_TIMESTAMP
  WHERE order_id=NEW.id AND store_id=NEW.store_id AND is_active=1;
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
