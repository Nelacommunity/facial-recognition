import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, faces as api, type Box, type RecognizedFace } from "./api";
import { useCamera } from "./useCamera";

/** Upper bound on recognition requests per second (the next frame is only sent after the previous reply). */
const MAX_FPS = 8;
const ENROLL_INTERVAL_MS = 350;
const MIN_SAMPLES_TO_SAVE = 5;

type Overlay = { width: number; height: number; boxes: { box: Box; label: string; tone: "good" | "warn" | "info" }[] };

type Enrollment =
  | { step: "closed" }
  | { step: "form"; personId?: number }
  | { step: "capturing"; personId?: number; sessionId: string; samples: number; target: number; message: string; accepted: boolean }
  | { step: "duplicate"; personId?: number; sessionId: string; duplicateOf: string }
  | { step: "saving"; personId?: number; sessionId: string };

export function LiveView() {
  const camera = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState<RecognizedFace[]>([]);
  const [enrolled, setEnrolled] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [enroll, setEnroll] = useState<Enrollment>({ step: "closed" });
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const enrollRef = useRef(enroll);
  enrollRef.current = enroll;

  // /?reenroll=<id>&name=<name> comes from the People page.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get("reenroll"));
    if (Number.isInteger(id) && id > 0) {
      setName(params.get("name") ?? "");
      setEnroll({ step: "form", personId: id });
    }
  }, []);

  const draw = useCallback((overlay: Overlay | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!overlay) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    canvas.width = overlay.width;
    canvas.height = overlay.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const css = getComputedStyle(canvas);
    const colors = {
      good: css.getPropertyValue("--aix-good").trim() || "#16a34a",
      warn: css.getPropertyValue("--aix-warn").trim() || "#d97706",
      info: css.getPropertyValue("--aix-info").trim() || "#2563eb",
    };
    for (const { box, label, tone } of overlay.boxes) {
      // The video is mirrored with CSS; mirror the box position but keep the text readable.
      const x = overlay.width - box.x - box.width;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors[tone];
      ctx.strokeRect(x, box.y, box.width, box.height);
      if (!label) continue;
      ctx.font = "600 14px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 12;
      // Above the box, or just inside it when the face touches the top edge.
      const top = box.y >= 22 ? box.y - 22 : box.y;
      ctx.fillStyle = colors[tone];
      ctx.fillRect(x - 1.5, top, w, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 4.5, top + 16);
    }
  }, []);

  // Recognition loop: runs while the camera is on and nobody is being enrolled.
  const recognizing = camera.on && (enroll.step === "closed" || enroll.step === "form");
  useEffect(() => {
    if (!recognizing) return;
    let stopped = false;
    let frames = 0;
    let windowStart = performance.now();
    (async () => {
      while (!stopped) {
        const started = performance.now();
        const frame = camera.capture();
        if (frame) {
          try {
            const result = await api.recognize(frame.image);
            if (stopped) break;
            setError(null);
            setCurrent(result.faces);
            setEnrolled(result.enrolled);
            draw({
              width: result.width,
              height: result.height,
              boxes: result.faces.map((f) => ({
                box: f.box,
                tone: f.recognized ? "good" : "warn",
                label: f.recognized ? `${f.name} · ${Math.round((f.similarity ?? 0) * 100)}%` : "Unknown",
              })),
            });
            frames++;
          } catch (e) {
            if (stopped) break;
            setError(errorMessage(e));
            await sleep(1500);
          }
        }
        const now = performance.now();
        if (now - windowStart >= 1000) {
          setFps(Math.round((frames * 1000) / (now - windowStart)));
          frames = 0;
          windowStart = now;
        }
        await sleep(Math.max(0, 1000 / MAX_FPS - (now - started)));
      }
    })();
    return () => {
      stopped = true;
      setCurrent([]);
      setFps(0);
      draw(null);
    };
  }, [recognizing, camera.capture, draw]);

  // Enrollment capture loop.
  const sessionId = enroll.step === "capturing" ? enroll.sessionId : null;
  useEffect(() => {
    if (!sessionId || !camera.on) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        const frame = camera.capture();
        if (frame) {
          try {
            const r = await api.enrollSample(sessionId, frame.image);
            if (stopped) break;
            draw({ width: r.width, height: r.height, boxes: r.faces.map((box) => ({ box, label: "", tone: r.accepted ? "good" : r.faces.length === 1 ? "info" : "warn" })) });
            setEnroll((s) => (s.step === "capturing" ? { ...s, samples: r.samples, target: r.target, message: r.message, accepted: r.accepted } : s));
            if (r.samples >= r.target) {
              void finish(sessionId, false);
              break;
            }
          } catch (e) {
            if (stopped) break;
            setEnroll({ step: "form", personId: enrollRef.current.step === "capturing" ? enrollRef.current.personId : undefined });
            setError(errorMessage(e));
            break;
          }
        }
        await sleep(ENROLL_INTERVAL_MS);
      }
    })();
    return () => {
      stopped = true;
      draw(null);
    };
    // finish is stable enough for this loop; it only reads refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, camera.on, camera.capture, draw]);

  async function startEnrollment() {
    const personId = enroll.step === "form" ? enroll.personId : undefined;
    if (!name.trim() && !personId) return setError("Enter a name.");
    if (!consent) return setError("Confirm that this person has consented.");
    setError(null);
    if (!camera.on) await camera.start();
    try {
      const { sessionId, target } = await api.enrollStart(personId);
      setEnroll({ step: "capturing", personId, sessionId, samples: 0, target, message: "Look at the camera and slowly turn your head.", accepted: false });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function finish(id: string, allowDuplicate: boolean) {
    const personId = "personId" in enrollRef.current ? enrollRef.current.personId : undefined;
    setEnroll({ step: "saving", personId, sessionId: id });
    try {
      const r = await api.enrollFinish(id, name, consent, allowDuplicate);
      if (!r.saved && r.duplicateOf) {
        setEnroll({ step: "duplicate", personId, sessionId: id, duplicateOf: r.duplicateOf });
        return;
      }
      setNotice([`Saved ${name.trim() || "profile"} with ${r.samples} samples.`, ...r.warnings].join(" "));
      closeEnrollment(false);
      if (personId) history.replaceState(null, "", "/");
    } catch (e) {
      setError(errorMessage(e));
      setEnroll({ step: "form", personId });
    }
  }

  function closeEnrollment(cancel = true) {
    const s = enrollRef.current;
    if (cancel && "sessionId" in s) void api.enrollCancel(s.sessionId).catch(() => {});
    setEnroll({ step: "closed" });
    setName("");
    setConsent(false);
  }

  const recognizedNow = current.filter((f) => f.recognized);
  const capturing = enroll.step === "capturing" ? enroll : null;

  return (
    <div className="grid gap-aix lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col gap-3">
        <div className={`relative aspect-video w-full overflow-hidden rounded-lg bg-surface-2 shadow-card ${camera.on ? "outline-3 outline-bad" : ""}`}>
          <video ref={camera.videoRef} playsInline muted className="h-full w-full object-contain" style={{ transform: "scaleX(-1)" }} />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
          {camera.on && <span className="absolute left-3 top-3 rounded-sm bg-bad px-2 py-0.5 text-xs font-bold tracking-wide text-white">● CAMERA ON</span>}
          {capturing && (
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-black/60 p-3 text-white">
              <div className="text-sm">{capturing.message}</div>
              <div className="h-2 overflow-hidden rounded-full bg-white/25">
                <div className="h-full bg-good transition-all" style={{ width: `${(capturing.samples / capturing.target) * 100}%` }} />
              </div>
            </div>
          )}
          {!camera.on && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-fg-2">
              <p className="m-0">The camera only turns on when you start it. Frames are processed in memory and never stored.</p>
              <button onClick={camera.start} className="rounded-button bg-accent px-4 py-2 font-medium text-accent-ink">
                Start camera
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-2">
          {camera.on && (
            <button onClick={() => (closeEnrollment(), camera.stop())} className="rounded-button border border-border px-3 py-1.5 text-fg">
              Stop camera
            </button>
          )}
          <Stat label="Faces in view" value={camera.on ? String(current.length) : "–"} />
          <Stat label="Recognized" value={recognizedNow.length ? recognizedNow.map((f) => f.name).join(", ") : "–"} />
          <Stat label="Enrolled" value={enrolled === null ? "–" : String(enrolled)} />
          <Stat label="FPS" value={recognizing ? String(fps) : "–"} />
        </div>
        {(camera.error || error) && <p className="m-0 text-sm text-bad">{camera.error ?? error}</p>}
        {notice && <p className="m-0 text-sm text-good">{notice}</p>}
      </section>

      <aside className="flex flex-col gap-aix">
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-pad shadow-card">
          <h2 className="m-0 text-base font-semibold text-fg">{enroll.step !== "closed" && enroll.personId ? "Re-enroll" : "Enroll a person"}</h2>
          {enroll.step === "closed" && (
            <>
              <p className="m-0 text-sm text-fg-2">Capture {MIN_SAMPLES_TO_SAVE}+ samples of one person from different angles. Only the numeric face embeddings are kept, encrypted.</p>
              <button onClick={() => (setNotice(null), setEnroll({ step: "form" }))} className="rounded-button bg-accent px-4 py-2 font-medium text-accent-ink">
                Enroll person
              </button>
            </>
          )}
          {enroll.step === "form" && (
            <>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={enroll.personId ? "Name (unchanged if empty)" : "Name"}
                maxLength={80}
                className="rounded-md border border-border bg-bg px-3 py-2 text-fg"
              />
              <label className="flex items-start gap-2 text-sm text-fg-2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                <span>This person is me, or has given explicit, informed consent to having their face enrolled.</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={startEnrollment}
                  disabled={!consent || (!name.trim() && !enroll.personId)}
                  className="flex-1 rounded-button bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-40"
                >
                  Start capture
                </button>
                <button onClick={() => closeEnrollment()} className="rounded-button border border-border px-3 py-2 text-fg">
                  Cancel
                </button>
              </div>
            </>
          )}
          {capturing && (
            <>
              <p className="m-0 text-sm text-fg-2">
                {name.trim() || "Profile"}: <span className="font-mono text-fg">{capturing.samples}</span> / {capturing.target} samples
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => finish(capturing.sessionId, false)}
                  disabled={capturing.samples < MIN_SAMPLES_TO_SAVE}
                  className="flex-1 rounded-button bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-40"
                >
                  Save now
                </button>
                <button onClick={() => closeEnrollment()} className="rounded-button border border-border px-3 py-2 text-fg">
                  Cancel
                </button>
              </div>
            </>
          )}
          {enroll.step === "saving" && <p className="m-0 text-sm text-fg-2">Saving…</p>}
          {enroll.step === "duplicate" && (
            <>
              <p className="m-0 text-sm text-warn">
                These samples look like <strong>{enroll.duplicateOf}</strong>, who is already enrolled. Save as a separate profile anyway?
              </p>
              <div className="flex gap-2">
                <button onClick={() => finish(enroll.sessionId, true)} className="flex-1 rounded-button bg-accent px-4 py-2 font-medium text-accent-ink">
                  Save anyway
                </button>
                <button onClick={() => closeEnrollment()} className="rounded-button border border-border px-3 py-2 text-fg">
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
        <p className="m-0 text-xs text-fg-3">
          Similarity shows how alike two faces look to the model. It is not proof of identity; don't use it for access control.
        </p>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}: <span className="font-medium text-fg">{value}</span>
    </span>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
