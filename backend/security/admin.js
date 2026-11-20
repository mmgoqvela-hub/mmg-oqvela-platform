import { getAuthenticatedSession } from "./authentication.js";

export async function getPlatformAdmin(request, db) {
  const session = await getAuthenticatedSession(request, db);

  if (!session) {
    return null;
  }

  const admin = await db.prepare(`
    SELECT user_id, admin_level, status
    FROM platform_admins
    WHERE user_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(session.user_id).first();

  if (!admin) {
    return null;
  }

  return {
    ...session,
    admin_level: admin.admin_level
  };
}
