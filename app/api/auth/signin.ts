// POST /api/auth/signin  { email, password } → sets the session cookies
import { authFailed, authRoute, body, requireString } from "../../../lib/faces";
import { authClient, withSession } from "../../../lib/supabase";

export const POST = authRoute(async (request) => {
  const b = await body<{ email: string; password: string }>(request);
  const { data, error } = await authClient().auth.signInWithPassword({ email: requireString(b.email, "email", 320), password: requireString(b.password, "password", 200) });
  if (error || !data.session) authFailed(error, "Sign-in failed.");
  return withSession(request, data.session, { user: { id: data.user.id, email: data.user.email } });
}, "Sign-in endpoint: credentials are checked by Supabase Auth (which rate-limits attempts).");
