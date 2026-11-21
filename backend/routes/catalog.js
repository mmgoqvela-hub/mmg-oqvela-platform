import {
  getAuthenticatedSession,
  validOrigin
} from "../security/authentication.js";
import { createStoreMediaStorage } from "../storage/store_media_storage.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function readBody(request, maxLength = 12000) {
  const raw = await request.text();
  if (raw.length > maxLength) return { error: "Request too large", status: 413 };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: "Invalid request body", status: 400 };
    }
    return { body };
  } catch {
    return { error: "Invalid JSON", status: 400 };
  }
}

async function getStoreAccess(db, storeId, userId) {
  return db.prepare(`
    SELECT s.id, s.status AS store_status, a.status AS account_status,
           au.role AS account_role, sm.id AS store_member_id,
           COALESCE(GROUP_CONCAT(DISTINCT p.code), '') AS permissions
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    JOIN account_users au ON au.account_id = s.account_id
    LEFT JOIN store_members sm
      ON sm.store_id = s.id AND sm.user_id = au.user_id AND sm.status = 'active'
    LEFT JOIN member_roles mr ON mr.store_member_id = sm.id
    LEFT JOIN roles r ON r.id = mr.role_id AND r.store_id = s.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE s.id = ?
      AND au.user_id = ?
      AND au.status = 'active'
      AND a.status = 'active'
      AND (au.role IN ('owner','admin') OR sm.id IS NOT NULL)
    GROUP BY s.id, a.status, au.role, sm.id
    LIMIT 1
  `).bind(storeId, userId).first();
}

function hasPermission(access, code) {
  if (["owner", "admin"].includes(access?.account_role)) return true;
  return String(access?.permissions || "").split(",").includes(code);
}

function canRead(access, code = "catalog.read") {
  return hasPermission(access, code);
}

function canWrite(access, code = "catalog.manage") {
  return hasPermission(access, code);
}

function validName(value, max = 100) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= max;
}

function makeSlug(prefix, id) {
  return prefix + "-" + id.replace(/-/g, "").slice(0, 16);
}

