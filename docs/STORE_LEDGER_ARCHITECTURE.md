# MMG OQVELA — Unified Inventory and Financial Ledger Architecture

Status: target architecture / design specification. No migration or production ledger activation is implied by this document.

## 1. Design objective

Create one coherent operational record across stock, purchases, sales, payments, cash, expenses, customer/supplier balances and accounting. Each posted event must be traceable to its source document and must not create duplicate or contradictory balances.

## 2. Existing foundation and constraints

The repository already has:
- `products`, `product_variants`, `inventory_movements` in migration 0003.
- Store orders, order items, inventory reservation/restoration triggers and payment/order lifecycle records in migration 0020.
- Database-level lifecycle guards in migration 0022.

The product and variant `stock_quantity` fields are currently maintained alongside inventory movements. This is a useful read projection, but the existing schema is not yet a complete purchasing, costing, cash or double-entry accounting ledger. New work must audit and reuse this foundation rather than create a competing inventory movement history.

## 3. Inventory ledger

- Every stock-changing event produces an immutable movement with store, warehouse when available, product, variant, quantity delta, reason, source document, actor, effective time and recorded time.
- Purchase receipt, sale/reservation, cancellation restoration, customer return, supplier return, transfer, damage, expiry, count adjustment and opening balance are distinct movement reasons.
- Keep on-hand, reserved, in-transit and available quantities conceptually separate. Available-to-promise is derived from the applicable stock states and reservations.
- Quantity projections may be maintained transactionally for performance, but they must reconcile to the movement ledger.
- Corrections are compensating movements; never edit or delete posted movement history.
- Warehouse transfers require dispatch and receipt events; in-transit stock is not available at either endpoint.
- Inventory valuation (FIFO/weighted average or another approved method) must be chosen and tested before cost-of-goods-sold or stock valuation is treated as authoritative.

## 4. Financial journal and subledgers

Introduce a controlled posting service and, when accounting is enabled, a chart of accounts and double-entry journal.

Conceptual records:
- Journal batch/header: store, source type/id, posting status, effective date, recorded timestamp, actor, idempotency key and policy/version metadata.
- Journal lines: account, debit/credit, transaction currency and amount, functional/reporting amount where configured, party, branch/cost center and rate snapshot.
- Payment records and allocations: actual received/paid amount, currency, method, reference, payer/payee, settlement status and links to one or more invoices.
- Cash/bank movements: account/drawer, direction, currency, amount, source, transfer pair, cashier/actor and reconciliation state.
- Customer and supplier subledger entries: invoices, payments, advances, credit notes, returns, write-offs and adjustments.
- Expense documents and payments remain separate: incurring an expense creates an obligation/expense event; paying it creates a cash/bank movement and settles the payable.

Names and exact columns must follow the existing repository conventions after a full schema/API audit. This conceptual list is not a ready-to-run migration.

## 5. Posting rules

- A posted event has a stable source type and source ID and can be posted only once.
- Idempotency is enforced by database uniqueness as well as route logic.
- Journal entries balance when double-entry accounting is enabled.
- Posted documents and journal lines are immutable. Correct errors with linked reversal/adjustment documents.
- Payment receipt is not automatically revenue recognition; payment allocation is not a second receipt; transfers are not income or expense.
- Revenue, receivable settlement, COGS, inventory movement, taxes and cash movement are distinct accounting effects.
- Sales, supplier bills, payments, returns, refunds and expenses post through a shared service, not route-specific arithmetic.
- For multi-record operations, use a verified D1 atomic batch/transaction boundary. External side effects require an outbox/retry pattern; do not claim distributed atomicity.

## 6. Currency and Syrian operating policy

- Supplier purchases and supplier invoices use USD as the agreed default procurement currency.
- Sales may be USD or the new Syrian pound; store each document's transaction currency explicitly.
- Keep raw balances separate by currency. Never add USD and SYP without an explicit converted reporting view.
- Every conversion stores source/target currency, rate value, rate ID/version, effective timestamp, source, rounding rule and reporting basis.
- Historical invoices, payments and journal entries retain their captured rate. A new exchange rate never rewrites posted history.
- Currency code, symbol, minor-unit precision and any redenomination mapping must be verified from authoritative sources before production activation. Do not guess a conversion ratio.
- Imported costs paid in another currency require an explicit authorized conversion into the USD procurement/cost basis.

## 7. Reconciliation

Provide repeatable reconciliation checks for:
- Product/variant quantity projections against inventory movements.
- Stock reservations against open order items and their lifecycle.
- Payment transactions against allocations and invoice balances.
- Cash drawers and bank accounts against cash/bank movements and counted close.
- Customer/supplier balances against their subledger documents.
- Journal debits and credits, control accounts and subledger totals.
- Exchange differences and converted reporting views.

Discrepancies create actionable alerts with source references. Never silently change posted history to make totals match.

## 8. Security and audit

- Enforce store/tenant ownership and action-level permissions on every endpoint.
- Separate view, draft, submit, approve, post, pay, refund, reverse, export and period-reopen permissions.
- Sensitive changes require actor, time, reason and before/after audit data.
- Prevent direct editing of balances or posted totals.
- Apply period locks and controlled reopen approvals before financial close.
- Exports are permission-checked, tenant-scoped and logged.

## 9. Implementation order

