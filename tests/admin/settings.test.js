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

              if (sql.includes("FROM platform_admins")) {
                return options.admin ?? null;
              }

              return null;
            },

            async run() {
              calls.push({ sql, values });
              return { meta: { changes: 1 } };
            },

            async all() {
              return {
                results: sql.includes("FROM admin_activity_logs")
                  ? (options.activityLogs ?? [])
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

      return [];
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
