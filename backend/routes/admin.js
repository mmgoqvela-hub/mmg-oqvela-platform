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


async function readAdminBody(request) {
  try {
    const raw = await request.text();
    if (raw.length > 10000) return {error:"Request too large",status:413};
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return {error:"Invalid JSON",status:400};
    return {body};
  } catch {
    return {error:"Invalid JSON",status:400};
  }
}

function adminLimit(url) {
  const value = Number(url.searchParams.get("limit") || 100);
  return Number.isInteger(value) ? Math.min(500,Math.max(1,value)) : 100;
}

async function adminOverview(db) {
  const [users,accounts,stores,activeSubscriptions,pendingPayments,revenue] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM users").first(),
    db.prepare("SELECT COUNT(*) AS total FROM accounts").first(),
    db.prepare("SELECT COUNT(*) AS total FROM stores").first(),
    db.prepare("SELECT COUNT(*) AS total FROM store_subscriptions WHERE status='active' AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)").first(),
    db.prepare("SELECT COUNT(*) AS total FROM payments WHERE status='pending'").first(),
    db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='approved'").first()
  ]);
  return {users:users?.total||0,accounts:accounts?.total||0,stores:stores?.total||0,active_subscriptions:activeSubscriptions?.total||0,pending_payments:pendingPayments?.total||0,approved_payment_total:revenue?.total||0};
}

async function listAdminResource(db,resource,url) {
  const limit=adminLimit(url);
  if(resource==="users") {
    const result=await db.prepare(`
      SELECT u.id,u.full_name,u.email,u.status,u.created_at,
             COUNT(DISTINCT au.account_id) AS accounts_count,
             COUNT(DISTINCT s.id) AS stores_count
      FROM users u
      LEFT JOIN account_users au ON au.user_id=u.id
      LEFT JOIN stores s ON s.account_id=au.account_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ?
    `).bind(limit).all();
    return {users:result.results||[]};
  }
  if(resource==="accounts") {
    const result=await db.prepare(`
      SELECT a.id,a.name,a.status,a.created_at,
             u.full_name AS owner_name,u.email AS owner_email,
             COUNT(DISTINCT s.id) AS stores_count
      FROM accounts a
      JOIN users u ON u.id=a.owner_user_id
      LEFT JOIN stores s ON s.account_id=a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).bind(limit).all();
    return {accounts:result.results||[]};
  }
  if(resource==="stores") {
    const result=await db.prepare(`
      SELECT s.id,s.account_id,s.name,s.slug,s.business_type,s.status,s.created_at,
             a.name AS account_name,
             (SELECT ss.status FROM store_subscriptions ss WHERE ss.store_id=s.id ORDER BY ss.created_at DESC LIMIT 1) AS subscription_status,
             (SELECT ss.expires_at FROM store_subscriptions ss WHERE ss.store_id=s.id ORDER BY ss.created_at DESC LIMIT 1) AS subscription_expires_at
      FROM stores s
      JOIN accounts a ON a.id=s.account_id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).bind(limit).all();
    return {stores:result.results||[]};
  }
  if(resource==="platform-admins") {
    const result=await db.prepare(`
      SELECT pa.user_id,pa.admin_level,pa.status,pa.created_at,u.full_name,u.email
      FROM platform_admins pa
      JOIN users u ON u.id=pa.user_id
      ORDER BY CASE pa.admin_level WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.full_name
      LIMIT ?
    `).bind(limit).all();
    return {admins:result.results||[]};
  }
  return null;
}

async function logAdminChange(db,admin,action,targetType,targetId,details) {
  return db.prepare(`
    INSERT INTO admin_activity_logs (id,admin_user_id,action,target_type,target_id,details)
    VALUES (?,?,?,?,?,?)
  `).bind(crypto.randomUUID(),admin.user_id,action,targetType,targetId,JSON.stringify(details||{}));
}

