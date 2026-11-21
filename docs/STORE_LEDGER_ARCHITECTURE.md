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