1. Audit all migrations, routes, triggers and current order/payment/inventory behavior.
2. Document existing invariants and identify missing source links before adding tables.
3. Add tests for idempotency, rollback, tenant isolation, stock reconciliation and order cancellation.
4. Implement supplier receipt and purchasing documents with inventory movements.
5. Implement payment allocations, cash/bank movements and expenses.
6. Implement journal posting and chart-of-accounts mapping.
7. Add costing/valuation and reconciled financial reports.
8. Add period close, audit and controlled correction workflows.

No production migration, live financial posting or deployment should occur until migration tests, CI and explicit rollout checks pass.

## 10. Repository audit findings (2026-11-21)

The current schema and route implementation were inspected before proposing new tables. These are observed repository facts, not assumptions about a deployed database.

### Existing records to reuse

- Migration 0003 defines `products`, `product_variants`, `product_images` and `inventory_movements`. The movement table already records store, product, optional variant, movement type, signed quantity, reference, notes, actor and creation time.
- Migration 0020 defines `store_orders`, `store_order_items`, `store_order_events` and checkout settings. Order items snapshot product name, SKU, quantity, unit price, line total and currency.
- Migration 0020 uses database triggers to decrement product/variant stock and insert a `sale` inventory movement when an order item is inserted. Cancellation restores quantities and writes `return` movements.
- Migration 0022 strengthens cancellation restoration by deriving the restored amount from the original `sale` movements, and enforces order/payment lifecycle transitions and consistency.
- Migration 0007's `payments` table is linked to `store_subscriptions`; it is platform subscription-payment data, not a store checkout payment ledger. Do not reuse it for store sales receipts.
- The current order route validates public order input, obtains authoritative product/variant prices from D1, inserts order headers and lines through `DB.batch`, and reports paid order totals grouped by currency.

### Important gaps and risks confirmed by inspection

- Product and variant prices, order line amounts and order totals currently use SQLite `REAL`; this is not an acceptable final authoritative money representation for the planned financial ledger. Existing data must be migrated with a deterministic, tested conversion plan; do not change column meaning in place without compatibility review.
- Store orders currently represent one currency per order and have no separate payment transaction/allocation rows. A Sham Cash order is recorded as pending with a transaction reference and sender name; cash on delivery is unpaid. This is not a general receipt, split-tender, refund or settlement ledger.
- The repository currently has no store-level supplier invoices, purchase receipts, expense documents, cash drawers, bank accounts, customer/supplier subledgers, chart of accounts or double-entry journal tables in migrations 0001-0026.
- `inventory_movements` has no warehouse, unit-of-measure, cost layer, effective business date, source type, idempotency key or reversal link. It must be extended compatibly rather than replaced by a second movement table.
- Stock quantity columns are projections updated by existing triggers/routes. New purchasing, returns, transfers and adjustments must update the projection and append the matching movement within one verified D1 transaction boundary.
- Existing order cancellation currently restores reserved stock. A future fulfillment/dispatch model must distinguish reservation, shipment/consumption and customer return; do not reinterpret historical `sale` movements without a migration and regression plan.
- The existing order report sums paid order totals, which is a cash/payment-status-oriented sales view, not a reconciled revenue, margin or profit statement. Do not relabel it as net profit.

## 11. Safe implementation sequence after the audit

1. Preserve all current tables, triggers, route contracts and historical rows. Add regression fixtures for the current order reservation, cancellation restoration, duplicate Sham Cash reference and lifecycle guards before financial schema work.
2. Design a versioned currency/amount representation and a backfill/compatibility strategy for current `REAL` prices and order snapshots. Confirm currency precision and rounding policy before production activation; use integer minor units only where the currency precision is verified, otherwise use a documented exact-decimal representation.
3. Add warehouse and inventory source metadata compatibly, plus append-only update/delete protection for posted movement records. Introduce new movement reasons through a migration that preserves all existing allowed values and historical rows.
4. Implement supplier purchase orders and receipts first. A posted receipt creates inventory movements and updates stock projections exactly once; draft/ordered quantities do not become on-hand stock. Supplier bills and payments remain distinct.
5. Implement store payment transactions and allocations independently of platform subscription `payments`. Support multiple tenders and partial settlement without duplicating revenue or cash receipt.
6. Add cash/bank accounts and movements, expenses, customer/supplier balances and journal posting only after the source documents and allocation rules are testable.
7. Introduce costing (beginning with an explicitly chosen and tested method) before reporting COGS, inventory valuation or gross margin as authoritative.
8. Expose dashboard KPIs only when their underlying records reconcile. Keep unsupported KPIs clearly unavailable.

### Mandatory acceptance tests before enabling financial posting

- Applying all migrations from an empty SQLite database succeeds and `PRAGMA foreign_key_check` is clean.
- Existing order creation reserves stock and creates one movement per line; any failed line rolls back the entire order batch.
- Cancellation restores only the quantity reserved by that order, exactly once; repeated cancellation or retry cannot restore stock twice.
- A duplicate store-scoped Sham Cash transaction reference is rejected without creating a second order.
- Store payment rows cannot be confused with platform subscription payments.
- Cross-store product, supplier, warehouse, payment, journal and allocation references are rejected at the database boundary.
- Every posted source document is idempotent; reversal creates linked compensating records and does not delete or rewrite the original.
- Debits equal credits for every posted journal batch; multi-currency balances are never summed as raw unlike-currency amounts.
- All financial and inventory operations have deterministic rollback tests against the actual D1-supported batch/transaction behavior.

No new financial migration or production posting was created by this audit. The next implementation unit should be the backward-compatible currency/amount foundation and inventory movement hardening, each with migration and route tests before purchase or accounting screens are exposed.

