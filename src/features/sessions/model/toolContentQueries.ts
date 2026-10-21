import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import type { ToolContentPage, ToolContentRequest, ToolContentSource } from "../../../integrations/harness/core/toolContent";

export function toolContentQuery(source: ToolContentSource, request: ToolContentRequest) {
  return queryOptions({
    queryKey: ["toolContent", ...source.key, request],
    queryFn: async ({ signal }) => {
      const page = await source.read(request, signal);
      signal.throwIfAborted();
      // Streaming versions must not retain hundreds of old tails for five minutes.
      // Active views own their pages; keep at most 127 other inactive pages.
      const inactive = queryClient.getQueryCache().findAll({ queryKey: ["toolContent"] })
        .filter(query => !query.getObserversCount() && query.state.fetchStatus !== "fetching")
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      for (const old of inactive.slice(127)) queryClient.removeQueries({ queryKey: old.queryKey, exact: true });
      return page;
    },
    networkMode: "always",
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    structuralSharing: false,
  });
}

/** Copy is explicit and pins one snapshot; ordinary viewing never downloads all pages. */
export async function readCompleteToolContent(source: ToolContentSource, request: ToolContentRequest, signal?: AbortSignal): Promise<string> {
  const pieces: string[] = [];
  let offset = 0, pinned: ToolContentPage | undefined;
  do {
    signal?.throwIfAborted();
    const page = await source.read({ ...request, offset, end: undefined, tail: false,
      ...(pinned ? { version: pinned.version, transfer: pinned.transfer } : {}) }, signal);
    if (page.start !== offset || (pinned && (page.version !== pinned.version || page.transfer !== pinned.transfer || page.total !== pinned.total)) ||
      (page.end <= offset && page.total > offset) || page.end > page.total || page.text.length !== page.end - page.start) throw new Error("Incomplete tool content response");
    pinned ??= page;
    pieces.push(page.text);
    offset = page.end;
  } while (offset < pinned.total);
  signal?.throwIfAborted();
  return pieces.join("");
}

export function removeToolContentQueries(scope: readonly unknown[]) {
  for (const kind of ["toolContent", "toolContentSearch"]) {
    void queryClient.cancelQueries({ queryKey: [kind, ...scope] });
    queryClient.removeQueries({ queryKey: [kind, ...scope] });
  }
}
