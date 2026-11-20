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
const eventsMigration = await readFile(
  new URL("../../database/migrations/0019_subscription_notification_events.sql", import.meta.url),
  "utf8"
);
const scheduler = await readFile(
  new URL("../../backend/notifications/scheduler.js", import.meta.url),
  "utf8"
);
const wrangler = await readFile(
  new URL("../../wrangler.toml", import.meta.url),
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


test("Subscription payment and trial lifecycle events create owner-only inbox notifications transactionally", () => {
  for (const trigger of [
    "trg_notify_subscription_request",
    "trg_notify_subscription_approved",
    "trg_notify_subscription_rejected",
    "trg_notify_trial_started"
  ]) assert.ok(eventsMigration.includes(trigger), "missing trigger " + trigger);
  assert.match(eventsMigration, /JOIN accounts a ON a\.id = s\.account_id/);
  assert.match(eventsMigration, /a\.owner_user_id/);
  assert.match(eventsMigration, /INSERT OR IGNORE INTO user_notifications/);
  assert.match(eventsMigration, /NEW\.rejection_reason/);
  assert.match(eventsMigration, /NEW\.status = 'approved'/);
  assert.match(eventsMigration, /NEW\.status = 'rejected'/);
});

test("Daily scheduled job creates deduplicated 3-day, 1-day and expiry notifications", () => {
  assert.match(scheduler, /date\(ss\.expires_at\) = date\('now', '\+3 days'\)/);
  assert.match(scheduler, /date\(ss\.expires_at\) = date\('now', '\+1 day'\)/);
  assert.match(scheduler, /ss\.expires_at <= CURRENT_TIMESTAMP/);
  assert.match(scheduler, /subscription-expiry-3d:/);
  assert.match(scheduler, /subscription-expiry-1d:/);
  assert.match(scheduler, /subscription-expired:/);
  assert.match(scheduler, /INSERT OR IGNORE/);
  assert.match(worker, /async scheduled\(controller, env, ctx\)/);
  assert.match(worker, /scheduleSubscriptionNotifications\(env\)/);
  assert.match(wrangler, /crons = \["0 9 \* \* \*"\]/);
});

test("Notification messages are safely rendered and localized for Arabic", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /function notificationText\(value\)/);
  assert.match(html, /currentLanguage !== "ar"/);
  assert.match(html, /message\.textContent = notificationText\(item\.message\)/);
  assert.match(html, /title\.textContent = notificationText\(item\.title\)/);
  assert.match(html, /Your payment request for/);
  assert.match(html, /انتهت الفترة التجريبية لمتجر/);
});


test("Every notification read mutation is scoped to the authenticated user", () => {
  assert.match(route, /UPDATE user_notifications[\s\S]*?WHERE user_id = \? AND read_at IS NULL/);
  assert.match(route, /UPDATE user_notifications[\s\S]*?WHERE id = \? AND user_id = \? AND read_at IS NULL/);
  assert.match(route, /SELECT id FROM user_notifications WHERE id = \? AND user_id = \?/);
  assert.match(route, /getAuthenticatedSession\(request, env\.DB\)/);
  assert.match(route, /if \(!validOrigin\(request\)\)/);
});

test("Notification inbox bounds user-controlled page size and disables caching", () => {
  assert.match(route, /Math\.max\(1, Math\.min\(requestedLimit, 50\)\)/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(route, /WHERE user_id = \?\s+ORDER BY created_at DESC/);
});
