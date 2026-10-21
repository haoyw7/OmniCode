import { queryClient } from "../../../shared/lib/queryClient";
import type { HistoryWindow } from "../../../integrations/harness/core/history";

/** Two consumers can publish a shared response in different React commits. */
export function retainHistoryWindow<T extends { revision: number; history?: HistoryWindow; session: { id: string; blocks: { id: string }[] } }>(current: T | undefined, next: T): T {
  if (!current || current.session.id !== next.session.id) return next;
  if (current.revision > next.revision) return current;
  if (current.revision === next.revision && current.history && next.history?.start &&
    current.session.blocks.findIndex(block => block.id === next.history!.start) > 0) return current;
  return next;
}

/** Paging and polling share one owner. A page always starts from the latest committed window. */
export async function readHistoryWindow<T extends { revision: number; history?: HistoryWindow }>(
  scope: readonly unknown[], known: T | undefined, earlier: boolean,
  load: (known: T | undefined, earlier: boolean, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const queryKey = ["sessionHistory", ...scope];
  const pending = queryClient.getQueryCache().find<T>({ queryKey, exact: true });
  if (pending?.state.fetchStatus === "fetching" && pending.promise) {
    const value = await pending.promise;
    return earlier && !pending.meta?.earlier ? readHistoryWindow(scope, value, true, load) : value;
  }
  const cached = queryClient.getQueryData<T>(queryKey);
  const base = cached?.history && (!known || cached.revision >= known.revision) ? cached : known;
  if (earlier && base?.history && !base.history.hasMore) return base;
  return queryClient.fetchQuery({ queryKey, gcTime: 5 * 60_000, staleTime: 0, retry: false,
    structuralSharing: false, networkMode: "always", meta: { earlier }, queryFn: async ({ signal }) => {
      const result = await load(base, earlier, signal);
      signal.throwIfAborted();
      const inactive = queryClient.getQueryCache().findAll({ queryKey: ["sessionHistory"] })
        .filter(query => query.state.fetchStatus !== "fetching")
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      for (const old of inactive.slice(7)) queryClient.removeQueries({ queryKey: old.queryKey, exact: true });
      return result;
    } });
}
