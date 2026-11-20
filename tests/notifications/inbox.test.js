import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(
  new URL("../../backend/routes/notifications.js", import.meta.url),
  "utf8"
);
const migration = await readFile(
  new URL("../../database/migrations/0018_user_notifications.sql", import.meta.url),
  "utf8"
);
const worker = await readFile(
  new URL("../../backend/worker.js", import.meta.url),
  "utf8"
);

test("Persistent notification inbox is scoped to the authenticated user", () => {
  assert.match(route, /getAuthenticatedSession\(request, env\.DB\)/);
  assert.match(route, /WHERE user_id = \?/);
  assert.match(route, /UPDATE user_notifications[\s\S]*?WHERE id = \? AND user_id = \?/);
  assert.match(route, /read-all/);
  assert.match(route, /Math\.min\(requestedLimit, 50\)/);
});

test("Notification storage supports deduplication, unread state and user ownership", () => {
  assert.match(migration, /CREATE TABLE user_notifications/);
  assert.match(migration, /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/);
  assert.match(migration, /dedupe_key TEXT UNIQUE/);
  assert.match(migration, /read_at TEXT/);
  assert.match(migration, /idx_user_notifications_unread/);
});

test("Worker routes notification API requests", () => {
  assert.match(worker, /import \{ handleNotifications \} from "\.\/routes\/notifications\.js"/);
  assert.match(worker, /handleNotifications\(request, env\)/);
});
