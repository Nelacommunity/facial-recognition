// POST /api/auth/refresh → new session cookies from the refresh-token cookie (401 when signed out)
import { authRoute } from "../../../lib/faces";
import { authClient, readCookie, REFRESH_COOKIE, withSession, withoutSession } from "../../../lib/supabase";

export const POST = authRoute(async (request) => {
  const refresh_token = readCookie(request, REFRESH_COOKIE);
  if (!refresh_token) return withoutSession(request, { error: "Not signed in." }, 401);
  const { data, error } = await authClient().auth.refreshSession({ refresh_token });
  if (error || !data.session) return withoutSession(request, { error: "Session expired. Sign in again." }, 401);
  return withSession(request, data.session, { user: { id: data.session.user.id, email: data.session.user.email } });
}, "Session refresh: only uses the HttpOnly refresh-token cookie.");
