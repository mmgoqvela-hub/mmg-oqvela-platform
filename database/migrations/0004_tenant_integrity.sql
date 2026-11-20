-- MMG OQVELA
-- Migration 0004: Tenant Isolation Integrity

-- Prevent categories from using a parent in another store.
CREATE TRIGGER trg_category_parent_insert
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.parent_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store category parent is forbidden');
END;

CREATE TRIGGER trg_category_parent_update
BEFORE UPDATE OF parent_id, store_id ON categories
WHEN NEW.parent_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.parent_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store category parent is forbidden');
END;

-- Prevent products from using another store's category.
CREATE TRIGGER trg_product_category_insert
BEFORE INSERT ON products
WHEN NEW.category_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store product category is forbidden');
END;

CREATE TRIGGER trg_product_category_update
BEFORE UPDATE OF category_id, store_id ON products
WHEN NEW.category_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id
    AND store_id = NEW.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store product category is forbidden');
END;

-- A stock movement variant must belong to the same product.
CREATE TRIGGER trg_inventory_variant_insert
BEFORE INSERT ON inventory_movements
WHEN NEW.variant_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id
    AND store_id = NEW.store_id
    AND product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Inventory variant does not belong to product');
END;

CREATE TRIGGER trg_inventory_variant_update
BEFORE UPDATE OF variant_id, product_id, store_id
ON inventory_movements
WHEN NEW.variant_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id
    AND store_id = NEW.store_id
    AND product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'Inventory variant does not belong to product');
END;

-- Prevent assigning a role from another store to a member.
CREATE TRIGGER trg_member_role_insert
BEFORE INSERT ON member_roles
WHEN NOT EXISTS (
    SELECT 1
    FROM store_members sm
    JOIN roles r ON r.id = NEW.role_id
    WHERE sm.id = NEW.store_member_id
    AND sm.store_id = r.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store role assignment is forbidden');
END;

CREATE TRIGGER trg_member_role_update
BEFORE UPDATE OF store_member_id, role_id ON member_roles
WHEN NOT EXISTS (
    SELECT 1
    FROM store_members sm
    JOIN roles r ON r.id = NEW.role_id
    WHERE sm.id = NEW.store_member_id
    AND sm.store_id = r.store_id
)
BEGIN
    SELECT RAISE(ABORT, 'Cross-store role assignment is forbidden');
END;
