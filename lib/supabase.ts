// Server-only Supabase access: configuration, session cookies, token verification and clients.
//
// Sign-in happens on the server (app/api/auth/*). The browser only ever holds HttpOnly cookies, so
// tokens are invisible to page scripts and the page's CSP needs no Supabase origin. Database calls
// use the signed-in user's access token, so Supabase row-level security applies to every query.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { secret, type IdentityAdapter } from "@aixjs/aix";

export const ACCESS_COOKIE = "faceid_at";
export const REFRESH_COOKIE = "faceid_rt";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!url) throw new Error("SUPABASE_URL is not set. Copy .env.example to .env and fill in your Supabase project.");
  return url;
}

function anonKey(): string {
  return secret("SUPABASE_ANON_KEY").reveal();
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** A client for auth calls (sign-in, sign-up, refresh) with no user session. */
export function authClient(): SupabaseClient {
  return createClient(supabaseUrl(), anonKey(), { ...clientOptions, auth: { ...clientOptions.auth, flowType: "implicit" } });
}

/** A client that acts as the signed-in user: row-level security applies to every query. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), anonKey(), { ...clientOptions, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

// ------------------------------------------------------------------------------------- cookies

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function cookie(request: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** A JSON response that stores the session in HttpOnly cookies. */
export function withSession(request: Request, session: Session, body: unknown): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", cookie(request, ACCESS_COOKIE, session.access_token, session.expires_in ?? 3600));
  headers.append("set-cookie", cookie(request, REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE));
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/** A JSON response that clears the session cookies. */
export function withoutSession(request: Request, body: unknown, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", cookie(request, ACCESS_COOKIE, "", 0));
  headers.append("set-cookie", cookie(request, REFRESH_COOKIE, "", 0));
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------- verification

export interface VerifiedUser {
  id: string;
  email?: string;
  claims: JWTPayload;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
// Legacy HS256 projects without SUPABASE_JWT_SECRET are verified by asking Supabase Auth; cache those answers.
const remoteChecks = new Map<string, { user: VerifiedUser; until: number }>();

/**
 * Verify a Supabase access token: signature, issuer, audience and expiry. New projects sign with
 * asymmetric keys (checked against the project's JWKS); legacy HS256 projects need SUPABASE_JWT_SECRET,
 * or fall back to a (cached) call to Supabase Auth.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedUser | undefined> {
  const url = supabaseUrl();
  const options = { issuer: `${url}/auth/v1`, audience: "authenticated" };
  let payload: JWTPayload;
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg === "HS256") {
      // An empty value (e.g. a blank variable on the hosting platform) counts as not set.
      const jwtSecret = secret("SUPABASE_JWT_SECRET", { optional: true })?.reveal();
      if (!jwtSecret) return verifyWithAuthServer(token);
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret), { ...options, algorithms: ["HS256"] }));
    } else {
      jwks ??= createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
      ({ payload } = await jwtVerify(token, jwks, { ...options, algorithms: ["ES256", "RS256"] }));
    }
  } catch {
    return undefined; // expired, malformed or forged: treated as signed out
  }
  if (!payload.sub || payload.role !== "authenticated") return undefined;
  return { id: payload.sub, ...(typeof payload.email === "string" ? { email: payload.email } : {}), claims: payload };
}

async function verifyWithAuthServer(token: string): Promise<VerifiedUser | undefined> {
  const now = Date.now();
  const cached = remoteChecks.get(token);
  if (cached && cached.until > now) return cached.user;
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) return undefined;
  const exp = Number((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as JWTPayload).exp ?? 0) * 1000;
  const user: VerifiedUser = { id: data.user.id, ...(data.user.email ? { email: data.user.email } : {}), claims: {} };
  if (remoteChecks.size > 1000) remoteChecks.clear();
  remoteChecks.set(token, { user, until: Math.min(exp, now + 60_000) });
  return user;
}

/** AIX identity adapter: the signed-in Supabase user, from the access-token cookie. */
export function supabaseIdentity(): IdentityAdapter {
  return {
    name: "supabase",
    async authenticate(request) {
      const token = readCookie(request, ACCESS_COOKIE);
      if (!token) return undefined;
      const user = await verifyAccessToken(token);
      if (!user) return undefined;
      return { id: user.id, roles: ["user"], provider: "supabase", ...(user.email ? { email: user.email } : {}) };
    },
  };
}
