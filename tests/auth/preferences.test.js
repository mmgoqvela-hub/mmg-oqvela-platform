import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { handleAuth } from "../../backend/routes/auth.js";

const TOKEN = "a".repeat(43);
const SESSION = {
  session_id: "session-001",
  user_id: "user-001",
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test User",
  email: "test@example.com",
  user_status: "active",
  preferred_language: "ar"
};

function createDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM auth_sessions")) return SESSION;
              return null;
            },
            async run() {
              calls.push({ sql, values });
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

function request(body, options = {}) {
  const headers = {
    Origin: "https://example.com",
    "Content-Type": "application/json"
  };
  if (options.auth !== false) headers.Cookie = "mmg_session=" + TOKEN;
  return new Request("https://example.com/api/auth/preferences", {
    method: options.method || "PUT",
    headers,
    body: JSON.stringify(body)
  });
}

test("Authenticated users can save Arabic or English as their preference", async () => {
  const db = createDb();
  const response = await handleAuth(request({ language: "en" }), { DB: db });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.preferences.language, "en");
  const update = db.calls.find(call => call.sql.includes("UPDATE users"));
  assert.ok(update);
  assert.deepEqual(update.values, ["en", "user-001"]);
});

test("Unsupported language preferences are rejected without database updates", async () => {
  const db = createDb();
  const response = await handleAuth(request({ language: "fr" }), { DB: db });
  assert.equal(response.status, 400);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE users")), false);
});

test("Unauthenticated users cannot update language preferences", async () => {
  const db = createDb();
  const response = await handleAuth(request({ language: "en" }, { auth: false }), { DB: db });
  assert.equal(response.status, 401);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE users")), false);
});

test("Language preferences endpoint only accepts PUT", async () => {
  const db = createDb();
  const response = await handleAuth(request({ language: "en" }, { method: "POST" }), { DB: db });
  assert.equal(response.status, 405);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE users")), false);
});
