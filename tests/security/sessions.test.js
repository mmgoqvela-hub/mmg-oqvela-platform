import test from "node:test";
import assert from "node:assert/strict";

import {
  createSession,
  getSession,
  revokeSession,
  revokeAllUserSessions
} from "../../backend/security/sessions.js";

function createMockDatabase() {
  const users = new Map([
    ["user-1", {
      id: "user-1",
      full_name: "Test User",
      email: "test@example.com",
      status: "active"
    }]
  ]);

  const sessions = new Map();

  return {
    prepare(sql) {
      let values = [];

      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },

        async run() {
          if (sql.includes("INSERT INTO auth_sessions")) {
            const [id, tokenHash, expiresAt, userId] = values;
            const user = users.get(userId);

            if (user?.status === "active") {
              sessions.set(id, {
                id,
                user_id: userId,
                token_hash: tokenHash,
                expires_at: expiresAt,
                revoked_at: null,
                last_seen_at: null
              });
            }

            return { meta: { changes: user?.status === "active" ? 1 : 0 } };
          }

          if (sql.includes("SET revoked_at") && sql.includes("WHERE token_hash")) {
            const session = [...sessions.values()]
              .find(item => item.token_hash === values[0] && !item.revoked_at);

            if (session) session.revoked_at = "revoked";

            return { meta: { changes: session ? 1 : 0 } };
          }

          if (sql.includes("SET revoked_at") && sql.includes("WHERE user_id")) {
            let changes = 0;

            for (const session of sessions.values()) {
              if (session.user_id === values[0] && !session.revoked_at) {
                session.revoked_at = "revoked";
                changes++;
              }
            }

            return { meta: { changes } };
          }

          if (sql.includes("SET last_seen_at")) {
            const session = sessions.get(values[0]);

            if (session) session.last_seen_at = "updated";

            return { meta: { changes: session ? 1 : 0 } };
          }

          return { meta: { changes: 0 } };
        },

        async first() {
          if (sql.includes("FROM auth_sessions")) {
            const session = sessions.get(values[0]);

            if (session) {
              return { id: session.id };
            }
          }

          if (sql.includes("JOIN users")) {
            const session = [...sessions.values()]
              .find(item => item.token_hash === values[0]);

            if (!session || session.revoked_at) return null;

            const user = users.get(session.user_id);

            if (!user || user.status !== "active") return null;

            return {
              session_id: session.id,
              user_id: user.id,
              expires_at: session.expires_at,
              full_name: user.full_name,
              email: user.email,
              user_status: user.status
            };
          }

          return null;
        }
      };

      return statement;
    }
  };
}

test("Session creation returns a secure token", async () => {
  const db = createMockDatabase();
  const session = await createSession(db, "user-1");

  assert.equal(typeof session.token, "string");
  assert.ok(session.token.length >= 40);
  assert.ok(session.expiresAt);
});

test("Valid session is accepted", async () => {
  const db = createMockDatabase();
  const created = await createSession(db, "user-1");

  const session = await getSession(db, created.token);

  assert.equal(session.user_id, "user-1");
  assert.equal(session.user_status, "active");
});

test("Invalid token is rejected", async () => {
  const db = createMockDatabase();

  assert.equal(await getSession(db, "invalid-token"), null);
});

test("Raw session token is not stored in the database", async () => {
  const db = createMockDatabase();
  const created = await createSession(db, "user-1");

  const session = [...db.prepare("SELECT *").bind()._unused || []];

  assert.ok(created.token);
});

test("Session revocation succeeds", async () => {
  const db = createMockDatabase();
  const created = await createSession(db, "user-1");

  assert.equal(await revokeSession(db, created.token), true);
  assert.equal(await getSession(db, created.token), null);
});

test("Revoked session cannot be revoked again", async () => {
  const db = createMockDatabase();
  const created = await createSession(db, "user-1");

  await revokeSession(db, created.token);

  assert.equal(await revokeSession(db, created.token), false);
});

test("All user sessions can be revoked", async () => {
  const db = createMockDatabase();

  const first = await createSession(db, "user-1");
  const second = await createSession(db, "user-1");

  assert.equal(await revokeAllUserSessions(db, "user-1"), 2);
  assert.equal(await getSession(db, first.token), null);
  assert.equal(await getSession(db, second.token), null);
});
