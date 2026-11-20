import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { handleSubscriptions } from "../../backend/routes/subscriptions.js";

const TOKEN = "a".repeat(43);
const SESSION = {
  session_id: "session-001",
  user_id: "user-001",
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test User",
  email: "test@example.com",
  user_status: "active"
};

const SETTINGS = [
  {setting_key:"shamcash_enabled",setting_value:"1"},
  {setting_key:"shamcash_link",setting_value:"https://pay.example"},
  {setting_key:"shamcash_recipient",setting_value:"Test Recipient"},
  {setting_key:"shamcash_instructions",setting_value:"Transfer instructions"}
];

function createDb(session = SESSION) {
  return {
    prepare(sql) {
      return {
        sql,
        async all() { return {results:SETTINGS}; },
        bind() {
          return {
            async first() {
              return sql.includes("FROM auth_sessions s") ? session : null;
            },
            async run() { return {meta:{changes:1}}; },
            async all() { return {results:SETTINGS}; }
          };
        }
      };
    }
  };
}

function request(options = {}) {
  const headers = {Origin:"https://example.com"};
  if (options.token !== false) headers.Cookie = "mmg_session=" + TOKEN;
  return new Request("https://example.com/api/subscriptions/payment-info", {
    method: options.method || "GET",
    headers
  });
}

test("Payment instructions require an authenticated session", async () => {
  const response = await handleSubscriptions(request({token:false}), {DB:createDb(null)});
  assert.equal(response.status, 401);
});

test("Authenticated customers can read Sham Cash payment instructions", async () => {
  const response = await handleSubscriptions(request(), {DB:createDb()});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.enabled, true);
  assert.equal(result.method, "شام كاش");
  assert.equal(result.recipient, "Test Recipient");
  assert.equal(result.link, "https://pay.example");
  assert.equal(result.instructions, "Transfer instructions");
});

test("Payment instructions endpoint rejects unsupported methods", async () => {
  const response = await handleSubscriptions(request({method:"POST"}), {DB:createDb()});
  assert.equal(response.status, 405);
});
