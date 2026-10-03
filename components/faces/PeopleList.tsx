import { useEffect, useState } from "react";
import { errorMessage, faces as api, type Person } from "./api";

export function PeopleList() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = () =>
    api
      .people()
      .then((p) => (setPeople(p), setError(null)))
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => void load(), []);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setEditing(null);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="m-0 text-sm text-bad">{error}</p>}
      {people === null && !error && <p className="m-0 text-fg-2">Loading…</p>}
      {people?.length === 0 && (
        <p className="m-0 text-fg-2">
          Nobody is enrolled yet. <a href="/">Enroll someone</a> from the live view.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {people?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-pad shadow-card">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent" aria-hidden>
              {initials(p.name)}
            </div>
            <div className="min-w-0 flex-1">
              {editing?.id === p.id ? (
                <form onSubmit={(e) => (e.preventDefault(), act(() => api.rename(p.id, editing.name)))} className="flex gap-2">
                  <input
                    autoFocus
                    value={editing.name}
                    maxLength={80}
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-fg"
                  />
                  <button className="rounded-button bg-accent px-3 py-1 text-sm text-accent-ink">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-button border border-border px-3 py-1 text-sm text-fg">
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="truncate font-medium text-fg">{p.name}</div>
              )}
              <div className="text-xs text-fg-3">
                {p.samples} samples · enrolled {formatDate(p.createdAt)}
                {p.lastSeen && ` · last seen ${formatDate(p.lastSeen)}`}
                {p.needsReenrollment && <span className="text-warn"> · needs re-enrollment</span>}
              </div>
            </div>
            {confirmDelete === p.id ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-fg-2">Delete {p.name} and their history?</span>
                <button onClick={() => act(() => api.remove(p.id))} className="rounded-button bg-bad px-3 py-1 text-white">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)} className="rounded-button border border-border px-3 py-1 text-fg">
                  Keep
                </button>
              </div>
            ) : (
              <div className="flex gap-2 text-sm">
                <button onClick={() => setEditing({ id: p.id, name: p.name })} className="rounded-button border border-border px-3 py-1 text-fg">
                  Rename
                </button>
                <a href={`/?reenroll=${p.id}&name=${encodeURIComponent(p.name)}`} className="rounded-button border border-border px-3 py-1 text-fg no-underline">
                  Re-enroll
                </a>
                <button onClick={() => setConfirmDelete(p.id)} className="rounded-button px-3 py-1 text-bad">
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
