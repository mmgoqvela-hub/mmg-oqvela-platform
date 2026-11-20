import {
  getAuthenticatedSession,
  validOrigin
} from "../security/authentication.js";

import { getPlatformAdmin } from "../security/admin.js";

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

async function readBody(request, maxLength = 10000) {
  const raw = await request.text();

  if (raw.length > maxLength) {
    return { error: "Request too large", status: 413 };
  }

  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: "Invalid JSON", status: 400 };
  }
}

function validTransactionReference(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 3 &&
    value.trim().length <= 120 &&
    /^[\p{L}\p{N}._/-]+$/u.test(value.trim())
  );
}

function validPlanData(body) {
  return (
    typeof body?.name === "string" &&
    body.name.trim().length >= 2 &&
    body.name.trim().length <= 80 &&
    (body.description == null ||
      (typeof body.description === "string" &&
       body.description.length <= 500)) &&
    typeof body.price === "number" &&
    Number.isFinite(body.price) &&
    body.price > 0 &&
    typeof body.currency === "string" &&
    /^[A-Z]{3}$/.test(body.currency) &&
    Number.isInteger(body.duration_days) &&
    body.duration_days >= 1 &&
    body.duration_days <= 3650 &&
    (body.is_active === undefined ||
      typeof body.is_active === "boolean")
  );
}

async function getMemberStore(db, storeId, userId) {
  return await db.prepare(`
    SELECT
      s.id,
      s.account_id,
      s.name,
      s.status AS store_status,
      a.status AS account_status,
      au.role AS account_role
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    JOIN account_users au ON au.account_id = s.account_id
    WHERE s.id = ?
      AND au.user_id = ?
      AND au.status = 'active'
      AND a.status = 'active'
    LIMIT 1
  `).bind(storeId, userId).first();
}

async function getPublicPlans(db) {
  const result = await db.prepare(`
    SELECT id, name, description, price, currency, duration_days
    FROM subscription_plans
    WHERE is_active = 1
      AND price > 0
      AND id != ?
    ORDER BY price ASC, duration_days ASC
  `).bind(TRIAL_PLAN_ID).all();

  return result.results || [];
}

async function getStoreSubscription(db, storeId, userId) {
  const store = await getMemberStore(db, storeId, userId);

  if (!store) return null;

  const result = await db.prepare(`
    SELECT
      ss.id AS subscription_id,
      ss.status AS subscription_status,
      ss.starts_at,
      ss.expires_at,
      ss.created_at AS subscription_created_at,
      sp.id AS plan_id,
      sp.name AS plan_name,
      sp.description AS plan_description,
      sp.price AS plan_price,
      sp.currency AS plan_currency,
      sp.duration_days,
      p.id AS payment_id,
      p.amount,
      p.currency AS payment_currency,
      p.payment_method,
      p.transaction_reference,
      p.status AS payment_status,
      p.rejection_reason,
      p.created_at AS payment_created_at,
      p.paid_at
    FROM store_subscriptions ss
    JOIN subscription_plans sp ON sp.id = ss.plan_id
    LEFT JOIN payments p ON p.subscription_id = ss.id
    WHERE ss.store_id = ?
    ORDER BY ss.created_at DESC
    LIMIT 20
  `).bind(storeId).all();

  return {
    store,
    subscriptions: result.results || []
  };
}

