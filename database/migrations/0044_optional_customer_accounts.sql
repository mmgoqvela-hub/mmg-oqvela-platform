-- MMG OQVELA
-- Migration 0044: Optional store-scoped customer accounts and persistent sessions.

CREATE TABLE store_customer_accounts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_identity_id TEXT NOT NULL UNIQUE,
  customer_phone_key TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_identity_id) REFERENCES store_customer_identities(id) ON DELETE CASCADE,
  UNIQUE (store_id,customer_phone_key),
  CHECK (length(customer_phone_key) BETWEEN 6 AND 30),
  CHECK (length(password_salt)=32),
  CHECK (length(password_hash)=64)
);

CREATE INDEX idx_store_customer_accounts_identity
  ON store_customer_accounts(store_id,customer_identity_id);

CREATE TABLE store_customer_account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (account_id) REFERENCES store_customer_accounts(id) ON DELETE CASCADE,
  CHECK (length(token_hash)=64)
);

CREATE INDEX idx_store_customer_account_sessions_active
  ON store_customer_account_sessions(token_hash,expires_at,revoked_at);

CREATE TABLE store_customer_auth_rate_limits (
  store_id TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  PRIMARY KEY (store_id,phone_hash),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CHECK (length(phone_hash)=64)
);
