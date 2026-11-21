# Store Template & Industry Architecture

Status: confirmed product direction; implementation is staged and must not be described as complete.
Last reviewed: 2026-11-21

## 1. Product decision

MMG OQVELA is a multi-tenant platform for different business types, not only conventional product shops. A tenant may represent, for example, a bakery, pharmacy, medical clinic, restaurant, fashion shop, electronics shop, beauty business, furniture shop, gym, salon, workshop or service business.

For each newly prepared customer store, the platform operator prepares **three genuinely different design options**. The customer receives previews and chooses one option. The customer is not given a general-purpose visual editor and cannot freely change layout, colors, spacing or page structure. The platform operator retains design control and can tailor the three options to the customer's brand and request.

The three options must differ in actual visual composition and presentation, not merely use three different color palettes on the same layout.

## 2. Separate the system into three layers

### A. Template layout
Defines the page structure and visual composition: header, navigation, hero, content sections, product/service cards, footer, responsive behavior and component placement.

### B. Industry capabilities
Defines which business features and content types are relevant to an industry. Examples:
- Bakery / restaurant: menu or catalog, categories, availability, ordering and fulfillment where enabled.
- Pharmacy: product catalog, categories, product details and pharmacy-specific operational rules; regulated medicine workflows must not be assumed or enabled without a separate approved specification.
- Clinic: clinic profile, specialties, practitioners, appointment availability and booking workflows when implemented. A clinic is not forced into a retail product-cart experience.
- Fashion: products, variants such as size and color, collections.
- Electronics: product specifications, categories and comparisons where implemented.
- Beauty: services or products, brands and categories.

Industry selection configures capabilities and defaults; it must not create a separate codebase for each industry.

### C. Design configuration
Stores the operator-controlled presentation settings, such as:
- Color tokens, backgrounds and contrast-safe text colors.
- Typography, font sizes and weights.
- Logo, hero and approved image selections.
- Section visibility and order.
- Layout variants, spacing and alignment.
- Card, button, navigation and footer styles.
- Content labels and presentation options.

Design configuration must be validated against an allowlist/schema. Do not allow arbitrary HTML, CSS or JavaScript supplied by a tenant.

## 3. Template catalog and customer-specific options

The existing general template directions remain useful as a starting catalog:
Modern, Classic, Minimal, Boutique, Tech, Market, Restaurant, Fashion, Electronics, Beauty and Luxury.

These are not a restriction to eleven fixed storefronts. Templates should be reusable foundations with supported layout variants and industry-specific components.

For each customer onboarding:
1. Identify the business type and collect its content, brand assets and requirements.
2. The platform operator prepares three distinct design configurations using compatible layouts and industry components.
3. Generate private/unpublished previews for that specific store.
4. Let the customer compare the three previews and select one.
5. Record the selected option and activate/publish it only through the authorized store workflow.
6. The operator can continue to make approved design changes later.

The three customer options are store-specific design configurations, not three duplicated codebases. Keep template code shared and versioned; keep each store's configuration and selection tenant-scoped.

## 4. Operator design workspace

The platform administration workspace should eventually allow an authorized operator to:
- Select a base template/layout and industry capability set.
- Create and manage three named options for a specific store.
- Change colors, typography, logo, images, section order/visibility and supported placements.
- Preview each option at mobile and desktop sizes.
- Save drafts, compare options, reset to a base preset, and publish the customer's selected option.
- Reuse approved presets/components without exposing other tenants' private content.

This is an operator-facing configuration workspace. A full free-form drag-and-drop editor is not required for the customer and should not be built for the customer.

## 5. Store owner experience after activation

The store owner manages business data through the store dashboard: products or services, descriptions, prices, inventory or availability, orders or appointments, and their business-specific settings as supported.

The store owner may select images from a store-approved image library where available. A product does not have to have a unique image. Multiple products may reference the same approved store image, and products may use a category/default image or no image when the chosen design supports it. A separate product image upload is an optional capability, not a mandatory field for every product.

