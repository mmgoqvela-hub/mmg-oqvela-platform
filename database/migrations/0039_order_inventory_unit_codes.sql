-- MMG OQVELA
-- Migration 0039: keep order-driven stock ledger units consistent with product sale units.
DROP TRIGGER IF EXISTS trg_order_item_reserve_variant_stock;
DROP TRIGGER IF EXISTS trg_order_item_reserve_product_stock;
DROP TRIGGER IF EXISTS trg_store_order_restore_variant_stock;

CREATE TRIGGER trg_order_item_reserve_variant_stock
AFTER INSERT ON store_order_items
WHEN NEW.variant_id IS NOT NULL
AND EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id AND p.track_inventory = 1)
BEGIN
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM product_variants v
      WHERE v.id = NEW.variant_id AND v.product_id = NEW.product_id
        AND v.store_id = NEW.store_id AND v.status = 'active'
    ) THEN RAISE(ABORT, 'Invalid order variant') END;
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.variant_id AND product_id = NEW.product_id
      AND store_id = NEW.store_id AND status = 'active'
      AND stock_quantity >= NEW.quantity;
    SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'Insufficient variant stock') END;
    INSERT INTO inventory_movements
      (id, store_id, product_id, variant_id, movement_type, quantity_change, reference_id, notes, unit_code)
    SELECT lower(hex(randomblob(16))), NEW.store_id, NEW.product_id, NEW.variant_id,
      'sale', -NEW.quantity, NEW.order_id, 'Customer order stock reservation',
      CASE WHEN p.sale_unit = 'kg' THEN 'g' ELSE 'piece' END
    FROM products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id;
END;

CREATE TRIGGER trg_order_item_reserve_product_stock
AFTER INSERT ON store_order_items
WHEN NEW.variant_id IS NULL
AND EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id AND p.track_inventory = 1)
BEGIN
    UPDATE products
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_id AND store_id = NEW.store_id
      AND status = 'active' AND stock_quantity >= NEW.quantity;
    SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'Insufficient product stock') END;
    INSERT INTO inventory_movements
      (id, store_id, product_id, movement_type, quantity_change, reference_id, notes, unit_code)
    SELECT lower(hex(randomblob(16))), NEW.store_id, NEW.product_id,
      'sale', -NEW.quantity, NEW.order_id, 'Customer order stock reservation',
      CASE WHEN p.sale_unit = 'kg' THEN 'g' ELSE 'piece' END
    FROM products p WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id;
END;

CREATE TRIGGER trg_store_order_restore_variant_stock
AFTER UPDATE OF order_status ON store_orders
WHEN OLD.order_status != 'cancelled' AND NEW.order_status = 'cancelled'
BEGIN
  UPDATE product_variants
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(SUM(-im.quantity_change),0)
    FROM inventory_movements im
    WHERE im.store_id = NEW.store_id
      AND im.reference_id = NEW.id
      AND im.movement_type = 'sale'
      AND im.product_id = product_variants.product_id
      AND im.variant_id = product_variants.id
  )
  WHERE store_id = NEW.store_id
    AND EXISTS (
      SELECT 1 FROM inventory_movements im
      WHERE im.store_id = NEW.store_id AND im.reference_id = NEW.id
        AND im.movement_type = 'sale'
        AND im.product_id = product_variants.product_id
        AND im.variant_id = product_variants.id
    );

  UPDATE products
  SET stock_quantity = stock_quantity + (
    SELECT COALESCE(SUM(-im.quantity_change),0)
    FROM inventory_movements im
    WHERE im.store_id = NEW.store_id
      AND im.reference_id = NEW.id
      AND im.movement_type = 'sale'
      AND im.product_id = products.id
      AND im.variant_id IS NULL
  )
  WHERE store_id = NEW.store_id
    AND EXISTS (
      SELECT 1 FROM inventory_movements im
      WHERE im.store_id = NEW.store_id AND im.reference_id = NEW.id
        AND im.movement_type = 'sale'
        AND im.product_id = products.id
        AND im.variant_id IS NULL
    );

  INSERT INTO inventory_movements
    (id,store_id,product_id,variant_id,movement_type,quantity_change,reference_id,notes,unit_code)
  SELECT lower(hex(randomblob(16))),NEW.store_id,im.product_id,im.variant_id,
    'return',SUM(-im.quantity_change),NEW.id,
    'Cancelled customer order stock restoration',
    CASE WHEN p.sale_unit = 'kg' THEN 'g' ELSE 'piece' END
  FROM inventory_movements im
  JOIN products p ON p.id = im.product_id AND p.store_id = im.store_id
  WHERE im.store_id = NEW.store_id AND im.reference_id = NEW.id
    AND im.movement_type = 'sale' AND im.quantity_change < 0
  GROUP BY im.product_id,im.variant_id,p.sale_unit;
END;
