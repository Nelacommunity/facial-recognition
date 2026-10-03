// POST /api/faces/enroll/start  { personId? } → { sessionId, target }
import { face_enroll_start } from "../../../../tools/faces.py";
import { body, check, faceRoute, getSettings } from "../../../../lib/faces";

export const POST = faceRoute(async (request, ctx) => {
  const { personId } = await body<{ personId: number }>(request);
  const person_id = Number.isInteger(personId) && personId! > 0 ? personId! : null;
  if (person_id !== null) check(await ctx.db.from("face_people").select("id").eq("id", person_id).single()); // 404 unless it's the user's
  return face_enroll_start.run({ settings: await getSettings(ctx), person_id }, { user: ctx.user });
});
