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
  { setting_key: "shamcash_enabled", setting_value: "0" },
  { setting_key: "platform_footer_ar", setting_value: "© 2026 MMG OQVELA — جميع الحقوق محفوظة" },
  { setting_key: "platform_footer_en", setting_value: "© 2026 MMG OQVELA — All rights reserved" },
  { setting_key: "platform_support_whatsapp", setting_value: "" }
];

function createDb(options = {}) {
  const calls = [];
  const db = {
    calls,

    prepare(sql) {
      return {
        sql,
        async first() {
          if (sql.includes("COUNT(*) AS total FROM platform_admins")) return {total:options.superAdminCount ?? 1};
          if (sql.includes("COUNT(*) AS total")) return {total:0};
          if (sql.includes("SELECT id FROM platform_admins")) return options.targetAdmin ?? null;
          if (sql.includes("SELECT admin_level FROM platform_admins")) return options.existingPlatformAdmin ?? null;
          if (sql.includes("FROM platform_admins")) return options.admin ?? null;
          if (sql.includes("FROM users WHERE email")) return options.user ?? {id:"target-user",status:"active"};
          if (sql.includes("FROM users WHERE id")) return options.targetUser ?? {id:"target-user",status:"active"};
          return null;
        },
        async all() {
          calls.push({sql,values:[]});
          if (sql.includes("FROM platform_announcements")) return {results:options.announcements ?? []};
          if (sql.includes("FROM platform_service_requests")) return {results:options.serviceRequests ?? []};
          if (sql.includes("GROUP BY currency")) return {results:options.revenue ?? []};
          return {results:[]};
        },

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
                results: sql.includes("FROM platform_announcements") ? (options.announcements ?? []) : sql.includes("FROM platform_service_requests") ? (options.serviceRequests ?? []) : sql.includes("FROM admin_activity_logs")
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

const SUPER_ADMIN = {
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
  shamcash_enabled: true,
  platform_footer_ar: "© MMG OQVELA — الحقوق محفوظة",
  platform_footer_en: "© MMG OQVELA — All rights reserved",
  platform_support_whatsapp: "+963 944 123 456"
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
  assert.equal(result.settings.platform_footer_ar, VALID_SETTINGS.platform_footer_ar);
  assert.equal(result.settings.platform_support_whatsapp, "963944123456");
  assert.equal(db.calls.length, 9);

  const auditLog = db.calls.find(item =>
    item.sql.includes("INSERT INTO admin_activity_logs")
  );

  assert.ok(auditLog);
  assert.equal(auditLog.values[1], USER_ID);
});

test("Footer settings reject empty or oversized text", async () => {
  const db = createDb({session:SESSION,admin:SUPER_ADMIN});
  const response = await handleAdmin(makeRequest("PUT",{
    ...VALID_SETTINGS,platform_footer_ar:"  "
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.some(call => call.sql.includes("INSERT INTO platform_settings") || call.sql.includes("INSERT INTO admin_activity_logs")),false);
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
  assert.ok(db.calls.some(call=>call?.sql?.includes("UPDATE stores SET status")));
  assert.ok(db.calls.some(call=>call?.sql?.includes("INSERT INTO admin_activity_logs")));
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



test("Only super admins can list platform announcements",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN,announcements:[{id:"announcement-1",title_ar:"تنبيه"}]});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/announcements"),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.announcements.length,1);
 const denied=await handleAdmin(makeAdminPathRequest("/api/admin/announcements"),{DB:createDb({session:SESSION,admin:NORMAL_ADMIN})});
 assert.equal(denied.status,403);
});

test("Platform announcement creation validates bilingual content and records audit",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/announcements","POST",{
  title_ar:"إعلان",title_en:"Announcement",message_ar:"رسالة",message_en:"Message",announcement_type:"warning"
 }),{DB:db});
 assert.equal(response.status,201);
 assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO platform_announcements")));
 assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO admin_activity_logs")));
});

