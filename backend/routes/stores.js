import {
  getAuthenticatedSession,
  validOrigin
} from "../security/authentication.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleStores(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/stores\/([^/]+)$/);

  if (!match) return null;

  if (!["GET", "PUT"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!validOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  const session = await getAuthenticatedSession(request, env.DB);

  if (!session) {
    return json({ error: "Authentication required" }, 401);
  }

  let storeId;

  try {
    storeId = decodeURIComponent(match[1]);
  } catch {
    return json({ error: "Invalid store ID" }, 400);
  }

  try {
    const store = await env.DB.prepare(`
      SELECT
        s.id,
        s.account_id,
        s.name,
        s.slug,
        s.business_type,
        s.description,
        s.status,
        s.created_at,
        s.updated_at,
        au.role AS account_role,
        (
          SELECT ss.status
          FROM store_subscriptions ss
          WHERE ss.store_id = s.id
          ORDER BY ss.created_at DESC
          LIMIT 1
        ) AS subscription_status,
        (
          SELECT ss.expires_at
          FROM store_subscriptions ss
          WHERE ss.store_id = s.id
          ORDER BY ss.created_at DESC
          LIMIT 1
        ) AS subscription_expires_at
      FROM stores s
      JOIN account_users au
        ON au.account_id = s.account_id
      JOIN accounts a
        ON a.id = s.account_id
      WHERE s.id = ?
        AND au.user_id = ?
        AND au.status = 'active'
        AND a.status = 'active'
      LIMIT 1
    `).bind(storeId, session.user_id).first();

    if (!store) {
      return json({ error: "Store not found" }, 404);
    }

    if (request.method === "GET") {
      return json({ status: "ok", store });
    }

    if (!["owner", "admin"].includes(store.account_role)) {
      return json({
        error: "You do not have permission to edit this store"
      }, 403);
    }

    const raw = await request.text();

    if (raw.length > 5000) {
      return json({ error: "Request too large" }, 413);
    }

    let body;

    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const name = typeof body?.name === "string"
      ? body.name.trim()
      : "";

    const businessType = body?.business_type == null
      ? ""
      : typeof body.business_type === "string"
        ? body.business_type.trim()
        : null;

    const description = body?.description == null
      ? ""
      : typeof body.description === "string"
        ? body.description.trim()
        : null;

    if (
      name.length < 2 ||
      name.length > 100 ||
      businessType === null ||
      businessType.length > 80 ||
      description === null ||
      description.length > 1000
    ) {
      return json({
        error: "تحقق من البيانات: الاسم 2-100 حرف، ونوع النشاط 80، والوصف 1000 حرف كحد أقصى."
      }, 400);
    }

    const result = await env.DB.prepare(`
      UPDATE stores
      SET
        name = ?,
        business_type = ?,
        description = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND account_id = ?
    `).bind(
      name,
      businessType || null,
      description || null,
      storeId,
      store.account_id
    ).run();

    if (!result.meta?.changes) {
      return json({ error: "Store was not updated" }, 409);
    }

    return json({
      status: "ok",
      message: "تم تحديث بيانات المتجر بنجاح"
    });

  } catch {
    return json({ error: "Unable to process store request" }, 500);
  }
}
