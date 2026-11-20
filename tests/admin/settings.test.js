import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import { handleAdmin } from "../../backend/routes/admin.js";

const TOKEN = "a".repeat(43);
const USER_ID = "admin-user-001";
const SESSION = {
  session_id: "session-001",
  user_id: USER_ID,
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test Admin",
  email: "admin@example.com",
  user_status: "active"
};

const DEFAULT_SETTINGS = [
  { setting_key: "shamcash_link", setting_value: "" },
  { setting_key: "shamcash_recipient", setting_value: "" },
  { setting_key: "shamcash_instructions", setting_value: "" },
  { setting_key: "shamcash_enabled", setting_value: "0" }
];

function createDb(options = {}) {
  const calls = [];
  const db = {
    calls,

    prepare(sql) {
      return {
        sql,

        bind(...values) {
          return {
            sql,
            values,

            async first() {
              if (sql.includes("FROM auth_sessions s")) {
                return options.session ?? null;
              }

              if (sql.includes("COUNT(*) AS total FROM platform_admins")) return {total:options.superAdminCount ?? 1};
              if (sql.includes("SELECT id FROM platform_admins")) return options.targetAdmin ?? null;
              if (sql.includes("SELECT admin_level FROM platform_admins")) return options.existingPlatformAdmin ?? null;
              if (sql.includes("FROM platform_admins")) return options.admin ?? null;
              if (sql.includes("FROM users WHERE email")) return options.user ?? {id:"target-user",status:"active"};
              if (sql.includes("FROM users WHERE id")) return options.targetUser ?? {id:"target-user",status:"active"};
              return null;
            },

            async run() {
              calls.push({ sql, values });
              return { meta: { changes: 1 } };
            },

            async all() {
              calls.push({ sql, values });
              return {
                results: sql.includes("FROM admin_activity_logs")
                  ? (options.activityLogs ?? [])
                  : sql.includes("GROUP BY currency")
                    ? (options.revenue ?? [])
                    : sql.includes("FROM users u")
                      ? (options.users ?? [])
                      : sql.includes("FROM accounts a")
                        ? (options.accounts ?? [])
                        : sql.includes("FROM stores s")
                          ? (options.stores ?? [])
                          : sql.includes("FROM platform_admins pa")
                            ? (options.platformAdmins ?? [])
                            : (options.settings ?? DEFAULT_SETTINGS)
              };
            }
          };
        }
      };
    },

    async batch(statements) {
      calls.push(...statements.map(item => ({
        sql: item.sql,
        values: item.values
      })));

      return statements.map(() => ({meta:{changes:1}}));
    }
  };

  return db;
}