test("Platform announcements reject invalid schedules and unsupported types",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/announcements","POST",{
  title_ar:"إعلان",title_en:"Announcement",message_ar:"رسالة",message_en:"Message",announcement_type:"script",starts_at:"2026-11-22T12:00:00Z",ends_at:"2026-11-21T12:00:00Z"
 }),{DB:db});
 assert.equal(response.status,400);
 assert.equal(db.calls.some(call=>call.sql.includes("INSERT INTO platform_announcements")||call.sql.includes("INSERT INTO admin_activity_logs")),false);
});


test("Central support WhatsApp accepts optional international numbers and rejects invalid values",async()=>{
 const validDb=createDb({session:SESSION,admin:SUPER_ADMIN});
 const valid=await handleAdmin(makeRequest("PUT",{...VALID_SETTINGS,platform_support_whatsapp:"+48 600 123 456"}),{DB:validDb});
 const validBody=await valid.json();
 assert.equal(valid.status,200);
 assert.equal(validBody.settings.platform_support_whatsapp,"48600123456");
 const invalidDb=createDb({session:SESSION,admin:SUPER_ADMIN});
 const invalid=await handleAdmin(makeRequest("PUT",{...VALID_SETTINGS,platform_support_whatsapp:"javascript:alert(1)"}),{DB:invalidDb});
 assert.equal(invalid.status,400);
 assert.equal(invalidDb.calls.some(call=>call.sql.includes("INSERT INTO platform_settings")),false);
});


test("Super admins can list public service requests",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN,serviceRequests:[{id:"request-1",request_type:"advertising",full_name:"A User",status:"new"}]});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/service-requests"),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.status,"ok");
 assert.equal(result.requests.length,1);
});

test("Super admins can update service request status with audit history",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/service-requests/request-1","PATCH",{status:"reviewing",admin_notes:"Contact the requester"}),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.status,"ok");
 assert.ok(db.calls.some(call=>call.sql.includes("UPDATE platform_service_requests")));
 assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO admin_activity_logs")));
});

test("Service request status rejects unsupported values",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/service-requests/request-1","PATCH",{status:"deleted"}),{DB:db});
 assert.equal(response.status,400);
 assert.equal(db.calls.some(call=>call.sql.includes("UPDATE platform_service_requests")),false);
});


test("Store handover preview is restricted to super administrators",async()=>{
 const db=createDb({session:SESSION,admin:NORMAL_ADMIN});
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/stores/store-1/handover-preview"),{DB:db});
 assert.equal(response.status,403);
});

test("Store handover preview reports store-scoped data without changing records",async()=>{
 const db=createDb({session:SESSION,admin:SUPER_ADMIN});
 const originalPrepare=db.prepare.bind(db);
 db.prepare=(sql)=>{
   if(sql.includes("FROM stores s")) return {bind:()=>({first:async()=>({
     id:"store-1",name:"Demo Store",slug:"demo",status:"active",account_id:"account-1",
     account_name:"Demo Account",account_status:"active",owner_user_id:"owner-1",
     owner_name:"Store Owner",owner_email:"owner@example.test"
   })})};
   if(sql.includes("FROM store_subscriptions")) return {bind:()=>({all:async()=>({results:[{id:"sub-1",status:"active",is_trial:1}]})})};
   if(sql.includes("sqlite_master")) return {all:async()=>({results:[{name:"products"},{name:"store_orders"}]})};
   if(sql.includes("pragma_table_info")) return {bind:()=>({all:async()=>({results:[{name:"id"},{name:"store_id"}]})})};
   if(sql.includes("COUNT(*) AS total FROM")) return {bind:()=>({first:async()=>({total:2})})};
   return originalPrepare(sql);
 };
 const response=await handleAdmin(makeAdminPathRequest("/api/admin/stores/store-1/handover-preview"),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.preview.store.owner_email,"owner@example.test");
 assert.equal(result.preview.total_store_scoped_records,4);
 assert.equal(result.preview.preview_only,true);
 assert.equal(result.preview.reset_available,false);
 assert.equal(db.calls.some(call=>call.sql?.startsWith("DELETE")||call.sql?.startsWith("UPDATE")),false);
});
