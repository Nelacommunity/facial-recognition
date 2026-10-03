// POST /api/faces/enroll/cancel  { sessionId } → discards the in-memory samples
import { face_enroll_cancel } from "../../../../tools/faces.py";
import { body, faceRoute, requireString } from "../../../../lib/faces";

export const POST = faceRoute(async (request, ctx) => {
  const { sessionId } = await body<{ sessionId: string }>(request);
  return face_enroll_cancel.run({ session_id: requireString(sessionId, "sessionId", 64) }, { user: ctx.user });
});
