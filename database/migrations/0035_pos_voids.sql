-- MMG OQVELA
-- Migration 0035: controlled full POS voids and tender-aware refunds.

INSERT OR IGNORE INTO permissions(id,code,description) VALUES
  ('perm-pos-sale-void','pos.sale.void','Void a posted POS sale with a reason and full refund');

CREATE TABLE pos_sale_voids (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  void_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  currency TEXT NOT NULL,
  refund_total REAL NOT NULL CHECK(refund_total>=0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TEXT,
  UNIQUE(store_id,void_number),
  UNIQUE(store_id,idempotency_key),
  UNIQUE(sale_id,store_id),
  UNIQUE(id,store_id),
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((status='draft' AND posted_at IS NULL) OR (status='posted' AND posted_at IS NOT NULL))
);
CREATE INDEX idx_pos_voids_store_time ON pos_sale_voids(store_id,created_at DESC);

CREATE TABLE pos_sale_void_items (
  id TEXT PRIMARY KEY,
  void_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(void_id,sale_item_id),
  FOREIGN KEY(void_id,store_id) REFERENCES pos_sale_voids(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_item_id,store_id) REFERENCES pos_sale_items(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id) ON DELETE RESTRICT
);
CREATE INDEX idx_pos_void_items_sale ON pos_sale_void_items(store_id,sale_id);

CREATE TABLE pos_sale_void_payments (
  id TEXT PRIMARY KEY,
  void_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','digital')),
  amount REAL NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL,
  reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(void_id,store_id) REFERENCES pos_sale_voids(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_pos_void_payments_void ON pos_sale_void_payments(store_id,void_id);

CREATE TRIGGER trg_pos_void_item_validate
BEFORE INSERT ON pos_sale_void_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_voids v JOIN pos_sales s
      ON s.id=v.sale_id AND s.store_id=v.store_id
    JOIN pos_sale_items i ON i.id=NEW.sale_item_id AND i.sale_id=s.id AND i.store_id=s.store_id
    WHERE v.id=NEW.void_id AND v.store_id=NEW.store_id AND v.sale_id=NEW.sale_id
      AND v.status='draft' AND s.status='posted'
      AND i.product_id=NEW.product_id AND i.variant_id IS NEW.variant_id
      AND i.quantity=NEW.quantity AND i.currency=NEW.currency
  ) THEN RAISE(ABORT,'POS void item does not match the original posted sale') END;
END;

CREATE TRIGGER trg_pos_void_payment_validate
BEFORE INSERT ON pos_sale_void_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_voids v JOIN pos_sales s
      ON s.id=v.sale_id AND s.store_id=v.store_id
    WHERE v.id=NEW.void_id AND v.store_id=NEW.store_id AND v.sale_id=NEW.sale_id
      AND v.status='draft' AND v.currency=NEW.currency AND s.currency=NEW.currency
  ) THEN RAISE(ABORT,'POS void refund payment does not match its void') END;
END;

CREATE TRIGGER trg_pos_void_post_validate
BEFORE UPDATE OF status ON pos_sale_voids
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_void_items WHERE void_id=NEW.id AND store_id=NEW.store_id
  ) THEN RAISE(ABORT,'A POS void must reverse the original sale items') END;
  SELECT CASE WHEN ROUND(COALESCE((SELECT SUM(amount) FROM pos_sale_void_payments
    WHERE void_id=NEW.id AND store_id=NEW.store_id),0),2) != ROUND(NEW.refund_total,2)
    THEN RAISE(ABORT,'POS void refund payments do not reconcile') END;
  SELECT CASE WHEN ROUND(NEW.refund_total,2) != ROUND((
    SELECT total FROM pos_sales WHERE id=NEW.sale_id AND store_id=NEW.store_id AND status='posted'
  ),2) THEN RAISE(ABORT,'A POS void must refund the full posted sale total') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM pos_sale_returns WHERE sale_id=NEW.sale_id AND store_id=NEW.store_id AND status='posted'
  ) THEN RAISE(ABORT,'A sale with posted returns cannot be voided') END;
END;

CREATE TRIGGER trg_pos_void_post_event
AFTER UPDATE OF status ON pos_sale_voids
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  INSERT INTO pos_sale_events(id,sale_id,store_id,actor_user_id,event_type,details_json)
  VALUES(lower(hex(randomblob(16))),NEW.sale_id,NEW.store_id,NEW.created_by,'voided',
    json_object('void_id',NEW.id,'void_number',NEW.void_number,
      'refund_total',NEW.refund_total,'currency',NEW.currency,'reason',NEW.reason));
  UPDATE pos_sales SET status='voided',payment_status='refunded'
  WHERE id=NEW.sale_id AND store_id=NEW.store_id AND status='posted';
END;

CREATE TRIGGER trg_pos_void_immutable_update
BEFORE UPDATE ON pos_sale_voids
WHEN NOT (OLD.status='draft' AND NEW.status='posted'
  AND NEW.id IS OLD.id AND NEW.store_id IS OLD.store_id AND NEW.sale_id IS OLD.sale_id
  AND NEW.void_number IS OLD.void_number AND NEW.idempotency_key IS OLD.idempotency_key
  AND NEW.reason IS OLD.reason AND NEW.currency IS OLD.currency
  AND NEW.refund_total IS OLD.refund_total AND NEW.created_by IS OLD.created_by
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'Posted POS voids are immutable');
END;
CREATE TRIGGER trg_pos_void_no_delete BEFORE DELETE ON pos_sale_voids
BEGIN SELECT RAISE(ABORT,'POS voids cannot be deleted'); END;

CREATE TRIGGER trg_pos_void_item_immutable_update
BEFORE UPDATE ON pos_sale_void_items
WHEN EXISTS(SELECT 1 FROM pos_sale_voids v WHERE v.id=OLD.void_id AND v.store_id=OLD.store_id AND v.status='posted')
BEGIN SELECT RAISE(ABORT,'Posted POS void items are immutable'); END;
CREATE TRIGGER trg_pos_void_item_immutable_delete
BEFORE DELETE ON pos_sale_void_items
WHEN EXISTS(SELECT 1 FROM pos_sale_voids v WHERE v.id=OLD.void_id AND v.store_id=OLD.store_id AND v.status='posted')
BEGIN SELECT RAISE(ABORT,'Posted POS void items cannot be deleted'); END;

CREATE TRIGGER trg_pos_void_payment_immutable_update
BEFORE UPDATE ON pos_sale_void_payments
WHEN EXISTS(SELECT 1 FROM pos_sale_voids v WHERE v.id=OLD.void_id AND v.store_id=OLD.store_id AND v.status='posted')
BEGIN SELECT RAISE(ABORT,'Posted POS void payments are immutable'); END;
CREATE TRIGGER trg_pos_void_payment_immutable_delete
BEFORE DELETE ON pos_sale_void_payments
WHEN EXISTS(SELECT 1 FROM pos_sale_voids v WHERE v.id=OLD.void_id AND v.store_id=OLD.store_id AND v.status='posted')
BEGIN SELECT RAISE(ABORT,'Posted POS void payments cannot be deleted'); END;
