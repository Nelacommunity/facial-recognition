// PATCH /api/faces/people/:id { name } renames; DELETE removes the person, their face data and history.
import { face_forget } from "../../../../tools/faces.py";
import { body, check, cleanName, faceRoute, HttpError, invalidateGallery, personId } from "../../../../lib/faces";

export const PATCH = faceRoute(
  async (request, ctx) => {
    const name = cleanName((await body<{ name: string }>(request)).name);
    if (!name) throw new HttpError(400, "Name can't be empty.");
    check(await ctx.db.from("face_people").update({ name, updated_at: new Date().toISOString() }).eq("id", personId(ctx.params)).select("id").single());
    invalidateGallery(ctx.user.id);
    return { ok: true };
  },
  { manage: true },
);

export const DELETE = faceRoute(
  async (_request, ctx) => {
    const id = personId(ctx.params);
    // Embeddings and events go with it (on delete cascade).
    check(await ctx.db.from("face_people").delete().eq("id", id).select("id").single());
    invalidateGallery(ctx.user.id);
    await face_forget.run({ person_id: id }, { user: ctx.user });
    return { ok: true };
  },
  { manage: true },
);
