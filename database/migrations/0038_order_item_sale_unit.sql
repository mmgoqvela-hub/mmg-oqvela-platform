-- MMG OQVELA
-- Migration 0038: preserve the sale unit used when each order item was placed.
ALTER TABLE store_order_items ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK (sale_unit IN ('piece','kg'));
