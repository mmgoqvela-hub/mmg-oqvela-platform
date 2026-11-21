-- MMG OQVELA
-- Migration 0033: POS cash sessions, posted sales, split tenders and atomic stock movements.

CREATE TABLE pos_cash_sessions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opening_cash_amount REAL NOT NULL DEFAULT 0 CHECK(opening_cash_amount>=0),
  closing_cash_amount REAL CHECK(closing_cash_amount IS NULL OR closing_cash_amount>=0),
  expected_cash_amount REAL CHECK(expected_cash_amount IS NULL OR expected_cash_amount>=0),
  cash_difference REAL,
  opening_notes TEXT,
  closing_notes TEXT,
  opened_by TEXT NOT NULL,
  closed_by TEXT,
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  UNIQUE(id,store_id),
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(warehouse_id,store_id) REFERENCES inventory_warehouses(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(opened_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(closed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((status='open' AND closed_at IS NULL AND closed_by IS NULL AND closing_cash_amount IS NULL)
     OR (status='closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND closing_cash_amount IS NOT NULL))
);
CREATE UNIQUE INDEX idx_pos_one_open_cash_session
  ON pos_cash_sessions(store_id,currency) WHERE status='open';
CREATE INDEX idx_pos_cash_sessions_store_time
  ON pos_cash_sessions(store_id,opened_at DESC);

CREATE TABLE pos_sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cash_session_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  sale_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  currency TEXT NOT NULL,
  subtotal REAL NOT NULL CHECK(subtotal>=0),
  discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
  discount_reason TEXT,
  total REAL NOT NULL CHECK(total>=0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','voided','partially_refunded','refunded')),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK(payment_status IN ('paid','partially_refunded','refunded')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id,sale_number),
  UNIQUE(store_id,idempotency_key),
  UNIQUE(id,store_id),
  FOREIGN KEY(cash_session_id,store_id) REFERENCES pos_cash_sessions(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(warehouse_id,store_id) REFERENCES inventory_warehouses(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK(discount_amount<=subtotal),
  CHECK((discount_amount=0 AND discount_reason IS NULL) OR
        (discount_amount>0 AND discount_reason IS NOT NULL AND length(trim(discount_reason))>=3))
);
CREATE INDEX idx_pos_sales_store_time ON pos_sales(store_id,created_at DESC);
CREATE INDEX idx_pos_sales_session ON pos_sales(store_id,cash_session_id,created_at);

CREATE TABLE pos_sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
  unit_price REAL NOT NULL CHECK(unit_price>=0),
  line_total REAL NOT NULL CHECK(line_total>=0),
  currency TEXT NOT NULL,
  pricing_mode TEXT NOT NULL DEFAULT 'manual' CHECK(pricing_mode IN ('manual','cost_plus_margin')),
  pricing_tier_code TEXT CHECK(pricing_tier_code IS NULL OR pricing_tier_code IN ('retail','wholesale','bulk_wholesale')),
  cost_version_id TEXT REFERENCES product_cost_versions(id) ON DELETE RESTRICT,
  cost_currency TEXT CHECK(cost_currency IS NULL OR cost_currency='USD'),
  cost_minor_units INTEGER CHECK(cost_minor_units IS NULL OR cost_minor_units BETWEEN 0 AND 9007199254740991),
  profit_margin_bps INTEGER CHECK(profit_margin_bps IS NULL OR profit_margin_bps BETWEEN 0 AND 1000000),
  rounding_increment_minor_units INTEGER CHECK(rounding_increment_minor_units IS NULL OR rounding_increment_minor_units BETWEEN 1 AND 1000000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,store_id),
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id) ON DELETE RESTRICT,
  CHECK((pricing_mode='manual' AND pricing_tier_code IS NULL AND cost_version_id IS NULL
         AND cost_currency IS NULL AND cost_minor_units IS NULL AND profit_margin_bps IS NULL
         AND rounding_increment_minor_units IS NULL)
     OR (pricing_mode='cost_plus_margin' AND pricing_tier_code IS NOT NULL AND cost_version_id IS NOT NULL
         AND cost_currency='USD' AND cost_minor_units IS NOT NULL AND profit_margin_bps IS NOT NULL
         AND rounding_increment_minor_units IS NOT NULL))
);
CREATE INDEX idx_pos_sale_items_sale ON pos_sale_items(store_id,sale_id);

CREATE TABLE pos_sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  cash_session_id TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','digital','shamcash')),
  amount REAL NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL,
  transaction_reference TEXT,
  sender_name TEXT,
  received_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(cash_session_id,store_id) REFERENCES pos_cash_sessions(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(received_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK(payment_method!='shamcash' OR
    (transaction_reference IS NOT NULL AND length(trim(transaction_reference))>=3
     AND sender_name IS NOT NULL AND length(trim(sender_name))>=2)),
  CHECK(payment_method='shamcash' OR (transaction_reference IS NULL AND sender_name IS NULL))
);
CREATE INDEX idx_pos_payments_sale ON pos_sale_payments(store_id,sale_id);
CREATE UNIQUE INDEX idx_pos_unique_shamcash_reference
  ON pos_sale_payments(store_id,transaction_reference)
  WHERE payment_method='shamcash' AND transaction_reference IS NOT NULL;

CREATE TABLE pos_sale_events (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('posted','voided','refund','payment')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_pos_sale_events_sale ON pos_sale_events(store_id,sale_id,created_at);

CREATE TABLE pos_cash_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('opened','closed')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id,store_id) REFERENCES pos_cash_sessions(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_pos_cash_events_session ON pos_cash_session_events(store_id,session_id,created_at);

CREATE TRIGGER trg_pos_sale_created_event
AFTER INSERT ON pos_sales
BEGIN
  INSERT INTO pos_sale_events(id,sale_id,store_id,actor_user_id,event_type,details_json)
  VALUES(lower(hex(randomblob(16))),NEW.id,NEW.store_id,NEW.created_by,'posted',
    json_object('sale_number',NEW.sale_number,'total',NEW.total,'currency',NEW.currency));
END;

CREATE TRIGGER trg_pos_sale_item_validate
BEFORE INSERT ON pos_sale_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sales s JOIN pos_cash_sessions cs
      ON cs.id=s.cash_session_id AND cs.store_id=s.store_id
    WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id
      AND s.status='posted' AND cs.status='open'
  ) THEN RAISE(ABORT,'POS sale requires an open cash session') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.status='active'
  ) THEN RAISE(ABORT,'POS product is unavailable') END;
  SELECT CASE WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM product_variants v WHERE v.id=NEW.variant_id AND v.product_id=NEW.product_id
      AND v.store_id=NEW.store_id AND v.status='active'
  ) THEN RAISE(ABORT,'POS product variant is unavailable') END;
  SELECT CASE WHEN NEW.pricing_mode='cost_plus_margin' AND NOT EXISTS(
    SELECT 1 FROM product_cost_versions cv
    WHERE cv.id=NEW.cost_version_id AND cv.store_id=NEW.store_id
      AND cv.product_id=NEW.product_id
      AND (cv.variant_id=NEW.variant_id OR (cv.variant_id IS NULL AND NEW.variant_id IS NULL))
      AND cv.cost_currency=NEW.cost_currency AND cv.cost_minor_units=NEW.cost_minor_units
  ) THEN RAISE(ABORT,'POS cost snapshot does not match its cost version') END;
END;

-- The stock projection, append-only movement and POS line are committed together.
CREATE TRIGGER trg_pos_sale_item_decrement_variant
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.track_inventory=1)
BEGIN
  UPDATE product_variants SET stock_quantity=stock_quantity-NEW.quantity
  WHERE id=NEW.variant_id AND product_id=NEW.product_id AND store_id=NEW.store_id
    AND status='active' AND stock_quantity>=NEW.quantity;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'Insufficient POS variant stock') END;
  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes,created_by,
     warehouse_id,unit_code,movement_reason,source_type,source_id,idempotency_key,effective_at,posted_at)
  SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.product_id,NEW.variant_id,'sale',-NEW.quantity,
    NEW.sale_id,'POS sale stock deduction',s.created_by,s.warehouse_id,'unit','pos_sale','pos_sale',
    NEW.sale_id,'pos-sale:'||NEW.sale_id||':'||NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM pos_sales s WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id;
