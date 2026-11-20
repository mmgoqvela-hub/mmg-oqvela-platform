import { getSession } from "./sessions.js";

const COOKIE_NAME = "mmg_session";

export function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  for (const item of cookies.split(";")) {
    const index = item.indexOf("=");

    if (index < 0) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

export async function getAuthenticatedSession(request, db) {
  const token = getCookie(request, COOKIE_NAME);

  if (!token) {
    return null;
  }

  return await getSession(db, token);
}

export function validOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
