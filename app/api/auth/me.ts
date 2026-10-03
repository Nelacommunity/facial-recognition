// GET /api/auth/me → the signed-in user, or { user: null }
import { authRoute } from "../../../lib/faces";
import { ACCESS_COOKIE, readCookie, verifyAccessToken } from "../../../lib/supabase";

export const GET = authRoute(async (request) => {
  const token = readCookie(request, ACCESS_COOKIE);
  const user = token ? await verifyAccessToken(token) : undefined;
  return { user: user ? { id: user.id, email: user.email ?? null } : null };
}, "Tells the page whether someone is signed in; reveals nothing without a valid session cookie.");
