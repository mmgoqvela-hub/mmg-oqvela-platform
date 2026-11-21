-- POS sale-unit support. Existing rows remain pieces; weighted POS quantities use 50g ticks.
ALTER TABLE pos_sale_items ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK(sale_unit IN ('piece','kg'));
ALTER TABLE pos_sale_return_items ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK(sale_unit IN ('piece','kg'));
ALTER TABLE pos_sale_void_items ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK(sale_unit IN ('piece','kg'));

DROP TRIGGER IF EXISTS trg_pos_sale_item_validate;
CREATE TRIGGER trg_pos_sale_item_validate
BEFORE INSERT ON pos_sale_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sales s JOIN pos_cash_sessions cs ON cs.id=s.cash_session_id AND cs.store_id=s.store_id
    WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id AND s.status='draft' AND cs.status='open'
  ) THEN RAISE(ABORT,'POS sale requires an open cash session') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id
      AND p.status='active' AND p.sale_unit=NEW.sale_unit
  ) THEN RAISE(ABORT,'POS product is unavailable or sale unit changed') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.currency=NEW.currency)
    THEN RAISE(ABORT,'POS line currency does not match product currency') END;
  SELECT CASE WHEN ROUND(NEW.line_total,2) != ROUND(NEW.unit_price*NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 0.05 ELSE 1 END,2)
    THEN RAISE(ABORT,'POS line total does not match quantity and sale unit') END;
  SELECT CASE WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM product_variants v WHERE v.id=NEW.variant_id AND v.product_id=NEW.product_id
      AND v.store_id=NEW.store_id AND v.status='active'
  ) THEN RAISE(ABORT,'POS product variant is unavailable') END;
  SELECT CASE WHEN NEW.pricing_mode='cost_plus_margin' AND NOT EXISTS(
    SELECT 1 FROM product_cost_versions cv WHERE cv.id=NEW.cost_version_id AND cv.store_id=NEW.store_id
      AND cv.product_id=NEW.product_id AND (cv.variant_id=NEW.variant_id OR (cv.variant_id IS NULL AND NEW.variant_id IS NULL))
      AND cv.cost_currency=NEW.cost_currency AND cv.cost_minor_units=NEW.cost_minor_units
  ) THEN RAISE(ABORT,'POS cost snapshot does not match its cost version') END;
END;

DROP TRIGGER IF EXISTS trg_pos_sale_item_decrement_variant;
CREATE TRIGGER trg_pos_sale_item_decrement_variant
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.track_inventory=1)
BEGIN
  UPDATE product_variants SET stock_quantity=stock_quantity-NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END
  WHERE id=NEW.variant_id AND product_id=NEW.product_id AND store_id=NEW.store_id
    AND status='active' AND stock_quantity>=NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'Insufficient POS variant stock') END;
  INSERT INTO inventory_movements(id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes,created_by,
    warehouse_id,unit_code,movement_reason,source_type,source_id,idempotency_key,effective_at,posted_at)
  SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.product_id,NEW.variant_id,'sale',
    -NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END,NEW.sale_id,'POS sale stock deduction',s.created_by,s.warehouse_id,
    CASE WHEN NEW.sale_unit='kg' THEN 'g' ELSE 'piece' END,'pos_sale','pos_sale',NEW.sale_id,
    'pos-sale:'||NEW.sale_id||':'||NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM pos_sales s WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id;
END;

DROP TRIGGER IF EXISTS trg_pos_sale_item_decrement_product;
CREATE TRIGGER trg_pos_sale_item_decrement_product
AFTER INSERT ON pos_sale_items
WHEN NEW.variant_id IS NULL
 AND EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product_id AND p.store_id=NEW.store_id AND p.track_inventory=1)
BEGIN
  UPDATE products SET stock_quantity=stock_quantity-NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END
  WHERE id=NEW.product_id AND store_id=NEW.store_id AND status='active'
    AND stock_quantity>=NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END;
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'Insufficient POS product stock') END;
  INSERT INTO inventory_movements(id,store_id,product_id,movement_type,quantity_change,reference_id,notes,created_by,
    warehouse_id,unit_code,movement_reason,source_type,source_id,idempotency_key,effective_at,posted_at)
  SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.product_id,'sale',
    -NEW.quantity*CASE WHEN NEW.sale_unit='kg' THEN 50 ELSE 1 END,NEW.sale_id,'POS sale stock deduction',s.created_by,s.warehouse_id,
    CASE WHEN NEW.sale_unit='kg' THEN 'g' ELSE 'piece' END,'pos_sale','pos_sale',NEW.sale_id,
    'pos-sale:'||NEW.sale_id||':'||NEW.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM pos_sales s WHERE s.id=NEW.sale_id AND s.store_id=NEW.store_id;
END;

DROP TRIGGER IF EXISTS trg_pos_return_item_validate;
CREATE TRIGGER trg_pos_return_item_validate
BEFORE INSERT ON pos_sale_return_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_returns r JOIN pos_sales s ON s.id=r.sale_id AND s.store_id=r.store_id
    JOIN pos_sale_items i ON i.id=NEW.sale_item_id AND i.sale_id=s.id AND i.store_id=s.store_id
    WHERE r.id=NEW.return_id AND r.store_id=NEW.store_id AND r.sale_id=NEW.sale_id
      AND r.status='draft' AND s.status IN ('posted','partially_refunded')
      AND i.product_id=NEW.product_id AND i.variant_id IS NEW.variant_id
      AND i.currency=NEW.currency AND i.sale_unit=NEW.sale_unit
  ) THEN RAISE(ABORT,'POS return item does not belong to this sale') END;
  SELECT CASE WHEN NEW.quantity + COALESCE((SELECT SUM(ri.quantity) FROM pos_sale_return_items ri
    JOIN pos_sale_returns r ON r.id=ri.return_id AND r.store_id=ri.store_id
    WHERE ri.sale_item_id=NEW.sale_item_id AND ri.store_id=NEW.store_id AND r.status='posted'),0)
    > (SELECT quantity FROM pos_sale_items WHERE id=NEW.sale_item_id AND store_id=NEW.store_id)
    THEN RAISE(ABORT,'Returned quantity exceeds the sold quantity') END;
END;

DROP TRIGGER IF EXISTS trg_pos_void_item_validate;
CREATE TRIGGER trg_pos_void_item_validate
BEFORE INSERT ON pos_sale_void_items
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_sale_voids v JOIN pos_sales s ON s.id=v.sale_id AND s.store_id=v.store_id
    JOIN pos_sale_items i ON i.id=NEW.sale_item_id AND i.sale_id=s.id AND i.store_id=s.store_id
    WHERE v.id=NEW.void_id AND v.store_id=NEW.store_id AND v.sale_id=NEW.sale_id
      AND v.status='draft' AND s.status='posted' AND i.product_id=NEW.product_id
      AND i.variant_id IS NEW.variant_id AND i.quantity=NEW.quantity AND i.currency=NEW.currency
      AND i.sale_unit=NEW.sale_unit
  ) THEN RAISE(ABORT,'POS void item does not match the original posted sale') END;
END;
