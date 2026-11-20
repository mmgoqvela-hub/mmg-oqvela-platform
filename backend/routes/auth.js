import {
  createSession,
  getSession,
  revokeSession
} from "../security/sessions.js";

import {
  hashPassword,
  verifyPassword
} from "../security/passwords.js";

const COOKIE_NAME = "mmg_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const MAX_BODY_SIZE = 16384;

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  for (const item of cookies.split(";")) {
    const index = item.indexOf("=");

    if (index < 0) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key === name) return value;
  }

  return null;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);

  if (length > MAX_BODY_SIZE) {
    return { error: "Request body is too large" };
  }

  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return { error: "Content-Type must be application/json" };
  }

  if (!request.body) {
    return { error: "Invalid request body" };
  }

  try {
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;

      if (total > MAX_BODY_SIZE) {
        await reader.cancel();
        return { error: "Request body is too large" };
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = JSON.parse(text);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: "Invalid request body" };
    }

    return { body };
  } catch {
    return { error: "Invalid JSON" };
  }
}

function validEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

async function register(request, env) {
  const parsed = await readBody(request);

  if (parsed.error) {
    return json({ error: parsed.error }, 400);
  }

  const { fullName, email, password } = parsed.body;

  const name = typeof fullName === "string"
    ? fullName.trim().replace(/\s+/g, " ")
    : "";

  const normalizedEmail = typeof email === "string"
    ? email.trim().toLowerCase()
    : "";

  if (name.length < 2 || name.length > 100) {
    return json({
      error: "Name must contain 2 to 100 characters"
    }, 400);
  }

  if (!validEmail(normalizedEmail)) {
    return json({ error: "Invalid email address" }, 400);
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  ) {
    return json({
      error: "Password must contain at least 12 characters"
    }, 400);
  }

  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();

  try {
    const passwordHash = await hashPassword(password);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, full_name, email, password_hash, status
        )
        VALUES (?, ?, ?, ?, 'active')
      `).bind(
        userId,
        name,
        normalizedEmail,
        passwordHash
      ),

      env.DB.prepare(`
        INSERT INTO accounts (
          id, name, owner_user_id, status
        )
        VALUES (?, ?, ?, 'active')
      `).bind(
        accountId,
        name,
        userId
      ),

      env.DB.prepare(`
        INSERT INTO account_users (
          account_id, user_id, role, status
        )
        VALUES (?, ?, 'owner', 'active')
      `).bind(accountId, userId)
    ]);

    const session = await createSession(env.DB, userId);

    return json({
      status: "ok",
      message: "Account created successfully",
      user: {
        id: userId,
        fullName: name,
        email: normalizedEmail
      },
      account: {
        id: accountId,
        name,
        role: "owner"
      }
    }, 201, {
      "Set-Cookie": sessionCookie(session.token)
    });

  } catch (error) {
    const message = String(error?.message || "");

    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("users.email")
    ) {
      return json({
        error: "An account with this email already exists"
      }, 409);
    }

    return json({
      error: "Unable to create account"
    }, 500);
  }
}


const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MINUTES = 15;

async function loginKeyHash(email, ip) {
  const data = new TextEncoder().encode(`${email}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

async function isLoginBlocked(db, keyHash) {
  const row = await db.prepare(`
    SELECT 1 AS blocked
    FROM auth_login_attempts
    WHERE key_hash = ?
      AND blocked_until > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(keyHash).first();

  return Boolean(row);
}

async function recordFailedLogin(db, keyHash) {
  await db.prepare(`
    INSERT INTO auth_login_attempts
      (key_hash, attempts, window_started_at, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE
        WHEN window_started_at <= datetime('now', '-15 minutes')
        THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE
        WHEN window_started_at <= datetime('now', '-15 minutes')
        THEN CURRENT_TIMESTAMP ELSE window_started_at END,
      blocked_until = CASE
        WHEN (
          CASE
            WHEN window_started_at <= datetime('now', '-15 minutes')
            THEN 1 ELSE attempts + 1
          END
        ) >= 5
        THEN datetime('now', '+15 minutes')
        ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(keyHash).run();

  return isLoginBlocked(db, keyHash);
}

async function clearFailedLogins(db, keyHash) {
  await db.prepare(`
    DELETE FROM auth_login_attempts WHERE key_hash = ?
  `).bind(keyHash).run();
}


async function login(request, env) {
  const parsed = await readBody(request);

  if (parsed.error) {
    return json({ error: parsed.error }, 400);
  }

  const { email, password } = parsed.body;
  const normalizedEmail = typeof email === "string"
    ? email.trim().toLowerCase()
    : "";

  if (
    !validEmail(normalizedEmail) ||
    typeof password !== "string" ||
    password.length > 1024
  ) {
    return json({ error: "Invalid email or password" }, 401);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const keyHash = await loginKeyHash(normalizedEmail, ip);

    if (await isLoginBlocked(env.DB, keyHash)) {
      return json({
        error: "Too many login attempts. Try again in 15 minutes."
      }, 429, { "Retry-After": "900" });
    }

    const user = await env.DB.prepare(`
      SELECT id, full_name, email, password_hash, status
      FROM users
      WHERE email = ?
      LIMIT 1
    `).bind(normalizedEmail).first();

    if (
      !user ||
      user.status !== "active" ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      const blocked = await recordFailedLogin(env.DB, keyHash);

      if (blocked) {
        return json({
          error: "Too many login attempts. Try again in 15 minutes."
        }, 429, { "Retry-After": "900" });
      }

      return json({ error: "Invalid email or password" }, 401);
    }

    await clearFailedLogins(env.DB, keyHash);
    const session = await createSession(env.DB, user.id);

    return json({
      status: "ok",
      message: "Login successful",
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email
      }
    }, 200, {
      "Set-Cookie": sessionCookie(session.token)
    });

  } catch {
    return json({ error: "Unable to complete login" }, 500);
  }
}

async function currentUser(request, env) {
  const token = getCookie(request, COOKIE_NAME);

  if (!token) {
    return json({ error: "Authentication required" }, 401);
  }

  try {
    const session = await getSession(env.DB, token);

    if (!session) {
      return json({
        error: "Session expired or invalid"
      }, 401, {
        "Set-Cookie": clearSessionCookie()
      });
    }

    const [accountsResult, storesResult] = await Promise.all([
      env.DB.prepare(`
        SELECT
          a.id,
          a.name,
          au.role
        FROM account_users au
        JOIN accounts a ON a.id = au.account_id
        WHERE au.user_id = ?
          AND au.status = 'active'
          AND a.status = 'active'
        ORDER BY a.created_at ASC
      `).bind(session.user_id).all(),

      env.DB.prepare(`
        SELECT
          s.id,
          s.account_id,
          s.name,
          s.slug,
          s.business_type,
          s.status
        FROM stores s
        JOIN account_users au
          ON au.account_id = s.account_id
        WHERE au.user_id = ?
          AND au.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 100
      `).bind(session.user_id).all()
    ]);

    return json({
      status: "ok",
      user: {
        id: session.user_id,
        fullName: session.full_name,
        email: session.email
      },
      accounts: accountsResult.results || [],
      stores: storesResult.results || []
    });

  } catch {
    return json({
      error: "Unable to retrieve account"
    }, 500);
  }
}

async function logout(request, env) {
  const token = getCookie(request, COOKIE_NAME);

  try {
    if (token) {
      await revokeSession(env.DB, token);
    }

    return json({
      status: "ok",
      message: "Logged out successfully"
    }, 200, {
      "Set-Cookie": clearSessionCookie()
    });

  } catch {
    return json({
      error: "Unable to complete logout"
    }, 500);
  }
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/auth/")) {
    return null;
  }

  if (!validOrigin(request)) {
    return json({ error: "Invalid request origin" }, 403);
  }

  if (path === "/api/auth/register") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    return register(request, env);
  }

  if (path === "/api/auth/login") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    return login(request, env);
  }

  if (path === "/api/auth/logout") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    return logout(request, env);
  }

  if (path === "/api/auth/me") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    return currentUser(request, env);
  }

  return json({ error: "Not found" }, 404);
}
