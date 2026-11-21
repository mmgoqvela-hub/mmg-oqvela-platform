-- MMG OQVELA
-- Migration 0029: versioned currency precision registry and store currency gates.
-- Historical REAL amounts are deliberately left untouched in this migration.

CREATE TABLE currency_precision_versions (
    currency_code TEXT NOT NULL
      CHECK (length(currency_code) = 3 AND currency_code = upper(currency_code)),
    version INTEGER NOT NULL CHECK (version >= 1),
    precision_exponent INTEGER
      CHECK (precision_exponent IS NULL OR precision_exponent BETWEEN 0 AND 9),
    verification_status TEXT NOT NULL
      CHECK (verification_status IN ('pending', 'verified')),
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    source_reference TEXT,
    evidence_note TEXT,
    verified_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (currency_code, version),
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE RESTRICT,
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (
      (verification_status = 'pending' AND precision_exponent IS NULL AND verified_by IS NULL)
      OR
      (verification_status = 'verified' AND precision_exponent IS NOT NULL
       AND source_reference IS NOT NULL AND length(trim(source_reference)) > 0)
    )
);

CREATE TRIGGER trg_currency_precision_version_sequence
BEFORE INSERT ON currency_precision_versions
WHEN NEW.version != COALESCE((
    SELECT MAX(version) + 1 FROM currency_precision_versions
    WHERE currency_code = NEW.currency_code
), 1)
OR EXISTS (
    SELECT 1 FROM currency_precision_versions previous
    WHERE previous.currency_code = NEW.currency_code
      AND previous.valid_from >= NEW.valid_from
)
BEGIN
    SELECT RAISE(ABORT, 'Currency precision versions must be sequential and chronological');
END;

CREATE TRIGGER trg_currency_precision_versions_immutable_update
BEFORE UPDATE ON currency_precision_versions
BEGIN
    SELECT RAISE(ABORT, 'Currency precision versions are immutable; append a new version');
END;

CREATE TRIGGER trg_currency_precision_versions_immutable_delete
BEFORE DELETE ON currency_precision_versions
BEGIN
    SELECT RAISE(ABORT, 'Currency precision versions cannot be deleted');
END;

-- USD precision is established. SYP remains explicitly pending until its
-- current legal definition, precision and effective date are verified.
INSERT INTO currency_precision_versions
  (currency_code, version, precision_exponent, verification_status,
   valid_from, source_reference, evidence_note)
VALUES
  ('USD', 1, 2, 'verified', '2026-11-21',
   'ISO 4217 currency code and minor-unit convention',
   'Two decimal places; used for exact USD purchase-order amounts.'),
  ('SYP', 1, NULL, 'pending', '2026-11-21',
   NULL,
   'Precision, current legal currency definition and redenomination/effective-date rules require authoritative verification before activation.');

CREATE TABLE store_currency_settings (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    precision_version INTEGER NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    is_default_sale_currency INTEGER NOT NULL DEFAULT 0
      CHECK (is_default_sale_currency IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (store_id, currency_code),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (currency_code, precision_version)
      REFERENCES currency_precision_versions(currency_code, version) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_store_one_default_sale_currency
  ON store_currency_settings(store_id)
  WHERE is_default_sale_currency = 1 AND is_enabled = 1;

CREATE TRIGGER trg_store_currency_requires_verified_precision
BEFORE INSERT ON store_currency_settings
WHEN NOT EXISTS (
    SELECT 1 FROM currency_precision_versions cp
    WHERE cp.currency_code = NEW.currency_code
      AND cp.version = NEW.precision_version
      AND cp.verification_status = 'verified'
)
BEGIN
    SELECT RAISE(ABORT, 'Store currency precision must be verified before activation');
END;

CREATE TRIGGER trg_store_currency_update_requires_verified_precision
BEFORE UPDATE OF currency_code, precision_version, is_enabled, is_default_sale_currency
ON store_currency_settings
WHEN NEW.is_enabled = 1 AND NOT EXISTS (
    SELECT 1 FROM currency_precision_versions cp
    WHERE cp.currency_code = NEW.currency_code
      AND cp.version = NEW.precision_version
      AND cp.verification_status = 'verified'
)
BEGIN
    SELECT RAISE(ABORT, 'Store currency precision must be verified before activation');
END;
