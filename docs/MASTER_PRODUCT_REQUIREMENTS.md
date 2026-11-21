# MMG OQVELA — Master Product Requirements & Delivery Register

Last reviewed: 2026-11-20
Repository: mmgoqvela-hub/mmg-oqvela-platform

This document is the working source of truth for preserving previously agreed requirements. It distinguishes confirmed decisions from implementation status and items whose detailed behavior must be recovered or specified before coding. Do not silently drop, replace, or invent requirements.

## 1. Product vision and identity

- Parent company / technology group: **MMG OQVELA**.
- Product: an extensible, multi-tenant SaaS business platform, not a single-store website.
- The platform should support independent business stores and later independent digital products/modules without rebuilding the foundation.
- A product name such as NEXORA was discussed as provisional; it is not a confirmed final public brand. Do not rename the product or company without explicit approval.
- Keep the existing repository and deployment architecture. Do not restart the project or replace the current implementation wholesale.

## 2. Confirmed platform-wide requirements

### 2.1 Multi-language
- Arabic and English are required across the entire platform.
- Arabic is the default language.
- Correct RTL for Arabic and LTR for English.
- A visible language switch.
- Persist the user's selected language.
- Translate all static and dynamic content: forms, labels, navigation, validation errors, success/error notices, admin screens, subscription screens, store interfaces and future modules.
- Localize dates, numbers and currencies.
- Keep architecture ready for additional languages.
- Do not translate user-entered content (store names, descriptions, product names, etc.) automatically.

### 2.2 Multi-account / multi-store tenancy
- One account can manage multiple independent stores.
- Every store has its own identity, settings, subscription and data boundary.
- First release uses path-based store URLs: `/s/{slug}` (initially discussed under a provisional project domain); architecture should allow future subdomains and custom domains.
- Strict tenant isolation is mandatory in every API, query, file operation and UI.
- Store data must never be accessible by guessing/changing another store's ID.
- Do not issue another trial to an account when it creates another store.
- There is an unresolved ownership workflow in the historical decisions: central administration was described as creating stores, while the current code allows account owners to create additional stores. Preserve current behavior until this workflow is reconciled against the user's original approval; do not silently change production behavior.

### 2.3 Roles and permissions
- Team managers who are ordinary store members may manage staff and custom roles only within their own permission ceiling: they cannot create/grant/assign permissions they do not themselves hold. Owners and account admins retain full store-role administration. Automated regression coverage protects against privilege escalation through role creation.
- Account-level roles include owner, admin and member.
- Store-level staff/roles and permission assignments are part of the foundation.
- Permissions must be enforced server-side, not merely hidden in the UI.
- A normal member must not gain owner/admin capabilities by modifying request data.
- Platform administration is separate from store/account roles, with restricted super-admin operations.
- No employee-count limit was specified in the retrieved decisions; do not invent one.

### 2.4 Platform administration
- Central administration is responsible for platform-wide configuration and oversight.
- Manage stores/accounts and platform status.
- Manage subscription plans and trial policy.
- Configure Sham Cash payment details and whether payment requests are enabled.
- Review subscription payment requests and approve/reject them with audit/history.
- View administrative activity logs.
- Central platform announcements/advertisements must be controlled centrally.
- A centrally controlled footer is required and must not be removable by an individual store.
- Administrative access must be protected by dedicated platform-admin authorization.

### 2.5 Subscription and trial rules
- The free trial is granted once per account, not once per store.
- Platform administration controls whether trial is enabled and its duration.
- Default trial duration is 14 days.
- The first eligible store receives the account's trial; creating another store must not grant a second trial.
- Each store has its own subscription.
- Paid subscriptions use **شام كاش** (display spelling with a space).
- A store receives one free trial per account; platform administration controls whether trials are enabled and their duration. The platform must notify the account/store owner before the trial expires and when it expires. After expiry, the storefront must be suspended/hidden until a paid subscription is approved; the owner must be prompted to choose and pay for a plan.
- When a plan is selected, show the exact amount due and the centrally configured Sham Cash recipient/payment instructions.
- The store owner/admin submits the Sham Cash transfer transaction number and the sender name as shown in Sham Cash; these two text fields are sufficient proof for review. A receipt image is optional (not required) and may be attached when secure R2 storage is configured. A submitted proof is only a pending request and must never activate a paid subscription automatically.
- Platform administration reviews each pending request and explicitly approves or rejects it. Rejection requires a reason; approval activates the subscription and issues/marks its invoice through the existing atomic approval workflow.
- Payment proof images must be stored securely with restricted access; public storefronts must never expose payment evidence. R2 storage/bucket configuration is not yet available and must be completed before image-proof upload is represented as operational.
- Store owner/admin can submit a subscription request; ordinary members cannot.
- Enforce at most one pending/active/suspended subscription per store. Expired/cancelled/rejected requests may be followed by a new request.
- Approval/rejection must be atomic and auditable; rejection requires a reason.
- Subscription alerts must cover pending/expiry/suspension/renewal states. Authenticated store subscription UI warns the owner up to three days before both trial and paid-subscription expiry, and displays a blocking expiry notice directing the owner to submit a new Sham Cash payment request after expiry. A persistent, authenticated per-user notification inbox now stores notifications, unread state and read timestamps, with per-user authorization and deduplication support. The dashboard now displays the inbox in Arabic/English, shows unread counts, supports refresh, marks individual notifications read, and can mark all as read. Renewal remains manual; no automatic charges are made.
- Automatic renewal behavior was requested as a capability/notification topic, but payment authorization and operational rules need to be specified before enabling automatic charges. Do not charge automatically or represent it as enabled without explicit approval.
- No real payments, paid-plan activation, or production financial changes during tests.

### 2.6 Communication and marketing
- Direct WhatsApp contact is required.
- Platform-wide advertisements/announcements are centrally managed and cannot be removed by individual stores.
- The centrally controlled footer must remain visible and cannot be deleted by stores.
- Subscription, suspension and renewal notifications are required.
- Delivery channels, scheduling, user targeting, consent and message templates require detailed design before implementation.

### 2.7 Security, privacy and operations
- Secure authentication and session handling. Login attempts are persistently throttled per normalized email/IP pair after five failed attempts in a 15-minute window; automated tests now cover the lockout response, Retry-After header and cross-origin rejection.
- Password protection and login abuse/rate limiting.
- Strict tenant isolation.
- Server-side role/permission checks.
- Protection against cross-site request abuse and unsafe input.
- Audit trail for administrative and sensitive business operations.
- Terms of use and privacy policy.
- Risk/security controls and incident-relevant activity records.
- File management and explicit storage limits/quotas.
- Comprehensive tests before launch.
- No secrets committed to GitHub; no production credentials exposed in logs or UI.

## 3. Store/business modules and current evidence

The original high-level vision includes managing business stores and their operations. The current database migration 0003 defines a catalog/inventory foundation:
- Product categories and nested categories.
- Products (physical, digital, service).
- Product variants, SKUs and attributes.
- Product images.
- Stock quantities and inventory movements (initial, purchase, sale, return, adjustment, damage).

Migration 0001 also defines store members, roles, permissions and role-permission assignments.

Important: database tables are not a completed feature. These modules still require authenticated tenant-scoped APIs, validation, UI, permission enforcement, audit coverage and tests. Do not claim them complete merely because schema tables exist.

