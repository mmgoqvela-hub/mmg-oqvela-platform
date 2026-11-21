-- MMG OQVELA
-- Migration 0028: supplier directory and exact-USD purchase orders.
-- Approved purchase orders do NOT change stock. Only posted goods receipts do.

CREATE TABLE suppliers (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
    phone TEXT,
    email TEXT,
    address TEXT,
    tax_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, store_id),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE INDEX idx_suppliers_store_status
    ON suppliers(store_id, status, name);

CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'submitted', 'approved', 'cancelled')),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    total_minor_units INTEGER NOT NULL DEFAULT 0
      CHECK (total_minor_units >= 0),
    notes TEXT,
    expected_at TEXT,
    created_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, order_number),
    UNIQUE (id, store_id),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id, store_id)
      REFERENCES suppliers(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_purchase_orders_store_status
    ON purchase_orders(store_id, status, created_at DESC);

CREATE TABLE purchase_order_items (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    purchase_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    product_name_snapshot TEXT NOT NULL,
    sku_snapshot TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000000),
    unit_cost_minor_units INTEGER NOT NULL
      CHECK (unit_cost_minor_units >= 0),
    line_total_minor_units INTEGER NOT NULL
      CHECK (line_total_minor_units >= 0 AND line_total_minor_units = unit_cost_minor_units * quantity),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id, store_id)
      REFERENCES purchase_orders(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id, store_id)
      REFERENCES products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (variant_id, store_id)
      REFERENCES product_variants(id, store_id) ON DELETE RESTRICT
);

CREATE INDEX idx_purchase_order_items_order
    ON purchase_order_items(store_id, purchase_order_id);

CREATE TRIGGER trg_purchase_order_items_only_draft_insert
BEFORE INSERT ON purchase_order_items
WHEN NOT EXISTS (
  SELECT 1 FROM purchase_orders po
  WHERE po.id = NEW.purchase_order_id AND po.store_id = NEW.store_id
    AND po.status = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'Purchase order items can only be added to a draft');
END;

CREATE TRIGGER trg_purchase_order_items_only_draft_update
BEFORE UPDATE ON purchase_order_items
WHEN NOT EXISTS (
  SELECT 1 FROM purchase_orders po
  WHERE po.id = OLD.purchase_order_id AND po.store_id = OLD.store_id
    AND po.status = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'Only draft purchase order items can be edited');
END;

CREATE TRIGGER trg_purchase_order_items_only_draft_delete
BEFORE DELETE ON purchase_order_items
WHEN NOT EXISTS (
  SELECT 1 FROM purchase_orders po
  WHERE po.id = OLD.purchase_order_id AND po.store_id = OLD.store_id
    AND po.status = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'Only draft purchase order items can be deleted');
END;

CREATE TRIGGER trg_purchase_order_item_validate_variant
BEFORE INSERT ON purchase_order_items
WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM product_variants v
  WHERE v.id = NEW.variant_id AND v.product_id = NEW.product_id
    AND v.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'Purchase order variant does not belong to product and store');
END;

CREATE TRIGGER trg_purchase_order_no_reopen
BEFORE UPDATE OF status ON purchase_orders
WHEN OLD.status IN ('approved', 'cancelled') AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'Approved or cancelled purchase orders cannot be reopened');
END;

CREATE TRIGGER trg_purchase_order_approval_requires_items
BEFORE UPDATE OF status ON purchase_orders
WHEN NEW.status = 'approved' AND OLD.status != 'approved'
 AND NOT EXISTS (
   SELECT 1 FROM purchase_order_items i
   WHERE i.purchase_order_id = OLD.id AND i.store_id = OLD.store_id
 )
BEGIN
  SELECT RAISE(ABORT, 'A purchase order requires at least one item before approval');
END;

CREATE TRIGGER trg_purchase_order_items_freeze_after_approval
BEFORE UPDATE ON purchase_order_items
WHEN EXISTS (
  SELECT 1 FROM purchase_orders po
  WHERE po.id = OLD.purchase_order_id AND po.store_id = OLD.store_id
    AND po.status != 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'Submitted or approved purchase order items are immutable');
END;


CREATE TRIGGER trg_purchase_order_valid_status_transition
BEFORE UPDATE OF status ON purchase_orders
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'draft' AND NEW.status IN ('submitted', 'cancelled'))
  OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'cancelled'))
  OR (OLD.status = 'approved' AND NEW.status = 'cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid purchase order status transition');
END;

CREATE TRIGGER trg_purchase_order_freeze_after_submission
BEFORE UPDATE ON purchase_orders
WHEN OLD.status != 'draft' AND (
  NEW.supplier_id IS NOT OLD.supplier_id
  OR NEW.order_number IS NOT OLD.order_number
  OR NEW.currency IS NOT OLD.currency
  OR NEW.total_minor_units IS NOT OLD.total_minor_units
  OR NEW.notes IS NOT OLD.notes
  OR NEW.expected_at IS NOT OLD.expected_at
)
BEGIN
  SELECT RAISE(ABORT, 'Submitted purchase order details are immutable');
END;

CREATE TRIGGER trg_purchase_order_no_delete_after_submission
BEFORE DELETE ON purchase_orders
WHEN OLD.status != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Submitted purchase orders cannot be deleted');
END;

CREATE TRIGGER trg_purchase_order_recalculate_after_item_insert
AFTER INSERT ON purchase_order_items
BEGIN
  UPDATE purchase_orders
  SET total_minor_units = (
    SELECT COALESCE(SUM(line_total_minor_units), 0)
    FROM purchase_order_items
    WHERE purchase_order_id = NEW.purchase_order_id AND store_id = NEW.store_id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.purchase_order_id AND store_id = NEW.store_id AND status = 'draft';
END;

CREATE TRIGGER trg_purchase_order_recalculate_after_item_update
AFTER UPDATE ON purchase_order_items
BEGIN
  UPDATE purchase_orders
  SET total_minor_units = (
    SELECT COALESCE(SUM(line_total_minor_units), 0)
    FROM purchase_order_items
    WHERE purchase_order_id = NEW.purchase_order_id AND store_id = NEW.store_id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.purchase_order_id AND store_id = NEW.store_id AND status = 'draft';
END;

CREATE TRIGGER trg_purchase_order_recalculate_after_item_delete
AFTER DELETE ON purchase_order_items
BEGIN
  UPDATE purchase_orders
  SET total_minor_units = (
    SELECT COALESCE(SUM(line_total_minor_units), 0)
    FROM purchase_order_items
    WHERE purchase_order_id = OLD.purchase_order_id AND store_id = OLD.store_id
  ), updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.purchase_order_id AND store_id = OLD.store_id AND status = 'draft';
END;
