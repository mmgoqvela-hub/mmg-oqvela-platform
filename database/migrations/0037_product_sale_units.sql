-- MMG OQVELA
-- Migration 0037: per-product sale unit (piece or kilogram).
-- Existing products remain piece-based for backward compatibility.
ALTER TABLE products ADD COLUMN sale_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK (sale_unit IN ('piece','kg'));
