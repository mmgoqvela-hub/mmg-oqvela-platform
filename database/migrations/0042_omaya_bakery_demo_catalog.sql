-- MMG OQVELA
-- Migration 0042: seed the first Omaya bakery storefront demo catalog.
-- Safe for existing stores: only the exact demo store is targeted, existing
-- products are never overwritten, and stock tracking stays disabled.

UPDATE stores
SET slug = 'omaya-pastries', updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id FROM stores
  WHERE name = 'معجنات أمية'
  ORDER BY created_at DESC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM stores WHERE slug = 'omaya-pastries'
    AND id != (
      SELECT id FROM stores
      WHERE name = 'معجنات أمية'
      ORDER BY created_at DESC
      LIMIT 1
    )
);

INSERT INTO categories (id, store_id, name, slug, description, sort_order)
SELECT 'demo-omaya-pastries-category', s.id, 'المعجنات', 'demo-pastries',
       'تشكيلة المعجنات والمخبوزات - قسم تجريبي', 1
FROM stores s
WHERE s.id = (
  SELECT id FROM stores WHERE name = 'معجنات أمية'
  ORDER BY created_at DESC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM categories c
  WHERE c.store_id = s.id AND c.slug = 'demo-pastries'
);

INSERT INTO products
  (id, store_id, category_id, name, slug, description, product_type,
   status, base_price, currency, sku, track_inventory, stock_quantity, is_featured, sale_unit)
SELECT 'demo-omaya-zatar', s.id, c.id, 'منقوشة زعتر', 'demo-zatar',
       'صنف تجريبي قابل لتعديل الوصف والسعر والصورة.', 'physical',
       'active', 5000, 'SYP', 'DEMO-OMAYA-001', 0, 0, 1, 'piece'
FROM stores s JOIN categories c ON c.store_id=s.id AND c.slug='demo-pastries'
WHERE s.id=(SELECT id FROM stores WHERE name='معجنات أمية' ORDER BY created_at DESC LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM products p WHERE p.store_id=s.id AND p.slug='demo-zatar');

INSERT INTO products
  (id, store_id, category_id, name, slug, description, product_type,
   status, base_price, currency, sku, track_inventory, stock_quantity, is_featured, sale_unit)
SELECT 'demo-omaya-cheese', s.id, c.id, 'فطيرة جبنة', 'demo-cheese',
       'صنف تجريبي قابل لتعديل الوصف والسعر والصورة.', 'physical',
       'active', 8000, 'SYP', 'DEMO-OMAYA-002', 0, 0, 0, 'piece'
FROM stores s JOIN categories c ON c.store_id=s.id AND c.slug='demo-pastries'
WHERE s.id=(SELECT id FROM stores WHERE name='معجنات أمية' ORDER BY created_at DESC LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM products p WHERE p.store_id=s.id AND p.slug='demo-cheese');

INSERT INTO products
  (id, store_id, category_id, name, slug, description, product_type,
   status, base_price, currency, sku, track_inventory, stock_quantity, is_featured, sale_unit)
SELECT 'demo-omaya-croissant', s.id, c.id, 'كرواسون شوكولاتة', 'demo-croissant',
       'صنف تجريبي قابل لتعديل الوصف والسعر والصورة.', 'physical',
       'active', 10000, 'SYP', 'DEMO-OMAYA-003', 0, 0, 0, 'piece'
FROM stores s JOIN categories c ON c.store_id=s.id AND c.slug='demo-pastries'
WHERE s.id=(SELECT id FROM stores WHERE name='معجنات أمية' ORDER BY created_at DESC LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM products p WHERE p.store_id=s.id AND p.slug='demo-croissant');

INSERT INTO products
  (id, store_id, category_id, name, slug, description, product_type,
   status, base_price, currency, sku, track_inventory, stock_quantity, is_featured, sale_unit)
SELECT 'demo-omaya-mixed', s.id, c.id, 'معجنات مشكلة', 'demo-mixed',
       'صنف تجريبي قابل لتعديل الوصف والسعر والصورة.', 'physical',
       'active', 40000, 'SYP', 'DEMO-OMAYA-004', 0, 0, 0, 'kg'
FROM stores s JOIN categories c ON c.store_id=s.id AND c.slug='demo-pastries'
WHERE s.id=(SELECT id FROM stores WHERE name='معجنات أمية' ORDER BY created_at DESC LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM products p WHERE p.store_id=s.id AND p.slug='demo-mixed');

INSERT INTO product_images (id, product_id, store_id, file_key, alt_text, sort_order)
SELECT 'demo-omaya-image-zatar', p.id, p.store_id,
       'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/zatar.svg',
       'منقوشة زعتر - صورة تجريبية', 0
FROM products p WHERE p.id='demo-omaya-zatar'
AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id);

INSERT INTO product_images (id, product_id, store_id, file_key, alt_text, sort_order)
SELECT 'demo-omaya-image-cheese', p.id, p.store_id,
       'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/cheese.svg',
       'فطيرة جبنة - صورة تجريبية', 0
FROM products p WHERE p.id='demo-omaya-cheese'
AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id);

INSERT INTO product_images (id, product_id, store_id, file_key, alt_text, sort_order)
SELECT 'demo-omaya-image-croissant', p.id, p.store_id,
       'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/croissant.svg',
       'كرواسون شوكولاتة - صورة تجريبية', 0
FROM products p WHERE p.id='demo-omaya-croissant'
AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id);

INSERT INTO product_images (id, product_id, store_id, file_key, alt_text, sort_order)
SELECT 'demo-omaya-image-mixed', p.id, p.store_id,
       'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/mixed.svg',
       'معجنات مشكلة - صورة تجريبية', 0
FROM products p WHERE p.id='demo-omaya-mixed'
AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id);

UPDATE stores
SET customization_json = json_set(
  CASE WHEN json_valid(customization_json) THEN customization_json ELSE '{}' END,
  '$.logo',
  CASE WHEN COALESCE(json_extract(customization_json,'$.logo'),'')=''
       THEN 'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/logo.svg'
       ELSE json_extract(customization_json,'$.logo') END,
  '$.heroImage',
  CASE WHEN COALESCE(json_extract(customization_json,'$.heroImage'),'')=''
       THEN 'https://mmg-oqvela-platform.mmgoqvela.workers.dev/assets/omaya/hero.svg'
       ELSE json_extract(customization_json,'$.heroImage') END,
  '$.texts.heroTitle',
  CASE WHEN COALESCE(json_extract(customization_json,'$.texts.heroTitle'),'')=''
       THEN 'معجنات أمية – الطعم الأصيل'
       ELSE json_extract(customization_json,'$.texts.heroTitle') END,
  '$.texts.heroSubtitle',
  CASE WHEN COALESCE(json_extract(customization_json,'$.texts.heroSubtitle'),'')=''
       THEN 'أشهى المعجنات والمخبوزات الطازجة يومياً'
       ELSE json_extract(customization_json,'$.texts.heroSubtitle') END,
  '$.announcement',
  CASE WHEN COALESCE(json_extract(customization_json,'$.announcement'),'')=''
       THEN 'معجنات طازجة يومياً — أهلاً بكم في معجنات أمية'
       ELSE json_extract(customization_json,'$.announcement') END
),
updated_at = CURRENT_TIMESTAMP
WHERE id = (
  SELECT id FROM stores WHERE name='معجنات أمية'
  ORDER BY created_at DESC LIMIT 1
);
