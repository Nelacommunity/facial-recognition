// GET /api/faces/people → enrolled people
import { check, currentModelId, faceRoute } from "../../../lib/faces";

interface Row {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  samples: number;
  model_ids: string[];
  last_seen: string | null;
}

export const GET = faceRoute(async (_request, ctx) => {
  const model = await currentModelId(ctx);
  const rows = check(await ctx.db.from("face_people_summary").select("*").order("name")) as Row[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    samples: r.samples,
    // Samples from another model can't be compared: the person must re-enroll.
    needsReenrollment: !r.model_ids.includes(model),
    lastSeen: r.last_seen,
  }));
});
