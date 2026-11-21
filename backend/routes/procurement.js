import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";
import { parseAmountToMinorUnits, formatMinorUnits } from "../finance/money.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function readBody(request, maxLength = 30000) {
  const raw = await request.text();
  if (raw.length > maxLength) return { error: "Request too large", status: 413 };
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body", status: 400 };
    return { body };
  } catch {
    return { error: "Invalid JSON", status: 400 };
  }
}

async function storeAccess(db, storeId, userId) {
  return db.prepare(`
    SELECT s.id, s.status AS store_status, au.role AS account_role,
           COALESCE(GROUP_CONCAT(DISTINCT p.code), '') AS permissions
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    JOIN account_users au ON au.account_id = s.account_id
    LEFT JOIN store_members sm ON sm.store_id = s.id AND sm.user_id = au.user_id AND sm.status = 'active'
    LEFT JOIN member_roles mr ON mr.store_member_id = sm.id
    LEFT JOIN roles r ON r.id = mr.role_id AND r.store_id = s.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE s.id = ? AND au.user_id = ? AND au.status = 'active' AND a.status = 'active'
      AND (au.role IN ('owner','admin') OR sm.id IS NOT NULL)
    GROUP BY s.id, au.role
    LIMIT 1
  `).bind(storeId, userId).first();
}

function permitted(access, code) {
  return ["owner", "admin"].includes(access?.account_role) ||
    String(access?.permissions || "").split(",").includes(code);
}

function validOptionalText(value, max) {
  return value == null || (typeof value === "string" && value.trim().length <= max);
}

