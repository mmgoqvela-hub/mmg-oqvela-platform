-- MMG OQVELA Platform
-- Migration 0006: Tenant Mutation Integrity Guards

-- Prevent moving a category when it would invalidate
-- existing child categories or product references.
CREATE TRIGGER trg_category_store_update_guard
BEFORE UPDATE OF store_id ON categories
WHEN NEW.store_id != OLD.store_id
AND (
    EXISTS (
        SELECT 1
        FROM categories child
        WHERE child.parent_id = OLD.id
        AND child.store_id != NEW.store_id
    )
    OR
    EXISTS (
        SELECT 1
        FROM products p
        WHERE p.category_id = OLD.id
        AND p.store_id != NEW.store_id
    )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move category while dependent records belong to another store'
    );
END;

-- Prevent moving a role when assigned members belong
-- to a different store.
CREATE TRIGGER trg_role_store_update_guard
BEFORE UPDATE OF store_id ON roles
WHEN NEW.store_id != OLD.store_id
AND EXISTS (
    SELECT 1
    FROM member_roles mr
    JOIN store_members sm
        ON sm.id = mr.store_member_id
    WHERE mr.role_id = OLD.id
    AND sm.store_id != NEW.store_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move role while assigned members belong to another store'
    );
END;

-- Prevent moving a store member when assigned roles
-- belong to a different store.
CREATE TRIGGER trg_store_member_update_guard
BEFORE UPDATE OF store_id ON store_members
WHEN NEW.store_id != OLD.store_id
AND EXISTS (
    SELECT 1
    FROM member_roles mr
    JOIN roles r
        ON r.id = mr.role_id
    WHERE mr.store_member_id = OLD.id
    AND r.store_id != NEW.store_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Cannot move member while assigned roles belong to another store'
    );
END;
