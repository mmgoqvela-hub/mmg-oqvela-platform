import test from "node:test";
import assert from "node:assert/strict";

import {
  hashPassword,
  verifyPassword
} from "../../backend/security/passwords.js";

test("Password hash has the expected secure format", async () => {
  const hash = await hashPassword("StrongPassword123!");

  const parts = hash.split("$");

  assert.equal(parts.length, 5);
  assert.equal(parts[0], "pbkdf2");
  assert.equal(parts[1], "sha-256");
  assert.equal(Number(parts[2]), 100000);
  assert.equal(parts[3].length, 32);
  assert.equal(parts[4].length, 64);
});

test("Each password hash uses a unique random salt", async () => {
  const first = await hashPassword("StrongPassword123!");
  const second = await hashPassword("StrongPassword123!");

  assert.notEqual(first, second);
});

test("Correct password is accepted and wrong password rejected", async () => {
  const hash = await hashPassword("StrongPassword123!");

  assert.equal(
    await verifyPassword("StrongPassword123!", hash),
    true
  );

  assert.equal(
    await verifyPassword("WrongPassword123!", hash),
    false
  );
});

test("Invalid hashes are rejected", async () => {
  assert.equal(
    await verifyPassword("StrongPassword123!", "invalid"),
    false
  );

  assert.equal(
    await verifyPassword("StrongPassword123!", "pbkdf2$sha-256$99999999$aa$bb"),
    false
  );
});

test("Short passwords are rejected", async () => {
  await assert.rejects(
    hashPassword("Short123"),
    /at least 12 characters/
  );
});

console.log("Password security test suite loaded.");
