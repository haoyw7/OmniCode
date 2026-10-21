import { queryOptions } from "@tanstack/react-query";
import { cancelSessionSearch, searchSessions } from "../../sessions/data/sessionStore";
import { cancelProjectSearch, searchProject, type ProjectSearchOptions } from "./search";

const sources = new WeakMap<typeof searchProject, number>();
let nextSource = 0;
function searchSource(search: typeof searchProject) {
  if (!sources.has(search)) sources.set(search, ++nextSource);
  return sources.get(search)!;
}

// Query cancellation also cancels the debounce, before a backend process exists.
async function debounceSearch(signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 200);
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted();
}

export const searchKeys = {
  all: ["search"] as const,
  project: (options: Omit<ProjectSearchOptions, "searchId">, source: number) => ["search", "project", source, options] as const,
  sessions: (query: string) => ["search", "sessions", query] as const,
};

export const projectSearchQuery = (options: Omit<ProjectSearchOptions, "searchId">, search = searchProject) => queryOptions({
  queryKey: searchKeys.project(options, searchSource(search)),
  gcTime: 0,
  enabled: !!options.query && !!options.cwd && options.cwd !== "~",
  queryFn: async ({ signal }) => {
    await debounceSearch(signal);
    const searchId = crypto.randomUUID();
    const cancel = () => { void cancelProjectSearch(options.cwd, searchId).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try { return await search({ ...options, searchId }); }
    finally { signal.removeEventListener("abort", cancel); }
  },
});

export const sessionSearchQuery = (query: string) => queryOptions({
  queryKey: searchKeys.sessions(query),
  gcTime: 0,
  queryFn: async ({ signal }) => {
    await debounceSearch(signal);
    const searchOwner = crypto.randomUUID();
    const cancel = () => { void cancelSessionSearch(searchOwner).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try { return await searchSessions({ query, searchOwner }); }
    finally { signal.removeEventListener("abort", cancel); }
  },
});