function makeRequest(method = "GET", body = undefined, options = {}) {
  const headers = {
    Origin: options.origin ?? "https://example.com"
  };

  if (options.token !== false) {
    headers.Cookie = `mmg_session=${TOKEN}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return new Request("https://example.com/api/admin/settings", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function makeAdminPathRequest(path,method="GET",body=undefined) {
  const headers={Origin:"https://example.com",Cookie:"mmg_session="+TOKEN};
  if(body!==undefined) headers["Content-Type"]="application/json";
  return new Request("https://example.com"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

  user_id: USER_ID,
  admin_level: "super_admin",
  status: "active"
};

const NORMAL_ADMIN = {
  user_id: USER_ID,
  admin_level: "admin",
  status: "active"
};

const VALID_SETTINGS = {
  shamcash_link: "https://example.com/pay",
  shamcash_recipient: "Test Recipient",
  shamcash_instructions: "Payment instructions",
  shamcash_enabled: true
};

test("Unauthenticated users cannot access admin settings", async () => {
  const db = createDb();

  const response = await handleAdmin(
    makeRequest("GET", undefined, { token: false }),
    { DB: db }
  );

  assert.equal(response.status, 403);
});

test("Normal admins cannot access super admin settings", async () => {
  const db = createDb({
    session: SESSION,
    admin: NORMAL_ADMIN
  });

  const response = await handleAdmin(
    makeRequest(),
    { DB: db }
  );

  assert.equal(response.status, 403);
});

test("Invalid origin is rejected", async () => {
  const db = createDb({
    session: SESSION,
    admin: SUPER_ADMIN
  });

  const response = await handleAdmin(
    makeRequest("GET", undefined, {
      origin: "https://evil.example"
    }),
    { DB: db }
  );

  assert.equal(response.status, 403);
});

test("Super admin can read platform settings", async () => {
  const db = createDb({
    session: SESSION,
    admin: SUPER_ADMIN
  });

  const response = await handleAdmin(
    makeRequest(),
    { DB: db }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "ok");
  assert.equal(result.settings.shamcash_enabled, "0");
});

test("Super admin can update settings and create audit log", async () => {
  const db = createDb({
    session: SESSION,
    admin: SUPER_ADMIN
  });

  const response = await handleAdmin(
    makeRequest("PUT", VALID_SETTINGS),
    { DB: db }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "ok");
  assert.equal(result.settings.shamcash_enabled, "1");
  assert.equal(db.calls.length, 6);

  const auditLog = db.calls.find(item =>
    item.sql.includes("INSERT INTO admin_activity_logs")
  );

  assert.ok(auditLog);
  assert.equal(auditLog.values[1], USER_ID);
});

test("Invalid payment link is rejected", async () => {
  const db = createDb({
    session: SESSION,
    admin: SUPER_ADMIN
  });

  const response = await handleAdmin(
    makeRequest("PUT", {
      ...VALID_SETTINGS,
      shamcash_link: "javascript:alert(1)"
    }),
    { DB: db }
  );

  assert.equal(response.status, 400);
  assert.equal(
    db.calls.filter(item =>
      item.sql.includes("platform_settings") ||
      item.sql.includes("admin_activity_logs")
    ).length,
    0
  );
});

test("Invalid settings data is rejected", async () => {
  const db = createDb({
    session: SESSION,
    admin: SUPER_ADMIN
  });

  const response = await handleAdmin(
    makeRequest("PUT", {
      ...VALID_SETTINGS,
      shamcash_enabled: "yes"
    }),
    { DB: db }
  );

  assert.equal(response.status, 400);
  assert.equal(
    db.calls.filter(item =>
      item.sql.includes("platform_settings") ||
      item.sql.includes("admin_activity_logs")
    ).length,
    0
  );
});

test("Unsupported methods are rejected", async () => {
  const response = await handleAdmin(
    new Request("https://example.com/api/admin/settings", {
      method: "POST"
    }),
    { DB: createDb() }
  );

  assert.equal(response.status, 405);
});


test("Only super admins can read the activity log", async () => {
  const db = createDb({ session: SESSION, admin: NORMAL_ADMIN });
  const response = await handleAdmin(
    new Request("https://example.com/api/admin/activity-logs", {
      method: "GET",
      headers: { Origin: "https://example.com", Cookie: `mmg_session=${TOKEN}` }
    }),
    { DB: db }
  );
  assert.equal(response.status, 403);
});

test("Super admins can read a bounded activity log", async () => {
  const activityLogs = [{
    id: "log-1",
    action: "approve",
    target_type: "subscription_payment",
    target_id: "payment-1",
    details: "{\"amount\":25}",
    created_at: "2026-11-20 12:00:00",
    admin_name: "Test Admin",
    admin_email: "admin@example.com"
  }];
  const db = createDb({ session: SESSION, admin: SUPER_ADMIN, activityLogs });
  const response = await handleAdmin(
    new Request("https://example.com/api/admin/activity-logs?limit=999", {
      method: "GET",
      headers: { Origin: "https://example.com", Cookie: `mmg_session=${TOKEN}` }
    }),
    { DB: db }
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].action, "approve");
  const query = db.calls.find(call => call.sql.includes("FROM admin_activity_logs"));
  assert.ok(query);
  assert.equal(query.values[0], 100);
});

test("Super admins can read platform overview and user records",async()=>{
  const db=createDb({session:SESSION,admin:SUPER_ADMIN,users:[{id:"user-2",email:"user@example.test",status:"active"}]});
  const overview=await handleAdmin(makeAdminPathRequest("/api/admin/overview"),{DB:db});
  const overviewData=await overview.json();
  assert.equal(overview.status,200);
  assert.equal(overviewData.status,"ok");
  const users=await handleAdmin(makeAdminPathRequest("/api/admin/users"),{DB:db});
  const usersData=await users.json();
  assert.equal(users.status,200);
  assert.equal(usersData.users.length,1);
});

test("Normal platform admins cannot access central user management",async()=>{
  const db=createDb({session:SESSION,admin:NORMAL_ADMIN});
  const response=await handleAdmin(makeAdminPathRequest("/api/admin/users"),{DB:db});
  assert.equal(response.status,403);
});

test("Super admins can suspend a store with an audit entry",async()=>{
  const db=createDb({session:SESSION,admin:SUPER_ADMIN});
  const response=await handleAdmin(makeAdminPathRequest("/api/admin/stores/store-1","PUT",{status:"suspended"}),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.status,"ok");
  assert.ok(db.calls.some(call=>call.sql.includes("UPDATE stores SET status")));
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO admin_activity_logs")));
});

test("The last active super administrator cannot be suspended",async()=>{
  const targetId="other-user";
  const db=createDb({session:SESSION,admin:SUPER_ADMIN,targetAdmin:{id:targetId},superAdminCount:1});
  const response=await handleAdmin(makeAdminPathRequest("/api/admin/users/"+targetId,"PUT",{status:"suspended"}),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.some(call=>call.sql.includes("UPDATE users SET status")),false);
});

test("Super admins can add an existing active user as support",async()=>{
  const db=createDb({session:SESSION,admin:SUPER_ADMIN,user:{id:"support-user",status:"active"}});
  const response=await handleAdmin(makeAdminPathRequest("/api/admin/platform-admins","POST",{
    email:"support@example.test",admin_level:"support"
  }),{DB:db});
  assert.equal(response.status,201);
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO platform_admins")));
});

test("Super-admin ownership can be transferred without leaving two active super admins",async()=>{
  const db=createDb({session:SESSION,admin:SUPER_ADMIN,targetUser:{id:"new-super-admin",status:"active"},superAdminCount:1});
  const response=await handleAdmin(makeAdminPathRequest("/api/admin/transfer-super-admin","POST",{user_id:"new-super-admin"}),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.status,"ok");
  assert.ok(db.calls.some(call=>call.sql.includes("admin_level='admin'")));
  assert.ok(db.calls.some(call=>call.sql.includes("admin_level='super_admin'")));
});

