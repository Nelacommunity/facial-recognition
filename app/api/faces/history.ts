// GET /api/faces/history?kind=all|recognized|unknown&q=name → events; DELETE clears the history.
import { check, faceRoute } from "../../../lib/faces";

interface Row {
  id: number;
  at: string;
  person_id: number | null;
  similarity: number | null;
  face_people: { name: string } | null;
}

export const GET = faceRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  // Searching by name only matches recognized events, so join people with !inner then.
  let query = ctx.db.from("face_events").select(`id, at, person_id, similarity, face_people${q ? "!inner" : ""}(name)`);
  if (kind === "recognized") query = query.not("person_id", "is", null);
  if (kind === "unknown") query = query.is("person_id", null);
  if (q) query = query.ilike("face_people.name", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const rows = check(await query.order("at", { ascending: false }).limit(200)) as unknown as Row[];
  return rows.map((r) => ({ id: r.id, at: r.at, personId: r.person_id, name: r.face_people?.name ?? null, similarity: r.similarity }));
});

export const DELETE = faceRoute(
  async (_request, ctx) => {
    const rows = check(await ctx.db.from("face_events").delete().gte("id", 0).select("id")) as unknown[];
    return { deleted: rows.length };
  },
  { manage: true },
);
