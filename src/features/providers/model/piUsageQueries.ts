import { queryOptions } from "@tanstack/react-query";
import { fetchPiUsage, type PiUsageProvider } from "./piUsage";
import { RATE_LIMIT_MIN_REFETCH_MS, RATE_LIMIT_POLL_MS } from "./rateLimits";

export const piUsageKeys = {
  usage: (provider: PiUsageProvider, view: string) => ["piUsage", provider, view] as const,
};
export const piUsageQuery = (provider: PiUsageProvider, view: string) => queryOptions({
  queryKey: piUsageKeys.usage(provider, view),
  // Consuming the signal lets Query discard a replaced conversation's request.
  queryFn: ({ signal }) => { signal.throwIfAborted(); return fetchPiUsage(provider); },
  staleTime: RATE_LIMIT_MIN_REFETCH_MS,
  gcTime: 0,
  refetchInterval: RATE_LIMIT_POLL_MS,
});
