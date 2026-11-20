import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import { handleStores } from "../../backend/routes/stores.js";

const TOKEN = "a".repeat(43);

const SESSION = {
  session_id: "session-001",
  user_id: "user-001",
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test User",
  email: "test@example.com",
  user_status: "active"
};

const STORE = {
  id: "store-001",
  account_id: "account-001",
  name: "Test Store",
  slug: "test-store",
  business_type: "Retail",
  description: "Test description",
  status: "active",
  account_role: "owner",
  subscription_status: "active",
  subscription_expires_at: "2099-01-01"
};

function createDb(options = {}) {
  const calls = [];

  return {
    calls,

    prepare(sql) {
      return {
        sql,

        bind(...values) {
          return {
            sql,
            values,

            async first() {
              if (sql.includes("FROM auth_sessions")) {
                return options.session ?? null;
              }

              if (sql.includes("FROM stores s")) {
                return options.store ?? null;
              }

              if (sql.includes("FROM accounts a")) {
                return options.account ?? null;
              }

              return null;
            },

            async run() {
              calls.push({ sql, values });

              return {
                meta: {
                  changes: options.updateChanges ?? 1
                }
              };
            }
          };
        }
      };
    }
  };
}

function makeRequest(method = "GET", body, options = {}) {
  const headers = {
    Origin: options.origin ?? "https://example.com"
  };

  if (options.token !== false) {
    headers.Cookie = `mmg_session=${TOKEN}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return new Request(
    "https://example.com/api/stores/store-001",
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );
}

const VALID_DATA = {
  name: "Updated Store",
  business_type: "Electronics",
  description: "Updated description"
};

test("Unauthenticated users cannot access stores", async () => {
  const db = createDb();

  const response = await handleStores(
    makeRequest("GET", undefined, { token: false }),
    { DB: db }
  );

  assert.equal(response.status, 401);
});

test("Invalid origin is rejected", async () => {
  const db = createDb({ session: SESSION, store: STORE });

  const response = await handleStores(
    makeRequest("GET", undefined, {
      origin: "https://evil.example"
    }),
    { DB: db }
  );

  assert.equal(response.status, 403);
});

test("Users cannot access stores outside their account", async () => {
  const db = createDb({
    session: SESSION,
    store: null
  });

  const response = await handleStores(
    makeRequest(),
    { DB: db }
  );

  assert.equal(response.status, 404);
});

test("Active account members can read store details", async () => {
  const db = createDb({
    session: SESSION,
    store: { ...STORE, account_role: "member" }
  });

  const response = await handleStores(
    makeRequest(),
    { DB: db }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "ok");
  assert.equal(result.store.id, STORE.id);
});

test("Normal members cannot edit stores", async () => {
  const db = createDb({
    session: SESSION,
    store: { ...STORE, account_role: "member" }
  });

  const response = await handleStores(
    makeRequest("PUT", VALID_DATA),
    { DB: db }
  );

  assert.equal(response.status, 403);
  assert.equal(db.calls.some(item => item.sql.includes("UPDATE stores")), false);
});

test("Store owner can update store details", async () => {
  const db = createDb({
    session: SESSION,
    store: { ...STORE, account_role: "owner" }
  });

  const response = await handleStores(
    makeRequest("PUT", VALID_DATA),
    { DB: db }
  );

  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "ok");

  const update = db.calls.find(item =>
    item.sql.includes("UPDATE stores")
  );

  assert.ok(update);
  assert.deepEqual(update.values, [
    VALID_DATA.name,
    VALID_DATA.business_type,
    VALID_DATA.description,
    STORE.id,
    STORE.account_id
  ]);

  assert.equal(update.sql.includes("slug ="), false);
  assert.equal(update.sql.includes("status ="), false);
});

test("Account admin can update store details", async () => {
  const db = createDb({
    session: SESSION,
    store: { ...STORE, account_role: "admin" }
  });

  const response = await handleStores(
    makeRequest("PUT", VALID_DATA),
    { DB: db }
  );

  assert.equal(response.status, 200);
});

test("Invalid store data is rejected without database update", async () => {
  const db = createDb({
    session: SESSION,
    store: STORE
  });

  const response = await handleStores(
    makeRequest("PUT", {
      ...VALID_DATA,
      name: "X"
    }),
    { DB: db }
  );

  assert.equal(response.status, 400);
  assert.equal(db.calls.some(item => item.sql.includes("UPDATE stores")), false);
});

test("Unsupported store methods are rejected", async () => {
  const db = createDb();

  const response = await handleStores(
    makeRequest("DELETE"),
    { DB: db }
  );

  assert.equal(response.status, 405);
});

test("Failed database update returns conflict", async () => {
  const db = createDb({
    session: SESSION,
    store: STORE,
    updateChanges: 0
  });

  const response = await handleStores(
    makeRequest("PUT", VALID_DATA),
    { DB: db }
  );

  assert.equal(response.status, 409);
});


const ACCOUNT = {id:"account-001",role:"owner"};

test("Account owner can create an additional store without receiving another trial", async () => {
  const db = createDb({session:SESSION,account:ACCOUNT});
  const response = await handleStores(
    new Request("https://example.com/api/stores", {
      method:"POST",
      headers:{Origin:"https://example.com",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},
      body:JSON.stringify({account_id:"account-001",name:"Second Store"})
    }),
    {DB:db}
  );
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.store.name,"Second Store");
  assert.equal(result.store.status,"active");
  assert.match(result.store.slug,/^store-/);
});

test("Users cannot create a store by substituting another account ID", async () => {
  const db = createDb({session:SESSION,account:null});
  const response = await handleStores(
    new Request("https://example.com/api/stores", {
      method:"POST",
      headers:{Origin:"https://example.com",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},
      body:JSON.stringify({account_id:"another-account-id",name:"Unauthorized Store"})
    }),
    {DB:db}
  );
  assert.equal(response.status,404);
  assert.equal(db.calls.some(item => item.sql.includes("INSERT INTO stores")),false);
});

test("Account members cannot create additional stores", async () => {
  const db = createDb({session:SESSION,account:{id:"account-001",role:"member"}});
  const response = await handleStores(
    new Request("https://example.com/api/stores", {
      method:"POST",
      headers:{Origin:"https://example.com",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},
      body:JSON.stringify({account_id:"account-001",name:"Second Store"})
    }),
    {DB:db}
  );
  assert.equal(response.status,403);
});

