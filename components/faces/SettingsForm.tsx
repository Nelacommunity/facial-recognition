import { useEffect, useState } from "react";
import { errorMessage, faces as api, type Settings } from "./api";

const CONFIRM_PHRASE = "DELETE";

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [wiped, setWiped] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function update(changes: Partial<Settings>) {
    try {
      setSettings(await api.updateSettings(changes));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function wipe() {
    try {
      await api.deleteEverything();
      setConfirm("");
      setWiped(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!settings) return error ? <p className="m-0 text-bad">{error}</p> : <p className="m-0 text-fg-2">Loading…</p>;

  return (
    <div className="flex flex-col gap-aix">
      <section className="flex flex-col gap-4 rounded-lg bg-surface p-pad shadow-card">
        <h2 className="m-0 text-base font-semibold text-fg">Recognition {saved && <span className="text-sm font-normal text-good">Saved</span>}</h2>
        <Slider
          label="Match threshold"
          help="Minimum similarity to count as a match. Higher means fewer false matches and more “Unknown”. OpenCV’s reference point for SFace is 0.36."
          min={0.2}
          max={0.95}
          step={0.01}
          value={settings.recognition_threshold}
          onCommit={(v) => update({ recognition_threshold: v })}
        />
        <Slider
          label="Detection confidence"
          help="How sure the detector must be that something is a face."
          min={0.3}
          max={0.99}
          step={0.01}
          value={settings.detection_score_threshold}
          onCommit={(v) => update({ detection_score_threshold: v })}
        />
        <Slider label="Minimum face size (px)" help="Smaller (more distant) faces are ignored." min={20} max={200} step={2} value={settings.min_face_size} onCommit={(v) => update({ min_face_size: v })} />
        <Slider label="Samples per enrollment" min={5} max={40} step={1} value={settings.enrollment_samples} onCommit={(v) => update({ enrollment_samples: v })} />
        <Slider
          label="History cooldown (s)"
          help="The same person is logged at most once per this many seconds."
          min={0}
          max={300}
          step={5}
          value={settings.event_cooldown_seconds}
          onCommit={(v) => update({ event_cooldown_seconds: v })}
        />
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={settings.log_unknown_faces} onChange={(e) => update({ log_unknown_faces: e.target.checked })} />
          Log unknown faces in the history
        </label>
        <p className="m-0 text-xs text-fg-3">
          Model: <span className="font-mono">{settings.modelId}</span> · settings are saved to your account
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg bg-surface p-pad shadow-card">
        <h2 className="m-0 text-base font-semibold text-fg">Privacy</h2>
        <ul className="m-0 flex flex-col gap-1 pl-5 text-sm text-fg-2">
          <li>Recognition runs on this app’s server, in a Python worker with no network access. Camera frames are processed in memory and never saved.</li>
          <li>Only 128-number face embeddings are stored, in your Supabase account. They are encrypted before they leave the server, so the database only holds ciphertext.</li>
          <li>Only enroll yourself or people who have given explicit consent. This is not a tool for identifying strangers.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-bad p-pad">
        <h2 className="m-0 text-base font-semibold text-bad">Delete all biometric data</h2>
        <p className="m-0 text-sm text-fg-2">Removes every person, embedding, history entry and setting in your account. This can’t be undone.</p>
        {wiped ? (
          <p className="m-0 text-sm text-good">All face data has been deleted.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={`Type ${CONFIRM_PHRASE} to confirm`}
              className="rounded-md border border-border bg-bg px-3 py-1.5 text-fg"
            />
            <button onClick={wipe} disabled={confirm !== CONFIRM_PHRASE} className="rounded-button bg-bad px-4 py-1.5 text-white disabled:opacity-40">
              Delete everything
            </button>
          </div>
        )}
      </section>
      {error && <p className="m-0 text-sm text-bad">{error}</p>}
    </div>
  );
}

function Slider(props: { label: string; help?: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  const commit = () => value !== props.value && props.onCommit(value);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between text-fg">
        {props.label}
        <span className="font-mono text-fg-2">{value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      {props.help && <span className="text-xs text-fg-3">{props.help}</span>}
    </label>
  );
}
