# Store media storage adapter

The store-media routes depend only on the `STORE_MEDIA` binding contract. A
provider must be connected through this boundary; routes and browser code must
not contain provider SDK calls or provider credentials.

## Binding contract

The binding may expose these independent asynchronous capabilities:

| Method | Contract | Used by |
| --- | --- | --- |
| `put(key, value, options)` | Stores bytes and accepts the upload options below. | Upload route |
| `get(key)` | Returns an object with `body` and `writeHttpMetadata(headers)`, or `null`. | Media GET/HEAD |
| `head(key)` | Returns object metadata, including `customMetadata`, or `null`. | Product image validation |
| `delete(key)` | Deletes the object at the key. | Product image removal |

Methods are optional and exposed independently. A route must check for the
capability it needs and must not assume that the other methods exist.

### Upload options

The current upload route passes:

- `httpMetadata.contentType`: validated image MIME type.
- `httpMetadata.cacheControl`: immutable one-year cache policy.
- `customMetadata.storeId`: owning store identifier.

The provider adapter is responsible for translating these values to its SDK
without changing the route contract.

## Security and tenancy requirements

- Use a private origin bucket/container. Do not expose provider credentials or
  direct write access to browsers.
- Keep object keys in the form `{storeId}/{uuid}.{extension}`.
- Preserve the owning `storeId` metadata on every object so catalog operations
  can verify ownership before attaching or deleting media.
- Keep authorization, origin checks, file-size limits, MIME/signature checks,
  and tenant ownership checks in the application routes.
- Do not treat a CDN as the permanent origin store. CDN/cache configuration is
  a delivery concern and must remain replaceable independently.
- Provider-specific configuration belongs in the deployment binding/adapter,
  never in frontend code or tenant-facing records.

## Adding a provider

1. Implement the four methods supported by the provider, mapping only the
   capabilities it actually offers.
2. Return the object shape documented above from `get`; adapt provider-specific
   response objects inside the provider adapter.
3. Preserve metadata and key semantics.
4. Add adapter contract tests for missing objects, metadata, upload options,
   deletion, and provider errors.
5. Run the repository CI dry-run and test suite before configuring production.
6. Confirm commercial/multi-tenant terms, free-tier limits, billing
   requirements, and data location before enabling the binding.

No provider is selected or enabled by this contract. The current application
continues to report uploads as unavailable until `STORE_MEDIA` is configured.
