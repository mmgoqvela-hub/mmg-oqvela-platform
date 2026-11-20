import {
  getAuthenticatedSession,
  validOrigin
} from "../security/authentication.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handleNotifications(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isInbox = path === "/api/notifications";
  const isReadAll = path === "/api/notifications/read-all";
  const readMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);

  if (!isInbox && !isReadAll && !readMatch) return null;

  if (!validOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  const session = await getAuthenticatedSession(request, env.DB);
  if (!session) return json({ error: "Authentication required" }, 401);

  try {
    if (isInbox) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const requestedLimit = Number(url.searchParams.get("limit") || 30);
      const limit = Number.isInteger(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 50))
        : 30;
      const [items, count] = await Promise.all([
        env.DB.prepare(`
          SELECT id, notification_type, title, message,
                 entity_type, entity_id, read_at, created_at
          FROM user_notifications
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).bind(session.user_id, limit).all(),
        env.DB.prepare(`
          SELECT COUNT(*) AS unread_count
          FROM user_notifications
          WHERE user_id = ? AND read_at IS NULL
        `).bind(session.user_id).first()
      ]);
      return json({
        status: "ok",
        notifications: items.results || [],
        unread_count: count?.unread_count || 0
      });
    }

    if (isReadAll) {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      await env.DB.prepare(`
        UPDATE user_notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND read_at IS NULL
      `).bind(session.user_id).run();
      return json({ status: "ok" });
    }

    if (readMatch) {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      let notificationId;
      try {
        notificationId = decodeURIComponent(readMatch[1]);
      } catch {
        return json({ error: "Invalid notification ID" }, 400);
      }
      const result = await env.DB.prepare(`
        UPDATE user_notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND read_at IS NULL
      `).bind(notificationId, session.user_id).run();
      if (!result.meta?.changes) {
        const existing = await env.DB.prepare(`
          SELECT id FROM user_notifications WHERE id = ? AND user_id = ?
        `).bind(notificationId, session.user_id).first();
        if (!existing) return json({ error: "Notification not found" }, 404);
      }
      return json({ status: "ok" });
    }

    return json({ error: "Not found" }, 404);
  } catch {
    return json({ error: "Unable to load notifications" }, 500);
  }
}
