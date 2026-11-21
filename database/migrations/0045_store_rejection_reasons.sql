-- MMG OQVELA
-- Migration 0045: Store-managed customer order rejection reasons.

CREATE TABLE store_order_rejection_reasons (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  reason_text TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE (store_id,reason_text),
  CHECK (length(reason_text) BETWEEN 3 AND 160)
);

CREATE INDEX idx_store_order_rejection_reasons
  ON store_order_rejection_reasons(store_id,is_enabled,sort_order,created_at);
