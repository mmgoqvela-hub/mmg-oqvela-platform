import test from "node:test";
import assert from "node:assert/strict";
import { createStoreMediaStorage } from "../../backend/storage/store_media_storage.js";

test("returns null when no compatible storage provider is configured", () => {
  assert.equal(createStoreMediaStorage({}), null);
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: { get() {} } }), null);
  assert.equal(createStoreMediaStorage({ STORE_MEDIA: { put() {} } }), null);
});

test("adapts required get and put operations without coupling routes to a provider", async () => {
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
  assert.equal(calls[0][0], "get");
  assert.equal(calls[0][1], "store/image.jpg");
  assert.equal(calls[1][0], "put");
  assert.equal(calls[1][1], "store/new.jpg");
  assert.equal(calls[1][2], bytes);
  assert.equal(calls[1][3], options);
  assert.equal(storage.head, undefined);
  assert.equal(storage.delete, undefined);
});

test("exposes optional head and delete capabilities through the adapter", async () => {
  const calls = [];
  const metadata = { customMetadata: { storeId: "store-1" } };
  const binding = {
    get() {},
    put() {},
    async head(key) { calls.push(["head", key]); return metadata; },
    async delete(key) { calls.push(["delete", key]); }
  };
  const storage = createStoreMediaStorage({ STORE_MEDIA: binding });
  assert.equal(await storage.head("store-1/image.png"), metadata);
  await storage.delete("store-1/image.png");
  assert.deepEqual(calls, [["head", "store-1/image.png"], ["delete", "store-1/image.png"]]);
});
