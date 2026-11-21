-- MMG OQVELA
-- Migration 0041: immutable store expenses and cashbox movement ledger.

INSERT OR IGNORE INTO permissions(id,code,description) VALUES
  ('perm-finance-expenses-read','finance.expenses.read','View store expenses'),
  ('perm-finance-expenses-manage','finance.expenses.manage','Record store expenses'),
  ('perm-finance-cashbox-read','finance.cashbox.read','View cashbox movements'),
  ('perm-finance-cashbox-manage','finance.cashbox.manage','Record cashbox deposits and withdrawals');

CREATE TABLE store_expenses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  expense_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 2 AND 80),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 2 AND 500),
  amount REAL NOT NULL CHECK(amount > 0 AND amount <= 1000000000000),
  currency TEXT NOT NULL CHECK(currency IN ('USD','SYP')),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','digital','shamcash','bank_transfer')),
  payment_reference TEXT,
  cash_session_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id,expense_number),
  UNIQUE(store_id,idempotency_key),
  UNIQUE(id,store_id),
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(cash_session_id,store_id) REFERENCES pos_cash_sessions(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((payment_method='cash' AND cash_session_id IS NOT NULL) OR
        (payment_method!='cash' AND cash_session_id IS NULL)),
  CHECK(payment_reference IS NULL OR length(payment_reference)<=160)
);
CREATE INDEX idx_store_expenses_store_date ON store_expenses(store_id,created_at DESC);
CREATE INDEX idx_store_expenses_store_currency ON store_expenses(store_id,currency,created_at DESC);

CREATE TABLE pos_cash_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cash_session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('deposit','withdrawal','expense')),
  amount REAL NOT NULL CHECK(amount > 0 AND amount <= 1000000000000),
  currency TEXT NOT NULL CHECK(currency IN ('USD','SYP')),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 2 AND 500),
  source_type TEXT NOT NULL CHECK(source_type IN ('manual','expense')),
  source_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id,idempotency_key),
  FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY(cash_session_id,store_id) REFERENCES pos_cash_sessions(id,store_id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((movement_type='expense' AND direction='out' AND source_type='expense' AND source_id IS NOT NULL)
     OR (movement_type!='expense' AND source_type='manual' AND source_id IS NULL))
);
CREATE INDEX idx_pos_cash_movements_session ON pos_cash_movements(store_id,cash_session_id,created_at);

CREATE TRIGGER trg_store_expense_cash_session_validate
BEFORE INSERT ON store_expenses
WHEN NEW.payment_method='cash'
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_cash_sessions cs
    WHERE cs.id=NEW.cash_session_id AND cs.store_id=NEW.store_id
      AND cs.status='open' AND cs.currency=NEW.currency
  ) THEN RAISE(ABORT,'Cash expense requires an open matching cash session') END;
END;

CREATE TRIGGER trg_store_expense_cash_movement
AFTER INSERT ON store_expenses
WHEN NEW.payment_method='cash'
BEGIN
  INSERT INTO pos_cash_movements
    (id,store_id,cash_session_id,direction,movement_type,amount,currency,description,
     source_type,source_id,idempotency_key,created_by)
  VALUES(lower(hex(randomblob(16))),NEW.store_id,NEW.cash_session_id,'out','expense',
    NEW.amount,NEW.currency,NEW.description,'expense',NEW.id,
    'expense:'||NEW.id,NEW.created_by);
END;

CREATE TRIGGER trg_pos_cash_movement_session_validate
BEFORE INSERT ON pos_cash_movements
WHEN NEW.source_type='manual'
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM pos_cash_sessions cs
    WHERE cs.id=NEW.cash_session_id AND cs.store_id=NEW.store_id
      AND cs.status='open' AND cs.currency=NEW.currency
  ) THEN RAISE(ABORT,'Cash movement requires an open matching cash session') END;
END;

CREATE TRIGGER trg_store_expenses_no_update
BEFORE UPDATE ON store_expenses
BEGIN
  SELECT RAISE(ABORT,'Expense records are immutable; record a correcting entry');
END;
CREATE TRIGGER trg_store_expenses_no_delete
BEFORE DELETE ON store_expenses
BEGIN
  SELECT RAISE(ABORT,'Expense records cannot be deleted');
END;
CREATE TRIGGER trg_pos_cash_movements_no_update
BEFORE UPDATE ON pos_cash_movements
BEGIN
  SELECT RAISE(ABORT,'Cashbox movements are immutable; record a correcting movement');
END;
CREATE TRIGGER trg_pos_cash_movements_no_delete
BEFORE DELETE ON pos_cash_movements
BEGIN
  SELECT RAISE(ABORT,'Cashbox movements cannot be deleted');
END;
