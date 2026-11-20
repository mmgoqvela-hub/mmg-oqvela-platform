-- MMG OQVELA
-- Migration 0014: Storefront template selection

ALTER TABLE stores
ADD COLUMN template_key TEXT NOT NULL DEFAULT 'modern'
CHECK (template_key IN ('modern', 'classic', 'minimal', 'boutique', 'tech'));

CREATE INDEX idx_stores_public_slug_status
ON stores(slug, status);
