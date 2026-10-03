import { useEffect, useState } from "react";
import { errorMessage, faces as api, type FaceEvent } from "./api";
import { formatDate } from "./PeopleList";

type Kind = "all" | "recognized" | "unknown";

export function HistoryList() {
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<FaceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .history(kind, query)
        .then((e) => (setEvents(e), setError(null)))
        .catch((e) => setError(errorMessage(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [kind, query]);

  async function clear() {
    try {
      await api.clearHistory();
      setEvents([]);
      setConfirmClear(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" className="rounded-md border border-border bg-bg px-3 py-1.5 text-fg" />
        {(["all", "recognized", "unknown"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-button px-3 py-1.5 text-sm capitalize ${kind === k ? "bg-accent text-accent-ink" : "border border-border text-fg"}`}
          >
            {k}
          </button>
        ))}
        <span className="ml-auto" />
        {confirmClear ? (
          <>
            <span className="text-sm text-fg-2">Delete the whole history?</span>
            <button onClick={clear} className="rounded-button bg-bad px-3 py-1.5 text-sm text-white">
              Clear
            </button>
            <button onClick={() => setConfirmClear(false)} className="rounded-button border border-border px-3 py-1.5 text-sm text-fg">
              Keep
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmClear(true)} disabled={!events?.length} className="rounded-button px-3 py-1.5 text-sm text-bad disabled:opacity-40">
            Clear history
          </button>
        )}
      </div>
      {error && <p className="m-0 text-sm text-bad">{error}</p>}
      {events?.length === 0 && <p className="m-0 text-fg-2">No events.</p>}
      {!!events?.length && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-fg-3">
              <th className="border-b border-border py-2 font-medium">Time</th>
              <th className="border-b border-border py-2 font-medium">Result</th>
              <th className="border-b border-border py-2 text-right font-medium">Similarity</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="border-b border-border py-2 text-fg-2">{formatDate(e.at)}</td>
                <td className="border-b border-border py-2">{e.name ? <span className="text-fg">{e.name}</span> : <span className="text-warn">Unknown</span>}</td>
                <td className="border-b border-border py-2 text-right font-mono text-fg-2">{e.similarity == null ? "–" : `${Math.round(e.similarity * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
