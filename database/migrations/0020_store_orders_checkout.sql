-- MMG OQVELA
-- Migration 0020: Store customer orders, checkout settings and atomic inventory

CREATE TABLE store_order_settings (
    store_id TEXT PRIMARY KEY,
    cash_on_delivery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cash_on_delivery_enabled IN (0,1)),
    shamcash_enabled INTEGER NOT NULL DEFAULT 1 CHECK (shamcash_enabled IN (0,1)),
    shamcash_recipient TEXT,
    shamcash_instructions TEXT,
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (shamcash_recipient IS NULL OR length(shamcash_recipient) <= 160),
    CHECK (shamcash_instructions IS NULL OR length(shamcash_instructions) <= 2000)
);

CREATE TABLE store_orders (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    shipping_address TEXT,
    customer_notes TEXT,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash_on_delivery','shamcash')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid'
      CHECK (payment_status IN ('unpaid','pending','paid','rejected','refunded')),
    order_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (order_status IN ('pending','confirmed','processing','shipped','completed','cancelled')),
    transaction_reference TEXT,
    sender_name TEXT,
    subtotal REAL NOT NULL CHECK (subtotal >= 0),
    total REAL NOT NULL CHECK (total >= 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, order_number),
    UNIQUE (id, store_id),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    CHECK (payment_method != 'shamcash' OR (transaction_reference IS NOT NULL AND sender_name IS NOT NULL)),
    CHECK (payment_method != 'cash_on_delivery' OR transaction_reference IS NULL)
);

CREATE TABLE store_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    product_name TEXT NOT NULL,
    variant_name TEXT,
    sku TEXT,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id, store_id) REFERENCES store_orders(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (variant_id, store_id) REFERENCES product_variants(id, store_id) ON DELETE RESTRICT
);

CREATE INDEX idx_store_orders_store_created ON store_orders(store_id, created_at DESC);
CREATE INDEX idx_store_orders_store_status ON store_orders(store_id, order_status, payment_status);
CREATE INDEX idx_store_order_items_order ON store_order_items(store_id, order_id);

-- Enforce product/variant ownership and reserve tracked stock in the same transaction
-- that creates the order. Any insufficient stock aborts the complete D1 batch.
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
      (id, store_id, product_id, variant_id, movement_type, quantity_change, reference_id, notes)
    VALUES
      (lower(hex(randomblob(16))), NEW.store_id, NEW.product_id, NEW.variant_id,
       'sale', -NEW.quantity, NEW.order_id, 'Customer order stock reservation');
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
      (id, store_id, product_id, movement_type, quantity_change, reference_id, notes)
    VALUES
      (lower(hex(randomblob(16))), NEW.store_id, NEW.product_id,
       'sale', -NEW.quantity, NEW.order_id, 'Customer order stock reservation');
END;

-- Restore reserved stock exactly once when an order is cancelled.
CREATE TRIGGER trg_store_order_restore_variant_stock
AFTER UPDATE OF order_status ON store_orders
WHEN OLD.order_status != 'cancelled' AND NEW.order_status = 'cancelled'
BEGIN
    UPDATE product_variants
    SET stock_quantity = stock_quantity + (
      SELECT oi.quantity FROM store_order_items oi
      WHERE oi.order_id = NEW.id AND oi.store_id = NEW.store_id
        AND oi.variant_id = product_variants.id
    )
    WHERE store_id = NEW.store_id
      AND id IN (
        SELECT variant_id FROM store_order_items
        WHERE order_id = NEW.id AND store_id = NEW.store_id AND variant_id IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM products p WHERE p.id = product_variants.product_id
          AND p.store_id = NEW.store_id AND p.track_inventory = 1
      );
    UPDATE products
    SET stock_quantity = stock_quantity + (
      SELECT oi.quantity FROM store_order_items oi
      WHERE oi.order_id = NEW.id AND oi.store_id = NEW.store_id
        AND oi.product_id = products.id AND oi.variant_id IS NULL
    )
    WHERE store_id = NEW.store_id
      AND id IN (
        SELECT product_id FROM store_order_items
        WHERE order_id = NEW.id AND store_id = NEW.store_id AND variant_id IS NULL
      )
      AND track_inventory = 1;
    INSERT INTO inventory_movements
      (id, store_id, product_id, variant_id, movement_type, quantity_change, reference_id, notes)
    SELECT lower(hex(randomblob(16))), NEW.store_id, product_id, variant_id,
      'return', quantity, NEW.id, 'Cancelled customer order stock restoration'
    FROM store_order_items
    WHERE order_id = NEW.id AND store_id = NEW.store_id
      AND EXISTS (
        SELECT 1 FROM products p WHERE p.id = store_order_items.product_id
          AND p.store_id = NEW.store_id AND p.track_inventory = 1
      );
END;


-- Notify the store owner when a customer places an order.
CREATE TRIGGER trg_notify_store_order_created
AFTER INSERT ON store_orders
BEGIN
    INSERT OR IGNORE INTO user_notifications
      (id,user_id,notification_type,title,message,entity_type,entity_id,dedupe_key)
    SELECT lower(hex(randomblob(16))), a.owner_user_id, 'store_order',
      'طلب جديد في متجرك',
      CASE WHEN NEW.payment_method = 'shamcash'
        THEN 'تم استلام طلب جديد عبر شام كاش ويحتاج إلى مراجعة رقم العملية.'
        ELSE 'تم استلام طلب جديد بالدفع عند الاستلام.'
      END,
      'store_order', NEW.id, 'store-order-created:' || NEW.id
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.id = NEW.store_id;
END;