Other detailed business modules (such as order processing, customer management, point-of-sale, accounting, tax, shipping, supplier workflows, and advanced analytics) are not sufficiently specified in the retrieved approved decisions. Keep them as discovery items; do not invent their workflows or mark them as agreed/implemented.

## 4. Technology and delivery constraints

- HTML, CSS and JavaScript.
- Cloudflare Workers for backend/API.
- Cloudflare D1 for relational data.
- Cloudflare R2 for object/file storage.
- Cloudflare Pages/Worker static assets for delivery.
- GitHub repository: `mmgoqvela-hub/mmg-oqvela-platform`.
- Development workflow includes Termux on Android and GitHub.
- Keep using the existing repository, migrations and Cloudflare deployment configuration.
- Start with free services. Do not enable paid services or incur costs without the user's explicit approval.
- Preserve existing production data. Never reset or replay already-applied D1 migrations.
- Make changes in small, testable steps and preserve working features.

## 5. Current repository implementation snapshot (2026-11-20)

### Implemented in code / schema (not all have a complete UI)
- User registration/login, secure password hashing and sessions.
- Login-attempt rate limiting.
- Account/store identity and account membership foundation.
- Store detail update and tenant membership checks.
- One-time account trial settings and activation flow.
- Subscription plans, store subscriptions, Sham Cash transaction references and review flow.
- Subscription history and invoices for subscription payments. Subscription payment review supports Sham Cash transaction references, sender names, and admin approval/rejection; receipt-image evidence (optional, pending secure R2 storage), transactional in-app lifecycle notifications for trial start and Sham Cash payment submission/approval/rejection are implemented, along with a daily scheduled reminder job for three-day, one-day and expired subscriptions. External-channel expiry messaging remains incomplete; visit-triggered subscription-panel notices are also implemented. The account subscription history now reports an active record whose expiry timestamp has passed as effectively `expired`, without mutating stored production subscription data.
- Central Sham Cash settings.
- Central trial settings.
- Platform-admin activity-log API and visible admin log.
- Catalog/inventory tables and tenant-integrity triggers. Inventory movement API enforces `inventory.manage` for writes and `inventory.read` for history; members with read-only inventory permission cannot mutate stock. Movement type direction, disabled tracking, nonnegative stock, atomic stock/history writes, and variant-aware history are covered by API tests.
- Tenant-scoped catalog APIs for category listing/creation/update/deletion, product listing/creation/update/archive, product variant creation/update/deactivation, and inventory movement history/stock adjustments. Product and variant creation record initial stock; stock changes are guarded against negative quantities and concurrent updates. Category deletion now refuses to proceed while products or child categories remain linked, preserving catalog relationships; the UI exposes category editing (name, description, parent, sort order) and guarded deletion. Product editing UI covers core details, price, currency, category, status, inventory tracking and featured state. Automated API tests cover tenant access, permissions, category deletion safety and inventory integrity.
- Per-store storefront template selection persisted in D1 with eleven presets: modern, classic, minimal, boutique, tech, market, restaurant, fashion, electronics, beauty and luxury. Each preset has its own responsive styling and selection preview; owners/admins can choose a template and open the public store preview without changing catalog data. The six business-focused presets were added with server-side allowlisting and automated validation tests.
- Public storefront route `/s/{slug}` with a tenant-safe public API, subscription-active visibility check, category filters, product search, product/variant display, responsive layouts, Arabic/English and RTL/LTR.
- Optional per-store WhatsApp contact number with server-side international-number validation and a public WhatsApp contact link on the storefront.
- Role/permission tables, seeded catalog/inventory/team permission codes, store team API and bilingual team-management UI. Store owners/admins can add existing active platform accounts as staff, assign built-in or custom roles, update/suspend access, and create/edit/delete custom roles. Permissions are checked server-side for catalog and inventory endpoints; no employee-count cap is imposed.

### Partially implemented / requires audit or completion
- Arabic/English switch and translation coverage are substantially implemented and have automated coverage for visible Arabic text, dynamic authentication/validation messages, RTL/LTR, and locale formatting. Per-user language preference API and migration 0013 are now in the repository; migrations 0013 (language preference) and 0014 (storefront templates) have not yet been applied to production, and full browser/device verification remains pending.
- Multi-store workflows and the unresolved distinction between platform-created stores and account-owner-created stores.
- Store staff and custom role management are now implemented for existing active platform accounts. Email-based invitation delivery, invitation acceptance, and adding users who do not yet have platform accounts remain incomplete; no email provider has been configured.
- Product/category/variant/image/inventory management end-to-end: category and product create/edit UI, guarded category deletion, variant creation/listing/editing/activation/deactivation and initial variant stock are exposed in the store catalog UI; server-side tenant and permission checks exist. Category deletion is blocked while products or child categories are linked. R2-backed product image upload/management remains incomplete. Variant-level stock movements are supported in the store UI and recorded with variant names in inventory history. Inventory writes require `inventory.manage`; history reads require `inventory.read`. Movement direction, disabled tracking, nonnegative stock, atomic stock/history writes and read-only member restrictions have automated API coverage. Latest product/category UI and inventory permission/movement test workflows pass CI; full browser/device verification remains pending.
- Storefronts: eleven selectable design templates and public product browsing are implemented. A persistent browser-local customer cart supports product/variant selection, quantity controls, stock-aware limits, per-store cart isolation and currency-grouped totals. Customer checkout supports both cash on delivery and Sham Cash, with store-configured payment methods, sender name and transaction reference for Sham Cash. Tenant-scoped store reports now summarize order statuses, confirmed paid revenue by currency and top paid products for 7/30/90-day periods. Orders are persisted with server-calculated prices, stock reservation, unique per-store transaction references, owner/staff permission checks, manual payment review, order-state transitions, event history and owner notifications. Full browser/device verification remains pending.
- Subscription lifecycle notifications and renewal rules. Trial and paid-subscription reminders and expiry notices are now surfaced in the authenticated store subscription panel when the owner visits: a warning appears within three days of expiry and an expired-subscription message explains that the public storefront is hidden and directs the owner to request a new paid plan. These subscription-panel notices are visit-triggered. In addition, a daily UTC Worker scheduled event now writes persistent inbox notifications three days and one day before expiry and after expiry. Transactional database triggers also notify the account owner when a trial starts and when a Sham Cash payment request is submitted, approved or rejected. External email/push/WhatsApp delivery and secure receipt-image storage remain incomplete.
- Centrally managed bilingual mandatory footer: platform super-admin can configure Arabic and English footer text in platform settings; the public storefront API supplies it and the storefront renders it in the selected language. Store owners cannot override or remove it. Bilingual platform-wide announcements are implemented with scheduling, activation controls, audit logging and storefront rendering; paid advertising campaigns/targeting/analytics remain incomplete.
- Per-store WhatsApp contact configuration and public contact link are implemented. A centrally configured international WhatsApp support number is now managed by the platform super-admin and shown separately on every public storefront.
- R2 file storage, file access policies and quotas.
- Terms, privacy and risk/security management screens.
- Full business audit logs beyond platform-admin settings.
- Order security regression tests now verify foreign-store order IDs cannot be mutated and order item/event histories are fetched only under the requested store ID. - Tenant-isolation regression tests now cover cross-store category parents, product categories, variants, images and staff-role assignment at database level, plus cross-account store-creation rejection. Broader API coverage for every future module remains required.

