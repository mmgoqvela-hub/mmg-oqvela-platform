-- MMG OQVELA
-- Migration 0027: warehouse-aware, append-only inventory movement foundation.
-- Existing stock_quantity columns remain compatibility projections.

CREATE TABLE inventory_warehouses (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, code),
    UNIQUE (id, store_id),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_inventory_one_default_warehouse
    ON inventory_warehouses(store_id)
    WHERE is_default = 1;

-- Give every existing store one default warehouse. IDs are deterministic and
-- collision-resistant within the store namespace.
INSERT INTO inventory_warehouses (id, store_id, code, name, is_default)
SELECT 'wh-default-' || lower(hex(randomblob(12))), id, 'MAIN', 'Main warehouse', 1
FROM stores;

ALTER TABLE inventory_movements
    ADD COLUMN warehouse_id TEXT REFERENCES inventory_warehouses(id) ON DELETE RESTRICT;

ALTER TABLE inventory_movements
    ADD COLUMN unit_code TEXT NOT NULL DEFAULT 'unit';

ALTER TABLE inventory_movements
    ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE inventory_movements
    ADD COLUMN source_id TEXT;

ALTER TABLE inventory_movements
    ADD COLUMN idempotency_key TEXT;

ALTER TABLE inventory_movements
    ADD COLUMN effective_at TEXT;

ALTER TABLE inventory_movements
    ADD COLUMN posted_at TEXT;

ALTER TABLE inventory_movements
    ADD COLUMN reversal_of_id TEXT;

-- Preserve old references as source IDs for traceability without guessing
-- their document type.
UPDATE inventory_movements
SET warehouse_id = (
      SELECT w.id FROM inventory_warehouses w
      WHERE w.store_id = inventory_movements.store_id AND w.is_default = 1
      LIMIT 1
    ),
    source_id = reference_id,
    effective_at = created_at,
    posted_at = created_at
WHERE warehouse_id IS NULL;

CREATE INDEX idx_inventory_warehouse_product_time
    ON inventory_movements(store_id, warehouse_id, product_id, effective_at);

CREATE INDEX idx_inventory_source
    ON inventory_movements(store_id, source_type, source_id);

CREATE UNIQUE INDEX idx_inventory_store_idempotency
    ON inventory_movements(store_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE inventory_warehouse_stock (
    warehouse_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_key TEXT NOT NULL DEFAULT '',
    variant_id TEXT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (warehouse_id, product_id, variant_key),
    FOREIGN KEY (warehouse_id, store_id)
        REFERENCES inventory_warehouses(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id, store_id)
        REFERENCES product_variants(id, store_id) ON DELETE CASCADE,
    CHECK ((variant_id IS NULL AND variant_key = '') OR
           (variant_id IS NOT NULL AND variant_key = variant_id))
);

CREATE INDEX idx_inventory_warehouse_stock_product
    ON inventory_warehouse_stock(store_id, product_id, warehouse_id);

-- The old product/variant stock values are the opening snapshot at migration
-- time. Historical movements remain available for audit but are not replayed
-- into this opening snapshot.
INSERT INTO inventory_warehouse_stock
    (warehouse_id, store_id, product_id, variant_key, variant_id, quantity)
SELECT w.id, p.store_id, p.id, '', NULL, p.stock_quantity
FROM products p
JOIN inventory_warehouses w
  ON w.store_id = p.store_id AND w.is_default = 1;

INSERT INTO inventory_warehouse_stock
    (warehouse_id, store_id, product_id, variant_key, variant_id, quantity)
SELECT w.id, v.store_id, v.product_id, v.id, v.id, v.stock_quantity
FROM product_variants v
JOIN inventory_warehouses w
  ON w.store_id = v.store_id AND w.is_default = 1;

-- A movement may omit warehouse_id for backward compatibility. It is assigned
-- exactly once to the store's default warehouse before the row is considered
-- immutable.
CREATE TRIGGER trg_inventory_movement_assign_default_warehouse
AFTER INSERT ON inventory_movements
WHEN NEW.warehouse_id IS NULL
BEGIN
    UPDATE inventory_movements
    SET warehouse_id = (
      SELECT id FROM inventory_warehouses
      WHERE store_id = NEW.store_id AND is_default = 1
      LIMIT 1
    )
    WHERE id = NEW.id;
END;

CREATE TRIGGER trg_inventory_movement_validate_insert
BEFORE INSERT ON inventory_movements
BEGIN
    SELECT CASE WHEN NEW.warehouse_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM inventory_warehouses w
      WHERE w.id = NEW.warehouse_id AND w.store_id = NEW.store_id
        AND w.status = 'active'
    ) THEN RAISE(ABORT, 'Inventory warehouse does not belong to this store or is inactive') END;

    SELECT CASE WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM product_variants v
      WHERE v.id = NEW.variant_id AND v.product_id = NEW.product_id
        AND v.store_id = NEW.store_id
    ) THEN RAISE(ABORT, 'Inventory variant does not belong to this product and store') END;

    SELECT CASE WHEN NEW.reversal_of_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM inventory_movements original
      WHERE original.id = NEW.reversal_of_id
        AND original.store_id = NEW.store_id
        AND original.product_id = NEW.product_id
        AND original.variant_id IS NEW.variant_id
        AND original.reversal_of_id IS NULL
        AND NEW.quantity_change * original.quantity_change < 0
        AND abs(
          COALESCE((
            SELECT SUM(reversal.quantity_change)
            FROM inventory_movements reversal
            WHERE reversal.reversal_of_id = original.id
          ), 0) + NEW.quantity_change
        ) <= abs(original.quantity_change)
    ) THEN RAISE(ABORT, 'Invalid or excessive inventory reversal') END;
