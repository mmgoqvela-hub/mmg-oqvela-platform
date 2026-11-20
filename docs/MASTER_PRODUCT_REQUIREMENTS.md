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
- Secure authentication and session handling.
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
- Storefronts: eleven selectable design templates and public product browsing are implemented. A persistent browser-local customer cart is now implemented with product/variant selection, quantity controls, stock-aware limits, per-store cart isolation and currency-grouped totals. Checkout, order persistence, order processing and store-side order management remain incomplete and require approved payment/delivery workflows.
- Subscription lifecycle notifications and renewal rules. Trial and paid-subscription reminders and expiry notices are now surfaced in the authenticated store subscription panel when the owner visits: a warning appears within three days of expiry and an expired-subscription message explains that the public storefront is hidden and directs the owner to request a new paid plan. These subscription-panel notices are visit-triggered. In addition, a daily UTC Worker scheduled event now writes persistent inbox notifications three days and one day before expiry and after expiry. Transactional database triggers also notify the account owner when a trial starts and when a Sham Cash payment request is submitted, approved or rejected. External email/push/WhatsApp delivery and secure receipt-image storage remain incomplete.
- Platform-wide announcements/ads and mandatory footer.
- Per-store WhatsApp contact configuration and public contact link are implemented. A separate centrally configured platform support contact remains to be added if required.
- R2 file storage, file access policies and quotas.
- Terms, privacy and risk/security management screens.
- Full business audit logs beyond platform-admin settings.
- Tenant-isolation regression tests now cover cross-store category parents, product categories, variants, images and staff-role assignment at database level, plus cross-account store-creation rejection. Broader API coverage for every future module remains required.

### Not evidenced as implemented
- Complete customer checkout, order persistence, order processing and store-side order management at `/s/{slug}` after payment and delivery rules are approved.
- End-to-end customer shopping/order workflows: cart, checkout, order creation, tenant-scoped store order list, manual payment review and order status transitions are implemented; customer accounts/order history and external messaging remain incomplete.
- Store-side business reports/analytics.
- A complete staff invitation/onboarding workflow.
- Persistent notification inbox storage, authenticated read/unread API and bilingual dashboard UI are implemented; transactional lifecycle notifications for trial start and Sham Cash payment submission/approval/rejection, plus a daily UTC scheduled job for three-day, one-day and expired subscription reminders, are implemented in code. External email/push/WhatsApp delivery integrations and notification preferences remain incomplete. The scheduled job will only execute after a deployment that includes the cron trigger; no production deployment or migration has been performed.
Do not represent these as finished until implemented and tested.

## 6. Delivery order (preserve dependencies)

1. Complete bilingual foundation with the per-user preference migration applied safely, then verify every visible/dynamic string, errors, RTL/LTR, persistence across devices and locale formatting.
2. Finish security and tenant-isolation audit for every existing API; add negative tests.
3. Finish account/store lifecycle and reconcile store-creation authority.
4. Complete invitation/onboarding delivery and audit coverage for staff membership; the existing team and custom-role API/UI and catalog/inventory permission enforcement are implemented.
5. Complete catalog management UI refinements, R2-backed product media upload/storage and R2-backed media upload/storage and remaining inventory workflow refinements; variant-level stock movements are now implemented and tested.
6. Finish storefront template previews, accessibility, product media, and public-store verification at `/s/{slug}`.
7. Specify and implement customer checkout, order persistence and store-side order management only against approved payment and delivery requirements; the browser-local cart and variant-aware quantity selection are now implemented.
8. Central admin overview, user/account/store management, platform-admin management and protected super-admin transfer APIs/UI are implemented with audit logging and CI coverage. Remaining central admin work: announcements/ads, mandatory centrally controlled footer and notification/WhatsApp platform contact workflows.
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
- Notification channels, consent, templates and scheduling.
- Storage quotas and any paid overage policy.
- Which future modules belong in the first public release versus later phases.