### Not evidenced as implemented
- Customer accounts and private customer order-history/status tracking are not implemented; do not expose order details publicly without a secure verification and rate-limiting design.
- External delivery/shipping provider integrations and customer-facing delivery tracking are not implemented; delivery workflows beyond the entered delivery address and store-managed order states need explicit requirements.
- Basic store reports are implemented for the last 7, 30 or 90 days: order counts by lifecycle status, confirmed paid revenue grouped by currency, and top products from paid/non-cancelled orders. Advanced analytics, exports and forecasting remain future work.
- A complete staff invitation/onboarding workflow.
- Persistent notification inbox storage, authenticated read/unread API and bilingual dashboard UI are implemented; transactional lifecycle notifications for trial start and Sham Cash payment submission/approval/rejection, plus a daily UTC scheduled job for three-day, one-day and expired subscription reminders, are implemented in code. External email/push/WhatsApp delivery integrations and notification preferences remain incomplete. A separate centrally managed support WhatsApp contact is exposed on public storefronts. The scheduled job will only execute after a deployment that includes the cron trigger; no production deployment or migration has been performed.
Do not represent these as finished until implemented and tested.

## 6. Delivery order (preserve dependencies)

1. Complete bilingual foundation with the per-user preference migration applied safely, then verify every visible/dynamic string, errors, RTL/LTR, persistence across devices and locale formatting.
2. Finish security and tenant-isolation audit for every existing API; add negative tests.
3. Finish account/store lifecycle and reconcile store-creation authority.
4. Complete invitation/onboarding delivery and audit coverage for staff membership; the existing team and custom-role API/UI and catalog/inventory permission enforcement are implemented.
5. Complete catalog management UI refinements, R2-backed product media upload/storage and R2-backed media upload/storage and remaining inventory workflow refinements; variant-level stock movements are now implemented and tested.
6. Finish storefront template previews, accessibility, product media, and public-store verification at `/s/{slug}`.
7. Customer checkout, order persistence, store-side order management and basic paid-sales reports are implemented for the approved cash-on-delivery + Sham Cash methods; next verify browser/device behavior, accessibility, stock concurrency and order lifecycle edge cases. Customer accounts/order history and external delivery integrations remain separate discovery items.
8. Central admin overview, user/account/store management, platform-admin management and protected super-admin transfer APIs/UI are implemented with audit logging and CI coverage. Remaining central admin work: paid advertising campaigns/targeting/analytics and externally delivered notification workflows.
9. Complete subscription lifecycle alerts, renewal controls and notification preferences.
10. Implement R2 file management and quotas.
11. Complete terms/privacy, risk controls, audit coverage and operational safeguards.
12. Run comprehensive unit, integration, migration, security, accessibility, bilingual and end-to-end tests.
13. Deploy only after CI passes; verify production health and user-facing behavior without creating real payments or altering live business data.

## 7. Definition of done

A feature is complete only when:
- Backend behavior and database constraints exist where required.
- Tenant ownership and role permissions are checked server-side.
- Arabic and English UI, validation, dynamic messages and RTL/LTR behavior are covered.
- Loading, empty, error and success states are implemented.
- Tests cover normal, unauthorized, cross-tenant, invalid-input and failure cases.
- CI passes and deployment is confirmed separately.
- No existing agreed feature or production data is removed or broken.

## 8. Open decisions — do not guess

- Final public product name (NEXORA was provisional; MMG OQVELA remains the parent/company identity).
- Exact authority and workflow for creating additional stores (central admin vs account owner).
- Exact business workflows beyond catalog/inventory and subscription foundation.
- Automatic renewal payment semantics and authorization.
- External notification channels (email/push/WhatsApp), consent, templates and scheduling.
- Storage quotas and any paid overage policy.
- Which future modules belong in the first public release versus later phases.

### Account, subscription and notification authorization audit (2026-11-20)
- Trial activation is restricted server-side to an active account owner, requires the centrally enabled trial policy and the active zero-price trial plan, and atomically claims the account's one-time trial. A unique partial index on `store_subscriptions.trial_account_id` prevents a second trial for the same account.
- Trial status lookup requires active membership in the requested account; cross-account requests return not found.
- Subscription billing history is restricted to store owners/admins. Subscription payment review and plan administration require an active platform `super_admin`; cross-origin requests are rejected.
- Notification inbox, unread count, mark-one-read and mark-all-read queries are scoped to the authenticated user's ID. Inbox responses are non-cacheable and page size is capped.
- Added regression assertions in `tests/subscriptions/integrity.test.js` and `tests/notifications/inbox.test.js` for these authorization boundaries. These tests verify route/query guards and migration constraints; they complement, but do not replace, live browser and deployed-environment verification.

### Order and inventory lifecycle hardening (2026-11-20)
- Added migration `0022_order_lifecycle_guards.sql` with database-level guards for allowed order-status transitions and payment-status transitions.
- D1 now independently prevents completing unpaid orders, progressing Sham Cash orders before payment approval, rejecting non-Sham-Cash payments, refunding a payment unless the order is cancelled, and reopening terminal/cancelled states through an invalid transition.
- Existing stock reservation and cancellation-restoration triggers remain transactional; cancellation now restores quantities from the actual `sale` reservation movements rather than the product's current tracking flag, so a fully reserved item is restored even if tracking was disabled after reservation. The terminal-state guard prevents a second cancellation/restoration.
- Added regression assertions in `tests/orders/orders.test.js` for the new lifecycle guards. Migration is in the repository only; it has not been applied to production. Full D1/browser concurrency verification remains pending.


### Public checkout audit hardening — 2026-11-20
- Audited public storefront checkout, API validation, server-side price calculation, tenant scoping, payment configuration, stock reservation and lifecycle enforcement.
- Fixed a browser race: repeated form submissions are now ignored while a checkout is in flight, and cart controls are temporarily disabled so cart changes cannot be lost when the response clears the submitted cart.
- Added a regression test for in-flight submission protection and cart-control locking.
- Public checkout now applies a D1-backed limit of five attempts per store/IP hash per ten-minute window; raw IPs are not persisted and stale buckets are pruned by the daily scheduler. A durable idempotency key for safe replay of successful checkout submissions remains incomplete, so repeated requests below the rate limit may still create separate cash-on-delivery orders.
- No production migration or deployment performed.


### Central footer and public service requests — 2026-11-20
- Added migration 0024_platform_service_requests.sql for a central inbox covering support, advertising, store setup, website design and general contact requests.
- Added a same-origin public submission endpoint with bounded input, contact validation, supported request-type allowlisting and a honeypot field. Requests are stored with Arabic/English source-language metadata.
- Added super-admin-only listing and status/notes update endpoints; status changes create administrative audit entries.
- Added footer entry points, an about-us dialog, a bilingual service request form and a central-admin review list.
- These changes are committed to the repository and require CI, remote D1 migration, deployment and live browser verification before they are active in production.
- WhatsApp and email delivery are not yet integrated; the initial release stores requests in the central admin inbox.


