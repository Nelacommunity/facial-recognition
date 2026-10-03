# facial

An [AIX](https://github.com/) app.

```bash
cp .env.example .env   # add a model key, or point OLLAMA_HOST at a local model
npm run dev            # http://localhost:3000  ·  dashboard: /__aix
```

## Face recognition

A Face ID app with **Supabase** for accounts and data. The browser streams webcam frames to a Python engine
(OpenCV **YuNet** detector + **SFace** recognizer, adapted from `../facial_recognition_app`) that runs in an AIX
worker pool; people, encrypted embeddings, history and settings are stored per user in Supabase.

### Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: paste `supabase/migrations/20261003000000_faceid.sql` into the dashboard's SQL editor, or run
   `supabase link` + `supabase db push` with the Supabase CLI.
3. In **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/login` to the redirect URLs (confirmation emails link back there).
4. `cp .env.example .env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and a new `FACEID_ENCRYPTION_KEY`
   (the command is in the file). Add `SUPABASE_JWT_SECRET` only if your project still uses the legacy JWT secret.
5. `npm run dev`, open http://localhost:3000 and create an account. If `.aix/faceid/models` is empty, run
   `python -m faceid.models` once to download the ONNX models (~38 MB, SHA-256 checked).

### Pages

| Page | What it does |
| --- | --- |
| **Login** (`/login`) | Sign in or create an account (Supabase Auth, email + password). Email confirmation links land here. |
| **Live** (`/`) | Start/stop the camera, labelled boxes with similarity, faces in view, FPS, and guided **enrollment**: name + consent, then 5–40 samples captured automatically. Frames with no face, several faces, a face too far away, blur, near-duplicates or a different person are rejected, and a possible duplicate profile is flagged before saving. |
| **People** | Rename, re-enroll or delete a profile (deleting also removes its embeddings and history). |
| **History** | Recognition events (logged once a result is stable for 3 frames, at most once per person per cooldown), with search, Recognized/Unknown filter and Clear. |
| **Settings** | Per-account match threshold, detection confidence, minimum face size, samples per enrollment, cooldown, logging of unknown faces, and **Delete all biometric data**. |

### How it fits together

```text
browser ── HttpOnly session cookies ──▶ app/api/auth/*  ──▶ Supabase Auth
   │                                    aix.config.ts: supabaseIdentity() verifies the JWT on every request
   │                                    routes.ts: every page except /login requires sign-in
   └─ 640px JPEG frames ──▶ app/api/faces/*  ──(user's token, RLS)──▶ Supabase Postgres: face_people, face_embeddings,
                              │                                       face_events, face_settings (owner_id = auth.uid())
                              └─▶ tools/faces.py (pool "faceid": no network, no file writes) ──▶ faceid/
                                    decrypts the user's gallery into memory, detects, aligns, embeds, matches,
                                    encrypts new embeddings with FACEID_ENCRYPTION_KEY
```

| Path | Role |
| --- | --- |
| `supabase/migrations/` | Tables, row-level security, `face_enroll_person` / `face_replace_embeddings` functions, `face_people_summary` view |
| `lib/supabase.ts` | Supabase clients, session cookies, JWT verification (JWKS or legacy HS256), the AIX identity adapter |
| `lib/faces.ts` | Route wrappers (`guarded` + same-origin check), error mapping, per-user settings and gallery cache |
| `app/api/auth/` | `signin`, `signup`, `session` (email links), `refresh`, `signout`, `me` |
| `app/api/faces/` | `recognize`, `enroll/*`, `people`, `people/[id]`, `history`, `settings`, `data` |
| `faceid/` | Plain-Python engine: `engine.py`, `matching.py`, `enrollment.py`, `crypto.py`, `service.py`, `config.py`, `models.py` |
| `tools/faces.py` | The engine as AIX tools; the user always comes from `ctx.user`, never from tool input |
| `components/faces/`, `components/auth/` | UI and the browser API client (refreshes the session on 401) |
| `tests/test_faceid.py` | Unit tests: `.aix/python/.venv/bin/python -m unittest discover tests` |

### Privacy and security

- **Embeddings are encrypted before they leave the Python worker** (Fernet, `FACEID_ENCRYPTION_KEY`). Supabase and
  the TypeScript server only handle ciphertext. Losing or changing the key makes existing enrollments unreadable;
  back it up somewhere safe, separately from the database.
- **Row-level security** limits every table to the signed-in user, and composite foreign keys stop an embedding or
  event from pointing at another user's person. Queries run with the user's own token; no service-role key is used.
- **Sessions** live in HttpOnly, SameSite=Lax cookies (Secure over HTTPS); page scripts never see tokens. All
  `/api` routes also require a same-origin custom header, so other websites can't call them.
- Camera frames are processed in memory and never stored. The `faceid` worker pool has `network: "none"` and no
  writable folders.
- Similarity is how alike two faces look to the model, not proof of identity. Don't use it for access control.
  Only enroll yourself or people who have given explicit consent.

The camera requires a secure context: `localhost` or HTTPS.

| Path | What it is |
|---|---|
| `app/` | Pages (`page.tsx`), layouts and API routes (`app/api/*.ts`) |
| `agents/` | Agents (`agent({...})`) — server-only |
| `tools/` | Tools agents can call — server-only |
| `workflows/`, `tasks/` | Deterministic workflows and background tasks |
| `aix.config.ts` | Optional configuration |

Useful commands: `npx aix doctor`, `npx aix models`, `npx aix logs`, `npx aix build && npx aix start`.
