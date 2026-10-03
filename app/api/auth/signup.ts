// POST /api/auth/signup  { email, password } → signed in, or { confirm: true } when Supabase requires email confirmation
import { authFailed, authRoute, body, HttpError, requireString } from "../../../lib/faces";
import { authClient, withSession } from "../../../lib/supabase";

export const POST = authRoute(async (request) => {
  const b = await body<{ email: string; password: string }>(request);
  const password = requireString(b.password, "password", 200);
  if (password.length < 8) throw new HttpError(400, "Use a password of at least 8 characters.");
  const { data, error } = await authClient().auth.signUp({
    email: requireString(b.email, "email", 320),
    password,
    // The confirmation link returns here; app/login reads the session from the URL fragment.
    options: { emailRedirectTo: `${new URL(request.url).origin}/login` },
  });
  if (error) authFailed(error, "Sign-up failed.", 400);
  if (!data.session) return { confirm: true };
  return withSession(request, data.session, { user: { id: data.user?.id, email: data.user?.email } });
}, "Sign-up endpoint: accounts are created by Supabase Auth (which rate-limits sign-ups).");