### Public service request abuse protection — 2026-11-20
- Added migration 0025 with a dedicated public service-request rate-limit table.
- The public request endpoint allows five submissions per client IP hash per ten-minute window and returns HTTP 429 after the limit.
- Only SHA-256 IP hashes are persisted; scheduled cleanup removes expired records older than two days.
- Automated test coverage verifies the sixth request is rejected. CI passed 176 tests and validated the full SQLite migration set.
- Production rollout is pending a manual deployment workflow run after this commit.


## 9. Integrated retail, purchasing, inventory, accounting and delivery requirements

The store-management direction is expanded into a professional, integrated retail/ERP operations suite. This is a confirmed product direction from the owner; detailed jurisdiction-specific accounting, tax and payment rules must still be configured and verified before production use. These requirements are not a claim that the modules are already implemented.

### 9.1 Product, service and master-data management

- Full create, view, edit, archive/restore and permission-controlled deletion workflows for products, services, categories, brands, units, variants, barcodes, price lists and bundles/kits where enabled.
- Preserve historical references: a product used in a posted invoice, purchase, sale or stock movement must not be hard-deleted. Use archive/deactivation; corrections must be recorded as auditable adjustments.
- Support product types and per-product controls: stock tracked/not tracked, saleable/purchasable, tax category, unit of measure, SKU, multiple barcodes, variant attributes, minimum stock, reorder level, preferred supplier, cost and selling-price history.
- Support unit conversions (piece, pack, box, kg, litre, etc.) only through explicit conversion definitions; prevent incompatible units from being mixed.
- Support price lists and customer-specific/wholesale pricing only through authorized, dated rules; retain the price actually applied to every transaction.
- Support optional batches/lots, expiry dates, serial numbers and warranty identifiers for relevant industries. Do not force these fields on every store.

### 9.2 Suppliers and procurement

- Supplier records: legal/display name, contacts, addresses, tax identifiers where applicable, opening balance, credit terms, payment due dates, currency, notes, documents and active status.
- Purchase workflow: draft purchase order, approval where required, supplier order, partial/full goods receipt, supplier invoice/bill, supplier return/debit note, payment and reconciliation.
- Allow direct receipt without a purchase order only when the store's policy permits it; capture the reason and actor.
- Purchase order, goods receipt and supplier invoice are distinct records. Receiving goods updates stock; entering a supplier bill creates/updates the payable; paying the supplier reduces the payable and cash/bank balance. Never treat these as one ambiguous action.
- Handle partial deliveries, backorders, damaged/short/extra quantities, price differences, freight and other landed costs with explicit allocation rules.
- Track supplier balances, amounts due, overdue bills, advances, credit notes, payments and a full statement/ledger.
- Supplier returns must reference the original receipt/bill where possible, record returned quantities and condition, adjust stock and supplier payable/credit correctly, and preserve the original documents.

### 9.3 Warehouses and inventory control

- Multiple warehouses/branches per store, with warehouse-scoped stock, permissions and reporting.
- Stock receiving, sales issue, customer returns, supplier returns, transfers, transfer-in-transit, adjustments, damage, loss, expiry, samples/consumption and opening balances as distinct movement reasons.
- Transfers require dispatch and receipt confirmation; stock in transit must not appear available in either warehouse. Support partial receipt and discrepancy resolution.
- Stock counts: create a count session by warehouse/category/location, freeze or snapshot the count basis, record counted quantities, compare expected vs actual, require reason/approval for differences, then post adjustment movements. Preserve count sheets and before/after quantities.
- Reorder thresholds, low-stock alerts, suggested purchase quantities and stock valuation reports.
- Prevent negative stock by default; any override must be an explicit store policy, permission-gated, reasoned and auditable. Recheck stock atomically at posting.
- Optional bin/shelf locations and stock reservations for online orders, POS and delivery orders. Reservations reduce available-to-promise quantity without prematurely treating reserved stock as sold.
- Optional batch/expiry FEFO picking, serial tracking and recalls for relevant business types.
- Maintain a movement ledger as the source of truth; never allow a user to edit a stock number directly without a corresponding movement record.
- Define and document the store's inventory valuation method (for example weighted average or FIFO) before enabling accounting valuation. Cost method changes must be controlled, prospective or migrated through an auditable process; never silently rewrite historical costs.

### 9.4 Sales, invoices, returns and customer balances

- Sales channels include public storefront, POS touch/manual/scanner, and authorized staff-created orders. All channels use the same product, price, stock, customer, payment and accounting services.
- Support quotations/estimates, sales orders, delivery/pick/pack, sales invoices, receipts, customer returns, credit notes, refunds and exchanges as distinct linked documents where applicable.
- Support cash sale and approved credit sale (pay later) with customer credit limits/terms when enabled. Credit sales create receivables; they are not marked paid until payment is actually received and allocated.
- Invoices need unique store-scoped numbers, configurable series/prefixes, issue/due dates, seller/buyer details, line items, units, discounts, taxes/fees, currency, totals, payment status, notes and print/PDF layout.
- Support partial payments, multiple payment allocations, customer advances, on-account balances and customer statements. Do not double-count a payment across invoices.
- Sales returns and refunds must reference the original sale/invoice, validate returnable quantities, record condition/restock decision, reverse the appropriate revenue/tax/receivable/payment effects and create auditable stock movements.
- Preserve immutable snapshots of product description, SKU, unit, quantity, price, discount, tax and currency on posted documents so later catalog edits do not rewrite history.
- Draft documents may be edited; posted/issued documents must be corrected through cancellation, reversal, return or credit-note workflows according to permissions and local requirements—not by destructive editing.

### 9.5 Customers, debts and collections

- Customer profiles with contacts, addresses, notes, optional tax data, price tier, credit limit, payment terms and opening balance.
- Customer account ledger showing invoices, payments, advances, credit notes, returns, write-offs and adjustments with running balance.
- Aging reports for current, 1–30, 31–60, 61–90 and older overdue receivables (configurable ranges).
- Record collection/payment receipts, payment method/reference, received-by staff member, date/time and allocation to one or more invoices.
- Support installment schedules and reminders only when enabled; overdue reminders must respect communication consent and configured channels.
- Debt write-off or balance adjustment requires elevated permission, reason, supporting note/document and audit entry. Never erase debt by editing the customer balance.
- Customer statements and printable receipts must reconcile with the underlying ledger.

### 9.6 Cash, banks, expenses and financial obligations

- Track cash drawers/register sessions, cash in/out, opening float, cash sales, refunds, supplier payments, expenses, transfers and counted closing balance as separate movements.
- Support multiple cash boxes, bank accounts and payment clearing accounts with currency-specific balances. Never combine unlike currencies into one raw balance.
- Cashier shift close: expected cash, counted cash, variance, explanation, reviewer and immutable close record. Permission-controlled corrections use adjustment entries.
- Expense management: categories, vendor/payee, date, amount/currency, tax where applicable, payment source, recurring flag, attachment/reference, approval status, cost center/project and notes.
- Distinguish an expense incurred (payable) from the payment of that expense. Track unpaid expenses, partial payments, due dates, advances and employee reimbursements.
- Record other payables/receivables and due obligations with party, source document, due date, installments, status and settlement history.
- Support transfers between cash/bank accounts with paired debit/credit movements and reconciliation references; a transfer must not be counted as income or expense.
- Track employee advances, reimbursements and commissions only as separately permissioned sub-ledgers; full payroll, statutory deductions and employment compliance require a separate approved specification.
- Provide daily cash flow, account balances, expense summaries and payment-method reconciliation.