END;

CREATE TRIGGER trg_pos_sale_item_decrement_product
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NULL
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.track_inventory=1)
BEGIN
  UPDATE products SET stock_quantity=stock_quantity-NEW.quantity
  WHERE id=NEW.product_id AND store_id=NEW.store_id AND status='active' AND stock_quantity>=NEW.quantity;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'Insufficient POS product stock') END;
  INSERT INTO inventory_movements
    (id,store_id,product_id,movement_type,quantity_change,reference_id,notes,created_by,
     warehouse_id,unit_code,movement_reason,source_type,source_id,idempotency_key,effective_at,posted_at)
  SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.product_id,'sale',-NEW.quantity,
    NEW.sale_id,'POS sale stock deduction',s.created_by,s.warehouse_id,'unit','pos_sale','pos_sale',
    NEW.sale_id,'pos-sale:'||NEW.sale_id||':'||NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM pos_sales s WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id;
END;

CREATE TRIGGER trg_pos_sale_item_cost_snapshot_required
BEFORE INSERT ON pos_sale_items
WHEN NEW.pricing_mode='cost_plus_margin'
BEGIN
  SELECT CASE WHEN NEW.pricing_tier_code IS NULL OR NEW.cost_version_id IS NULL
    OR NEW.cost_currency!='USD' OR NEW.cost_minor_units IS NULL
    OR NEW.profit_margin_bps IS NULL OR NEW.rounding_increment_minor_units IS NULL
    THEN RAISE(ABORT,'POS automatic pricing snapshot is incomplete') END;
END;

CREATE TRIGGER trg_pos_payment_session_currency
BEFORE INSERT ON pos_sale_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sales s JOIN pos_cash_sessions cs
      ON cs.id=s.cash_session_id AND cs.store_id=s.store_id
    WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id
      AND s.cash_session_id=NEW.cash_session_id AND s.currency=NEW.currency
      AND cs.currency=NEW.currency AND cs.status='open'
  ) THEN RAISE(ABORT,'POS payment session is closed or currency does not match') END;
END;
