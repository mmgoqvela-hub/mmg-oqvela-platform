import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = {
  "image/jpeg": { ext: "jpg", signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { ext: "png", signature: bytes => bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) },
  "image/webp": { ext: "webp", signature: bytes => bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP" },
  "image/gif": { ext: "gif", signature: bytes => ["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.slice(0,6))) }
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function handleStoreMedia(request, env) {
  const url = new URL(request.url);
  const mediaMatch = url.pathname.match(/^\/media\/([a-zA-Z0-9_-]+)\/([a-f0-9-]+)\.(jpg|png|webp|gif)$/i);
  const uploadPath = url.pathname === "/api/store-media";
  if (!mediaMatch && !uploadPath) return null;

  if (!env.STORE_MEDIA) return json({ error: "تخزين الصور غير مهيأ بعد. يلزم ربط مساحة R2 باسم STORE_MEDIA." }, 503);

  if (mediaMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
    const key = mediaMatch[1] + "/" + mediaMatch[2] + "." + mediaMatch[3].toLowerCase();
    const object = await env.STORE_MEDIA.get(key);
    if (!object) return json({ error: "Image not found" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Cross-Origin-Resource-Policy", "same-site");
    if (request.method === "HEAD") return new Response(null, { headers });
    return new Response(object.body, { headers });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!validOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const session = await getAuthenticatedSession(request, env.DB);
  if (!session) return json({ error: "Authentication required" }, 401);

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BYTES + 64 * 1024) return json({ error: "حجم الصورة يتجاوز 5 ميغابايت." }, 413);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "صيغة رفع غير صالحة." }, 400); }
  const storeId = String(form.get("store_id") || "");
  const file = form.get("file");
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(storeId) || !(file instanceof File)) return json({ error: "اختر المتجر والصورة أولاً." }, 400);
  if (!file.size || file.size > MAX_BYTES) return json({ error: "يجب ألا يتجاوز حجم الصورة 5 ميغابايت." }, 413);

  const store = await env.DB.prepare(`
    SELECT s.id, s.account_id
    FROM stores s
    JOIN accounts a ON a.id = s.account_id
    JOIN account_users au ON au.account_id = s.account_id
    WHERE s.id = ? AND au.user_id = ? AND au.status = 'active'
      AND a.status = 'active' AND au.role IN ('owner','admin')
    LIMIT 1
  `).bind(storeId, session.user_id).first();
  if (!store) return json({ error: "لا تملك صلاحية رفع الصور لهذا المتجر." }, 403);

  const type = TYPES[file.type];
  if (!type) return json({ error: "الصيغ المدعومة: JPG وPNG وWebP وGIF فقط." }, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || !type.signature(bytes)) return json({ error: "محتوى الصورة لا يطابق نوع الملف." }, 415);

  const key = storeId + "/" + crypto.randomUUID() + "." + type.ext;
  await env.STORE_MEDIA.put(key, bytes, {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { storeId }
  });
  return json({ status: "ok", url: "/media/" + key, size: bytes.length, contentType: file.type }, 201);
}