### 9.7 Delivery, fulfillment and drivers

- Configurable delivery zones/areas, fees, free-delivery thresholds, estimated windows, pickup/click-and-collect and delivery availability per store.
- Delivery order lifecycle: awaiting preparation, picking, packed, ready, assigned, picked up, in transit, delivered, failed, returned/cancelled. Store-specific labels may vary, but transitions must be guarded.
- Capture delivery address/contact/instructions, fee payer, delivery fee, assigned driver/courier, assignment time, proof/status and customer notifications where enabled.
- Support in-house drivers and manual external courier records first; external carrier integrations are separate adapters and must not be assumed.
- Track driver cash collection, COD amount, delivery fee/commission, cash handed over, settlement date and discrepancy. Driver collections must reconcile to the sale and cash ledger without duplicate revenue.
- Handle partial fulfillment, failed delivery, customer unavailable, reschedule, return-to-store and delivery cancellation with stock/payment effects defined.
- Provide delivery dispatch board and filters by status, zone, driver and date. Live GPS tracking is not implied unless separately implemented and consented.

### 9.8 Discounts, promotions and pricing controls

- Fixed and percentage discounts at line or invoice level, coupon/promo codes, scheduled campaigns, quantity/bundle offers, customer-group pricing and authorized manual discounts.
- Define stacking/exclusion order, eligible products/categories/customers/channels, start/end times, usage limits, minimum spend and currency rules.
- Enforce role-based maximum discount limits and approval for overrides; record original price, discount, approver, reason and final price.
- Prevent negative totals and unintended discount/tax compounding. Calculate all authoritative values server-side and store immutable transaction snapshots.
- Keep promotion configuration separate from posted transaction history; editing a promotion must not alter past invoices.

### 9.9 Accounting foundation and financial reporting

- Build an integrated, auditable accounting layer rather than deriving financial truth from dashboard totals. Posted business events should create balanced journal entries through a controlled posting service.
- Use a configurable chart of accounts and double-entry ledger, with journal date, reference/source document, currency, debit/credit, account, party/cost center and posting actor.
- Map sales, cost of goods sold, inventory, customer receivables, supplier payables, tax liabilities, cash/bank, expenses, returns, discounts and payment clearing to accounting entries.
- Enforce balanced journal entries, idempotent posting, period controls and immutable posted entries. Corrections use reversing/adjusting entries with references.
- Support fiscal periods, period close/reopen permissions and audit history. Multi-currency requires explicit exchange-rate source/date, functional currency and realized/unrealized gain/loss policy before activation.
- Reports: sales by period/channel/product/category/cashier; purchases by supplier/product; gross profit and margin; cost of goods sold; stock on hand/valuation/aging; inventory movement; receivables/payables aging; customer/supplier statements; expenses; cash flow; trial balance; profit and loss; balance sheet; tax summaries where configured.
- Separate cash received, revenue recognized, outstanding receivables and gross profit. Do not label sales totals as profit.
- Tax rates, invoice numbering, fiscal documents and accounting policies must be configurable and validated for each target jurisdiction. Do not claim statutory/fiscal compliance by default.

### 9.10 Documents, approvals, audit and permissions

- Unified document center for quotations, purchase orders, goods receipts, supplier bills, sales invoices, receipts, credit/debit notes, returns, expenses, delivery manifests, stock counts and payment proofs.
- Numbering must be unique within store/document type/series and concurrency-safe. Voided numbers remain traceable; never reuse posted invoice numbers.
- Role/permission matrix at action level: view, create, edit draft, submit, approve, post, pay, refund, void, export and manage settings. Sensitive permissions may be separated (for example cashier can sell but cannot refund or edit cost).
- Approval limits for purchases, expenses, discounts, stock adjustments, credit limits, write-offs, refunds and cash variances.
- Immutable audit history for create/edit/approve/post/cancel/return/refund/payment/stock movement and permission changes, including actor, timestamp, before/after or event payload, reason and linked document.
- Exports and document access must be tenant-scoped, permission-checked, rate-limited and logged. Uploaded documents require durable private storage and access controls before being offered as operational.

### 9.11 Cross-module integrity and platform architecture

- Each store is an isolated legal/operational ledger boundary. Every record, query, file, report, number series, stock location and idempotency key is scoped to the owning store/tenant.
- Use one authoritative transaction/posting service for storefront orders, POS, purchases, inventory, payments, receivables/payables and accounting. Do not maintain disconnected duplicate balances.
- Posting workflows must be atomic: document state, stock movements/reservations, account ledger, payment allocation and audit events either commit together or fail together.
- Use integer minor units or a safe decimal strategy for money; never binary floating-point arithmetic for financial totals. Store currency codes and precision explicitly.
- Use idempotency keys, concurrency checks, database constraints and server-side recalculation for all financial/stock-changing commands.
- Draft, approved, posted, partially paid, paid, partially fulfilled, completed, cancelled and reversed states must have explicit allowed transitions. Never permit arbitrary status mutation.
- Support data export and backups appropriate to the platform's operational capabilities; define retention and restore procedures before production launch.
- Keep optional capabilities modular by industry and plan, but do not let plan restrictions bypass data integrity, security or audit controls.

### 9.12 Delivery phases and open accounting decisions

Implement in dependency order: (1) product/unit/warehouse foundations and movement ledger; (2) suppliers, purchase orders, receipts and supplier bills; (3) sales invoices, customer accounts, receipts and returns; (4) cash/bank/expenses and payables/receivables; (5) delivery and driver settlements; (6) discounts/promotions; (7) accounting journal and financial statements; (8) advanced costing, batch/serial/expiry, reconciliation and integrations.

Before implementing accounting postings or fiscal documents, obtain the store's target country/jurisdiction, functional currency, tax setup, inventory valuation method, fiscal-year rules and document-numbering policy. Defaults may be provided as drafts but must not be silently treated as legal/accounting advice or compliance.

### 9.13 Current implementation status

The repository currently has catalog, variants, basic stock movements, storefront orders/checkout, order lifecycle guards and basic paid-sales reports as described in earlier sections. It does not yet provide the integrated purchasing, supplier, multi-warehouse, customer debt, expense, cash/bank, delivery dispatch, full invoicing/returns or double-entry accounting suite described above. Existing tables or basic order totals must not be represented as completion of these modules.


### 9.14 Syria-first operation, dual-currency pricing, exchange rates, customs and taxes

Syria is the initial target market for store operations. The platform must support the Syrian operating context without hard-coding assumptions that would prevent later expansion to other jurisdictions. These requirements are a product direction; they do not constitute confirmation of current Syrian tax, customs, currency or legal rules.

#### Currency model and display

