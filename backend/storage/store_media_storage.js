/**
 * Provider-neutral adapter for store media object storage.
 *
 * The configured provider is injected through env.STORE_MEDIA. Routes use
 * this narrow interface instead of depending directly on a vendor binding.
 */
export function createStoreMediaStorage(env) {
  const binding = env?.STORE_MEDIA;
  if (!binding || typeof binding.get !== "function" || typeof binding.put !== "function") {
    return null;
  }

  const storage = {
    get(key) {
      return binding.get(key);
    },
    put(key, value, options) {
      return binding.put(key, value, options);
    }
  };

  // Optional capabilities keep simple read/write providers usable while
  // allowing product galleries to verify ownership and clean up unused files.
  if (typeof binding.head === "function") {
    storage.head = key => binding.head(key);
  }
  if (typeof binding.delete === "function") {
    storage.delete = key => binding.delete(key);
  }

  return Object.freeze(storage);
}
