import { createStore, localStorageAdapter } from "@aixjs/aix/state";

/** Application state shared by your pages and components. Inspect it live at /__aix/state. */
export const appState = createStore(
  {
    sidebar: "open" as "open" | "closed",
    lastVisited: null as string | null,
  },
  { name: "app", persist: { adapter: localStorageAdapter(), keys: ["sidebar"] } },
);