- Support simultaneous USD and the **new Syrian pound** in store catalogs, price lists, purchases, sales, invoices, receipts, expenses, supplier/customer balances, cash drawers, bank/payment accounts and reports.
- Use explicit currency identifiers and configured display names/symbols/precision. Do not assume the official ISO code, minor-unit precision, redenomination conversion factor or legal display rules for the new Syrian pound until verified against authoritative current sources and configured by platform administration.
- A store must be able to set its functional/reporting currency and its permitted transaction currencies. The initial Syria setup should make USD and the new Syrian pound available, while preserving the ability to add currencies later.
- Never add unlike currency amounts together as if they were the same currency. Keep separate currency balances and show converted totals only with the exchange rate, rate timestamp and target currency clearly identified.
- Support invoices and payments in either currency, and mixed-currency settlement only through an explicit conversion/settlement record that captures both amounts, both currencies, the applied rate, any fee/difference and the approving actor.
- Preserve the original transaction currency and amount permanently. A later exchange-rate change must not rewrite posted invoices, receipts, supplier bills, payments, historical reports or debts.

#### Exchange-rate management

- Provide a central platform exchange-rate service and store-level rate policy/settings. Rates must be time-stamped, versioned, auditable and scoped by currency pair and effective time.
- Authorized administrators can enter or update the USD-to-new-Syrian-pound rate repeatedly as market conditions change. Support manual rate entry first; any external rate feed is a replaceable adapter and must not be assumed reliable, official or enabled without verification and explicit configuration.
- Keep a rate history; never overwrite the only copy of a previous rate. Record source (manual/provider), entered by, effective-from time, recorded-at time, and optional note/reference.
- Define which rate is used for each purpose: product price conversion, purchase costing, invoice settlement, accounting translation and reporting. Do not silently reuse one rate for every purpose.
- A store may use a platform-published rate, a store-specific rate, or an authorized override according to permissions and policy. Record the exact rate/version applied to every price calculation and posted transaction.
- Support configurable rounding rules and price endings by currency (for example rounding to a configured increment); show the unrounded calculation and final rounded price in audit details.
- Protect against stale or missing rates: warn or block affected conversions when the rate exceeds a configured age, rather than silently applying an outdated value.

#### Automatic product-price recalculation

- Each product/variant price or price-list entry must declare its source currency and pricing mode. At minimum support: (a) source price maintained in USD with SYP price calculated from the selected USD/SYP rate; (b) source price maintained in new Syrian pounds with USD equivalent calculated from the selected rate; and (c) independently maintained fixed prices in both currencies.
- For rate-linked prices, a new approved exchange-rate version recalculates the derived-currency price automatically according to the store's configured rounding and pricing rules. The store owner can choose whether recalculation is immediate, scheduled, or requires approval before publishing.
- Independently fixed prices must not be changed by exchange-rate updates. A manually overridden derived price becomes fixed/locked until the owner explicitly re-enables rate linking.
- Support price protection rules: minimum/maximum permitted change, change threshold requiring approval, margin floor, price ceilings, excluded products/categories, and a preview of affected products before publishing.
- Recalculation must be idempotent, batched safely, tenant-scoped and auditable. A rate update must not partially publish a mixture of old/new prices. Keep price history with old/new amounts, currencies, rate version, calculation rule, actor/system job and publication time.
- Do not change prices on already-created carts or posted orders/invoices. At checkout, clearly define and enforce the current price snapshot and expiry/refresh behavior for a cart when a rate update occurs.
- Provide a dry-run preview showing how many prices will change and the before/after amounts before an authorized rate update is published. Notify store owners of material changes where notifications are enabled.

#### Taxes, customs duties and landed costs

- Provide configurable tax profiles by jurisdiction, product/service tax category, transaction type and effective date. Support inclusive/exclusive tax pricing, exemptions, zero-rated/out-of-scope treatment where legally applicable, multiple tax components and documented rounding.
- Tax configuration must support rates, fixed charges, thresholds, exemptions, registration details, tax-inclusive display and invoice fields as configurable data; do not hard-code a single Syrian rate or presume every store/product is taxable in the same way.
- Provide customs/import-cost records for imported goods: customs duty, import taxes, clearance/broker fees, freight, insurance, port/transport charges and other landed costs. Allow costs to be allocated to received goods by approved allocation methods (quantity, value, weight, volume or manual allocation) and preserve source documents and calculation details.
- Distinguish recoverable taxes from non-recoverable taxes and distinguish customs/landed costs capitalized into inventory cost from operating expenses, according to a reviewed accounting policy.
- Keep tax and customs rules effective-dated and versioned. Changing a rate or rule affects future eligible transactions only; historical posted documents retain their original rule snapshot.
- Provide reports for collected/payable tax, tax by category/period, import/customs costs and landed cost by item/batch. Statutory filings, tax invoices, customs declarations and legal compliance must remain disabled/unclaimed until jurisdiction-specific requirements are verified by a qualified local professional and configured.
- Support store-specific tax/customs exemptions or special treatments only with required evidence, expiry dates, permissions and audit history.

#### Syria-specific configuration and safeguards

- Platform administration must be able to configure the initial Syria jurisdiction profile and update it without a code deployment, while retaining previous versions and the date each configuration became effective.
- Keep the legal currency name, public display label, currency code, precision, conversion/redenomination factors and invoice display rules as separately configurable fields. Do not silently convert old SYP records into the new Syrian pound or infer a redenomination ratio.
- Store owners must see the active exchange rate, its source and last update time, and whether each product price is linked, fixed or manually overridden.
- All rate changes, automatic price recalculations, manual overrides, tax/customs changes and approvals must create immutable audit events.
- Before live financial use, validate the current Syrian currency conventions, tax rules, customs treatment, required invoice content, fiscal numbering and record-retention obligations with authoritative local sources and qualified local advice. The platform must not claim compliance merely because configurable fields exist.


### 9.15 Mandatory USD procurement and dual-currency sales policy for Syria

For the initial Syria-focused store configuration, the following is the default operating rule. It is distinct from the platform's ability to support other countries and currencies later.

- All merchandise procurement is recorded in USD: supplier purchase orders, supplier invoices/bills, goods-receipt purchase cost, supplier credit balances and supplier payments are denominated in USD. The original supplier document amount and currency must be retained.
- Inventory acquisition cost and the base product cost are maintained in USD. Additional import/customs/freight/clearance costs must be recorded with their original currency and converted/allocated into the USD inventory cost using an explicitly recorded rate and approved costing policy. Do not silently discard non-USD source costs.
- Store sales may be priced and completed in USD or the new Syrian pound, according to the store's enabled currencies and the customer's selected payment currency. A single sale must have a clearly defined invoice currency; mixed tender is permitted only through explicit multi-payment settlement lines.
- When a product's selling price is maintained as a USD base price, the new-Syrian-pound display/charge amount is derived from the approved store rate and configured rounding/markup policy. A store may explicitly maintain a separate fixed SYP price where permitted; the system must show whether a price is USD-linked, SYP-fixed or manually overridden.
- A sale paid in SYP must retain: the SYP invoice/receipt amount, USD reference/base amount, exact USD/SYP rate and version, rate timestamp/source, rounding result, payment amount/currency and any settlement difference. The system must not record the same sale as two revenues.
- Supplier payable ledgers and purchase analytics remain USD-based for this Syria policy. Customer receivables and cash/bank balances retain their actual transaction currencies; cross-currency settlement creates an explicit conversion record rather than mutating the underlying debt.
- Cost of goods sold and gross margin are calculated from the USD inventory cost basis. For a SYP sale, convert the sale value to the reporting/functional currency using the transaction's captured rate, then compare it with USD cost under a documented accounting translation policy. Reports must disclose the translation basis and must not compare raw SYP revenue directly with USD cost.
- Exchange-rate movements after a posted sale or purchase must not rewrite historical cost, revenue, debt, supplier balances or profit. Any realized exchange difference is recorded separately through the configured accounting policy.
- If a supplier invoice is received in a currency other than USD, the system must flag it as an exception requiring an authorized conversion/approval into the USD procurement ledger; it must not silently accept it as an ordinary USD invoice.

