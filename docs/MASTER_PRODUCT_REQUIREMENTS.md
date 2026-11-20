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
- A customer submits the transfer transaction reference; payment is not considered approved until platform administration reviews it.
- Store owner/admin can submit a subscription request; ordinary members cannot.
- Enforce at most one pending/active/suspended subscription per store. Expired/cancelled/rejected requests may be followed by a new request.
- Approval/rejection must be atomic and auditable; rejection requires a reason.
- Subscription alerts must cover pending/expiry/suspension/renewal states.
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
- Subscription history and invoices for subscription payments.
- Central Sham Cash settings.
- Central trial settings.
- Platform-admin activity-log API and visible admin log.
- Catalog/inventory tables and tenant-integrity triggers.
- Tenant-scoped catalog APIs for category listing/creation/update/deletion, product listing/creation/update/archive, product variant creation/update/deactivation, and inventory movement history/stock adjustments. Product and variant creation record initial stock; stock changes are guarded against negative quantities and concurrent updates. Automated API tests cover tenant access, permissions and inventory integrity.
- Role/permission tables and some cross-store integrity triggers.

### Partially implemented / requires audit or completion
- Arabic/English switch and translation coverage are substantially implemented and have automated coverage for visible Arabic text, dynamic authentication/validation messages, RTL/LTR, and locale formatting. Per-user language preference API and migration 0013 are now in the repository; migration 0013 has not yet been applied to production, and full browser/device verification remains pending.
- Multi-store workflows and the unresolved distinction between platform-created stores and account-owner-created stores.
- Store staff, custom roles and permission-management screens/APIs.
- Product/category/variant/image/inventory management end-to-end: category, product and variant APIs plus stock movements now exist, but there is no finished management UI; R2-backed product image upload/management remains incomplete.
- Subscription lifecycle notifications and renewal rules.
- Platform-wide announcements/ads and mandatory footer.
- WhatsApp contact configuration/links.
- R2 file storage, file access policies and quotas.
- Terms, privacy and risk/security management screens.
- Full business audit logs beyond platform-admin settings.
- Tenant-isolation regression tests now cover cross-store category parents, product categories, variants, images and staff-role assignment at database level, plus cross-account store-creation rejection. Broader API coverage for every future module remains required.

### Not evidenced as implemented
- Fully featured storefront pages at `/s/{slug}`.
- End-to-end customer shopping/order workflows.
- Store-side business reports/analytics.
- A complete staff invitation/onboarding workflow.
- Automated notifications/delivery integrations.
Do not represent these as finished until implemented and tested.

## 6. Delivery order (preserve dependencies)

1. Complete bilingual foundation with the per-user preference migration applied safely, then verify every visible/dynamic string, errors, RTL/LTR, persistence across devices and locale formatting.
2. Finish security and tenant-isolation audit for every existing API; add negative tests.
3. Finish account/store lifecycle and reconcile store-creation authority.
4. Complete roles, staff membership and server-enforced permissions.
5. Complete catalog management UI, variant CRUD, media upload/storage and inventory workflows using the existing schema.
6. Build storefront routing and public store presentation at `/s/{slug}`.
7. Specify and implement customer-facing order/business workflows only against approved requirements.
8. Complete central administration, central ads/announcements, mandatory footer and WhatsApp contact.
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
