-- MMG OQVELA
-- Migration 0026: Persistent per-store visual customization settings.
ALTER TABLE stores ADD COLUMN customization_json TEXT NOT NULL DEFAULT '{}';
