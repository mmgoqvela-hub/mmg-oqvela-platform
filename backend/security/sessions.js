// MMG OQVELA
// Secure session management for Cloudflare Workers.

const SESSION_DURATION_DAYS = 7;

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return toHex(new Uint8Array(digest));
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function formatDatabaseTime(date) {
  return date.toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

export async function createSession(db, userId) {
  if (!db || !userId) {
    throw new Error("Database and user ID are required");
  }

  const token = createToken();
  const tokenHash = await hashToken(token);
  const sessionId = crypto.randomUUID();

  const expiresAt = formatDatabaseTime(
    new Date(Date.now() + SESSION_DURATION_DAYS * 86400000)
  );

  await db.prepare(`
    INSERT INTO auth_sessions (
      id, user_id, token_hash, expires_at
    )
    SELECT ?, id, ?, ?
    FROM users
    WHERE id = ?
      AND status = 'active'
  `).bind(
    sessionId,
    tokenHash,
    expiresAt,
    userId
  ).run();

  const created = await db.prepare(`
    SELECT id
    FROM auth_sessions
    WHERE id = ? AND user_id = ?
  `).bind(sessionId, userId).first();

  if (!created) {
    throw new Error("Unable to create session for this user");
  }

  return { token, expiresAt };
}

export async function getSession(db, token) {
  if (
    !db ||
    typeof token !== "string" ||
    token.length < 40 ||
    token.length > 100
  ) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const session = await db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.expires_at,
      u.full_name,
      u.email,
      u.status AS user_status,
      u.preferred_language
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.status = 'active'
    LIMIT 1
  `).bind(tokenHash).first();

  if (!session) return null;

  await db.prepare(`
    UPDATE auth_sessions
    SET last_seen_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        last_seen_at IS NULL
        OR last_seen_at <= datetime('now', '-5 minutes')
      )
  `).bind(session.session_id).run();

  return session;
}

export async function revokeSession(db, token) {
  if (
    !db ||
    typeof token !== "string" ||
    token.length < 40 ||
    token.length > 100
  ) {
    return false;
  }

  const tokenHash = await hashToken(token);

  const result = await db.prepare(`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ?
      AND revoked_at IS NULL
  `).bind(tokenHash).run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function revokeAllUserSessions(db, userId) {
  if (!db || !userId) {
    throw new Error("Database and user ID are required");
  }

  const result = await db.prepare(`
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND revoked_at IS NULL
  `).bind(userId).run();

  return result.meta?.changes ?? 0;
}
