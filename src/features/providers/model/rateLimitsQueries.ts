import { isCancelledError, queryOptions, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { errorRateLimits, fetchingRateLimits, idleRateLimits, type ProviderRateLimits, type RateLimitProvider } from "./rateLimits";
import { fetchClaudeRateLimits, fetchCodexRateLimits, fetchOpencodeGoRateLimits } from "./rateLimitsFetch";
import { providerUsageHost, providerUsageSourceKey } from "./providerUsageSource";

// Only the explicit-refresh barrier is local. Query owns data, request sharing,
// fetching state and subscribers.
const queuedRefreshes = new Map<string, Promise<ProviderRateLimits>>();
let sourceKey = providerUsageSourceKey();

export const rateLimitsKeys = {
  all: ["providerRateLimits"] as const,
  source: (source: string) => ["providerRateLimits", source] as const,
  account: (source: string, provider: RateLimitProvider, accountId: string) =>
    ["providerRateLimits", source, provider, accountId] as const,
};

function currentSource() {
  const next = providerUsageSourceKey();
  if (next !== sourceKey) {
    const previous = sourceKey;
    sourceKey = next;
    queryClient.removeQueries({ queryKey: rateLimitsKeys.source(previous) });
  }
  return next;
}

/** Accounts are sampled once per window, until an explicit refresh. */
export function rateLimitsQuery(provider: RateLimitProvider, accountId = "default", force = false) {
  const source = currentSource();
  const queryKey = rateLimitsKeys.account(source, provider, accountId);
  return queryOptions({
    queryKey,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<ProviderRateLimits> => {
      try {
        return provider === "claude"
          ? await (force && providerUsageHost() ? fetchClaudeRateLimits(accountId, true) : fetchClaudeRateLimits(accountId))
          : provider === "codex"
            ? await (force && providerUsageHost() ? fetchCodexRateLimits(accountId, true) : fetchCodexRateLimits(accountId))
            : await fetchOpencodeGoRateLimits();
      } catch (error) {
        return errorRateLimits(provider, error instanceof Error ? error.message : String(error),
          queryClient.getQueryData<ProviderRateLimits>(queryKey));
      }
    },
  });
}

export function rateLimitsSnapshot(provider: RateLimitProvider, data: ProviderRateLimits | undefined, fetching: boolean) {
  return fetching ? fetchingRateLimits(provider, data) : data ?? idleRateLimits(provider);
}

export function useRateLimits(provider: RateLimitProvider, accountId = "default", enabled = true) {
  const query = useQuery({ ...rateLimitsQuery(provider, accountId), enabled }, queryClient);
  return rateLimitsSnapshot(provider, query.data, query.isFetching);
}

export function getCachedRateLimits(provider: RateLimitProvider, accountId = "default") {
  const state = queryClient.getQueryState<ProviderRateLimits>(rateLimitsQuery(provider, accountId).queryKey);
  return rateLimitsSnapshot(provider, state?.data, state?.fetchStatus === "fetching");
}

export function setCachedRateLimits(provider: RateLimitProvider, accountId: string, value: ProviderRateLimits) {
  queryClient.setQueryData(rateLimitsQuery(provider, accountId).queryKey, value);
}

/** A forced Host probe must follow the current request, never share its old result. */
export function loadRateLimits(provider: RateLimitProvider, accountId = "default", force = false): Promise<ProviderRateLimits> {
  const options = rateLimitsQuery(provider, accountId, force);
  const source = sourceKey;
  const key = JSON.stringify(options.queryKey);
  const query = queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true });
  if (force && query?.state.fetchStatus === "fetching") {
    const queued = queuedRefreshes.get(key);
    if (queued) return queued;
    const next = query.promise!.catch(() => undefined).then(() =>
      source === currentSource() && queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true }) === query
        ? loadRateLimits(provider, accountId, true)
        : idleRateLimits(provider));
    queuedRefreshes.set(key, next);
    void next.finally(() => {
      if (queuedRefreshes.get(key) === next) queuedRefreshes.delete(key);
    });
    return next;
  }
  if (force) void queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
  return queryClient.fetchQuery(options).catch((error) => {
    if (isCancelledError(error)) return idleRateLimits(provider);
    throw error;
  });
}

export function clearCachedRateLimits(provider?: RateLimitProvider, accountId?: string) {
  const source = currentSource();
  queryClient.removeQueries({ queryKey: provider && accountId
    ? rateLimitsKeys.account(source, provider, accountId) : rateLimitsKeys.all });
}
