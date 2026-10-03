// Browser client for /api/faces (see lib/faces.ts for the server side).

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognizedFace {
  box: Box;
  score: number;
  recognized: boolean;
  personId: number | null;
  name: string | null;
  /** Cosine similarity 0..1 to the closest enrolled person; null when nobody is enrolled. */
  similarity: number | null;
  closest: string | null;
}

export interface RecognizeResult {
  width: number;
  height: number;
  faces: RecognizedFace[];
  enrolled: number;
}

export interface SampleResult {
  status: string;
  accepted: boolean;
  message: string;
  samples: number;
  target: number;
  width: number;
  height: number;
  faces: Box[];
}

export interface FinishResult {
  saved: boolean;
  personId?: number;
  samples?: number;
  duplicateOf: string | null;
  warnings: string[];
}

export interface Person {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  samples: number;
  needsReenrollment: boolean;
  lastSeen: string | null;
}

export interface FaceEvent {
  id: number;
  at: string;
  personId: number | null;
  name: string | null;
  similarity: number | null;
}

export interface Settings {
  recognition_threshold: number;
  min_face_size: number;
  detection_score_threshold: number;
  enrollment_samples: number;
  event_cooldown_seconds: number;
  log_unknown_faces: boolean;
  modelId: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function send(url: string, method: string, data?: unknown) {
  return fetch(url, {
    method,
    headers: { "x-faceid-client": "1", ...(data !== undefined ? { "content-type": "application/json" } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}

let refreshing: Promise<boolean> | null = null;

/** Renew the session from the refresh-token cookie (once, even if several requests ask at the same time). */
function refreshSession(): Promise<boolean> {
  refreshing ??= send("/api/auth/refresh", "POST")
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export function goToLogin() {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function call<T>(method: string, path: string, data?: unknown): Promise<T> {
  const url = `/api/faces/${path}`;
  let response = await send(url, method, data);
  // Access tokens are short-lived: refresh once and retry, or send the user to sign in.
  if (response.status === 401) {
    if (await refreshSession()) response = await send(url, method, data);
    if (response.status === 401) {
      goToLogin();
      throw new ApiError("Signed out.", 401);
    }
  }
  const payload = (await response.json().catch(() => ({}))) as { error?: string | { message?: string }; hint?: string };
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : (payload.error?.message ?? `Request failed (${response.status})`);
    throw new ApiError(message, response.status, payload.hint);
  }
  return payload as T;
}

export const faces = {
  recognize: (image: string) => call<RecognizeResult>("POST", "recognize", { image }),
  enrollStart: (personId?: number) => call<{ sessionId: string; target: number }>("POST", "enroll/start", personId ? { personId } : {}),
  enrollSample: (sessionId: string, image: string) => call<SampleResult>("POST", "enroll/sample", { sessionId, image }),
  enrollFinish: (sessionId: string, name: string, consent: boolean, allowDuplicate = false) =>
    call<FinishResult>("POST", "enroll/finish", { sessionId, name, consent, allowDuplicate }),
  enrollCancel: (sessionId: string) => call<{ ok: true }>("POST", "enroll/cancel", { sessionId }),
  people: () => call<Person[]>("GET", "people"),
  rename: (id: number, name: string) => call<{ ok: true }>("PATCH", `people/${id}`, { name }),
  remove: (id: number) => call<{ ok: true }>("DELETE", `people/${id}`),
  history: (kind: "all" | "recognized" | "unknown", q: string) => call<FaceEvent[]>("GET", `history?kind=${kind}&q=${encodeURIComponent(q)}`),
  clearHistory: () => call<{ deleted: number }>("DELETE", "history"),
  settings: () => call<Settings>("GET", "settings"),
  updateSettings: (changes: Partial<Settings>) => call<Settings>("PATCH", "settings", changes),
  deleteEverything: () => call<{ ok: true }>("DELETE", "data"),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.hint ? `${error.message} (${error.hint})` : error.message;
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------------------------ auth

export interface AuthUser {
  id: string;
  email: string | null;
}

async function authCall<T>(path: string, method = "POST", data?: unknown): Promise<T> {
  const response = await send(`/api/auth/${path}`, method, data);
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  return payload as T;
}

export const auth = {
  signIn: (email: string, password: string) => authCall<{ user: AuthUser }>("signin", "POST", { email, password }),
  signUp: (email: string, password: string) => authCall<{ user?: AuthUser; confirm?: boolean }>("signup", "POST", { email, password }),
  /** Store a session that arrived in an email link's URL fragment. */
  fromLink: (access_token: string, refresh_token: string) => authCall<{ user: AuthUser }>("session", "POST", { access_token, refresh_token }),
  refresh: refreshSession,
  signOut: () => authCall<{ ok: true }>("signout"),
  me: () => authCall<{ user: AuthUser | null }>("me", "GET"),
};
