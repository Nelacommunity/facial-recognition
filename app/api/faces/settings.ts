// GET /api/faces/settings → current settings; PATCH { ...changes } updates them (ranges are enforced by the database).
import { body, check, currentModelId, faceRoute, getSettings, invalidateSettings, SETTING_KEYS, type FaceCtx } from "../../../lib/faces";

const DEFAULTS = { recognition_threshold: 0.5, min_face_size: 48, detection_score_threshold: 0.8, enrollment_samples: 15, event_cooldown_seconds: 10, log_unknown_faces: true };

async function current(ctx: FaceCtx) {
  return { ...DEFAULTS, ...(await getSettings(ctx)), modelId: await currentModelId(ctx) };
}

export const GET = faceRoute((_request, ctx) => current(ctx));

export const PATCH = faceRoute(
  async (request, ctx) => {
    const input = await body<Record<string, unknown>>(request);
    const changes = Object.fromEntries(SETTING_KEYS.filter((k) => typeof input[k] === "number" || typeof input[k] === "boolean").map((k) => [k, input[k]]));
    const saved = { ...(await getSettings(ctx)), ...changes, owner_id: ctx.user.id, updated_at: new Date().toISOString() };
    const { error } = await ctx.db.from("face_settings").upsert(saved);
    if (error?.code === "23514") return Response.json({ error: "A setting is out of range." }, { status: 400 });
    check({ data: null, error });
    invalidateSettings(ctx.user.id);
    return current(ctx);
  },
  { manage: true },
);