Do not confuse:
- Shared, versioned platform assets (template artwork, icons and common image-library assets).
- Store-specific brand/design assets.
- Dynamic product/service images uploaded or selected by a store owner.

## 6. Image delivery and storage boundaries

- GitHub stores source code and versioned, shared platform/template assets. It is not the operational upload store for customer-generated files.
- CDN is a delivery/cache layer, not the durable origin for uploaded customer files.
- Shared fixed assets can be served through the platform's static asset/CDN path.
- Any customer-uploaded logo, design image or optional product image requires a durable origin store before that upload feature is represented as operational.
- Keep storage behind the existing provider-neutral adapter boundary so the provider can be selected or changed without rewriting storefront/catalog logic.
- Do not select, enable or incur costs for a storage provider without checking current commercial/SaaS terms, free-tier limits, payment-card requirements, bandwidth/operation limits and tenant isolation, then obtaining user approval.
- No customer workflow should require copying and pasting an external image URL as the normal way to add an image.

## 7. Multi-tenant and safety requirements

- Every design option, draft, preview, asset reference and published selection must be scoped to the owning store/tenant and authorized server-side.
- A user must never access or alter another store's previews, configuration or media by changing an ID.
- Public storefronts may only render the currently published configuration and assets intended to be public.
- Validate all configuration values and asset references server-side.
- Preserve an audit trail for operator changes and publishing actions.
- Preview and draft routes must not leak unpublished customer information or become publicly enumerable.
- Design changes must not mutate product/order/customer data.
- Templates must be responsive, accessible and support Arabic RTL and English LTR.

## 8. Delivery sequence

1. Preserve and verify the existing authentication, store ownership, tenant isolation and catalog foundations.
2. Define the template configuration schema, industry capability registry and versioning rules.
3. Build reusable storefront components and at least one complete end-to-end template configuration.
4. Add store-scoped draft options and secure preview rendering.
5. Build the operator workspace for preparing and comparing three options.
6. Add customer selection and controlled publishing.
7. Add further industries and layouts incrementally, with automated tests for tenant isolation, configuration validation, RTL/LTR and responsive behavior.
8. Enable customer image uploads only after durable storage has been selected and verified.

## 9. Explicit non-goals / items not yet implemented

This document records the approved direction; it does not claim these features already exist. Do not:
- Give customers unrestricted visual editing.
- Create a separate codebase for every customer or industry.
- Require every product/service to have its own image.
- Treat a CDN cache as permanent storage.
- Put customer uploads or frequently changing tenant data into Git commits.
- Assume clinic, pharmacy or other regulated workflows without separately specifying and approving their operational, privacy and compliance requirements.

## 10. Future template expansion and backward compatibility

This is a confirmed platform requirement:
- The template catalog must remain extensible after the platform launches. The initial catalog size (including the current eleven template directions) is not a permanent limit.
- New templates and industry-specific variants can be added later without rebuilding the platform or creating a separate application/codebase for each template.
- A new template must be independently versioned, validated and tested before it is made available in the operator workspace.
- Platform operators may choose whether a newly added template is available only for newly onboarded stores or is also offered to selected existing stores.
- Adding, updating, deprecating or removing a catalog template must never silently change an existing store's published design.
- Each store must retain its own pinned template identity/version and design configuration. Existing storefronts continue rendering against their selected compatible version until an operator deliberately migrates that store.
- Template upgrades or migrations for existing stores must be explicit, previewable, reversible where practical, and must not modify products, orders, customers, subscriptions or other business records.
- Shared components and design tokens should be versioned with compatibility rules so new templates can reuse them without breaking older templates.
- The operator workspace should support catalog lifecycle states such as draft, tested, published and retired. Retiring a template prevents new selections but does not break stores already using it.
- Automated regression tests must verify that publishing a new template does not alter existing stores' selected template versions or rendered configuration.
