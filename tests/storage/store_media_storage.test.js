import test from "node:test";
import assert from "node:assert/strict";
import { createStoreMediaStorage } from "../../backend/storage/store_media_storage.js";

test("returns null when no supported storage capability is configured", () => {
  assert.equal(createStoreMediaStorage({}), null);
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: {} }), null);
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: null }), null);
});

test("adapts get and put without coupling routes to a provider", async () => {
  const calls = [];
  const object = { body: new Uint8Array([1, 2, 3]) };
  const binding = {
    async get(key) { calls.push(["get", key]); return object; },
    async put(key, value, options) { calls.push(["put", key, value, options]); return { key }; }
  };
  const storage = createStoreMediaStorage({ STORE_MEDIA: binding });
  assert.ok(storage);
  assert.equal(await storage.get("store/image.jpg"), object);
  const bytes = new Uint8Array([4, 5, 6]);
  const options = { httpMetadata: { contentType: "image/jpeg" } };
  assert.deepEqual(await storage.put("store/new.jpg", bytes, options), { key: "store/new.jpg" });
  assert.deepEqual(calls.map(call => call.slice(0,2)), [["get","store/image.jpg"],["put","store/new.jpg"]]);
  assert.equal(storage.head, undefined);
  assert.equal(storage.delete, undefined);
});

test("exposes optional head and delete capabilities independently", async () => {
  const calls = [];
  const metadata = { customMetadata: { storeId: "store-1" } };
  const binding = {
    async head(key) { calls.push(["head", key]); return metadata; },
    async delete(key) { calls.push(["delete", key]); }
  };
  const storage = createStoreMediaStorage({ STORE_MEDIA: binding });
  assert.equal(await storage.head("store-1/image.png"), metadata);
  await storage.delete("store-1/image.png");
  assert.deepEqual(calls, [["head","store-1/image.png"],["delete","store-1/image.png"]]);
  assert.equal(storage.get, undefined);
  assert.equal(storage.put, undefined);
});

test("keeps provider method context and exposes an immutable capability surface", async () => {
  const binding = {
    marker: "provider-instance",
    async put(key) {
      assert.equal(this.marker, "provider-instance");
      return key;
    }
  };
  const storage = createStoreMediaStorage({ STORE_MEDIA: binding });
  assert.equal(await storage.put("store/image.webp"), "store/image.webp");
  assert.equal(Object.isFrozen(storage), true);
  assert.deepEqual(Object.keys(storage), ["put"]);
});

test("ignores non-function provider properties and rejects non-object bindings", () => {
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: "bucket" }), null);
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: { get: true, put: null } }), null);
  const storage = createStoreMediaStorage({
    STORE_MEDIA: { get: async () => null, providerName: "example" }
  });
  assert.deepEqual(Object.keys(storage), ["get"]);
});
