import { getPlatformAdmin } from "../security/admin.js";
import { validOrigin } from "../security/authentication.js";

const SETTINGS_KEYS = [
  "shamcash_link",
  "shamcash_recipient",
  "shamcash_instructions",
  "shamcash_enabled"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function getSettings(db) {
  const result = await db.prepare(`
    SELECT setting_key, setting_value, updated_at
    FROM platform_settings
    WHERE setting_key IN (?, ?, ?, ?)
  `).bind(...SETTINGS_KEYS).all();

  const settings = {};
  for (const item of result.results || []) {
    settings[item.setting_key] = item.setting_value;
  }

  return settings;
}

async function updateSettings(request, db, admin) {
  let body;

  try {
    const raw = await request.text();
    if (raw.length > 10000) {
      return json({ error: "Request too large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const {
    shamcash_link,
    shamcash_recipient,
    shamcash_instructions,
    shamcash_enabled
  } = body || {};

  if (
    typeof shamcash_link !== "string" ||
    shamcash_link.length > 2000 ||
    typeof shamcash_recipient !== "string" ||
    shamcash_recipient.length > 200 ||
    typeof shamcash_instructions !== "string" ||
    shamcash_instructions.length > 5000 ||
    typeof shamcash_enabled !== "boolean"
  ) {
    return json({ error: "Invalid settings data" }, 400);
  }

  if (shamcash_link.trim()) {
    try {
      const url = new URL(shamcash_link);
      if (!["https:", "http:"].includes(url.protocol)) {
        return json({ error: "Invalid Sham Cash link" }, 400);
      }
    } catch {
      return json({ error: "Invalid Sham Cash link" }, 400);
    }
  }

  const values = {
    shamcash_link: shamcash_link.trim(),
    shamcash_recipient: shamcash_recipient.trim(),
    shamcash_instructions: shamcash_instructions.trim(),
    shamcash_enabled: shamcash_enabled ? "1" : "0"
  };

  const statements = SETTINGS_KEYS.map(key =>
    db.prepare(`
      INSERT INTO platform_settings
        (setting_key, setting_value, updated_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).bind(key, values[key], admin.user_id)
  );

  statements.push(
    db.prepare(`
      INSERT INTO admin_activity_logs
        (id, admin_user_id, action, target_type, details)
      VALUES (?, ?, 'update', 'platform_settings', ?)
    `).bind(
      crypto.randomUUID(),
      admin.user_id,
      JSON.stringify({ changed: SETTINGS_KEYS })
    )
  );

  await db.batch(statements);

  return json({
    status: "ok",
    message: "تم تحديث إعدادات شام كاش بنجاح",
    settings: values
  });
}

export async function handleAdmin(request, env) {
  const url = new URL(request.url);

  if (url.pathname !== "/api/admin/settings") {
    return null;
  }

  if (!["GET", "PUT"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!validOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  const admin = await getPlatformAdmin(request, env.DB);

  if (!admin || admin.admin_level !== "super_admin") {
    return json({ error: "Admin access required" }, 403);
  }

  try {
    if (request.method === "GET") {
      return json({
        status: "ok",
        settings: await getSettings(env.DB)
      });
    }

    return await updateSettings(request, env.DB, admin);
  } catch {
    return json({ error: "Unable to process admin settings" }, 500);
  }
}
