import { validOrigin } from "../security/authentication.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

const TYPES = new Set(["support", "advertising", "store_setup", "website_design", "contact"]);

async function enforcePublicRequestLimit(db, request) {
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  const ipHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const result = await db.prepare(`
    INSERT INTO public_service_request_rate_limits(ip_hash, window_started_at, request_count)
    VALUES(?, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN window_started_at <= datetime('now','-10 minutes') THEN CURRENT_TIMESTAMP
        ELSE window_started_at END,
      request_count = CASE
        WHEN window_started_at <= datetime('now','-10 minutes') THEN 1
        ELSE request_count + 1 END
    WHERE window_started_at <= datetime('now','-10 minutes') OR request_count < 5
    RETURNING request_count
  `).bind(ipHash).first();
  return Boolean(result);
}

export async function handlePublicServiceRequests(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/service-requests") return null;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!validOrigin(request)) return json({ error: "Invalid origin" }, 403);

  try {
    if (!await enforcePublicRequestLimit(env.DB, request)) {
      return json({ error: "Too many requests. Please try again in 10 minutes." }, 429);
    }
    const raw = await request.text();
    if (raw.length > 10000) return json({ error: "Request too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Invalid request" }, 400);
    }

    // Honeypot: silently accept automated form fills without storing them.
    if (typeof body.website === "string" && body.website.trim()) {
      return json({ status: "ok", message: "Request received" }, 201);
    }

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const requestType = body.request_type;
    const language = body.language === "en" ? "en" : "ar";

    if (fullName.length < 2 || fullName.length > 120 ||
        !TYPES.has(requestType) ||
        message.length < 10 || message.length > 3000 ||
        email.length > 254 || phone.length > 40 ||
        (!email && !phone) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        (phone && !/^\+?[0-9\s().-]{8,24}$/.test(phone))) {
      return json({ error: "Please provide a valid name, contact method, request type and message" }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO platform_service_requests
        (id, request_type, full_name, email, phone, message, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, requestType, fullName, email, phone, message, language).run();

    return json({
      status: "ok",
      id,
      message: language === "ar"
        ? "تم استلام طلبك بنجاح، وسنراجعه قريباً."
        : "Your request has been received and will be reviewed."
    }, 201);
  } catch {
    return json({ error: "Unable to submit request right now" }, 500);
  }
}