async function updateAdminResource(request,env,admin,resource,id) {
  const parsed=await readAdminBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const status=parsed.body.status;
  const definitions={
    users:{table:"users",allowed:["active","suspended","pending"],target:"user"},
    accounts:{table:"accounts",allowed:["active","suspended","closed"],target:"account"},
    stores:{table:"stores",allowed:["active","suspended","maintenance","closed"],target:"store"}
  };
  const definition=definitions[resource];
  if(!definition || !definition.allowed.includes(status)) return json({error:"Invalid status"},400);
  if(resource==="users" && id===admin.user_id && status!=="active") return json({error:"You cannot suspend your own active administrator account"},409);
  if(resource==="users") {
    const target=await env.DB.prepare("SELECT id FROM platform_admins WHERE user_id=? AND admin_level='super_admin' AND status='active' LIMIT 1").bind(id).first();
    if(target && status!=="active") {
      const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM platform_admins WHERE admin_level='super_admin' AND status='active'").first();
      if((count?.total||0)<=1) return json({error:"The last active super administrator cannot be suspended"},409);
    }
  }
  const table=definition.table;
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,id),
    logAdminChange(env.DB,admin,"update",definition.target,id,{status})
  ]);
  if(!result[0]?.meta?.changes) return json({error:"Record not found or unchanged"},404);
  return json({status:"ok",message:"Record status updated"});
}

async function createPlatformAdmin(request,env,admin) {
  const parsed=await readAdminBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const email=typeof parsed.body.email==="string"?parsed.body.email.trim().toLowerCase():"";
  const level=parsed.body.admin_level;
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||email.length>254||!["admin","support"].includes(level)) {
    return json({error:"Invalid platform administrator details"},400);
  }
  const user=await env.DB.prepare("SELECT id,status FROM users WHERE email=? LIMIT 1").bind(email).first();
  if(!user||user.status!=="active") return json({error:"An active platform user with this email is required"},404);
  const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO platform_admins (user_id,admin_level,status) VALUES (?,?, 'active') ON CONFLICT(user_id) DO UPDATE SET admin_level=excluded.admin_level,status='active'").bind(user.id,level),
    logAdminChange(env.DB,admin,"create","platform_admin",user.id,{admin_level:level})
  ]);
  if(!result[0]?.meta?.changes) return json({error:"Unable to create platform administrator"},409);
  return json({status:"ok",message:"Platform administrator added"},201);
}

async function updatePlatformAdmin(request,env,admin,userId) {
  const parsed=await readAdminBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const level=parsed.body.admin_level;
  const status=parsed.body.status;
  if(level!==undefined && !["admin","support"].includes(level)) return json({error:"Invalid platform administrator level"},400);
  if(status!==undefined && !["active","suspended"].includes(status)) return json({error:"Invalid platform administrator status"},400);
  if(userId===admin.user_id && (status==="suspended" || level==="support")) return json({error:"You cannot remove your own active super administrator access"},409);
  const current=await env.DB.prepare("SELECT admin_level,status FROM platform_admins WHERE user_id=? LIMIT 1").bind(userId).first();
  if(!current) return json({error:"Platform administrator not found"},404);
  if(current.admin_level==="super_admin" && (status==="suspended" || level==="support")) {
    const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM platform_admins WHERE admin_level='super_admin' AND status='active'").first();
    if((count?.total||0)<=1) return json({error:"The last active super administrator cannot be removed"},409);
  }
  const nextLevel=level || current.admin_level;
  const nextStatus=status || current.status;
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE platform_admins SET admin_level=?,status=? WHERE user_id=?").bind(nextLevel,nextStatus,userId),
    logAdminChange(env.DB,admin,"update","platform_admin",userId,{admin_level:nextLevel,status:nextStatus})
  ]);
  if(!result[0]?.meta?.changes) return json({error:"Platform administrator not found"},404);
  return json({status:"ok",message:"Platform administrator updated"});
}

