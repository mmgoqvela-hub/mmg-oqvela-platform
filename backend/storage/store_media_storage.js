/**
 * Provider-neutral adapter for store media object storage.
 *
 * Each storage capability is exposed independently. This supports providers
 * and test doubles that implement only the operations needed by a route.
 */
export function createStoreMediaStorage(env) {
  const binding = env?.STORE_MEDIA;
  if (!binding || typeof binding !== "object") return null;

  const storage = {};
  for (const method of ["get", "put", "head", "delete"]) {
    if (typeof binding[method] === "function") {
      storage[method] = (...args) => binding[method](...args);
    }
  }
  return Object.keys(storage).length ? Object.freeze(storage) : null;
}