async function categoryExists(db, storeId, categoryId) {
  if (!categoryId) return true;
  const row = await db.prepare(
    "SELECT id FROM categories WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(categoryId, storeId).first();
  return Boolean(row);
}

async function handleCategories(request, env, storeId, userId, access, categoryId) {
  const method = request.method;
  if (!categoryId) {
    if (!["GET", "POST"].includes(method)) return json({ error: "Method not allowed" }, 405);
    if (method === "GET") {
      if (!canRead(access, "catalog.read")) return json({ error: "Store read permission required" }, 403);
      const result = await env.DB.prepare(`
        SELECT id, parent_id, name, slug, description, sort_order, created_at
        FROM categories
        WHERE store_id = ?
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
      `).bind(storeId).all();
      return json({ status: "ok", categories: result.results || [] });
    }
    if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const parentId = body.parent_id == null || body.parent_id === "" ? null : body.parent_id;
    const sortOrder = body.sort_order === undefined ? 0 : body.sort_order;
    if (!validName(name) || description.length > 1000 ||
        (parentId !== null && typeof parentId !== "string") ||
        !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000) {
      return json({ error: "Invalid category data" }, 400);
    }
    if (parentId && !(await categoryExists(env.DB, storeId, parentId))) {
      return json({ error: "Parent category not found in this store" }, 400);
    }
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(`
        INSERT INTO categories (id, store_id, parent_id, name, slug, description, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, storeId, parentId, name, makeSlug("category", id), description || null, sortOrder).run();
      return json({ status: "ok", category: { id, store_id: storeId, parent_id: parentId, name, description, sort_order: sortOrder } }, 201);
    } catch {
      return json({ error: "Unable to create category" }, 409);
    }
  }

  if (!["PUT", "DELETE"].includes(method)) return json({ error: "Method not allowed" }, 405);
  if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
  const existing = await env.DB.prepare(
    "SELECT id FROM categories WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(categoryId, storeId).first();
  if (!existing) return json({ error: "Category not found" }, 404);

  if (method === "DELETE") {
    const [productUsage, childUsage] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM products WHERE category_id = ? AND store_id = ?"
      ).bind(categoryId, storeId).first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM categories WHERE parent_id = ? AND store_id = ?"
      ).bind(categoryId, storeId).first()
    ]);
    const linkedProducts = Number(productUsage?.total || 0);
    const childCategories = Number(childUsage?.total || 0);
    if (linkedProducts || childCategories) {
      return json({
        error: "Category is in use. Move its products and child categories before deleting it.",
        linked_products: linkedProducts,
        child_categories: childCategories
      }, 409);
    }
    await env.DB.prepare("DELETE FROM categories WHERE id = ? AND store_id = ?")
      .bind(categoryId, storeId).run();
    return json({ status: "ok" });
  }

  const parsed = await readBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const parentId = body.parent_id == null || body.parent_id === "" ? null : body.parent_id;
  const sortOrder = body.sort_order === undefined ? 0 : body.sort_order;
  if (!validName(name) || description.length > 1000 ||
      (parentId !== null && typeof parentId !== "string") ||
      !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000 ||
      parentId === categoryId) {
    return json({ error: "Invalid category data" }, 400);
  }
  if (parentId && !(await categoryExists(env.DB, storeId, parentId))) {
    return json({ error: "Parent category not found in this store" }, 400);
  }
  if (parentId) {
    const cycle = await env.DB.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM categories WHERE parent_id = ? AND store_id = ?
        UNION ALL
        SELECT c.id FROM categories c
        JOIN descendants d ON c.parent_id = d.id
        WHERE c.store_id = ?
      )
      SELECT id FROM descendants WHERE id = ? LIMIT 1
    `).bind(categoryId, storeId, storeId, parentId).first();
    if (cycle) return json({ error: "Category hierarchy cannot contain a cycle" }, 400);
  }
  await env.DB.prepare(`
    UPDATE categories
    SET parent_id = ?, name = ?, description = ?, sort_order = ?
    WHERE id = ? AND store_id = ?
  `).bind(parentId, name, description || null, sortOrder, categoryId, storeId).run();
  return json({ status: "ok" });
}

function validProduct(body) {
  return validName(body?.name, 160) &&
    (body.description == null || (typeof body.description === "string" && body.description.length <= 10000)) &&
    ["physical", "digital", "service"].includes(body.product_type || "physical") &&
    ["piece", "kg"].includes(body.sale_unit || "piece") &&
    ["draft", "active", "archived"].includes(body.status || "draft") &&
    typeof body.base_price === "number" && Number.isFinite(body.base_price) && body.base_price >= 0 &&
    (body.compare_at_price == null || (typeof body.compare_at_price === "number" && Number.isFinite(body.compare_at_price) && body.compare_at_price >= 0)) &&
    typeof (body.currency || "USD") === "string" && /^[A-Z]{3}$/.test(body.currency || "USD") &&
    (body.sku == null || (typeof body.sku === "string" && body.sku.trim().length <= 100)) &&
    (body.track_inventory === undefined || typeof body.track_inventory === "boolean") &&
    (body.is_featured === undefined || typeof body.is_featured === "boolean");
}

async function handleProducts(request, env, storeId, userId, access, productId) {
  const method = request.method;
  if (!productId) {
    if (!["GET", "POST"].includes(method)) return json({ error: "Method not allowed" }, 405);
    if (method === "GET") {
      if (!canRead(access, "catalog.read")) return json({ error: "Store read permission required" }, 403);
      const url = new URL(request.url);
      const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
      const categoryId = url.searchParams.get("category_id");
      const status = url.searchParams.get("status");
      const limitRaw = Number(url.searchParams.get("limit") || 50);
      const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;
      if (categoryId && !(await categoryExists(env.DB, storeId, categoryId))) {
        return json({ error: "Category not found in this store" }, 404);
      }
      if (status && !["draft", "active", "archived"].includes(status)) {
        return json({ error: "Invalid product status" }, 400);
      }
      const result = await env.DB.prepare(`
        SELECT p.id, p.category_id, c.name AS category_name, p.name, p.slug,
               p.description, p.product_type, p.sale_unit, p.status, p.base_price,
               p.compare_at_price, p.currency, p.sku, p.track_inventory,
               p.stock_quantity, p.is_featured, p.created_at, p.updated_at
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
        WHERE p.store_id = ?
          AND (? = '' OR p.name LIKE '%' || ? || '%' OR p.sku LIKE '%' || ? || '%')
          AND (? IS NULL OR p.category_id = ?)
          AND (? IS NULL OR p.status = ?)
        ORDER BY p.updated_at DESC, p.name COLLATE NOCASE ASC
        LIMIT ?
      `).bind(storeId, query, query, query, categoryId, categoryId, status, status, limit).all();
      return json({ status: "ok", products: result.results || [] });
    }
    if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    if (!validProduct(body)) return json({ error: "Invalid product data" }, 400);
    const categoryId = body.category_id == null || body.category_id === "" ? null : body.category_id;
    if (categoryId !== null && typeof categoryId !== "string") return json({ error: "Invalid category ID" }, 400);
    if (categoryId && !(await categoryExists(env.DB, storeId, categoryId))) {
      return json({ error: "Category not found in this store" }, 400);
    }
    const trackInventory = body.track_inventory !== false;
    const stock = body.stock_quantity === undefined ? 0 : body.stock_quantity;
    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000000 || ((body.sale_unit || "piece") === "kg" && stock % 50 !== 0)) {
      return json({ error: "Invalid initial stock quantity" }, 400);
    }
    if (!trackInventory && stock !== 0) {
      return json({ error: "Stock quantity requires inventory tracking" }, 400);
    }
    const id = crypto.randomUUID();
    const slug = makeSlug("product", id);
    const statements = [
      env.DB.prepare(`
        INSERT INTO products (
          id, store_id, category_id, name, slug, description, product_type,
          status, base_price, compare_at_price, currency, sku,
          track_inventory, stock_quantity, sale_unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, storeId, categoryId, body.name.trim(), slug,
        body.description?.trim() || null, body.product_type || "physical",
        body.status || "draft", body.base_price, body.compare_at_price ?? null,
        body.currency || "USD", body.sku?.trim() || null,
        trackInventory ? 1 : 0, stock, body.sale_unit || "piece"
      )
    ];
    if (stock > 0) {
      statements.push(env.DB.prepare(`
        INSERT INTO inventory_movements (
          id, store_id, product_id, movement_type, quantity_change, notes, created_by, unit_code
        )
        SELECT ?, ?, ?, 'initial', ?, 'Initial stock on product creation', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM products
          WHERE id = ? AND store_id = ? AND stock_quantity = ?
        )
      `).bind(crypto.randomUUID(), storeId, id, stock, userId, body.sale_unit === "kg" ? "g" : "piece", id, storeId, stock));
    }
    try {
      const results = await env.DB.batch(statements);
      if (!results[0]?.meta?.changes || (stock > 0 && !results[1]?.meta?.changes)) {
        return json({ error: "Unable to create product and its initial stock record" }, 409);
      }
      return json({ status: "ok", product: { id, store_id: storeId, name: body.name.trim(), slug, stock_quantity: stock } }, 201);
    } catch {
      return json({ error: "Unable to create product; check whether the SKU is already used in this store" }, 409);
    }
  }

  if (!["GET", "PUT", "DELETE"].includes(method)) return json({ error: "Method not allowed" }, 405);
  const product = await env.DB.prepare(
    "SELECT id, store_id, category_id, name, slug, description, product_type, sale_unit, status, base_price, compare_at_price, currency, sku, track_inventory, stock_quantity, is_featured FROM products WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);
  if (method === "GET") {
    if (!canRead(access, "catalog.read")) return json({ error: "Store read permission required" }, 403);
    const [variants, images] = await Promise.all([
      env.DB.prepare(
        "SELECT id, name, sku, price, stock_quantity, attributes_json, status FROM product_variants WHERE product_id = ? AND store_id = ? ORDER BY created_at ASC"
      ).bind(productId, storeId).all(),
      env.DB.prepare(
        "SELECT id, file_key AS url, alt_text, sort_order FROM product_images WHERE product_id = ? AND store_id = ? ORDER BY sort_order ASC, created_at ASC"
      ).bind(productId, storeId).all()
    ]);
    return json({ status: "ok", product, variants: variants.results || [], images: images.results || [] });
  }
  if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
  if (method === "DELETE") {
    await env.DB.prepare(
      "UPDATE products SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?"
    ).bind(productId, storeId).run();
    return json({ status: "ok", message: "Product archived" });
  }
  const parsed = await readBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  if (!validProduct(body)) return json({ error: "Invalid product data" }, 400);
  if (body.track_inventory === false) {
    const variantStock = await env.DB.prepare("SELECT COALESCE(SUM(stock_quantity), 0) AS total FROM product_variants WHERE product_id = ? AND store_id = ?").bind(productId, storeId).first();
    if (product.stock_quantity > 0 || (variantStock?.total || 0) > 0) {
      return json({ error: "Cannot disable inventory tracking while stock remains" }, 409);
    }
  }
  const categoryId = body.category_id == null || body.category_id === "" ? null : body.category_id;
  if (categoryId !== null && typeof categoryId !== "string") return json({ error: "Invalid category ID" }, 400);
  if (categoryId && !(await categoryExists(env.DB, storeId, categoryId))) {
    return json({ error: "Category not found in this store" }, 400);
  }
  await env.DB.prepare(`
    UPDATE products
    SET category_id = ?, name = ?, description = ?, product_type = ?,
        status = ?, base_price = ?, compare_at_price = ?, currency = ?,
        sku = ?, track_inventory = ?, is_featured = ?, sale_unit = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).bind(
    categoryId, body.name.trim(), body.description?.trim() || null,
    body.product_type || "physical", body.status || "draft",
    body.base_price, body.compare_at_price ?? null, body.currency || "USD",
    body.sku?.trim() || null, body.track_inventory === false ? 0 : 1,
    body.is_featured === true ? 1 : 0, body.sale_unit || product.sale_unit || "piece", productId, storeId
  ).run();
  return json({ status: "ok" });
}

async function handleVariants(request, env, storeId, userId, access, productId, variantId) {
  const product = await env.DB.prepare(
    "SELECT id, track_inventory FROM products WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);

  if (!variantId && request.method === "GET") {
    if (!canRead(access, "catalog.read")) return json({ error: "Store read permission required" }, 403);
    const result = await env.DB.prepare(`
      SELECT id,product_id,name,sku,price,stock_quantity,attributes_json,status,created_at
      FROM product_variants WHERE product_id=? AND store_id=? AND status='active'
      ORDER BY name COLLATE NOCASE ASC
    `).bind(productId,storeId).all();
    return json({ status:"ok", variants:(result.results||[]).map(row=>({
      ...row, attributes:(()=>{try{return JSON.parse(row.attributes_json||"{}");}catch{return {};}})()
    })) });
  }

  if (!variantId) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const price = body.price;
    const stock = body.stock_quantity === undefined ? 0 : body.stock_quantity;
    const attributes = body.attributes == null ? {} : body.attributes;
    if (!validName(name) || name.length > 100 ||
        (sku && sku.length > 100) ||
        typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
        !Number.isInteger(stock) || stock < 0 || stock > 1000000000 ||
        !attributes || typeof attributes !== "object" || Array.isArray(attributes) ||
        JSON.stringify(attributes).length > 4000) {
      return json({ error: "Invalid product variant data" }, 400);
    }
    if (!product.track_inventory && stock > 0) {
      return json({ error: "Inventory tracking is disabled for this product" }, 409);
    }
    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`
        INSERT INTO product_variants (
          id, product_id, store_id, name, sku, price,
          stock_quantity, attributes_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).bind(id, productId, storeId, name, sku || null, price, stock, JSON.stringify(attributes))
    ];
    if (stock > 0) {
      statements.push(env.DB.prepare(`
        INSERT INTO inventory_movements (
          id, store_id, product_id, variant_id, movement_type,
          quantity_change, notes, created_by
        )
        SELECT ?, ?, ?, ?, 'initial', ?, 'Initial variant stock', ?
        WHERE EXISTS (
          SELECT 1 FROM product_variants
          WHERE id = ? AND product_id = ? AND store_id = ? AND stock_quantity = ?
        )
      `).bind(crypto.randomUUID(), storeId, productId, id, stock, userId, id, productId, storeId, stock));
    }
    try {
      const results = await env.DB.batch(statements);
      if (!results[0]?.meta?.changes || (stock > 0 && !results[1]?.meta?.changes)) {
        return json({ error: "Unable to create product variant and its initial stock record" }, 409);
      }
      return json({ status: "ok", variant: { id, product_id: productId, name, sku: sku || null, price, stock_quantity: stock, attributes } }, 201);
    } catch {
      return json({ error: "Unable to create variant; check whether the SKU is already used in this store" }, 409);
    }
  }

  if (!["PUT", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);
  const variant = await env.DB.prepare(
    "SELECT id, stock_quantity, status FROM product_variants WHERE id = ? AND product_id = ? AND store_id = ? LIMIT 1"
  ).bind(variantId, productId, storeId).first();
  if (!variant) return json({ error: "Product variant not found" }, 404);

  if (request.method === "DELETE") {
    if (variant.stock_quantity > 0) {
      return json({ error: "A variant with remaining stock cannot be deactivated" }, 409);
    }
    await env.DB.prepare(
      "UPDATE product_variants SET status = 'inactive' WHERE id = ? AND product_id = ? AND store_id = ?"
    ).bind(variantId, productId, storeId).run();
    return json({ status: "ok" });
  }

  const parsed = await readBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const price = body.price;
  const attributes = body.attributes == null ? {} : body.attributes;
  const status = body.status || "active";
  if (!validName(name) || name.length > 100 || (sku && sku.length > 100) ||
      typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
      !["active", "inactive"].includes(status) ||
      !attributes || typeof attributes !== "object" || Array.isArray(attributes) ||
      JSON.stringify(attributes).length > 4000) {
    return json({ error: "Invalid product variant data" }, 400);
  }
  if (status === "inactive" && variant.stock_quantity > 0) {
    return json({ error: "A variant with remaining stock cannot be deactivated" }, 409);
  }
  try {
    await env.DB.prepare(`
      UPDATE product_variants
      SET name = ?, sku = ?, price = ?, attributes_json = ?, status = ?
      WHERE id = ? AND product_id = ? AND store_id = ?
    `).bind(name, sku || null, price, JSON.stringify(attributes), status, variantId, productId, storeId).run();
    return json({ status: "ok" });
  } catch {
    return json({ error: "Unable to update variant; check whether the SKU is already used in this store" }, 409);
  }
}

async function handleProductImages(request, env, storeId, access, productId, imageId) {
  const mediaStorage = createStoreMediaStorage(env);
  const product = await env.DB.prepare(
    "SELECT id FROM products WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);
  if (!canWrite(access)) return json({ error: "Store write permission required" }, 403);

  if (request.method === "PUT" && imageId === "order") {
    const parsed = await readBody(request, 3000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const ids = parsed.body.image_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 ||
        ids.some(id => typeof id !== "string" || id.length > 80) ||
        new Set(ids).size !== ids.length) {
      return json({ error: "Invalid product image order" }, 400);
    }
    const existing = await env.DB.prepare(
      "SELECT id FROM product_images WHERE product_id = ? AND store_id = ?"
    ).bind(productId, storeId).all();
    const existingIds = (existing.results || []).map(item => item.id);
    if (existingIds.length !== ids.length || ids.some(id => !existingIds.includes(id))) {
      return json({ error: "Image list does not match this product gallery" }, 409);
    }
    const updates = ids.map((id, index) => env.DB.prepare(
      "UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ? AND store_id = ?"
    ).bind(index, id, productId, storeId));
    await env.DB.batch(updates);
    return json({ status: "ok", image_ids: ids });
  }

  if (request.method === "POST" && !imageId) {
    const parsed = await readBody(request, 3000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    const fileKey = typeof body.url === "string" ? body.url.trim() : "";
    const altText = typeof body.alt_text === "string" ? body.alt_text.trim() : "";
    const sortOrder = body.sort_order === undefined ? 0 : body.sort_order;
    let externalUrl = false;
    try {
      const parsedUrl = new URL(fileKey);
      externalUrl = parsedUrl.protocol === "https:" && !parsedUrl.username && !parsedUrl.password && fileKey.length <= 2000;
    } catch {}
    const validMediaPath = /^[a-zA-Z0-9_-]{3,80}$/.test(storeId) &&
      new RegExp("^/media/" + storeId + "/[a-f0-9-]+\\.(?:jpg|png|webp|gif)$","i").test(fileKey);
    if ((!externalUrl && !validMediaPath) ||
        altText.length > 250 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      return json({ error: "Image URL must be a valid HTTPS link or an uploaded image belonging to this store" }, 400);
    }
    const imageCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM product_images WHERE product_id = ? AND store_id = ?"
    ).bind(productId, storeId).first();
    if ((imageCount?.total || 0) >= 5) return json({ error: "A product can have at most five images" }, 409);
    if (!externalUrl) {
      if (!mediaStorage || typeof mediaStorage.head !== "function") return json({ error: "Direct HTTPS image URLs are available while file uploads are disabled." }, 503);
      const object = await mediaStorage.head(fileKey.slice("/media/".length));
      if (!object || object.customMetadata?.storeId !== storeId) {
        return json({ error: "Uploaded image not found in this store" }, 404);
      }
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO product_images (id, product_id, store_id, file_key, alt_text, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, productId, storeId, fileKey, altText || null, sortOrder).run();
    return json({ status: "ok", image: { id, product_id: productId, url: fileKey, alt_text: altText, sort_order: sortOrder } }, 201);
  }

  if (request.method === "DELETE" && imageId) {
    const image = await env.DB.prepare(
      "SELECT id, file_key FROM product_images WHERE id = ? AND product_id = ? AND store_id = ? LIMIT 1"
    ).bind(imageId, productId, storeId).first();
    if (!image) return json({ error: "Product image not found" }, 404);
    await env.DB.prepare(
      "DELETE FROM product_images WHERE id = ? AND product_id = ? AND store_id = ?"
    ).bind(imageId, productId, storeId).run();
    if (mediaStorage && typeof mediaStorage.delete === "function" && typeof image.file_key === "string" &&
        image.file_key.startsWith("/media/" + storeId + "/")) {
      const remaining = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM product_images WHERE store_id = ? AND file_key = ?"
      ).bind(storeId, image.file_key).first();
      if (!remaining?.total) await mediaStorage.delete(image.file_key.slice("/media/".length));
    }
    return json({ status: "ok" });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleInventory(request, env, storeId, userId, access) {
  if (request.method === "GET") {
    if (!canRead(access, "inventory.read")) return json({ error: "Store read permission required" }, 403);
    const result = await env.DB.prepare(`
      SELECT im.id, im.product_id, p.name AS product_name, p.sale_unit, im.variant_id,
             v.name AS variant_name, im.movement_type, im.quantity_change, im.unit_code, im.reference_id,
             im.notes, im.created_at, u.full_name AS created_by_name
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id AND p.store_id = im.store_id
      LEFT JOIN product_variants v ON v.id = im.variant_id AND v.product_id = im.product_id AND v.store_id = im.store_id
      LEFT JOIN users u ON u.id = im.created_by
      WHERE im.store_id = ?
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT 100
    `).bind(storeId).all();
    return json({ status: "ok", movements: result.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!canWrite(access, "inventory.manage")) return json({ error: "Store write permission required" }, 403);
  const parsed = await readBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const variantId = body.variant_id == null || body.variant_id === "" ? null : body.variant_id;
  const movementType = body.movement_type;
  const quantityChange = body.quantity_change;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const referenceId = typeof body.reference_id === "string" ? body.reference_id.trim() : "";
  const validTypes = ["initial", "purchase", "sale", "return", "adjustment", "damage"];
  if (!productId || (variantId !== null && typeof variantId !== "string") ||
      !validTypes.includes(movementType) || !Number.isInteger(quantityChange) ||
      quantityChange === 0 || Math.abs(quantityChange) > 1000000000 ||
      notes.length > 1000 || referenceId.length > 120) {
    return json({ error: "Invalid inventory movement data" }, 400);
  }
  if (["initial", "purchase", "return"].includes(movementType) && quantityChange < 0) {
    return json({ error: "This movement type requires a positive quantity" }, 400);
  }
  if (["sale", "damage"].includes(movementType) && quantityChange > 0) {
    return json({ error: "This movement type requires a negative quantity" }, 400);
  }
  const product = await env.DB.prepare(
    "SELECT id, track_inventory, stock_quantity, sale_unit FROM products WHERE id = ? AND store_id = ? LIMIT 1"
  ).bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);
  if (!product.track_inventory) return json({ error: "Inventory tracking is disabled for this product" }, 409);
  if (product.sale_unit === "kg" && quantityChange % 50 !== 0) {
    return json({ error: "Weight inventory movements must use 50 gram increments" }, 400);
  }

  let currentQuantity = product.stock_quantity;
  if (variantId) {
    const variant = await env.DB.prepare(
      "SELECT id, stock_quantity FROM product_variants WHERE id = ? AND product_id = ? AND store_id = ? AND status = 'active' LIMIT 1"
    ).bind(variantId, productId, storeId).first();
    if (!variant) return json({ error: "Product variant not found in this store" }, 404);
    currentQuantity = variant.stock_quantity;
  }
  const nextQuantity = currentQuantity + quantityChange;
  if (nextQuantity < 0) return json({ error: "Insufficient stock for this movement" }, 409);

  const update = variantId
    ? env.DB.prepare(`
        UPDATE product_variants SET stock_quantity = stock_quantity + ?
        WHERE id = ? AND product_id = ? AND store_id = ?
          AND status = 'active' AND stock_quantity = ? AND stock_quantity + ? >= 0
      `).bind(quantityChange, variantId, productId, storeId, currentQuantity, quantityChange)
    : env.DB.prepare(`
        UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ? AND track_inventory = 1
          AND stock_quantity = ? AND stock_quantity + ? >= 0
      `).bind(quantityChange, productId, storeId, currentQuantity, quantityChange);

  const stockCheck = variantId
    ? "SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND store_id = ? AND stock_quantity = ?"
    : "SELECT id FROM products WHERE id = ? AND store_id = ? AND stock_quantity = ?";
  const stockValues = variantId
    ? [variantId, productId, storeId, nextQuantity]
    : [productId, storeId, nextQuantity];

  try {
    const results = await env.DB.batch([
      update,
      env.DB.prepare(`
        INSERT INTO inventory_movements (
          id, store_id, product_id, variant_id, movement_type,
          quantity_change, reference_id, notes, created_by, unit_code
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (${stockCheck})
      `).bind(
        crypto.randomUUID(), storeId, productId, variantId, movementType,
        quantityChange, referenceId || null, notes || null, userId,
        product.sale_unit === "kg" ? "g" : "piece", ...stockValues
      )
    ]);
    if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) {
      return json({ error: "Stock changed concurrently; refresh and try again" }, 409);
    }
    return json({ status: "ok", stock_quantity: nextQuantity });
  } catch {
    return json({ error: "Unable to record inventory movement" }, 409);
  }
}

export async function handleCatalog(request, env) {
  const url = new URL(request.url);
  const variantMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/products\/([^/]+)\/variants(?:\/([^/]+))?$/);
  const imageMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/products\/([^/]+)\/images(?:\/([^/]+))?$/);
  const match = url.pathname.match(/^\/api\/stores\/([^/]+)\/(categories|products|inventory)(?:\/([^/]+))?$/);
  if (!match && !variantMatch && !imageMatch) return null;

  if (!validOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const session = await getAuthenticatedSession(request, env.DB);
  if (!session) return json({ error: "Authentication required" }, 401);

  let storeId;
  let resourceId = null;
  let productId = null;
  let variantId = null;
  try {
    if (variantMatch || imageMatch) {
      const routeMatch = variantMatch || imageMatch;
      storeId = decodeURIComponent(routeMatch[1]);
      productId = decodeURIComponent(routeMatch[2]);
      if (variantMatch) variantId = routeMatch[3] ? decodeURIComponent(routeMatch[3]) : null;
      else resourceId = routeMatch[3] ? decodeURIComponent(routeMatch[3]) : null;
    } else {
      storeId = decodeURIComponent(match[1]);
      resourceId = match[3] ? decodeURIComponent(match[3]) : null;
    }
  } catch {
    return json({ error: "Invalid store or resource ID" }, 400);
  }

  const access = await getStoreAccess(env.DB, storeId, session.user_id);
  if (!access) return json({ error: "Store not found" }, 404);
  if (access.store_status !== "active") return json({ error: "Store is not active" }, 409);

  try {
    if (variantMatch) {
      return await handleVariants(request, env, storeId, session.user_id, access, productId, variantId);
    }
    if (imageMatch) {
      return await handleProductImages(request, env, storeId, access, productId, resourceId);
    }
    if (match[2] === "categories") {
      return await handleCategories(request, env, storeId, session.user_id, access, resourceId);
    }
    if (match[2] === "products") {
      return await handleProducts(request, env, storeId, session.user_id, access, resourceId);
    }
    if (resourceId) return json({ error: "Not found" }, 404);
    return await handleInventory(request, env, storeId, session.user_id, access);
  } catch {
    return json({ error: "Unable to process catalog request" }, 500);
  }
}
