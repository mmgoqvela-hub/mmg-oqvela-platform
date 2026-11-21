-- MMG OQVELA
-- Migration 0034: POS returns, partial refunds and immutable stock reversals.

INSERT OR IGNORE INTO permissions(id,code,description) VALUES
  ('perm-pos-sale-return','pos.sale.return','Create POS returns and refunds');

CREATE TABLE pos_sale_returns (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  return_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  currency TEXT NOT NULL,
  refund_total REAL NOT NULL CHECK(refund_total>=0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TEXT,
  UNIQUE(store_id,return_number),
  UNIQUE(store_id,idempotency_key),
  UNIQUE(id,store_id),
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((status='draft' AND posted_at IS NULL) OR (status='posted' AND posted_at IS NOT NULL))
);
CREATE INDEX idx_pos_returns_sale ON pos_sale_returns(store_id,sale_id,created_at);

CREATE TABLE pos_sale_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
  restock INTEGER NOT NULL DEFAULT 1 CHECK(restock IN (0,1)),
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(return_id,sale_item_id),
  UNIQUE(id,store_id),
  FOREIGN KEY(return_id,store_id) REFERENCES pos_sale_returns(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_item_id,store_id) REFERENCES pos_sale_items(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(variant_id,store_id) REFERENCES product_variants(id,store_id) ON DELETE RESTRICT
);
CREATE INDEX idx_pos_return_items_sale_item ON pos_sale_return_items(store_id,sale_item_id);

CREATE TABLE pos_sale_refund_payments (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','digital')),
  amount REAL NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL,
  reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(return_id,store_id) REFERENCES pos_sale_returns(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,store_id) REFERENCES pos_sales(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_pos_refund_payments_return ON pos_sale_refund_payments(store_id,return_id);

CREATE TRIGGER trg_pos_return_item_validate
BEFORE INSERT ON pos_sale_return_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_returns r JOIN pos_sales s
      ON s.id=r.sale_id AND s.store_id=r.store_id
    JOIN pos_sale_items i ON i.id=NEW.sale_item_id AND i.sale_id=s.id AND i.store_id=s.store_id
    WHERE r.id=NEW.return_id AND r.store_id=NEW.store_id AND r.sale_id=NEW.sale_id
      AND r.status='draft' AND s.status IN ('posted','partially_refunded')
      AND i.product_id=NEW.product_id AND i.variant_id IS NEW.variant_id
      AND i.currency=NEW.currency
  ) THEN RAISE(ABORT,'POS return item does not belong to this sale') END;
  SELECT CASE WHEN NEW.quantity + COALESCE((
    SELECT SUM(ri.quantity) FROM pos_sale_return_items ri
    JOIN pos_sale_returns r ON r.id=ri.return_id AND r.store_id=ri.store_id
    WHERE ri.sale_item_id=NEW.sale_item_id AND ri.store_id=NEW.store_id AND r.status='posted'
  ),0) > (SELECT quantity FROM pos_sale_items WHERE id=NEW.sale_item_id AND store_id=NEW.store_id)
    THEN RAISE(ABORT,'Returned quantity exceeds the sold quantity') END;
END;

CREATE TRIGGER trg_pos_return_payment_validate
BEFORE INSERT ON pos_sale_refund_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_returns r JOIN pos_sales s
      ON s.id=r.sale_id AND s.store_id=r.store_id
    WHERE r.id=NEW.return_id AND r.store_id=NEW.store_id AND r.sale_id=NEW.sale_id
      AND r.status='draft' AND r.currency=NEW.currency AND s.currency=NEW.currency
  ) THEN RAISE(ABORT,'Refund payment does not match its return') END;
END;

CREATE TRIGGER trg_pos_return_post_validate
BEFORE UPDATE OF status ON pos_sale_returns
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_return_items WHERE return_id=NEW.id AND store_id=NEW.store_id
  ) THEN RAISE(ABORT,'A POS return must contain at least one returned item') END;
  SELECT CASE WHEN ROUND(COALESCE((SELECT SUM(amount) FROM pos_sale_refund_payments
    WHERE return_id=NEW.id AND store_id=NEW.store_id),0),2) != ROUND(NEW.refund_total,2)
    THEN RAISE(ABORT,'POS refund payments do not reconcile with the return total') END;
  SELECT CASE WHEN NEW.refund_total + COALESCE((
    SELECT SUM(refund_total) FROM pos_sale_returns
    WHERE sale_id=NEW.sale_id AND store_id=NEW.store_id AND status='posted'
  ),0) > (SELECT total FROM pos_sales WHERE id=NEW.sale_id AND store_id=NEW.store_id)
    THEN RAISE(ABORT,'Cumulative refunds exceed the original sale total') END;
END;

CREATE TRIGGER trg_pos_return_post_event
AFTER UPDATE OF status ON pos_sale_returns
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  INSERT INTO pos_sale_events(id,sale_id,store_id,actor_user_id,event_type,details_json)
  VALUES(lower(hex(randomblob(16))),NEW.sale_id,NEW.store_id,NEW.created_by,'refund',
    json_object('return_id',NEW.id,'return_number',NEW.return_number,
      'refund_total',NEW.refund_total,'currency',NEW.currency,'reason',NEW.reason));
  UPDATE pos_sales SET
    status=CASE WHEN ROUND(COALESCE((SELECT SUM(refund_total) FROM pos_sale_returns
      WHERE sale_id=NEW.sale_id AND store_id=NEW.store_id AND status='posted'),0),2)
      >= ROUND(total,2) THEN 'refunded' ELSE 'partially_refunded' END,
    payment_status=CASE WHEN ROUND(COALESCE((SELECT SUM(refund_total) FROM pos_sale_returns
      WHERE sale_id=NEW.sale_id AND store_id=NEW.store_id AND status='posted'),0),2)
      >= ROUND(total,2) THEN 'refunded' ELSE 'partially_refunded' END
  WHERE id=NEW.sale_id AND store_id=NEW.store_id AND status IN ('posted','partially_refunded');
END;

CREATE TRIGGER trg_pos_return_immutable_update
BEFORE UPDATE ON pos_sale_returns
WHEN NOT (OLD.status='draft' AND NEW.status='posted'
  AND NEW.id IS OLD.id AND NEW.store_id IS OLD.store_id AND NEW.sale_id IS OLD.sale_id
  AND NEW.return_number IS OLD.return_number AND NEW.idempotency_key IS OLD.idempotency_key
  AND NEW.reason IS OLD.reason AND NEW.currency IS OLD.currency
  AND NEW.refund_total IS OLD.refund_total AND NEW.created_by IS OLD.created_by
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'Posted POS returns are immutable');
END;
CREATE TRIGGER trg_pos_return_no_delete
BEFORE DELETE ON pos_sale_returns
BEGIN
  SELECT RAISE(ABORT,'POS returns cannot be deleted');
END;
