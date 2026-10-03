import { route, routes } from "@aixjs/aix";

// Everything requires a signed-in Supabase user unless listed as public here.
// Signed-out visitors to a page are sent to /login?next=…
export default routes({ default: "authenticated", loginPath: "/login" }, [
  route("/login", { public: true, purpose: "Sign in or create an account" }),
  route("/api/auth/**", { public: true }),
  route("/api/health", { public: true }),
  route("/", { purpose: "Live face recognition and guided enrollment" }),
  route("/people", { purpose: "Manage enrolled people" }),
  route("/history", { purpose: "Recognition history" }),
  route("/settings", { purpose: "Recognition settings and data deletion" }),
]);