### 9.16 Professional store dashboard and operational command center

Each store owner/admin needs a polished, comprehensive, responsive dashboard that acts as the store's command center. Dashboard data must be calculated from authoritative posted documents, inventory movements, payment allocations and ledgers—not from duplicated manually maintained totals.

#### Financial overview and period comparisons

- Provide daily, weekly, monthly and yearly views, plus custom date ranges, with clear timezone and period boundaries.
- Show sales/revenue, cost of goods sold, gross profit, operating expenses, net operating result/profit or loss, refunds/returns, discounts, taxes collected/payable, outstanding customer receivables, supplier payables and cash/bank movements as separate metrics.
- Clearly distinguish gross sales, net sales, cash collected, unpaid sales, gross profit and net profit. Never label revenue or cash received as profit.
- Show comparisons with the previous equivalent period and trends over time, with drill-down to the source invoices, receipts, expenses, returns and journal entries.
- Present amounts grouped by currency (USD and new Syrian pound). A consolidated converted view is optional and must disclose the reporting currency, conversion rate/version and timestamp. Never sum unlike currencies without conversion disclosure.
- Show gross margin and net margin with documented formulas. Loss periods must be visibly represented as losses, not hidden by positive revenue.
- Include best-selling products, low-performing products, sales by category, sales channel, cashier, payment method and branch/warehouse where relevant.
- Include purchases from suppliers, purchase cost, landed/import costs and supplier due amounts as separate purchasing indicators.

#### Daily cash box and shift control

- Provide a daily cash-box view for each register/drawer and payment account, with separate USD and SYP balances.
- Show opening balance, cash sales received, other receipts, supplier payments, expenses, refunds, transfers, cash paid out, expected closing balance and counted closing balance, with variance and explanation.
- Support cashier/register opening and closing shifts, cash handover, reviewer approval and immutable close records. The dashboard must show open shifts and shifts awaiting reconciliation.
- Bank, digital payment and clearing-account balances must be distinguished from physical cash. Transfers between accounts must not appear as income or expense.
- Allow authorized users to drill into each cash movement and its source document; do not permit editing a balance directly.

#### Inventory health and configurable low-stock alerts

- Each product/variant can have a reorder threshold/minimum stock quantity configurable by the store owner; thresholds may differ by warehouse/branch.
- When available stock reaches or falls below the configured threshold, create an alert/notification with product, variant, warehouse, current available quantity, threshold, reserved quantity and suggested reorder quantity where configured.
- Support separate alerts for out-of-stock, critically low stock, expiry approaching, expired stock, slow-moving stock and pending stock-count discrepancies when the relevant capabilities are enabled.
- Avoid alert floods: deduplicate active alerts, support acknowledged/snoozed/resolved states, and re-open only when a meaningful new condition occurs. Notify only users with relevant permissions/preferences.
- Calculate available stock consistently from on-hand minus reservations and other unavailable/in-transit quantities according to the inventory model. A threshold alert must not mistake reserved or in-transit stock for freely available stock.
- Provide a low-stock list with filters and a path to create a draft purchase order; never place an order with a supplier automatically without explicit authorization.

#### Alerts, notifications and action center

- Provide a central dashboard notification/action center for low stock, out of stock, rate changes/stale rates, price recalculation awaiting approval, supplier bills due/overdue, customer debts overdue, unpaid expenses, cash variance, open shifts, pending orders, delivery exceptions, failed payments, expiring batches and approval requests.
- Every alert must link to the relevant record/action, include severity, created time, current status and responsible role/user where applicable.
- Support in-app persistent notifications, unread counts, mark-read/acknowledge, filters and permission-aware visibility. External email/push/WhatsApp delivery is optional and must not be claimed until configured.
- Let the owner configure alert thresholds, notification recipients, quiet periods and enabled alert types without weakening mandatory security or accounting controls.

#### Dashboard customization, drill-down and reliability

- Use a professional responsive layout with clear KPI hierarchy, charts, trend indicators, tables, quick actions and compact mobile presentation. Provide Arabic RTL and English LTR, accessible contrast and light/dark themes consistent with platform settings.
- Allow authorized owners/admins to reorder, show/hide and resize dashboard widgets, save personal or store-wide layouts, and choose the default reporting period. Customization must never hide critical security, payment or reconciliation warnings from authorized responsible users.
- Provide role-aware dashboards: a cashier sees POS/shift tasks; inventory staff see stock and receiving; purchasing staff see suppliers and due bills; owners/admins see the complete financial and operational picture. Permissions must also be enforced on drill-down APIs.
- Include last-updated timestamps and clear empty/loading/error states. If a data source is unavailable or a background calculation is delayed, show that fact rather than presenting stale numbers as current.
- KPI calculations must be documented and tested against source ledgers, including refunds, partial payments, multi-currency sales, discounts, tax, delivery fees, supplier returns, expenses, stock adjustments and exchange differences.
- Dashboard widgets are views over source records; they must not become independent financial ledgers or allow direct editing of derived totals.
- Provide exports only with role authorization, tenant isolation, audit logging and currency/rate metadata.

#### Delivery and implementation status

- These dashboard and Syria procurement/sales rules are requirements, not evidence that the dashboard or ERP modules are implemented.
- Implement the dashboard after the relevant ledgers and posting workflows exist, so profit/loss, cash and inventory figures reconcile. Early dashboard shells may show only verified existing metrics and must label missing modules as unavailable rather than fabricate totals.

### 9.17 Store opening hours, holidays and service availability

Opening hours are a first-class store capability, not a decorative line of text. They must drive customer-facing availability and operational workflows while remaining configurable for each store, branch and service channel.

