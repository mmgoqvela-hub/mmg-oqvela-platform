import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { handleStoreMedia } from "../../backend/routes/store_media.js";

const TOKEN = "a".repeat(43);
const SESSION = {session_id:"s1",user_id:"user-1",expires_at:"2099-01-01 00:00:00",full_name:"Test",email:"t@example.com",user_status:"active"};
function env(options={}) {
  const objects = new Map();
  return {
    objects,
    DB: { prepare(sql) { return { bind(...values) { return { async first() {
      if (sql.includes("FROM auth_sessions")) return options.session === false ? null : SESSION;
      if (sql.includes("FROM stores s")) return options.store === false ? null : {id:"store-1",account_id:"account-1"};
      return null;
    } }; } }; } },
    STORE_MEDIA: {
      async put(key,value,metadata) { objects.set(key,{value,metadata}); },
      async get(key) { const item=objects.get(key); if(!item)return null; return {body:new Blob([item.value]).stream(),writeHttpMetadata(headers){headers.set("Content-Type",item.metadata.httpMetadata.contentType);}}; }
    }
  };
}
function uploadRequest(file, options={}) {
  const form = new FormData();
  form.set("store_id",options.storeId || "store-1");
  if (file) form.set("file",file,"image.png");
  const headers = {Origin:"https://example.com"};
  if (options.auth !== false) headers.Cookie="mmg_session="+TOKEN;
  return new Request("https://example.com/api/store-media",{method:"POST",headers,body:form});
}
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
test("Store image upload requires an authenticated session",async()=>{
  const response=await handleStoreMedia(uploadRequest(new Blob([png],{type:"image/png"}),{auth:false}),env());
  assert.equal(response.status,401);
});
test("Store owner can upload a signature-verified PNG to isolated R2 storage",async()=>{
  const runtime=env();
  const response=await handleStoreMedia(uploadRequest(new Blob([png],{type:"image/png"})),runtime);
  const result=await response.json();
  assert.equal(response.status,201);
  assert.match(result.url,/^\/media\/store-1\/[a-f0-9-]+\.png$/);
  assert.equal(runtime.objects.size,1);
  assert.equal(runtime.objects.values().next().value.metadata.customMetadata.storeId,"store-1");
});
test("Store image upload rejects cross-account store IDs",async()=>{
  const response=await handleStoreMedia(uploadRequest(new Blob([png],{type:"image/png"})),env({store:false}));
  assert.equal(response.status,403);
});
test("Store image upload rejects unsupported MIME types",async()=>{
  const response=await handleStoreMedia(uploadRequest(new Blob(["hello"],{type:"text/plain"})),env());
  assert.equal(response.status,415);
});
test("Store image upload rejects a file whose bytes do not match its MIME type",async()=>{
  const response=await handleStoreMedia(uploadRequest(new Blob(["not a png"],{type:"image/png"})),env());
  assert.equal(response.status,415);
});
test("Store image upload rejects files larger than five megabytes",async()=>{
  const response=await handleStoreMedia(uploadRequest(new Blob([new Uint8Array(5*1024*1024+1)],{type:"image/png"})),env());
  assert.equal(response.status,413);
});
test("Public media route serves only an existing namespaced object with safe headers",async()=>{
  const runtime=env();
  await runtime.STORE_MEDIA.put("store-1/123e4567-e89b-12d3-a456-426614174000.png",png,{httpMetadata:{contentType:"image/png"}});
  const response=await handleStoreMedia(new Request("https://example.com/media/store-1/123e4567-e89b-12d3-a456-426614174000.png"),runtime);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");
  assert.equal(response.headers.get("Content-Type"),"image/png");
});