async function transferSuperAdmin(request,env,admin) {
  const parsed=await readAdminBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const targetId=typeof parsed.body.user_id==="string"?parsed.body.user_id:"";
  if(!targetId || targetId===admin.user_id) return json({error:"Choose another active user for administrator transfer"},400);
  const target=await env.DB.prepare("SELECT id,status FROM users WHERE id=? LIMIT 1").bind(targetId).first();
  if(!target||target.status!=="active") return json({error:"The new administrator must be an active platform user"},404);
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE platform_admins SET admin_level='admin' WHERE user_id=? AND admin_level='super_admin' AND status='active'").bind(admin.user_id),
    env.DB.prepare("INSERT INTO platform_admins (user_id,admin_level,status) VALUES (?,'super_admin','active') ON CONFLICT(user_id) DO UPDATE SET admin_level='super_admin',status='active'").bind(targetId),
    logAdminChange(env.DB,admin,"transfer","platform_super_admin",targetId,{previous_super_admin:admin.user_id})
  ]);
  if(!result[0]?.meta?.changes || !result[1]?.meta?.changes) return json({error:"Administrator transfer could not be completed"},409);
  return json({status:"ok",message:"Super administrator role transferred"});
}

async function handleAdminManagement(request,env,admin,path,url) {
  if(path==="/api/admin/overview" && request.method==="GET") {
    return json({status:"ok",overview:await adminOverview(env.DB)});
  }
  const match=path.match(/^\\/api\\/admin\\/(users|accounts|stores|platform-admins)(?:\\/([^/]+))?$/);
  if(!match) return null;
  const resource=match[1];
  const id=match[2]?decodeURIComponent(match[2]):null;
  if(!id && request.method==="GET") return json({status:"ok",...(await listAdminResource(env.DB,resource,url))});
  if(resource==="platform-admins" && !id && request.method==="POST") return createPlatformAdmin(request,env,admin);
  if(resource==="platform-admins" && id && request.method==="PUT") return updatePlatformAdmin(request,env,admin,id);
  if(["users","accounts","stores"].includes(resource) && id && request.method==="PUT") return updateAdminResource(request,env,admin,resource,id);
  return json({error:"Method not allowed"},405);
}

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const isActivityLogs = path === "/api/admin/activity-logs";
  if (!["/api/admin/settings", "/api/admin/trial-settings"].includes(path) && !isActivityLogs) {
    return null;
  }

  if (isActivityLogs && request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!isActivityLogs && !["GET", "PUT"].includes(request.method)) {
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
    if (isActivityLogs) {
      const requestedLimit = Number(new URL(request.url).searchParams.get("limit") || 50);
      const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
      const result = await env.DB.prepare(`
        SELECT
          al.id, al.action, al.target_type, al.target_id, al.details, al.created_at,
          u.full_name AS admin_name, u.email AS admin_email
        FROM admin_activity_logs al
        LEFT JOIN users u ON u.id = al.admin_user_id
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ?
      `).bind(limit).all();
      return json({ status: "ok", logs: result.results || [] });
    }

    if (path === "/api/admin/settings") {
      if (request.method === "GET") {
        return json({
          status: "ok",
          settings: await getSettings(env.DB)
        });
      }

      return await updateSettings(request, env.DB, admin);
    }

    if (request.method === "GET") {
      const settings = await env.DB.prepare(`
        SELECT enabled, duration_days, updated_at
        FROM platform_trial_settings
        WHERE id = 1
      `).first();

      return json({
        status: "ok",
        settings
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

    if (
      typeof body?.enabled !== "boolean" ||
      !Number.isInteger(body?.duration_days) ||
      body.duration_days < 1 ||
      body.duration_days > 365
    ) {
      return json({ error: "Invalid trial settings" }, 400);
    }

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE platform_trial_settings
        SET enabled = ?,
            duration_days = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).bind(
        body.enabled ? 1 : 0,
        body.duration_days,
        admin.user_id
      ),

      env.DB.prepare(`
        INSERT INTO admin_activity_logs
          (id, admin_user_id, action, target_type, details)
        VALUES (?, ?, 'update', 'trial_settings', ?)
      `).bind(
        crypto.randomUUID(),
        admin.user_id,
        JSON.stringify({
          enabled: body.enabled,
          duration_days: body.duration_days
        })
      )
    ]);

    return json({
      status: "ok",
      message: "تم تحديث إعدادات الفترة التجريبية",
      settings: {
        enabled: body.enabled,
        duration_days: body.duration_days
      }
    });

  } catch {
    return json({ error: "Unable to process admin request" }, 500);
  }
}