async function suppliers(request, env, storeId, userId, access, supplierId) {
  if (request.method === "GET" && !supplierId) {
    if (!permitted(access, "inventory.read")) return json({ error: "Store read permission required" }, 403);
    const rows = await env.DB.prepare(`
      SELECT id, name, phone, email, address, tax_reference, notes, status, created_at, updated_at
      FROM suppliers WHERE store_id = ? ORDER BY name COLLATE NOCASE LIMIT 500
    `).bind(storeId).all();
    return json({ status: "ok", suppliers: rows.results || [] });
  }

  if (request.method === "POST" && !supplierId) {
    if (!permitted(access, "inventory.manage")) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request, 8000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const phone = typeof b.phone === "string" ? b.phone.trim() : "";
    const email = typeof b.email === "string" ? b.email.trim() : "";
    const address = typeof b.address === "string" ? b.address.trim() : "";
    const tax = typeof b.tax_reference === "string" ? b.tax_reference.trim() : "";
    const notes = typeof b.notes === "string" ? b.notes.trim() : "";
    if (name.length < 2 || name.length > 160 || phone.length > 60 ||
        email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        address.length > 1000 || tax.length > 100 || notes.length > 2000) {
      return json({ error: "Invalid supplier data" }, 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO suppliers (id, store_id, name, phone, email, address, tax_reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, storeId, name, phone || null, email || null, address || null, tax || null, notes || null).run();
    return json({ status: "ok", supplier: { id, name, phone, email, address, tax_reference: tax, notes, status: "active" } }, 201);
  }

  if (!supplierId || !["PUT", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  if (!permitted(access, "inventory.manage")) return json({ error: "Store write permission required" }, 403);
  const existing = await env.DB.prepare("SELECT id FROM suppliers WHERE id = ? AND store_id = ?").bind(supplierId, storeId).first();
  if (!existing) return json({ error: "Supplier not found" }, 404);

  if (request.method === "DELETE") {
    const used = await env.DB.prepare("SELECT COUNT(*) AS total FROM purchase_orders WHERE supplier_id = ? AND store_id = ?").bind(supplierId, storeId).first();
    if (Number(used?.total || 0)) {
      await env.DB.prepare("UPDATE suppliers SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?").bind(supplierId, storeId).run();
      return json({ status: "ok", deactivated: true });
    }
    await env.DB.prepare("DELETE FROM suppliers WHERE id = ? AND store_id = ?").bind(supplierId, storeId).run();
    return json({ status: "ok", deleted: true });
  }

  const parsed = await readBody(request, 8000);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const b = parsed.body;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const tax = typeof b.tax_reference === "string" ? b.tax_reference.trim() : "";
  const notes = typeof b.notes === "string" ? b.notes.trim() : "";
  const status = b.status || "active";
  if (name.length < 2 || name.length > 160 || phone.length > 60 ||
      email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
      address.length > 1000 || tax.length > 100 || notes.length > 2000 ||
      !["active", "inactive"].includes(status)) return json({ error: "Invalid supplier data" }, 400);
  await env.DB.prepare(`
    UPDATE suppliers SET name=?, phone=?, email=?, address=?, tax_reference=?, notes=?, status=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?
  `).bind(name, phone || null, email || null, address || null, tax || null, notes || null, status, supplierId, storeId).run();
  return json({ status: "ok" });
}

async function prepareItems(db, storeId, items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new Error("Purchase order must contain 1 to 100 items");
  const prepared = [];
  let total = 0n;
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.product_id !== "string" ||
        (item.variant_id != null && typeof item.variant_id !== "string") ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000000000 ||
        typeof item.unit_cost !== "string") throw new Error("Invalid purchase order item");

    const unitCost = BigInt(parseAmountToMinorUnits(item.unit_cost, 2));
    const lineTotal = unitCost * BigInt(item.quantity);
    if (lineTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Purchase order line total is too large");
    const product = await db.prepare(
      "SELECT id, name, sku, track_inventory, status FROM products WHERE id=? AND store_id=?"
    ).bind(item.product_id, storeId).first();
    if (!product) throw new Error("A selected product does not belong to this store");
    if (!product.track_inventory) throw new Error("Purchase orders can only include inventory-tracked products");
    if (item.variant_id) {
      const variant = await db.prepare(
        "SELECT id, name, sku FROM product_variants WHERE id=? AND product_id=? AND store_id=?"
      ).bind(item.variant_id, item.product_id, storeId).first();
      if (!variant) throw new Error("A selected variant does not belong to this product and store");
    }
    total += lineTotal;
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Purchase order total is too large");
    prepared.push({
      id: crypto.randomUUID(),
      product_id: product.id,
      variant_id: item.variant_id || null,
      product_name_snapshot: product.name,
      sku_snapshot: product.sku || null,
      quantity: item.quantity,
      unit_cost_minor_units: Number(unitCost),
      line_total_minor_units: Number(lineTotal)
    });
  }
  return { items: prepared, total_minor_units: Number(total), total: formatMinorUnits(total, 2) };
}

async function purchaseOrders(request, env, storeId, userId, access, orderId) {
  if (request.method === "GET" && !orderId) {
    if (!permitted(access, "inventory.read")) return json({ error: "Store read permission required" }, 403);
    const rows = await env.DB.prepare(`
      SELECT po.id, po.order_number, po.status, po.currency, po.total_minor_units,
             po.notes, po.expected_at, po.created_at, po.updated_at,
             s.id AS supplier_id, s.name AS supplier_name
      FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id AND s.store_id=po.store_id
      WHERE po.store_id=? ORDER BY po.created_at DESC LIMIT 200
    `).bind(storeId).all();
    return json({ status: "ok", purchase_orders: (rows.results || []).map(x => ({
      ...x, total: formatMinorUnits(x.total_minor_units, 2)
    })) });
  }

  if (request.method === "GET" && orderId) {
    if (!permitted(access, "inventory.read")) return json({ error: "Store read permission required" }, 403);
    const order = await env.DB.prepare(`
      SELECT po.*, s.name AS supplier_name FROM purchase_orders po
      JOIN suppliers s ON s.id=po.supplier_id AND s.store_id=po.store_id
      WHERE po.id=? AND po.store_id=?
    `).bind(orderId, storeId).first();
    if (!order) return json({ error: "Purchase order not found" }, 404);
    const rows = await env.DB.prepare(`
      SELECT id, product_id, variant_id, product_name_snapshot, sku_snapshot,
             quantity, unit_cost_minor_units, line_total_minor_units, currency
      FROM purchase_order_items WHERE purchase_order_id=? AND store_id=? ORDER BY rowid
    `).bind(orderId, storeId).all();
    return json({ status: "ok", purchase_order: {
      ...order, total: formatMinorUnits(order.total_minor_units, 2),
      items: (rows.results || []).map(x => ({
        ...x, unit_cost: formatMinorUnits(x.unit_cost_minor_units, 2),
        line_total: formatMinorUnits(x.line_total_minor_units, 2)
      }))
    }});
  }

  if (request.method === "POST" && !orderId) {
    if (!permitted(access, "inventory.manage")) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request, 30000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    const supplierId = typeof b.supplier_id === "string" ? b.supplier_id : "";
    const orderNumber = typeof b.order_number === "string" ? b.order_number.trim() : "";
    const notes = typeof b.notes === "string" ? b.notes.trim() : "";
    const expectedAt = typeof b.expected_at === "string" ? b.expected_at.trim() : "";
    if (!supplierId || orderNumber.length < 2 || orderNumber.length > 80 ||
        notes.length > 2000 || expectedAt.length > 40) return json({ error: "Invalid purchase order data" }, 400);
    const supplier = await env.DB.prepare(
      "SELECT id FROM suppliers WHERE id=? AND store_id=? AND status='active'"
    ).bind(supplierId, storeId).first();
    if (!supplier) return json({ error: "Active supplier not found in this store" }, 404);
    let prepared;
    try { prepared = await prepareItems(env.DB, storeId, b.items); }
    catch (error) { return json({ error: error.message || "Invalid purchase order items" }, 400); }
    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(`
        INSERT INTO purchase_orders (id,store_id,supplier_id,order_number,status,currency,total_minor_units,notes,expected_at,created_by)
        VALUES (?,?,?,?,'draft','USD',?,?,?,?)
      `).bind(id, storeId, supplierId, orderNumber, prepared.total_minor_units, notes || null, expectedAt || null, userId),
      ...prepared.items.map(item => env.DB.prepare(`
        INSERT INTO purchase_order_items
          (id,store_id,purchase_order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,quantity,unit_cost_minor_units,line_total_minor_units,currency)
        VALUES (?,?,?,?,?,?,?,?,?,?,'USD')
      `).bind(item.id, storeId, id, item.product_id, item.variant_id, item.product_name_snapshot,
        item.sku_snapshot, item.quantity, item.unit_cost_minor_units, item.line_total_minor_units))
    ];
    try {
      await env.DB.batch(statements);
      return json({ status: "ok", purchase_order: {
        id, order_number: orderNumber, supplier_id: supplierId, status: "draft",
        currency: "USD", total_minor_units: prepared.total_minor_units, total: prepared.total
      }}, 201);
    } catch {
      return json({ error: "Unable to create purchase order; check the order number and item data" }, 409);
    }
  }

  if (request.method === "POST" && orderId) {
    if (!permitted(access, "inventory.manage")) return json({ error: "Store write permission required" }, 403);
    const parsed = await readBody(request, 3000);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);
    const action = parsed.body.action;
    if (!["submit", "approve", "cancel"].includes(action)) return json({ error: "Invalid purchase order action" }, 400);
    const order = await env.DB.prepare(
      "SELECT id,status FROM purchase_orders WHERE id=? AND store_id=?"
    ).bind(orderId, storeId).first();
    if (!order) return json({ error: "Purchase order not found" }, 404);
    let result;
    if (action === "submit" && order.status === "draft") {
      result = await env.DB.prepare(
        "UPDATE purchase_orders SET status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=? AND status='draft'"
      ).bind(orderId, storeId).run();
    } else if (action === "approve" && order.status === "submitted") {
      result = await env.DB.prepare(
        "UPDATE purchase_orders SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=? AND status='submitted'"
      ).bind(userId, orderId, storeId).run();
    } else if (action === "cancel" && ["draft","submitted","approved"].includes(order.status)) {
      result = await env.DB.prepare(
        "UPDATE purchase_orders SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=? AND status=?"
      ).bind(orderId, storeId, order.status).run();
    } else {
      return json({ error: "This purchase order cannot perform that transition" }, 409);
    }
    if (!result?.meta?.changes) return json({ error: "Purchase order changed concurrently" }, 409);
    return json({ status: "ok", purchase_order_status: action === "submit" ? "submitted" : action === "approve" ? "approved" : "cancelled", stock_changed: false });
  }

  return json({ error: "Method not allowed" }, 405);
}

export async function handleProcurement(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/stores\/([^/]+)\/(suppliers|purchase-orders)(?:\/([^/]+))?$/);
  if (!match) return null;
  if (!validOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const session = await getAuthenticatedSession(request, env.DB);
  if (!session) return json({ error: "Authentication required" }, 401);

  let storeId, resourceId;
  try {
    storeId = decodeURIComponent(match[1]);
    resourceId = match[3] ? decodeURIComponent(match[3]) : null;
  } catch {
    return json({ error: "Invalid store or resource ID" }, 400);
  }

  const access = await storeAccess(env.DB, storeId, session.user_id);
  if (!access) return json({ error: "Store not found" }, 404);
  if (access.store_status !== "active") return json({ error: "Store is not active" }, 409);

  try {
    if (match[2] === "suppliers") return await suppliers(request, env, storeId, session.user_id, access, resourceId);
    return await purchaseOrders(request, env, storeId, session.user_id, access, resourceId);
  } catch {
    return json({ error: "Unable to process procurement request" }, 500);
  }
}