async function createSubscriptionRequest(request, env, session) {
  const parsed = await readBody(request);

  if (parsed.error) {
    return json({ error: parsed.error }, parsed.status);
  }

  const body = parsed.body || {};
  const storeId = body.store_id;
  const planId = body.plan_id;
  const reference = typeof body.transaction_reference === "string"
    ? body.transaction_reference.trim()
    : "";

  if (
    typeof storeId !== "string" ||
    !storeId ||
    typeof planId !== "string" ||
    !planId ||
    !validTransactionReference(reference)
  ) {
    return json({
      error: "تحقق من المتجر والباقة ورقم عملية التحويل."
    }, 400);
  }

  const store = await getMemberStore(
    env.DB,
    storeId,
    session.user_id
  );

  if (!store) {
    return json({ error: "المتجر غير موجود أو لا تملك صلاحية الوصول إليه." }, 404);
  }

  if (!["owner", "admin"].includes(store.account_role)) {
    return json({ error: "يجب أن تكون مالك المتجر أو مديره لتقديم طلب اشتراك." }, 403);
  }

  if (store.store_status !== "active") {
    return json({ error: "لا يمكن طلب اشتراك لمتجر غير نشط." }, 409);
  }

  const plan = await env.DB.prepare(`
    SELECT id, name, price, currency, duration_days
    FROM subscription_plans
    WHERE id = ?
      AND is_active = 1
      AND price > 0
      AND id != ?
    LIMIT 1
  `).bind(planId, TRIAL_PLAN_ID).first();

  if (!plan) {
    return json({ error: "الباقة غير متاحة حالياً." }, 404);
  }

  const settingsResult = await env.DB.prepare(`
    SELECT setting_key, setting_value
    FROM platform_settings
    WHERE setting_key IN (
      'shamcash_enabled',
      'shamcash_link',
      'shamcash_recipient',
      'shamcash_instructions'
    )
  `).all();

  const settings = {};

  for (const item of settingsResult.results || []) {
    settings[item.setting_key] = item.setting_value;
  }

  if (
    settings.shamcash_enabled !== "1" ||
    !settings.shamcash_recipient?.trim()
  ) {
    return json({
      error: "الدفع عبر شام كاش غير متاح حالياً. يرجى المحاولة لاحقاً."
    }, 409);
  }

  const current = await env.DB.prepare(`
    SELECT status
    FROM store_subscriptions
    WHERE store_id = ?
      AND status IN ('pending', 'active', 'suspended')
    LIMIT 1
  `).bind(storeId).first();

  if (current) {
    return json({
      error: current.status === "pending"
        ? "لديك طلب اشتراك قيد المراجعة لهذا المتجر."
        : current.status === "active"
          ? "لدى هذا المتجر اشتراك نشط بالفعل."
          : "اشتراك هذا المتجر معلّق إدارياً، يرجى التواصل مع الإدارة."
    }, 409);
  }

  const subscriptionId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const historyId = crypto.randomUUID();

  const snapshot = JSON.stringify({
    method: "شام كاش",
    recipient: settings.shamcash_recipient,
    link: settings.shamcash_link || "",
    instructions: settings.shamcash_instructions || ""
  });

  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO store_subscriptions (
          id, store_id, plan_id, status,
          starts_at, expires_at, auto_renew,
          is_trial, created_at, updated_at
        )
        SELECT
          ?, ?, ?, 'pending',
          NULL, NULL, 0, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1
          FROM stores s
          JOIN accounts a ON a.id = s.account_id
          JOIN account_users au ON au.account_id = s.account_id
          WHERE s.id = ?
            AND s.status = 'active'
            AND a.status = 'active'
            AND au.user_id = ?
            AND au.status = 'active'
            AND au.role IN ('owner', 'admin')
        )
        AND EXISTS (
          SELECT 1 FROM subscription_plans
          WHERE id = ? AND is_active = 1 AND price > 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM store_subscriptions
          WHERE store_id = ?
            AND status IN ('pending', 'active', 'suspended')
        )
      `).bind(
        subscriptionId,
        storeId,
        planId,
        storeId,
        session.user_id,
        planId,
        storeId
      ),

      env.DB.prepare(`
        INSERT INTO payments (
          id, subscription_id, amount, currency,
          payment_method, transaction_reference,
          status, payment_details_snapshot, created_at
        )
        SELECT
          ?, ss.id, ?, ?, 'shamcash', ?, 'pending', ?,
          CURRENT_TIMESTAMP
        FROM store_subscriptions ss
        WHERE ss.id = ?
          AND ss.status = 'pending'
      `).bind(
        paymentId,
        plan.price,
        plan.currency,
        reference,
        snapshot,
        subscriptionId
      ),

      env.DB.prepare(`
        INSERT INTO subscription_history (
          id, subscription_id, action, details, performed_by
        )
        SELECT ?, id, 'created', ?, ?
        FROM store_subscriptions
        WHERE id = ? AND status = 'pending'
      `).bind(
        historyId,
        JSON.stringify({
          source: "customer_request",
          payment_method: "shamcash"
        }),
        session.user_id,
        subscriptionId
      )
    ]);

    if (
      !results[0]?.meta?.changes ||
      !results[1]?.meta?.changes ||
      !results[2]?.meta?.changes
    ) {
      return json({
        error: "تعذر إنشاء الطلب. قد يكون هناك طلب آخر قيد المعالجة."
      }, 409);
    }

    return json({
      status: "ok",
      message: "تم إرسال طلب الاشتراك بنجاح، وهو بانتظار مراجعة الإدارة.",
      request: {
        subscription_id: subscriptionId,
        payment_id: paymentId,
        plan_name: plan.name,
        amount: plan.price,
        currency: plan.currency,
        payment_method: "شام كاش",
        recipient: settings.shamcash_recipient,
        link: settings.shamcash_link || "",
        instructions: settings.shamcash_instructions || "",
        transaction_reference: reference,
        status: "pending"
      }
    }, 201);

  } catch (error) {
    if (
      String(error?.message || "").toLowerCase().includes("unique") ||
      String(error?.message || "").toLowerCase().includes("constraint")
    ) {
      return json({
        error: "رقم العملية مستخدم مسبقاً أو يوجد طلب اشتراك آخر لهذا المتجر."
      }, 409);
    }

    throw error;
  }
}

async function adminListRequests(db) {
  const result = await db.prepare(`
    SELECT
      p.id AS payment_id,
      p.amount,
      p.currency,
      p.payment_method,
      p.transaction_reference,
      p.status AS payment_status,
      p.rejection_reason,
      p.created_at AS requested_at,
      ss.id AS subscription_id,
      ss.status AS subscription_status,
      ss.store_id,
      s.name AS store_name,
      a.name AS account_name,
      sp.name AS plan_name,
      sp.duration_days,
      u.full_name AS requester_name,
      u.email AS requester_email
    FROM payments p
    JOIN store_subscriptions ss ON ss.id = p.subscription_id
    JOIN stores s ON s.id = ss.store_id
    JOIN accounts a ON a.id = s.account_id
    JOIN subscription_plans sp ON sp.id = ss.plan_id
    LEFT JOIN subscription_history sh
      ON sh.subscription_id = ss.id
      AND sh.action = 'created'
    LEFT JOIN users u ON u.id = sh.performed_by
    ORDER BY
      CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
      p.created_at DESC
    LIMIT 500
  `).all();

  return result.results || [];
}

async function approvePayment(request, env, admin, paymentId) {
  const payment = await env.DB.prepare(`
    SELECT
      p.id AS payment_id,
      p.subscription_id,
      p.amount,
      p.currency,
      p.status AS payment_status,
      ss.store_id,
      ss.status AS subscription_status,
      ss.plan_id,
      sp.duration_days
    FROM payments p
    JOIN store_subscriptions ss ON ss.id = p.subscription_id
    JOIN subscription_plans sp ON sp.id = ss.plan_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(paymentId).first();

  if (!payment) {
    return json({ error: "طلب الدفع غير موجود." }, 404);
  }

  if (
    payment.payment_status !== "pending" ||
    payment.subscription_status !== "pending"
  ) {
    return json({ error: "تمت معالجة هذا الطلب مسبقاً." }, 409);
  }

  const active = await env.DB.prepare(`
    SELECT id
    FROM store_subscriptions
    WHERE store_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(payment.store_id).first();

  if (active) {
    return json({
      error: "لا يمكن تفعيل الطلب لوجود اشتراك نشط آخر لهذا المتجر."
    }, 409);
  }

  const prior = await env.DB.prepare(`
    SELECT id
    FROM store_subscriptions
    WHERE store_id = ?
      AND id != ?
      AND status IN ('expired', 'cancelled')
    LIMIT 1
  `).bind(payment.store_id, payment.subscription_id).first();

  const action = prior ? "renewed" : "activated";
  const invoiceId = crypto.randomUUID();
  const historyId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const invoiceNumber =
    "MMG-" +
    new Date().toISOString().slice(0, 10).replace(/-/g, "") +
    "-" +
    crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

  try {
    const results = await env.DB.batch([
      // 1. Prepare the invoice. It becomes paid through the database trigger.
      env.DB.prepare(`
        INSERT INTO invoices (
          id, subscription_id, payment_id, invoice_number,
          subtotal, tax, total, currency, status
        )
        SELECT ?, ?, ?, ?, ?, 0, ?, ?, 'issued'
        WHERE EXISTS (
          SELECT 1
          FROM payments p
          JOIN store_subscriptions ss
            ON ss.id = p.subscription_id
          WHERE p.id = ?
            AND p.status = 'pending'
            AND p.subscription_id = ?
            AND ss.status = 'pending'
        )
      `).bind(
        invoiceId,
        payment.subscription_id,
        paymentId,
        invoiceNumber,
        payment.amount,
        payment.amount,
        payment.currency,
        paymentId,
        payment.subscription_id
      ),

      // 2. Prepare the subscription history before approval.
      env.DB.prepare(`
        INSERT INTO subscription_history (
          id, subscription_id, action, details, performed_by
        )
        SELECT ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM payments p
          JOIN store_subscriptions ss
            ON ss.id = p.subscription_id
          WHERE p.id = ?
            AND p.status = 'pending'
            AND ss.status = 'pending'
        )
      `).bind(
        historyId,
        payment.subscription_id,
        action,
        JSON.stringify({
          payment_id: paymentId,
          invoice_number: invoiceNumber,
          approved_by: admin.user_id
        }),
        admin.user_id,
        paymentId
      ),

      // 3. Prepare the audit record before approval.
      env.DB.prepare(`
        INSERT INTO admin_activity_logs (
          id, admin_user_id, action, target_type, target_id, details
        )
        SELECT ?, ?, 'approve', 'subscription_payment', ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM payments p
          JOIN store_subscriptions ss
            ON ss.id = p.subscription_id
          WHERE p.id = ?
            AND p.status = 'pending'
            AND ss.status = 'pending'
        )
      `).bind(
        auditId,
        admin.user_id,
        paymentId,
        JSON.stringify({
          subscription_id: payment.subscription_id,
          amount: payment.amount,
          currency: payment.currency
        }),
        paymentId
      ),

      // 4. Approve payment last. Migration 0012 triggers complete activation.
      env.DB.prepare(`
        UPDATE payments
        SET status = 'approved',
            paid_at = CURRENT_TIMESTAMP,
            rejection_reason = NULL
        WHERE id = ?
          AND status = 'pending'
          AND subscription_id = ?
          AND EXISTS (
            SELECT 1
            FROM store_subscriptions
            WHERE id = ?
              AND status = 'pending'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM store_subscriptions other
            WHERE other.store_id = ?
              AND other.status = 'active'
          )
      `).bind(
        paymentId,
        payment.subscription_id,
        payment.subscription_id,
        payment.store_id
      )
    ]);

    if (
      !results[0]?.meta?.changes ||
      !results[1]?.meta?.changes ||
      !results[2]?.meta?.changes ||
      !results[3]?.meta?.changes
    ) {
      return json({
        error: "تعذرت الموافقة على الطلب. لم تكتمل جميع عمليات الاعتماد."
      }, 409);
    }

    return json({
      status: "ok",
      message: "تمت الموافقة وتفعيل الاشتراك وإصدار الفاتورة.",
      invoice_number: invoiceNumber
    });

  } catch (error) {
    if (
      String(error?.message || "").toLowerCase().includes("unique") ||
      String(error?.message || "").toLowerCase().includes("constraint") ||
      String(error?.message || "").toLowerCase().includes("another active") ||
      String(error?.message || "").toLowerCase().includes("missing")
    ) {
      return json({
        error: "تعذرت الموافقة. لم يتم اعتماد الدفع أو تفعيل الاشتراك."
      }, 409);
    }

    throw error;
  }
}

async function rejectPayment(request, env, admin, paymentId) {
  const parsed = await readBody(request, 5000);

  if (parsed.error) {
    return json({ error: parsed.error }, parsed.status);
  }

  const reason = typeof parsed.body?.reason === "string"
    ? parsed.body.reason.trim()
    : "";

  if (reason.length < 3 || reason.length > 1000) {
    return json({
      error: "سبب الرفض مطلوب، ويجب أن يكون بين 3 و1000 حرف."
    }, 400);
  }

  const payment = await env.DB.prepare(`
    SELECT
      p.id,
      p.subscription_id,
      p.status AS payment_status,
      ss.status AS subscription_status
    FROM payments p
    JOIN store_subscriptions ss ON ss.id = p.subscription_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(paymentId).first();

  if (!payment) {
    return json({ error: "طلب الدفع غير موجود." }, 404);
  }

  if (
    payment.payment_status !== "pending" ||
    payment.subscription_status !== "pending"
  ) {
    return json({ error: "تمت معالجة هذا الطلب مسبقاً." }, 409);
  }

  const historyId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  // The rejection guard requires both records to exist before payment changes.
  // The AFTER UPDATE trigger then cancels the pending subscription atomically.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO subscription_history (
        id, subscription_id, action, details, performed_by
      )
      SELECT ?, ?, 'cancelled', ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM payments p
        JOIN store_subscriptions ss ON ss.id = p.subscription_id
        WHERE p.id = ?
          AND p.status = 'pending'
          AND ss.id = ?
          AND ss.status = 'pending'
      )
    `).bind(
      historyId,
      payment.subscription_id,
      JSON.stringify({
        reason,
        payment_id: paymentId,
        rejected_by: admin.user_id
      }),
      admin.user_id,
      paymentId,
      payment.subscription_id
    ),

    env.DB.prepare(`
      INSERT INTO admin_activity_logs (
        id, admin_user_id, action, target_type, target_id, details
      )
      SELECT ?, ?, 'reject', 'subscription_payment', ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM payments p
        JOIN store_subscriptions ss ON ss.id = p.subscription_id
        WHERE p.id = ?
          AND p.status = 'pending'
          AND ss.status = 'pending'
      )
    `).bind(
      auditId,
      admin.user_id,
      paymentId,
      JSON.stringify({ reason }),
      paymentId
    ),

    env.DB.prepare(`
      UPDATE payments
      SET status = 'rejected',
          rejection_reason = ?
      WHERE id = ?
        AND status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM store_subscriptions
          WHERE id = payments.subscription_id
            AND status = 'pending'
        )
    `).bind(reason, paymentId)
  ]);

  if (
    !results[0]?.meta?.changes ||
    !results[1]?.meta?.changes ||
    !results[2]?.meta?.changes
  ) {
    return json({ error: "تعذر إكمال رفض الطلب." }, 409);
  }

  return json({
    status: "ok",
    message: "تم رفض الطلب وحفظ السبب."
  });
}

async function adminPlans(request, env, admin, path) {
  if (request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT
        sp.id, sp.name, sp.description,
        sp.price, sp.currency, sp.duration_days,
        sp.is_active, sp.created_at, sp.updated_at,
        COUNT(ss.id) AS subscriptions_count
      FROM subscription_plans sp
      LEFT JOIN store_subscriptions ss ON ss.plan_id = sp.id
      WHERE sp.id != ?
      GROUP BY sp.id
      ORDER BY sp.created_at DESC
    `).bind(TRIAL_PLAN_ID).all();

    return json({ status: "ok", plans: result.results || [] });
  }

  if (request.method === "POST" && path === "/api/admin/subscription-plans") {
    const parsed = await readBody(request);

    if (parsed.error) {
      return json({ error: parsed.error }, parsed.status);
    }

    const body = parsed.body || {};

    if (!validPlanData(body)) {
      return json({ error: "بيانات الباقة غير صالحة." }, 400);
    }

    const id = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO subscription_plans (
          id, name, description, price,
          currency, duration_days, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        body.name.trim(),
        body.description?.trim() || null,
        body.price,
        body.currency,
        body.duration_days,
        body.is_active === false ? 0 : 1
      ),

      env.DB.prepare(`
        INSERT INTO admin_activity_logs (
          id, admin_user_id, action, target_type, target_id, details
        )
        VALUES (?, ?, 'create', 'subscription_plan', ?, ?)
      `).bind(
        crypto.randomUUID(),
        admin.user_id,
        id,
        JSON.stringify({
          name: body.name.trim(),
          price: body.price,
          currency: body.currency,
          duration_days: body.duration_days
        })
      )
    ]);

    return json({
      status: "ok",
      message: "تم إنشاء الباقة.",
      plan_id: id
    }, 201);
  }

  const match = path.match(/^\/api\/admin\/subscription-plans\/([^/]+)$/);

  if (request.method === "PUT" && match) {
    let planId;

    try {
      planId = decodeURIComponent(match[1]);
    } catch {
      return json({ error: "معرف الباقة غير صالح." }, 400);
    }

    if (planId === TRIAL_PLAN_ID) {
      return json({ error: "لا يمكن تعديل باقة التجربة من إدارة الباقات المدفوعة." }, 403);
    }

    const parsed = await readBody(request);

    if (parsed.error) {
      return json({ error: parsed.error }, parsed.status);
    }

    const body = parsed.body || {};

    if (!validPlanData(body)) {
      return json({ error: "بيانات الباقة غير صالحة." }, 400);
    }

    const existing = await env.DB.prepare(`
      SELECT
        id,
        EXISTS (
          SELECT 1 FROM store_subscriptions
          WHERE plan_id = subscription_plans.id
        ) AS is_used
      FROM subscription_plans
      WHERE id = ?
      LIMIT 1
    `).bind(planId).first();

    if (!existing) {
      return json({ error: "الباقة غير موجودة." }, 404);
    }

    if (existing.is_used) {
      const current = await env.DB.prepare(`
        SELECT price, currency, duration_days
        FROM subscription_plans
        WHERE id = ?
      `).bind(planId).first();

      if (
        current.price !== body.price ||
        current.currency !== body.currency ||
        current.duration_days !== body.duration_days
      ) {
        return json({
          error: "هذه الباقة مستخدمة سابقاً. لا يمكن تغيير السعر أو العملة أو المدة؛ أنشئ باقة جديدة."
        }, 409);
      }
    }

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE subscription_plans
        SET name = ?,
            description = ?,
            price = ?,
            currency = ?,
            duration_days = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND id != ?
      `).bind(
        body.name.trim(),
        body.description?.trim() || null,
        body.price,
        body.currency,
        body.duration_days,
        body.is_active === false ? 0 : 1,
        planId,
        TRIAL_PLAN_ID
      ),

      env.DB.prepare(`
        INSERT INTO admin_activity_logs (
          id, admin_user_id, action, target_type, target_id, details
        )
        VALUES (?, ?, 'update', 'subscription_plan', ?, ?)
      `).bind(
        crypto.randomUUID(),
        admin.user_id,
        planId,
        JSON.stringify(body)
      )
    ]);

    return json({
      status: "ok",
      message: "تم تحديث الباقة."
    });
  }

  return json({ error: "Method not allowed" }, 405);
}

export async function handleSubscriptions(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const customerPath =
    path === "/api/subscriptions/payment-info" ||
    path === "/api/subscriptions/plans" ||
    path === "/api/subscriptions/request" ||
    /^\/api\/subscriptions\/store\/[^/]+$/.test(path);

  const adminPath =
    path === "/api/admin/subscriptions/requests" ||
    /^\/api\/admin\/subscriptions\/[^/]+\/(approve|reject)$/.test(path) ||
    path === "/api/admin/subscription-plans" ||
    /^\/api\/admin\/subscription-plans\/[^/]+$/.test(path);

  if (!customerPath && !adminPath) return null;

  if (!validOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  try {
    if (customerPath) {
      const session = await getAuthenticatedSession(request, env.DB);

      if (!session) {
        return json({ error: "Authentication required" }, 401);
      }

      if (path === "/api/subscriptions/payment-info") {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }

        const settings = await env.DB.prepare(`
          SELECT setting_key, setting_value
          FROM platform_settings
          WHERE setting_key IN (
            'shamcash_enabled',
            'shamcash_link',
            'shamcash_recipient',
            'shamcash_instructions'
          )
        `).all();

        const values = Object.fromEntries(
          (settings.results || []).map(item => [
            item.setting_key,
            item.setting_value
          ])
        );

        return json({
          status: "ok",
          enabled: values.shamcash_enabled === "1",
          method: "شام كاش",
          recipient: values.shamcash_recipient || "",
          link: values.shamcash_link || "",
          instructions: values.shamcash_instructions || ""
        });
      }
      if (path === "/api/subscriptions/plans") {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed" }, 405);
        }

        return json({
          status: "ok",
          plans: await getPublicPlans(env.DB)
        });
      }

      if (path === "/api/subscriptions/request") {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }

        return await createSubscriptionRequest(request, env, session);
      }

      const match = path.match(/^\/api\/subscriptions\/store\/([^/]+)$/);

      if (match && request.method === "GET") {
        let storeId;

        try {
          storeId = decodeURIComponent(match[1]);
        } catch {
          return json({ error: "Invalid store ID" }, 400);
        }

        const data = await getStoreSubscription(
          env.DB,
          storeId,
          session.user_id
        );

        if (!data) {
          return json({ error: "Store not found" }, 404);
        }

        return json({ status: "ok", ...data });
      }

      return json({ error: "Method not allowed" }, 405);
    }

    const admin = await getPlatformAdmin(request, env.DB);

    if (!admin || admin.admin_level !== "super_admin") {
      return json({ error: "Super admin access required" }, 403);
    }

    if (path === "/api/admin/subscriptions/requests") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      return json({
        status: "ok",
        requests: await adminListRequests(env.DB)
      });
    }

    if (
      path === "/api/admin/subscription-plans" ||
      /^\/api\/admin\/subscription-plans\/[^/]+$/.test(path)
    ) {
      return await adminPlans(request, env, admin, path);
    }

    const actionMatch = path.match(
      /^\/api\/admin\/subscriptions\/([^/]+)\/(approve|reject)$/
    );

    if (actionMatch) {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      let paymentId;

      try {
        paymentId = decodeURIComponent(actionMatch[1]);
      } catch {
        return json({ error: "Invalid payment ID" }, 400);
      }

      if (actionMatch[2] === "approve") {
        return await approvePayment(request, env, admin, paymentId);
      }

      return await rejectPayment(request, env, admin, paymentId);
    }

    return json({ error: "Not found" }, 404);

  } catch (error) {
    if (
      String(error?.message || "").toLowerCase().includes("unique") ||
      String(error?.message || "").toLowerCase().includes("constraint")
    ) {
      return json({
        error: "تعارض في البيانات. تحقق من رقم العملية أو حالة اشتراك المتجر."
      }, 409);
    }

    return json({
      error: "Unable to process subscription request"
    }, 500);
  }
}
