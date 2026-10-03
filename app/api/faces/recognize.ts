// POST /api/faces/recognize  { image: base64 JPEG } → faces with boxes and matches
import { face_recognize } from "../../../tools/faces.py";
import { body, faceRoute, getSettings, requireString, withGallery } from "../../../lib/faces";

interface Recognized {
  events: { personId: number | null; similarity: number | null }[];
  [key: string]: unknown;
}

export const POST = faceRoute(async (request, ctx) => {
  const image = requireString((await body<{ image: string }>(request)).image, "image");
  const settings = await getSettings(ctx);
  const result = (await withGallery(ctx, (version) => face_recognize.run({ image, version, settings }, { user: ctx.user }))) as Recognized;
  const { events, ...rest } = result;
  if (events.length) {
    // History is best effort: a failed insert must not interrupt the live view.
    const { error } = await ctx.db.from("face_events").insert(events.map((e) => ({ person_id: e.personId, similarity: e.similarity })));
    if (error) console.error("[faces] could not log events:", error.message);
  }
  return rest;
});
