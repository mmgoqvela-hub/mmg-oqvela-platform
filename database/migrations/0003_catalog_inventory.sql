-- MMG OQVELA
-- Migration 0003: Catalog and Inventory

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (parent_id)
        REFERENCES categories(id) ON DELETE SET NULL,

    UNIQUE (store_id, slug),
    UNIQUE (id, store_id)
);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    category_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    product_type TEXT NOT NULL DEFAULT 'physical'
        CHECK (product_type IN (
            'physical', 'digital', 'service'
        )),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'active', 'archived'
        )),
    base_price REAL NOT NULL DEFAULT 0
        CHECK (base_price >= 0),
    compare_at_price REAL
        CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    sku TEXT,
    track_inventory INTEGER NOT NULL DEFAULT 1
        CHECK (track_inventory IN (0, 1)),
    stock_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (stock_quantity >= 0),
    is_featured INTEGER NOT NULL DEFAULT 0
        CHECK (is_featured IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (category_id)
        REFERENCES categories(id) ON DELETE SET NULL,

    UNIQUE (store_id, slug),
    UNIQUE (store_id, sku),
    UNIQUE (id, store_id)
);

CREATE TABLE product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    price REAL NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (stock_quantity >= 0),
    attributes_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE,

    UNIQUE (store_id, sku),
    UNIQUE (id, store_id)
);

CREATE TABLE product_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    alt_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE
);

CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN (
            'initial',
            'purchase',
            'sale',
            'return',
            'adjustment',
            'damage'
        )),
    quantity_change INTEGER NOT NULL
        CHECK (quantity_change != 0),
    reference_id TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,

    FOREIGN KEY (product_id, store_id)
        REFERENCES products(id, store_id) ON DELETE CASCADE,

    FOREIGN KEY (variant_id, store_id)
        REFERENCES product_variants(id, store_id) ON DELETE RESTRICT,

    FOREIGN KEY (created_by)
        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_categories_store
    ON categories(store_id);

CREATE INDEX idx_products_store_status
    ON products(store_id, status);

CREATE INDEX idx_products_category
    ON products(store_id, category_id);

CREATE INDEX idx_variants_product
    ON product_variants(store_id, product_id);

CREATE INDEX idx_product_images_product
    ON product_images(store_id, product_id);

CREATE INDEX idx_inventory_product
    ON inventory_movements(store_id, product_id, created_at);
