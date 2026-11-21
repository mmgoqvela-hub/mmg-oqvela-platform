-- MMG OQVELA
-- Migration 0030: store pricing tiers and immutable product cost basis.
-- Margin percentages are markups on acquisition cost, expressed in basis points.
-- This migration does not alter legacy catalog/order REAL prices.

CREATE TABLE store_pricing_settings (
    store_id TEXT PRIMARY KEY,
    pricing_mode TEXT NOT NULL DEFAULT 'manual'
      CHECK (pricing_mode IN ('manual', 'cost_plus_margin')),
    cost_currency TEXT NOT NULL DEFAULT 'USD'
      CHECK (cost_currency = 'USD'),
    rounding_increment_minor_units INTEGER NOT NULL DEFAULT 1
      CHECK (rounding_increment_minor_units BETWEEN 1 AND 1000000),
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE store_pricing_tiers (
    store_id TEXT NOT NULL,
    tier_code TEXT NOT NULL
      CHECK (tier_code IN ('retail', 'wholesale', 'bulk_wholesale')),
    min_quantity INTEGER NOT NULL
      CHECK (min_quantity BETWEEN 1 AND 1000000000),
    profit_margin_bps INTEGER
      CHECK (profit_margin_bps IS NULL OR profit_margin_bps BETWEEN 0 AND 1000000),
    is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (store_id, tier_code),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    CHECK (tier_code != 'retail' OR min_quantity = 1)
);

CREATE TABLE product_cost_versions (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    cost_currency TEXT NOT NULL DEFAULT 'USD' CHECK (cost_currency = 'USD'),
    cost_minor_units INTEGER NOT NULL
      CHECK (cost_minor_units BETWEEN 0 AND 9007199254740991),
    cost_source TEXT NOT NULL
      CHECK (cost_source IN ('manual', 'import', 'purchase_receipt')),
    source_reference TEXT,
    effective_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, idempotency_key),
    FOREIGN KEY (product_id, store_id)
      REFERENCES products(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (variant_id, store_id)
      REFERENCES product_variants(id, store_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (cost_source != 'purchase_receipt' OR source_reference IS NOT NULL)
);

CREATE INDEX idx_product_cost_latest
  ON product_cost_versions(store_id, product_id, variant_id, effective_at DESC, created_at DESC);

CREATE TRIGGER trg_product_cost_variant_matches_product
BEFORE INSERT ON product_cost_versions
WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants v
    WHERE v.id = NEW.variant_id
      AND v.product_id = NEW.product_id
      AND v.store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cost variant must belong to the selected product and store');
END;

CREATE TRIGGER trg_product_cost_versions_no_update
BEFORE UPDATE ON product_cost_versions
BEGIN
    SELECT RAISE(ABORT, 'Product cost versions are immutable; append a new cost version');
END;

CREATE TRIGGER trg_product_cost_versions_no_delete
BEFORE DELETE ON product_cost_versions
BEGIN
    SELECT RAISE(ABORT, 'Product cost versions cannot be deleted');
END;

CREATE TABLE product_tier_margin_overrides (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    tier_code TEXT NOT NULL,
    profit_margin_bps INTEGER NOT NULL
      CHECK (profit_margin_bps BETWEEN 0 AND 1000000),
    min_quantity INTEGER
      CHECK (min_quantity IS NULL OR min_quantity BETWEEN 1 AND 1000000000),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, product_id, variant_id, tier_code),
    FOREIGN KEY (product_id, store_id)
      REFERENCES products(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id, store_id)
      REFERENCES product_variants(id, store_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id, tier_code)
      REFERENCES store_pricing_tiers(store_id, tier_code) ON DELETE RESTRICT
);

CREATE TRIGGER trg_product_tier_override_variant_matches_product
BEFORE INSERT ON product_tier_margin_overrides
WHEN NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants v
    WHERE v.id = NEW.variant_id
      AND v.product_id = NEW.product_id
      AND v.store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Pricing override variant must belong to the selected product and store');
END;

-- Existing stores start in manual-price mode. No unverified cost or margin
-- is invented and no existing product/order price is changed.
INSERT INTO store_pricing_settings (store_id)
SELECT id FROM stores;

INSERT INTO store_pricing_tiers
  (store_id, tier_code, min_quantity, profit_margin_bps, is_enabled)
SELECT s.id, tiers.tier_code, tiers.min_quantity, NULL, 0
FROM stores s
CROSS JOIN (
  SELECT 'retail' AS tier_code, 1 AS min_quantity
  UNION ALL SELECT 'wholesale', 2
  UNION ALL SELECT 'bulk_wholesale', 10
) tiers;

CREATE TRIGGER trg_store_pricing_defaults_after_store_insert
AFTER INSERT ON stores
BEGIN
    INSERT INTO store_pricing_settings (store_id) VALUES (NEW.id);
    INSERT INTO store_pricing_tiers
      (store_id, tier_code, min_quantity, profit_margin_bps, is_enabled)
    VALUES
      (NEW.id, 'retail', 1, NULL, 0),
      (NEW.id, 'wholesale', 2, NULL, 0),
      (NEW.id, 'bulk_wholesale', 10, NULL, 0);
END;

CREATE TRIGGER trg_store_pricing_settings_currency_guard
BEFORE UPDATE OF cost_currency ON store_pricing_settings
WHEN NEW.cost_currency != 'USD'
BEGIN
    SELECT RAISE(ABORT, 'Cost currency must remain USD until additional currency precision is verified');
END;
