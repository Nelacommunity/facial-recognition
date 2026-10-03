import { useEffect, useState } from "react";
import { auth, errorMessage } from "../faces/api";

/** Only same-site paths, so ?next= can't send people to another website. */
function nextPath(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Arriving from a Supabase email link (confirmation, magic link): the session is in the URL fragment.
      const hash = new URLSearchParams(location.hash.slice(1));
      history.replaceState(null, "", location.pathname + location.search); // never leave tokens in the address bar
      try {
        if (hash.get("error_description")) {
          setError(hash.get("error_description"));
        } else if (hash.get("access_token") && hash.get("refresh_token")) {
          await auth.fromLink(hash.get("access_token")!, hash.get("refresh_token")!);
          location.replace(nextPath());
          return;
        } else if (await auth.refresh()) {
          // Still signed in (the access token had only expired).
          location.replace(nextPath());
          return;
        }
      } catch (e) {
        setError(errorMessage(e));
      }
      setBusy(false);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await auth.signIn(email, password);
      } else {
        const r = await auth.signUp(email, password);
        if (r.confirm) {
          setNotice(`Check ${email} for a confirmation link, then come back here.`);
          setBusy(false);
          return;
        }
      }
      location.replace(nextPath());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-surface p-pad shadow-card">
      <h2 className="m-0 text-lg font-semibold text-fg">{mode === "signin" ? "Sign in" : "Create an account"}</h2>
      <label className="flex flex-col gap-1 text-sm text-fg-2">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-border bg-bg px-3 py-2 text-fg" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-2">
        Password
        <input
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-border bg-bg px-3 py-2 text-fg"
        />
      </label>
      <button disabled={busy} className="rounded-button bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-40">
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      {error && <p className="m-0 text-sm text-bad">{error}</p>}
      {notice && <p className="m-0 text-sm text-good">{notice}</p>}
      <button
        type="button"
        onClick={() => (setMode(mode === "signin" ? "signup" : "signin"), setError(null), setNotice(null))}
        className="self-start bg-transparent p-0 text-sm text-link"
      >
        {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
