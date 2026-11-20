-- MMG OQVELA
-- Migration 0015: Store team permission catalogue

INSERT OR IGNORE INTO permissions (id, code, description) VALUES
  ('perm-catalog-read', 'catalog.read', 'View store categories and products'),
  ('perm-catalog-manage', 'catalog.manage', 'Create and manage categories, products and variants'),
  ('perm-inventory-read', 'inventory.read', 'View stock levels and inventory movements'),
  ('perm-inventory-manage', 'inventory.manage', 'Record and manage inventory movements'),
  ('perm-team-manage', 'team.manage', 'Manage store team membership and roles');