END;

-- Every newly inserted movement changes exactly one warehouse projection.
-- The conditional UPSERT prevents stock from becoming negative.
CREATE TRIGGER trg_inventory_movement_update_product_stock
AFTER INSERT ON inventory_movements
WHEN NEW.warehouse_id IS NOT NULL AND NEW.variant_id IS NULL
BEGIN
    INSERT INTO inventory_warehouse_stock
      (warehouse_id, store_id, product_id, variant_key, variant_id, quantity)
    VALUES (NEW.warehouse_id, NEW.store_id, NEW.product_id, '', NULL, NEW.quantity_change)
    ON CONFLICT(warehouse_id, product_id, variant_key)
    DO UPDATE SET quantity = quantity + NEW.quantity_change,
                  updated_at = CURRENT_TIMESTAMP
    WHERE inventory_warehouse_stock.quantity + NEW.quantity_change >= 0;

    SELECT CASE WHEN changes() = 0
      THEN RAISE(ABORT, 'Insufficient warehouse stock') END;
END;

CREATE TRIGGER trg_inventory_movement_update_variant_stock
AFTER INSERT ON inventory_movements
WHEN NEW.warehouse_id IS NOT NULL AND NEW.variant_id IS NOT NULL
BEGIN
    INSERT INTO inventory_warehouse_stock
      (warehouse_id, store_id, product_id, variant_key, variant_id, quantity)
    VALUES (NEW.warehouse_id, NEW.store_id, NEW.product_id, NEW.variant_id, NEW.variant_id, NEW.quantity_change)
    ON CONFLICT(warehouse_id, product_id, variant_key)
    DO UPDATE SET quantity = quantity + NEW.quantity_change,
                  updated_at = CURRENT_TIMESTAMP
    WHERE inventory_warehouse_stock.quantity + NEW.quantity_change >= 0;

    SELECT CASE WHEN changes() = 0
      THEN RAISE(ABORT, 'Insufficient warehouse variant stock') END;
END;

-- This is the only permitted UPDATE: one-time default-warehouse assignment
-- for legacy-compatible inserts that omitted warehouse_id.
CREATE TRIGGER trg_inventory_movement_append_only_update
BEFORE UPDATE ON inventory_movements
WHEN NOT (
    OLD.warehouse_id IS NULL
    AND NEW.warehouse_id IS NOT NULL
    AND NEW.id IS OLD.id
    AND NEW.store_id IS OLD.store_id
    AND NEW.product_id IS OLD.product_id
    AND NEW.variant_id IS OLD.variant_id
    AND NEW.movement_type IS OLD.movement_type
    AND NEW.quantity_change IS OLD.quantity_change
    AND NEW.reference_id IS OLD.reference_id
    AND NEW.notes IS OLD.notes
    AND NEW.created_by IS OLD.created_by
    AND NEW.created_at IS OLD.created_at
    AND NEW.unit_code IS OLD.unit_code
    AND NEW.source_type IS OLD.source_type
    AND NEW.source_id IS OLD.source_id
    AND NEW.idempotency_key IS OLD.idempotency_key
    AND NEW.effective_at IS OLD.effective_at
    AND NEW.posted_at IS OLD.posted_at
    AND NEW.reversal_of_id IS OLD.reversal_of_id
)
BEGIN
    SELECT RAISE(ABORT, 'Posted inventory movements are immutable');
END;

CREATE TRIGGER trg_inventory_movement_append_only_delete
BEFORE DELETE ON inventory_movements
BEGIN
    SELECT RAISE(ABORT, 'Posted inventory movements cannot be deleted');
END;
