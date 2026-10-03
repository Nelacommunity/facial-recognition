// POST /api/auth/signout → revokes the session at Supabase, clears cookies and in-memory face state
import { face_forget } from "../../../tools/faces.py";
import { authRoute } from "../../../lib/faces";
import { ACCESS_COOKIE, readCookie, userClient, verifyAccessToken, withoutSession } from "../../../lib/supabase";

export const POST = authRoute(async (request) => {
  const token = readCookie(request, ACCESS_COOKIE);
  const user = token ? await verifyAccessToken(token) : undefined;
  if (token && user) {
    await userClient(token).auth.admin.signOut(token, "local").catch(() => {});
    await face_forget.run({}, { user: { id: user.id, roles: ["user"] } }).catch(() => {});
  }
  return withoutSession(request, { ok: true });
}, "Sign-out: clears this browser's session.");
