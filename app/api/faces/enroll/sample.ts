// POST /api/faces/enroll/sample  { sessionId, image } → capture status and progress
import { face_enroll_sample } from "../../../../tools/faces.py";
import { body, faceRoute, getSettings, requireString } from "../../../../lib/faces";

export const POST = faceRoute(async (request, ctx) => {
  const { sessionId, image } = await body<{ sessionId: string; image: string }>(request);
  return face_enroll_sample.run(
    { session_id: requireString(sessionId, "sessionId", 64), image: requireString(image, "image"), settings: await getSettings(ctx) },
    { user: ctx.user },
  );
});
