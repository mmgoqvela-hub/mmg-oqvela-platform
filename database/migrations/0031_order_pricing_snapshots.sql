-- MMG OQVELA
-- Migration 0031: immutable pricing decision snapshots on customer order lines.
-- Legacy rows remain explicitly manual and are not recalculated.

ALTER TABLE store_order_items ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (pricing_mode IN ('manual','cost_plus_margin'));
ALTER TABLE store_order_items ADD COLUMN pricing_tier_code TEXT
  CHECK (pricing_tier_code IS NULL OR pricing_tier_code IN ('retail','wholesale','bulk_wholesale'));
ALTER TABLE store_order_items ADD COLUMN cost_version_id TEXT
  REFERENCES product_cost_versions(id) ON DELETE RESTRICT;
ALTER TABLE store_order_items ADD COLUMN cost_currency TEXT
  CHECK (cost_currency IS NULL OR cost_currency='USD');
ALTER TABLE store_order_items ADD COLUMN cost_minor_units INTEGER
  CHECK (cost_minor_units IS NULL OR cost_minor_units BETWEEN 0 AND 9007199254740991);
ALTER TABLE store_order_items ADD COLUMN profit_margin_bps INTEGER
  CHECK (profit_margin_bps IS NULL OR profit_margin_bps BETWEEN 0 AND 1000000);
ALTER TABLE store_order_items ADD COLUMN rounding_increment_minor_units INTEGER
  CHECK (rounding_increment_minor_units IS NULL OR rounding_increment_minor_units BETWEEN 1 AND 1000000);

CREATE TRIGGER trg_order_item_cost_snapshot_required
BEFORE INSERT ON store_order_items
WHEN NEW.pricing_mode='cost_plus_margin'
BEGIN
  SELECT CASE WHEN NEW.pricing_tier_code IS NULL OR NEW.cost_version_id IS NULL
    OR NEW.cost_currency!='USD' OR NEW.cost_minor_units IS NULL
    OR NEW.profit_margin_bps IS NULL OR NEW.rounding_increment_minor_units IS NULL
    THEN RAISE(ABORT,'Automatic pricing snapshot is incomplete') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM product_cost_versions cv
    WHERE cv.id=NEW.cost_version_id AND cv.store_id=NEW.store_id
      AND cv.product_id=NEW.product_id
      AND (cv.variant_id=NEW.variant_id OR (cv.variant_id IS NULL AND NEW.variant_id IS NULL))
      AND cv.cost_currency=NEW.cost_currency AND cv.cost_minor_units=NEW.cost_minor_units
  ) THEN RAISE(ABORT,'Order cost snapshot does not match its cost version') END;
END;
