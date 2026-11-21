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