- Store and each branch/location must have an explicit IANA time-zone identifier. All schedules are interpreted in that location's time zone; persist event timestamps unambiguously and never rely on the visitor's device time zone.
- Support a weekly recurring schedule for every weekday, including closed days, multiple opening intervals in one day, break periods, and overnight intervals that close after midnight. Validate invalid or overlapping intervals while allowing legitimate overnight hours.
- Support date-specific exceptions: public holidays, religious/cultural holidays, annual recurring closures, one-off holidays, staff training, maintenance, emergency closure, special opening, extended hours and shortened hours. Store owners/admins can create, edit, schedule and cancel exceptions.
- Do not hard-code Syrian or other national holiday dates as immutable rules. Provide editable holiday calendars and optional imported calendar sources only after their reliability and licensing are verified. A store may observe, ignore or override a suggested holiday.
- Support separate availability schedules by channel/service where needed: walk-in/customer service, public online ordering, pickup, delivery, appointments/bookings, phone support and specific departments. A store may accept online orders while its physical location is closed, or stop delivery while pickup remains available.
- Public storefronts should show open/closed status, today's hours, next opening time and any special closure notice in the store's local time zone. Avoid exposing internal staff schedules or private closure notes.
- Define explicit after-hours behavior per channel: block new orders, accept orders for later processing, allow scheduled/pre-orders, or show a contact/request form. Display expected processing/delivery/pickup windows honestly; do not imply immediate fulfillment while closed.
- Enforce availability server-side at the relevant action (checkout, appointment booking, pickup slot or delivery slot), not only by hiding a button in the browser. Recheck schedule, capacity and cutoff rules when committing the transaction.
- For fulfillment, support preparation lead time, order cutoff, minimum advance notice, slot capacity, blackout dates, holidays and configurable buffers. Do not promise a delivery or pickup time outside the selected service's actual availability.
- Appointment-based businesses may derive bookable slots from opening hours, service duration, staff/resource calendars, breaks, buffers, existing bookings and capacity. This is a separate booking capability; opening hours alone must never be treated as proof that a clinician, employee or room is available.
- Branch schedules and exceptions are independent. A central owner may copy a schedule to selected branches, but subsequent changes must not silently overwrite branch-specific exceptions.
- Emergency closure and reopening actions require authorized roles, an audit record, an optional public message and clear handling of already accepted orders/bookings. Existing confirmed commitments must not be silently deleted; require cancellation, rescheduling or customer contact workflows.
- Staff shifts and attendance are separate from customer opening hours. A store can be open without every employee being scheduled, and a staff shift does not automatically make a customer service available.
- Show schedule configuration history and who changed it. Notify relevant staff of upcoming special hours where in-app notifications are enabled.
- Test timezone changes, daylight-saving transitions, leap days, year boundaries, overnight periods, overlapping intervals, holiday overrides, branch overrides, after-hours checkout and concurrent slot booking.

### 9.18 Unified financial and inventory posting architecture

The platform must maintain a consistent source of truth across stock, money, documents and operational history. This section defines the target architecture; it does not claim that the existing catalog movement table is already a complete ledger or that double-entry accounting is implemented.

- Keep inventory movements as the immutable source history for stock changes. Product/variant quantity columns may remain transactionally maintained projections for fast reads, but must reconcile to posted movements and must never be manually overwritten without a corresponding controlled adjustment.
- Introduce a financial posting/journal service for posted business events. Sales, supplier bills, receipts, payments, refunds, returns, expenses, cash transfers, taxes and exchange differences must post through a single controlled mapping layer rather than each route inventing its own balance updates.
- A posted document/event should have a stable source type and source ID, posting status, idempotency key, actor, effective business date, recorded timestamp, currency and immutable reference to the exact rate/version used where conversion applies.
- Enforce balanced debit/credit journal entries when double-entry accounting is enabled. Do not infer profit from cash movement or order totals. Payment receipt, revenue recognition, receivable settlement, inventory cost and expense recognition remain distinct concepts.
- Keep separate currency amounts and account balances. Never add USD and SYP as raw numbers. Conversions must capture source currency, target currency, rate value, rate ID/version, effective time, rounding rule and reporting basis.
- Use integer minor units or an explicitly documented decimal strategy with currency-specific precision. Do not rely on JavaScript floating-point arithmetic for authoritative money calculations. Currency precision must be configurable and verified for the actual Syrian currency definition before activation.
- Posting must be idempotent and concurrency-safe. Duplicate webhook/API retries must not duplicate stock, revenue, payment allocation or journal entries. Enforce source uniqueness and database constraints in addition to application checks.
- Where a business operation changes multiple related records, use a D1-supported atomic batch/transaction boundary and verify rollback behavior. Do not claim atomicity across external payment, storage or notification providers; use durable outbox/retry patterns where external side effects are required.
- Posted records are immutable. Corrections use linked reversal, credit/debit note, return or adjustment entries; preserve the original record and complete actor/time/reason history.
- Add period locks and controlled reopen permissions before production financial close. Historical reports must remain reproducible from posted source records and captured exchange-rate snapshots.
- Define reconciliation checks between inventory projections and movements, payments and allocations, cash/bank accounts and movements, supplier/customer subledgers and control accounts, and journal debits/credits. Surface discrepancies as actionable alerts; never silently auto-correct financial history.
- Build this foundation incrementally after auditing existing schema, triggers, APIs and migrations. Reuse compatible tables and preserve existing production data; do not create duplicate movement or payment ledgers simply because a new module is being added.

### 9.19 Industry profiles and optional business capabilities

The platform serves more than conventional product shops. Each store selects one or more business profiles; the profile enables relevant capabilities and tailored screens without forcing irrelevant fields or workflows on every business.

- Core capabilities should be composable: catalog, services, customers, suppliers, inventory, orders, POS, appointments, reservations, invoicing, payments, delivery, staff/resources, documents, reporting and accounting. Each capability has explicit dependencies, permissions, settings and activation status.
- Retail and fashion: size/color variants, barcode labels, fitting/returns, bundles, stock availability and product collections.
- Grocery and wholesale: units and conversions, pack/carton pricing, weight-based goods where supported, bulk/customer-tier pricing, minimum quantities, supplier purchasing and multiple warehouses.
- Restaurants, cafes and bakeries: menus, modifiers/add-ons, meal combos, preparation notes, order types (table, takeaway, pickup, delivery), kitchen tickets/queues, preparation time and item availability/86-out controls. Food safety and allergen disclosures require local review.
- Pharmacies: batch/lot and expiry tracking, supplier traceability, prescription-related workflows and restricted-product controls only after local legal review. Health-related customer data must receive stricter privacy/access controls; do not assume every pharmacy product may be sold without a pharmacist or prescription check.
- Clinics and healthcare practices: clinician profiles, specialties, service durations, branch/staff calendars, appointment booking, cancellation/no-show rules and patient communications. Medical records, diagnoses, prescriptions and sensitive health data are a separate high-sensitivity module requiring privacy, security and jurisdictional review; they are not ordinary store notes.
- Salons and personal services: service catalog, staff skills, duration, resource/chair scheduling, booking deposits, cancellation policies, packages and repeat appointments.
- Repair and maintenance businesses: customer assets/devices, intake inspection, work orders, diagnosis, estimates, customer approval, parts usage, technician assignment, warranty and completion handover.
- Rental businesses: rentable assets, availability calendars, deposits, rental periods, late fees, damage inspection and return workflows.
- Digital goods and subscriptions: entitlement delivery, license/serial issuance, recurring billing only with explicit payment authorization, renewal/cancellation lifecycle and access revocation.
- B2B/service businesses: quotations, projects/jobs, milestones, timesheets where approved, contracts, service completion evidence, retainers and receivables.
- Industry profiles are starting configurations, not rigid silos. Owners may enable additional compatible capabilities; disabling a capability must preserve its historical documents and data.
- Use industry-specific storefront components and templates where helpful, but keep shared identity, permissions, customer, payment, document and audit foundations consistent.
- Every profile must define which data is public, staff-only or sensitive, and which roles can access or export it. Never expose patient, prescription, repair-device or customer-private data through public storefront APIs.
- Before activating a regulated workflow, verify current local laws, licensing, tax rules and required records with authoritative sources and qualified local professionals. The platform must not claim legal or clinical compliance by default.
- The first release should prioritize the shared foundations and a limited set of complete business profiles; do not expose unfinished profile features as operational merely because their settings or navigation exist.

