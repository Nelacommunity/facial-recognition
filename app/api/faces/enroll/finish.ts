// POST /api/faces/enroll/finish  { sessionId, name, consent, allowDuplicate? } → saved person or duplicate warning
import { face_enroll_cancel, face_enroll_finish } from "../../../../tools/faces.py";
import { body, check, cleanName, faceRoute, getSettings, HttpError, invalidateGallery, requireString, withGallery } from "../../../../lib/faces";

interface Finished {
  ready: boolean;
  personId: number | null;
  modelId: string;
  ciphertexts: string[];
  duplicateOf: string | null;
  warnings: string[];
}

export const POST = faceRoute(
  async (request, ctx) => {
    const b = await body<{ sessionId: string; name: string; consent: boolean; allowDuplicate: boolean }>(request);
    const session_id = requireString(b.sessionId, "sessionId", 64);
    const name = cleanName(b.name);
    const settings = await getSettings(ctx);
    const r = (await withGallery(ctx, async (version): Promise<unknown> =>
      face_enroll_finish.run({ session_id, version, consent: b.consent === true, allow_duplicate: b.allowDuplicate === true, settings }, { user: ctx.user }),
    )) as Finished;
    if (!r.ready) return { saved: false, duplicateOf: r.duplicateOf, warnings: r.warnings };

    let personId: number;
    if (r.personId !== null) {
      check(await ctx.db.rpc("face_replace_embeddings", { p_person_id: r.personId, p_model_id: r.modelId, p_ciphertexts: r.ciphertexts, p_name: name || null }));
      personId = r.personId;
    } else {
      if (!name) throw new HttpError(400, "Enter a name.");
      personId = check(await ctx.db.rpc("face_enroll_person", { p_name: name, p_model_id: r.modelId, p_ciphertexts: r.ciphertexts })) as number;
    }
    invalidateGallery(ctx.user.id);
    await face_enroll_cancel.run({ session_id }, { user: ctx.user }); // saved: drop the in-memory samples
    return { saved: true, personId, samples: r.ciphertexts.length, duplicateOf: r.duplicateOf, warnings: r.warnings };
  },
  { manage: true },
);
