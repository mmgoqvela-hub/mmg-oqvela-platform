import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(
  new URL("../../backend/routes/subscriptions.js", import.meta.url),
  "utf8"
);
const migration = await readFile(
  new URL("../../database/migrations/0012_paid_approval_atomicity.sql", import.meta.url),
  "utf8"
);
const senderMigration = await readFile(
  new URL("../../database/migrations/0017_shamcash_sender_name.sql", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = route.indexOf(`async function ${name}(`);
  const end = route.indexOf(`\nasync function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return route.slice(start, end);
}

test("Rejection records history and audit before changing payment status", () => {
  const source = functionSource("rejectPayment", "adminPlans");
  const history = source.indexOf("INSERT INTO subscription_history");
  const audit = source.indexOf("INSERT INTO admin_activity_logs");
  const paymentUpdate = source.indexOf("UPDATE payments");

  assert.ok(history >= 0, "rejection history insert must exist");
  assert.ok(audit > history, "audit insert must follow history insert");
  assert.ok(paymentUpdate > audit, "payment status update must be last");
  assert.match(source, /status = 'rejected'/);
  assert.match(source, /rejection_reason = \?/);
});

test("Database rejection guard requires audit/history and cancels subscription", () => {
  assert.match(migration, /CREATE TRIGGER trg_paid_rejection_guard/);
  assert.match(migration, /action = 'cancelled'/);
  assert.match(migration, /action = 'reject'/);
  assert.match(migration, /CREATE TRIGGER trg_paid_rejection_complete/);
  assert.match(migration, /SET status = 'cancelled'/);
});

test("Approval prepares invoice, history and audit before payment approval", () => {
  const source = functionSource("approvePayment", "rejectPayment");
  const invoice = source.indexOf("INSERT INTO invoices");
  const history = source.indexOf("INSERT INTO subscription_history");
  const audit = source.indexOf("INSERT INTO admin_activity_logs");
  const paymentUpdate = source.indexOf("UPDATE payments");

  assert.ok(invoice >= 0, "invoice insert must exist");
  assert.ok(history > invoice, "history must follow invoice");
  assert.ok(audit > history, "audit must follow history");
  assert.ok(paymentUpdate > audit, "payment approval must be last");
  assert.match(migration, /CREATE TRIGGER trg_paid_approval_guard/);
  assert.match(migration, /CREATE TRIGGER trg_paid_approval_complete/);
});


test("Store subscription history reports expired active records as expired", async () => {
  const route = await readFile(
    new URL("../../backend/routes/subscriptions.js", import.meta.url),
    "utf8"
  );
  assert.match(
    route,
    /WHEN ss\.status = 'active'[\s\S]*?ss\.expires_at IS NOT NULL[\s\S]*?ss\.expires_at <= CURRENT_TIMESTAMP[\s\S]*?THEN 'expired'/
  );
  assert.match(route, /ss\.status AS stored_subscription_status/);
});


test("Subscription billing details are restricted to store owners and admins", () => {
  const source = functionSource("getStoreSubscription", "createSubscriptionRequest");
  const storeLookup = source.indexOf("const store = await getMemberStore");
  const roleGuard = source.indexOf('if (!["owner", "admin"].includes(store.account_role)) return null;');
  const billingQuery = source.indexOf("FROM store_subscriptions ss");
  assert.ok(storeLookup >= 0, "store membership must be verified");
  assert.ok(roleGuard > storeLookup, "billing role guard must follow store lookup");
  assert.ok(billingQuery > roleGuard, "billing data must only be queried after role guard");
});


test("Sham Cash subscription requests require transaction reference and sender name", () => {
  assert.match(route, /function validSenderName\(value\)/);
  assert.match(route, /!validTransactionReference\(reference\)[\s\S]*?!validSenderName\(senderName\)/);
  assert.match(route, /transaction_reference, sender_name/);
  assert.match(route, /p\.sender_name/);
});

test("Subscription payment UI collects and displays the sender name", async () => {
  const html = await readFile(
    new URL("../../frontend/index.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /senderName\.required = true/);
  assert.match(html, /sender_name:senderName\.value\.trim\(\)/);
  assert.match(html, /request\.sender_name/);
  assert.match(html, /اسم المرسل/);
});


test("Sender name is stored and protected as immutable payment evidence", () => {
  assert.match(senderMigration, /ADD COLUMN sender_name TEXT/);
  assert.match(senderMigration, /DROP TRIGGER IF EXISTS trg_payment_financial_fields_guard/);
  assert.match(senderMigration, /NEW\.sender_name IS NOT OLD\.sender_name/);
  assert.match(route, /sender_name: senderName/);
});
