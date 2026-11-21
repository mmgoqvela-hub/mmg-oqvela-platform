import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";
import { parseAmountToMinorUnits, formatMinorUnits } from "../finance/money.js";
import { parseProfitPercentToBps } from "../finance/tier_pricing.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function readBody(request, maxLength = 12000) {
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
    JOIN accounts a ON a.id=s.account_id
    JOIN account_users au ON au.account_id=s.account_id
    LEFT JOIN store_members sm ON sm.store_id=s.id AND sm.user_id=au.user_id AND sm.status='active'
    LEFT JOIN member_roles mr ON mr.store_member_id=sm.id
    LEFT JOIN roles r ON r.id=mr.role_id AND r.store_id=s.id
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE s.id=? AND au.user_id=? AND au.status='active' AND a.status='active'
      AND (au.role IN ('owner','admin') OR sm.id IS NOT NULL)
    GROUP BY s.id, au.role LIMIT 1
  `).bind(storeId, userId).first();
}

function permitted(access, code) {
  return ["owner", "admin"].includes(access?.account_role) ||
    String(access?.permissions || "").split(",").includes(code);
}


function percentText(bps) {
  if (bps == null) return null;
  return (bps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function validTierCode(value) {
  return ["retail", "wholesale", "bulk_wholesale"].includes(value);
}

async function pricingSettings(request, env, storeId, userId, access) {
  if (request.method === "GET") {
    if (!permitted(access, "catalog.read")) return json({ error: "Store read permission required" }, 403);
    const [settings, tiers] = await Promise.all([
      env.DB.prepare("SELECT pricing_mode,cost_currency,rounding_increment_minor_units,updated_at FROM store_pricing_settings WHERE store_id=?").bind(storeId).first(),
      env.DB.prepare("SELECT tier_code,min_quantity,profit_margin_bps,is_enabled,updated_at FROM store_pricing_tiers WHERE store_id=? ORDER BY min_quantity").bind(storeId).all()
    ]);
    if (!settings) return json({ error: "Pricing settings not found" }, 404);
    return json({ status: "ok", settings, tiers: (tiers.results || []).map(t => ({ ...t, profit_margin_percent: percentText(t.profit_margin_bps) })) });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  if (!permitted(access, "catalog.manage")) return json({ error: "Store write permission required" }, 403);
  const parsed = await readBody(request, 10000);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const b = parsed.body;
  const mode = b.pricing_mode;
  const increment = b.rounding_increment_minor_units;
  if (!["manual", "cost_plus_margin"].includes(mode) ||
      !Number.isInteger(increment) || increment < 1 || increment > 1000000 ||
      !Array.isArray(b.tiers) || b.tiers.length !== 3) {
    return json({ error: "Provide a pricing mode, valid rounding increment and all three pricing tiers" }, 400);
  }
  const byCode = new Map();
  try {
    for (const tier of b.tiers) {
      if (!tier || !validTierCode(tier.tier_code) || byCode.has(tier.tier_code) ||
          !Number.isInteger(tier.min_quantity) || tier.min_quantity < 1 || tier.min_quantity > 1000000000 ||
          typeof tier.is_enabled !== "boolean") throw new Error("Invalid tier configuration");
      if (tier.tier_code === "retail" && tier.min_quantity !== 1) throw new Error("Retail must start at quantity 1");
      const margin = tier.profit_margin_percent == null || tier.profit_margin_percent === ""
        ? null : parseProfitPercentToBps(tier.profit_margin_percent);
      if (tier.is_enabled && margin === null) throw new Error("Every enabled tier needs a profit percentage");
      byCode.set(tier.tier_code, { ...tier, profit_margin_bps: margin });
    }
  } catch (error) {
    return json({ error: error.message || "Invalid tier configuration" }, 400);
  }
  if (byCode.size !== 3 || !byCode.get("retail")?.is_enabled ||
      byCode.get("wholesale").min_quantity <= 1 ||
      byCode.get("bulk_wholesale").min_quantity <= byCode.get("wholesale").min_quantity) {
    return json({ error: "Enable retail and set strictly increasing minimum quantities for wholesale and bulk wholesale" }, 400);
  }
  const statements = [
    env.DB.prepare(`
      UPDATE store_pricing_settings SET pricing_mode=?,rounding_increment_minor_units=?,
        updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE store_id=?
    `).bind(mode, increment, userId, storeId)
  ];
  for (const code of ["retail", "wholesale", "bulk_wholesale"]) {
    const tier = byCode.get(code);
    statements.push(env.DB.prepare(`
      UPDATE store_pricing_tiers SET min_quantity=?,profit_margin_bps=?,is_enabled=?,updated_at=CURRENT_TIMESTAMP
      WHERE store_id=? AND tier_code=?
    `).bind(tier.min_quantity, tier.profit_margin_bps, tier.is_enabled ? 1 : 0, storeId, code));
  }
  try {
    const results = await env.DB.batch(statements);
    if (results.some(result => !result?.meta?.changes)) return json({ error: "Pricing settings changed concurrently; refresh and retry" }, 409);
    return json({ status: "ok", message: "Pricing settings saved. Existing posted sales are unchanged." });
  } catch {
    return json({ error: "Unable to save pricing settings" }, 409);
  }
}

async function productCosts(request, env, storeId, userId, access, productId) {
  if (!permitted(access, request.method === "GET" ? "inventory.read" : "inventory.manage")) {
    return json({ error: "Inventory permission required" }, 403);
  }
  const product = await env.DB.prepare("SELECT id,name FROM products WHERE id=? AND store_id=?")
    .bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT id,variant_id,cost_currency,cost_minor_units,cost_source,source_reference,
        effective_at,created_at,idempotency_key
      FROM product_cost_versions WHERE store_id=? AND product_id=?
      ORDER BY effective_at DESC,created_at DESC LIMIT 200
    `).bind(storeId, productId).all();
    return json({ status: "ok", costs: (rows.results || []).map(row => ({
      ...row, cost: formatMinorUnits(row.cost_minor_units, 2)
    })) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const parsed = await readBody(request, 5000);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const b = parsed.body;
  const variantId = b.variant_id == null || b.variant_id === "" ? null : b.variant_id;
  const source = b.cost_source || "manual";
  const key = typeof b.idempotency_key === "string" ? b.idempotency_key.trim() : "";
  if ((variantId !== null && typeof variantId !== "string") ||
      !["manual", "import"].includes(source) || key.length < 8 || key.length > 120 ||
      typeof b.cost !== "string") return json({ error: "Provide a USD cost, valid source, and idempotency key" }, 400);
  if (variantId) {
    const variant = await env.DB.prepare("SELECT id FROM product_variants WHERE id=? AND product_id=? AND store_id=?")
      .bind(variantId, productId, storeId).first();
    if (!variant) return json({ error: "Variant not found for this product" }, 404);
  }
  let costMinor;
  try {
    costMinor = parseAmountToMinorUnits(b.cost, 2);
    if (costMinor < 0) throw new RangeError("Cost cannot be negative");
  } catch {
    return json({ error: "Cost must be a valid non-negative USD amount with no more than two decimal places" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id,cost_minor_units,variant_id,cost_source FROM product_cost_versions WHERE store_id=? AND idempotency_key=?")
    .bind(storeId, key).first();
  if (existing) {
    if (existing.cost_minor_units !== costMinor || existing.variant_id !== variantId || existing.cost_source !== source) {
      return json({ error: "Idempotency key was already used for a different cost entry" }, 409);
    }
    return json({ status: "ok", duplicate: true, cost_version: { ...existing, cost: formatMinorUnits(existing.cost_minor_units, 2) } });
  }
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO product_cost_versions
        (id,store_id,product_id,variant_id,cost_currency,cost_minor_units,cost_source,effective_at,idempotency_key,created_by)
      VALUES (?,?,?,?,'USD',?,?,CURRENT_TIMESTAMP,?,?)
    `).bind(id, storeId, productId, variantId, costMinor, source, key, userId).run();
    return json({ status: "ok", cost_version: {
      id, product_id: productId, variant_id: variantId, cost_currency: "USD",
      cost_minor_units: costMinor, cost: formatMinorUnits(costMinor, 2), cost_source: source
    }}, 201);
  } catch {
    return json({ error: "Unable to save cost version; refresh and check the idempotency key" }, 409);
  }
}

async function productOverrides(request, env, storeId, access, productId) {
  if (!permitted(access, request.method === "GET" ? "catalog.read" : "catalog.manage")) {
    return json({ error: "Catalog permission required" }, 403);
  }
  const product = await env.DB.prepare("SELECT id FROM products WHERE id=? AND store_id=?")
    .bind(productId, storeId).first();
  if (!product) return json({ error: "Product not found" }, 404);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT id,variant_id,tier_code,profit_margin_bps,min_quantity,is_enabled,updated_at
      FROM product_tier_margin_overrides WHERE store_id=? AND product_id=?
      ORDER BY tier_code,variant_id
    `).bind(storeId, productId).all();
    return json({ status: "ok", overrides: (rows.results || []).map(row => ({
      ...row, profit_margin_percent: percentText(row.profit_margin_bps)
    })) });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  const parsed = await readBody(request, 5000);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const b = parsed.body;
  const variantId = b.variant_id == null || b.variant_id === "" ? null : b.variant_id;
  if ((variantId !== null && typeof variantId !== "string") || !validTierCode(b.tier_code) ||
      typeof b.is_enabled !== "boolean") return json({ error: "Invalid product pricing override" }, 400);
  if (variantId) {
    const variant = await env.DB.prepare("SELECT id FROM product_variants WHERE id=? AND product_id=? AND store_id=?")
      .bind(variantId, productId, storeId).first();
    if (!variant) return json({ error: "Variant not found for this product" }, 404);
  }
  let margin;
  try { margin = parseProfitPercentToBps(b.profit_margin_percent); }
  catch (error) { return json({ error: error.message }, 400); }
  const minQuantity = b.min_quantity == null ? null : b.min_quantity;
  if (minQuantity !== null && (!Number.isInteger(minQuantity) || minQuantity < 1 || minQuantity > 1000000000)) {
    return json({ error: "Invalid minimum quantity override" }, 400);
  }
  const existing = variantId
    ? await env.DB.prepare("SELECT id FROM product_tier_margin_overrides WHERE store_id=? AND product_id=? AND variant_id=? AND tier_code=?")
      .bind(storeId, productId, variantId, b.tier_code).first()
    : await env.DB.prepare("SELECT id FROM product_tier_margin_overrides WHERE store_id=? AND product_id=? AND variant_id IS NULL AND tier_code=?")
      .bind(storeId, productId, b.tier_code).first();
  try {
    if (existing) {
      await env.DB.prepare(`
        UPDATE product_tier_margin_overrides SET profit_margin_bps=?,min_quantity=?,is_enabled=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND store_id=?
      `).bind(margin, minQuantity, b.is_enabled ? 1 : 0, existing.id, storeId).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO product_tier_margin_overrides
          (id,store_id,product_id,variant_id,tier_code,profit_margin_bps,min_quantity,is_enabled)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(crypto.randomUUID(), storeId, productId, variantId, b.tier_code, margin, minQuantity, b.is_enabled ? 1 : 0).run();
    }
    return json({ status: "ok", message: "Product pricing override saved" });
  } catch {
    return json({ error: "Unable to save pricing override; refresh and retry" }, 409);
  }
}

export async function handlePricing(request, env) {
  const url = new URL(request.url);
  const settingsMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/pricing$/);
  const costMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/products\/([^/]+)\/costs$/);
  const overrideMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/products\/([^/]+)\/pricing-overrides$/);
  if (!settingsMatch && !costMatch && !overrideMatch) return null;
  if (!validOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const session = await getAuthenticatedSession(request, env.DB);
  if (!session) return json({ error: "Authentication required" }, 401);
  let storeId, productId = null;
  try {
    const match = settingsMatch || costMatch || overrideMatch;
    storeId = decodeURIComponent(match[1]);
    if (costMatch || overrideMatch) productId = decodeURIComponent(match[2]);
  } catch {
    return json({ error: "Invalid store or product ID" }, 400);
  }
  const access = await storeAccess(env.DB, storeId, session.user_id);
  if (!access) return json({ error: "Store not found" }, 404);
  if (access.store_status !== "active") return json({ error: "Store is not active" }, 409);
  try {
    if (settingsMatch) return await pricingSettings(request, env, storeId, session.user_id, access);
    if (costMatch) return await productCosts(request, env, storeId, session.user_id, access, productId);
    return await productOverrides(request, env, storeId, access, productId);
  } catch {
    return json({ error: "Unable to process pricing request" }, 500);
  }
}
