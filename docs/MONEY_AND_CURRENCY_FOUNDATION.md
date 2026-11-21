# MMG OQVELA — Exact Money and Currency Foundation

Status: design and pure utility layer only. This document and helper do not migrate existing records, activate financial posting, or declare any currency policy legally or operationally approved.

## 1. Goals

- Eliminate JavaScript floating-point arithmetic from new authoritative monetary workflows.
- Preserve current API and historical data until a tested compatibility migration is approved.
- Keep currency identity, precision, symbol, legal status and redenomination policy configurable and versioned.
- Support the initial Syria operating model without hard-coding unverified currency assumptions.
- Make rounding explicit, reproducible and auditable.

## 2. Exact representation

The initial implementation primitive accepts a decimal amount as a string and a caller-supplied minor-unit exponent. It converts the value to an exact integer count of minor units using BigInt internally, then returns a JavaScript safe integer suitable for a SQLite INTEGER binding.

Constraints:
- No floating-point input is accepted.
- No exponent notation, grouping separators, whitespace or locale-formatted values are accepted.
- Excess fractional digits are rejected; this helper never rounds silently.
- The configured exponent is bounded to 0–9 as a technical safety limit, not as a statement about any currency.
- Values outside JavaScript's safe-integer range are rejected rather than silently losing precision.
- Formatting always emits the configured number of fractional digits.

The helper deliberately knows nothing about USD, SYP, ISO registration, symbols, redenomination or legal tender. Those are policy data and must be supplied by a separately governed currency registry.

## 3. Versioned currency policy

Before monetary records are migrated, define a currency registry with immutable versions. Each version should contain:
- Internal currency identity and externally recognized code, once verified.
- Display name and symbol, separately from the machine code.
- Minor-unit exponent and permitted input precision.
- Effective-from and optional effective-to timestamps.
- Status (draft, active, retired) and authoritative verification reference.
- Rounding policy identifier and policy version.
- Optional redenomination predecessor/successor mapping, only after authoritative confirmation.

Every posted monetary record must retain the exact currency-definition version used when it was created. Updating a current display label or exchange rate must not rewrite historical documents.

## 4. Exchange rates

An exchange rate is a dated, versioned quote, not a mutable global number. Capture:
- Base and quote currency-definition IDs.
- Exact decimal rate string and its direction.
- Source/provider and verification status.
- Effective timestamp and recorded timestamp.
- Rounding policy and policy version.
- Actor/approval metadata when manually entered.

A sale in SYP must retain its transaction currency and the rate snapshot used for any USD reporting or cost-basis conversion. Do not add USD and SYP balances together without an explicit conversion basis. Do not revise posted documents when a later rate is entered.

## 5. Existing REAL columns and compatibility

Migrations 0003 and 0020 currently use SQLite REAL for product prices, variant prices, order line amounts and order totals. Do not change their meaning in place.

The safe migration sequence is:
1. Inventory every read/write path, import/export and API contract that uses these columns.
2. Add versioned currency metadata and additive exact-value columns in a later migration, without removing or renaming legacy columns.
3. Freeze and document a deterministic conversion rule for historical REAL values, including treatment of binary floating-point artifacts and the original input/display precision where available.
4. Backfill in a controlled, repeatable job with before/after counts, exception reports and reconciliation totals. Never guess missing precision.
5. Dual-read/dual-write only behind an explicit compatibility layer and feature flag; define which representation is authoritative at each rollout stage.
6. Verify historical order totals against their line snapshots and investigate discrepancies before switching reads.
7. Retire legacy REAL columns only in a separately approved migration after all supported clients and reports have moved.

Do not convert a REAL value by multiplying it by a guessed power of ten. The original user-entered decimal may not be recoverable from the binary value alone.

## 6. Inventory and financial posting boundary

- Inventory quantities remain separate from money amounts.
- Inventory movements must reference source documents and be appended once per idempotency key.
- Purchase order drafts do not increase on-hand stock; posted receipts do.
- Stock cost layers and valuation method must be selected before reporting authoritative inventory value or COGS.
- Store sales payment records must remain separate from platform subscription payments.
- Payment receipts, invoice allocations, cash movements, revenue recognition and refunds are distinct events.
- Posted records are immutable; corrections use linked reversals or adjustment documents.

## 7. Syria-specific policy gates

The initial commercial workflow expects supplier procurement and supplier invoices in USD, while store sales may be in USD or the new Syrian pound. Before enabling production financial posting, verify from authoritative and current sources:
- The legally recognized currency code/name and effective dates.
- The applicable minor-unit precision and rounding rules.
- The exact redenomination treatment and conversion ratio, if any.
- Invoice, tax, customs and record-retention requirements.
- Whether dual display or any mandatory reporting currency is required.

Until those gates are satisfied, the platform may store draft policy configuration but must not activate assumed currency precision, redenomination conversion or legal/tax calculations.

## 8. Current code delivered with this foundation

- backend/finance/money.js: exact decimal-string to safe integer minor-unit conversion and deterministic formatting.
- tests/finance/money.test.js: precision, sign, zero-decimal, invalid syntax, overflow and no-silent-rounding tests.

These utilities are not yet wired into catalog or checkout routes. Existing routes still use legacy numeric fields until the additive schema and compatibility rollout is designed and tested.
