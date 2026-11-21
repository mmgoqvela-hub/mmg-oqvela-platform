-- MMG OQVELA
-- Migration 0032: point-of-sale access and tier-selection permissions.
-- Owners/admins inherit these permissions; staff receive only explicitly assigned capabilities.

INSERT OR IGNORE INTO permissions (id,code,description) VALUES
  ('perm-pos-access','pos.access','Access the store point of sale and create sales'),
  ('perm-pos-wholesale','pos.wholesale','Apply wholesale pricing in the point of sale'),
  ('perm-pos-bulk-wholesale','pos.bulk_wholesale','Apply bulk-wholesale pricing in the point of sale'),
  ('perm-pos-price-override','pos.price_override','Override a point-of-sale unit price with an audited reason');
