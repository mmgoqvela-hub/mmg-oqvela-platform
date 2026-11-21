/**
 * Provider-neutral adapter for private store media storage.
 *
 * Providers are injected through env.STORE_MEDIA and must implement the
 * Cloudflare R2-compatible get/put object-storage contract. The route layer
 * depends only on this adapter, so a future provider can be swapped here.
 */
export function createStoreMediaStorage(env) {
  const binding = env?.STORE_MEDIA;
  if (!binding || typeof binding.get !== "function" || typeof binding.put !== "function") {
    return null;
  }

  return Object.freeze({
    get(key) {
      return binding.get(key);
    },
    put(key, value, options) {
      return binding.put(key, value, options);
    }
  });
}
