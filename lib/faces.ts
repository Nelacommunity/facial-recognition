// Server-only helpers for the /api/faces and /api/auth routes.
import { action, guarded, publicRoute, type GuardedContext } from "@aixjs/aix";
import type { SupabaseClient } from "@supabase/supabase-js";
import { face_load_gallery, face_model } from "../tools/faces.py";
import { ACCESS_COOKIE, readCookie, userClient } from "./supabase";

/** Header the browser client sends. A custom header forces a CORS preflight, which this server never approves. */
export const CLIENT_HEADER = "x-faceid-client";

// Recognition runs several times a second, so it isn't written to the audit log; changes to face data are.
const facesUse = action({ name: "faces.use", description: "Recognize faces and enroll people", anyAuthenticated: true, audit: false });
const facesManage = action({ name: "faces.manage", description: "Change or delete face data", anyAuthenticated: true, sensitive: true });

export interface FaceCtx {
  /** Passed to Python tools as the call's user (ctx.user there). */
  user: { id: string; roles: string[] };
  db: SupabaseClient;
  params: Record<string, string | string[]>;
}

type FaceHandler = (request: Request, ctx: FaceCtx) => unknown;

/** A signed-in /api/faces route: same-origin only, errors mapped to JSON. */
export function faceRoute(handler: FaceHandler, options: { manage?: boolean } = {}) {
  return guarded(options.manage ? facesManage : facesUse, async (request: Request, { identity, params }: GuardedContext) => {
    const blocked = crossSite(request);
    if (blocked) return blocked;
    const token = readCookie(request, ACCESS_COOKIE);
    if (!token) return Response.json({ error: "Sign in again." }, { status: 401 });
    try {
      return await handler(request, { user: { id: identity.id, roles: [...identity.roles] }, db: userClient(token), params });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

/** A public auth route (sign-in, sign-up …): same-origin only, errors mapped to JSON. */
export function authRoute(handler: (request: Request) => unknown, reason: string) {
  return publicRoute(
    async (request: Request) => {
      const blocked = crossSite(request);
      if (blocked) return blocked;
      try {
        return await handler(request);
      } catch (error) {
        return errorResponse(error);
      }
    },
    { reason },
  );
}

function crossSite(request: Request): Response | undefined {
  const site = request.headers.get("sec-fetch-site");
  if (request.headers.get(CLIENT_HEADER) !== "1" || (site && site !== "same-origin")) {
    return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  return undefined;
}

// ------------------------------------------------------------------------------- request data

/** Read a JSON body, or {} when there is none. */
export async function body<T extends object>(request: Request): Promise<Partial<T>> {
  const text = await request.text();
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Partial<T>) : {};
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

export function personId(params: Record<string, string | string[]>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid person id.");
  return id;
}

export function requireString(value: unknown, field: string, maxLength = 4_000_000): string {
  if (typeof value !== "string" || !value || value.length > maxLength) throw new HttpError(400, `"${field}" is required.`);
  return value;
}

export function cleanName(value: unknown): string {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ").slice(0, 80) : "";
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throw on a Supabase error, with a readable message. */
export function check<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) {
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(result.error.message)) throw unreachable();
    if (result.error.code === "PGRST116" || result.error.code === "P0002") throw new HttpError(404, "Not found.");
    if (result.error.code === "42P01" || result.error.code === "PGRST205") {
      throw new HttpError(503, "The Face ID tables are missing. Apply supabase/migrations to your Supabase project.");
    }
    throw new Error(`Supabase: ${result.error.message}`);
  }
  return result.data;
}

function unreachable() {
  return new HttpError(503, "Couldn't reach Supabase. Check SUPABASE_URL and your network.");
}

/** Throw for a failed Supabase Auth call, with a readable message. */
export function authFailed(error: { message: string; status?: number; name?: string } | null, fallback: string, status = 401): never {
  if (!error) throw new HttpError(status, fallback);
  if (error.name === "AuthRetryableFetchError" || /fetch failed/i.test(error.message)) throw unreachable();
  throw new HttpError(error.status === 429 ? 429 : status, error.message || fallback);
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const e = error as { code?: string; message?: string; status?: number; details?: { status?: number; hint?: string } };
  // Errors raised by tools/faces.py arrive as AixErrors with a code and the Python message.
  const status = e.details?.status ?? (e.code === "VALIDATION_FAILED" ? 400 : e.code === "CONFIG_INVALID" ? 503 : e.code === "UNAUTHENTICATED" ? 401 : (e.status ?? 500));
  const expose = status < 500 || e.code === "CONFIG_INVALID";
  if (!expose) console.error("[faces]", error);
  return Response.json({ error: expose ? (e.message ?? "Error") : "Something went wrong. See the server log.", hint: e.details?.hint }, { status });
}

// ------------------------------------------------------------------------- settings and gallery

export interface FaceSettings {
  recognition_threshold: number;
  min_face_size: number;
  detection_score_threshold: number;
  enrollment_samples: number;
  event_cooldown_seconds: number;
  log_unknown_faces: boolean;
}

export const SETTING_KEYS = ["recognition_threshold", "min_face_size", "detection_score_threshold", "enrollment_samples", "event_cooldown_seconds", "log_unknown_faces"] as const;

const CACHE_MS = 30_000;
const settingsCache = new Map<string, { value: Partial<FaceSettings>; until: number }>();
// Version of each user's gallery as loaded into the Python worker. Writes through this server
// invalidate it at once; changes made elsewhere (another server, the dashboard) show up within CACHE_MS.
const galleries = new Map<string, { version: string; until: number }>();
let modelId: string | undefined;

/** The user's saved settings (missing values are filled with defaults in Python). */
export async function getSettings(ctx: FaceCtx): Promise<Partial<FaceSettings>> {
  const hit = settingsCache.get(ctx.user.id);
  if (hit && hit.until > Date.now()) return hit.value;
  const row = check(await ctx.db.from("face_settings").select(SETTING_KEYS.join(",")).maybeSingle()) as Partial<FaceSettings> | null;
  const value = row ?? {};
  settingsCache.set(ctx.user.id, { value, until: Date.now() + CACHE_MS });
  return value;
}

export function invalidateSettings(userId: string) {
  settingsCache.delete(userId);
}

export async function currentModelId(ctx: FaceCtx): Promise<string> {
  modelId ??= ((await face_model.run({}, { user: ctx.user })) as { modelId: string }).modelId;
  return modelId;
}

/** Make sure the Python worker holds the user's current gallery; returns its version. */
export async function galleryVersion(ctx: FaceCtx, force = false): Promise<string> {
  const hit = galleries.get(ctx.user.id);
  if (!force && hit && hit.until > Date.now()) return hit.version;
  const model = await currentModelId(ctx);
  const people = check(await ctx.db.from("face_people").select("id, name")) as { id: number; name: string }[];
  const rows = check(await ctx.db.from("face_embeddings").select("person_id, ciphertext").eq("model_id", model)) as { person_id: number; ciphertext: string }[];
  const byPerson = new Map<number, string[]>();
  for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), r.ciphertext]);
  const version = crypto.randomUUID();
  await face_load_gallery.run({ version, people: people.map((p) => ({ id: p.id, name: p.name, ciphertexts: byPerson.get(p.id) ?? [] })) }, { user: ctx.user });
  galleries.set(ctx.user.id, { version, until: Date.now() + CACHE_MS });
  return version;
}

export function invalidateGallery(userId: string) {
  galleries.delete(userId);
}

/** Run a call that needs the gallery, reloading it once if the worker reports it stale. */
export async function withGallery<T>(ctx: FaceCtx, call: (version: string) => Promise<T>): Promise<T> {
  try {
    return await call(await galleryVersion(ctx));
  } catch (error) {
    if (!(error as { details?: { stale?: boolean } }).details?.stale) throw error;
    return call(await galleryVersion(ctx, true));
  }
}
