// DELETE /api/faces/data → deletes ALL of the signed-in user's people, face data, history and settings.
import { face_forget } from "../../../tools/faces.py";
import { check, faceRoute, invalidateGallery, invalidateSettings } from "../../../lib/faces";

export const DELETE = faceRoute(
  async (_request, ctx) => {
    // Row-level security limits each delete to this user's rows; the filters only satisfy PostgREST's "no unfiltered delete" rule.
    check(await ctx.db.from("face_events").delete().gte("id", 0));
    check(await ctx.db.from("face_people").delete().gte("id", 0)); // cascades to embeddings
    check(await ctx.db.from("face_settings").delete().eq("owner_id", ctx.user.id));
    invalidateGallery(ctx.user.id);
    invalidateSettings(ctx.user.id);
    await face_forget.run({}, { user: ctx.user });
    return { ok: true };
  },
  { manage: true },
);
