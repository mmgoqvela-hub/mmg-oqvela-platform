-- MMG OQVELA
-- Migration 0036: Store pickup and delivery checkout options.
ALTER TABLE store_order_settings ADD COLUMN pickup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (pickup_enabled IN (0,1));
ALTER TABLE store_order_settings ADD COLUMN delivery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (delivery_enabled IN (0,1));
ALTER TABLE store_order_settings ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE store_orders ADD COLUMN fulfillment_method TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment_method IN ('pickup','delivery'));
ALTER TABLE store_orders ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
