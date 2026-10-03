// POST /api/auth/session  { access_token, refresh_token } → stores a session that arrived in an email link
import { authFailed, authRoute, body, HttpError, requireString } from "../../../lib/faces";
import { authClient, verifyAccessToken, withSession } from "../../../lib/supabase";

export const POST = authRoute(async (request) => {
  const b = await body<{ access_token: string; refresh_token: string }>(request);
  const access = requireString(b.access_token, "access_token", 8192);
  if (!(await verifyAccessToken(access))) throw new HttpError(401, "This sign-in link is invalid or has expired.");
  // Exchange the refresh token so the stored session is fresh and its expiry is known.
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: requireString(b.refresh_token, "refresh_token", 1024) });
  if (error || !data.session) authFailed(error, "This sign-in link is invalid or has expired.");
  return withSession(request, data.session, { user: { id: data.session.user.id, email: data.session.user.email } });
}, "Completes sign-in from a Supabase email link; the token is verified before it is stored.");
