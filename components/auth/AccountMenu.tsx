import { useEffect, useState } from "react";
import { auth, type AuthUser } from "../faces/api";

/** Signed-in email and a sign-out button, shown in the navigation bar. */
export function AccountMenu() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (!user) return null;

  async function signOut() {
    await auth.signOut().catch(() => {});
    location.replace("/login");
  }

  return (
    <span className="ml-auto flex items-center gap-3 text-sm text-fg-2">
      <span className="hidden sm:inline">{user.email}</span>
      <button onClick={signOut} className="rounded-button border border-border px-3 py-1 text-fg">
        Sign out
      </button>
    </span>
  );
}
