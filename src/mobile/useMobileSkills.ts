import { useCallback, useEffect } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import type { HostSkillCatalog } from "../features/connections/model/protocol";

export type MobileSkillsLoader = (refresh?: boolean) => Promise<HostSkillCatalog>;
let catalogVisit = 0;
export const mobileSkillsQuery = (key: string, load: MobileSkillsLoader | undefined, native: boolean) => queryOptions({
  queryKey: ["mobileSkills", key], staleTime: native ? 30000 : 5 * 60000, gcTime: Infinity,
  meta: { visited: ++catalogVisit }, structuralSharing: false, queryFn: () => load!(!native),
});
function trimCatalogs() {
  const entries = queryClient.getQueryCache().findAll({ queryKey: ["mobileSkills"] })
    .sort((a, b) => Number(b.meta?.visited ?? 0) - Number(a.meta?.visited ?? 0));
  for (const query of entries.slice(32))
    if (!query.getObserversCount() && query.state.fetchStatus !== "fetching") queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
}
export function useMobileSkills(key: string, load: MobileSkillsLoader | undefined, open: boolean, native: boolean) {
  const read = useQuery({ ...mobileSkillsQuery(key, load, native), enabled: open && !!load }, queryClient);
  useEffect(trimCatalogs, [key, read.dataUpdatedAt]);
  const reload = useCallback(async (refresh = false) => {
    if (!load) return;
    await queryClient.fetchQuery({ ...mobileSkillsQuery(key, load, native), queryFn: () => load(refresh || !native),
      ...(refresh ? { staleTime: 0 } : {}),
    }).catch(() => undefined);
  }, [key, load, native]);
  return { key, catalog: read.data, loading: read.isFetching && !read.data, failed: read.isError || undefined,
    error: read.error instanceof Error ? read.error.message : undefined, reload };
}
