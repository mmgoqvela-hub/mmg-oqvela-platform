import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";

const TRIAL_PLAN_ID = "00000000-0000-4000-8000-000000000001";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleTrial(request, env) {
  const url = new URL(request.url);

  if (!["/api/trial/status", "/api/trial/start"].includes(url.pathname)) {
    return null;
  }

  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!validOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  const session = await getAuthenticatedSession(request, env.DB);

  if (!session) {
    return json({ error: "Authentication required" }, 401);
  }

  try {
    if (request.method === "GET") {
      const accountId = url.searchParams.get("account_id");

      if (!accountId) {
        return json({ error: "Account ID required" }, 400);
      }

      const result = await env.DB.prepare(`
        SELECT
          a.trial_used_at,
          EXISTS (
            SELECT 1
            FROM account_users au
            WHERE au.account_id = a.id
              AND au.user_id = ?
              AND au.status = 'active'
          ) AS is_member,
          COALESCE(pts.enabled, 0) AS trial_enabled,
          COALESCE(pts.duration_days, 0) AS duration_days
        FROM accounts a
        LEFT JOIN platform_trial_settings pts ON pts.id = 1
        WHERE a.id = ?
          AND a.status = 'active'
      `).bind(session.user_id, accountId).first();

      if (!result || !result.is_member) {
        return json({ error: "Account not found" }, 404);
      }

      return json({
        status: "ok",
        has_used_trial: Boolean(result.trial_used_at),
        trial_enabled: Boolean(result.trial_enabled),
        duration_days: result.duration_days
      });
    }

    let body;

    try {
      const raw = await request.text();

      if (raw.length > 5000) {
        return json({ error: "Request too large" }, 413);
      }

      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const accountId = body?.account_id;
    const storeName = typeof body?.store_name === "string"
      ? body.store_name.trim()
      : "";

    if (
      typeof accountId !== "string" ||
      !accountId ||
      storeName.length > 100 ||
      (storeName && storeName.length < 2)
    ) {
      return json({ error: "Invalid account or store name" }, 400);
    }

    const claim = crypto.randomUUID();
    const storeId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const slug = `store-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE accounts
        SET trial_used_at = ?
        WHERE id = ?
          AND status = 'active'
          AND trial_used_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM account_users au
            WHERE au.account_id = accounts.id
              AND au.user_id = ?
              AND au.role = 'owner'
              AND au.status = 'active'
          )
          AND EXISTS (
            SELECT 1
            FROM platform_trial_settings
            WHERE id = 1 AND enabled = 1
          )
          AND EXISTS (
            SELECT 1
            FROM subscription_plans
            WHERE id = ? AND is_active = 1 AND price = 0
          )
      `).bind(claim, accountId, session.user_id, TRIAL_PLAN_ID),

      env.DB.prepare(`
        INSERT INTO stores (
          id, account_id, name, slug, status
        )
        SELECT
          ?, a.id, COALESCE(NULLIF(?, ''), a.name), ?, 'active'
        FROM accounts a
        WHERE a.id = ?
          AND a.trial_used_at = ?
      `).bind(storeId, storeName, slug, accountId, claim),

      env.DB.prepare(`
        INSERT INTO store_subscriptions (
          id, store_id, plan_id, status,
          starts_at, expires_at, auto_renew,
          is_trial, trial_account_id,
          created_at, updated_at
        )
        SELECT
          ?, ?, p.id, 'active',
          CURRENT_TIMESTAMP,
          datetime('now', '+' || ts.duration_days || ' days'),
          0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM subscription_plans p
        JOIN platform_trial_settings ts ON ts.id = 1
        JOIN stores s ON s.id = ?
        WHERE p.id = ?
          AND ts.enabled = 1
          AND p.is_active = 1
      `).bind(
        subscriptionId,
        storeId,
        accountId,
        storeId,
        TRIAL_PLAN_ID
      ),

      env.DB.prepare(`
        UPDATE accounts
        SET trial_used_at = CURRENT_TIMESTAMP
        WHERE id = ? AND trial_used_at = ?
      `).bind(accountId, claim)
    ]);

    const claimed = results[0]?.meta?.changes || 0;
    const storeCreated = results[1]?.meta?.changes || 0;
    const subscriptionCreated = results[2]?.meta?.changes || 0;

    if (!claimed || !storeCreated || !subscriptionCreated) {
      return json({
        error: "Trial unavailable or already used"
      }, 409);
    }

    return json({
      status: "ok",
      message: "تم تفعيل الفترة التجريبية وإنشاء متجرك بنجاح",
      store: {
        id: storeId,
        name: storeName || "متجرك",
        slug
      },
      subscription_id: subscriptionId
    }, 201);

  } catch {
    return json({ error: "Unable to activate trial" }, 500);
  }
}
