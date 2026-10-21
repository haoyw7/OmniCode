import { queryClient, invalidateAfterChange } from "../../../shared/lib/queryClient";
import { isCancelledError } from "@tanstack/react-query";

export const inboxSourceKey = (provider: string, kind: string, id: string) => ["inboxSource", provider, kind, id] as const;

/** Query owns both cached native reads and concurrent request sharing. */
export async function fetchInboxSource<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>, options?: { force?: boolean; maxAgeMs?: number }) {
  if (options?.force) await queryClient.cancelQueries({ queryKey, exact: true });
  let request: Promise<T> | undefined;
  try {
    return await queryClient.fetchQuery({ queryKey, queryFn: () => request = queryFn(), staleTime: options?.force ? 0 : options?.maxAgeMs ?? 0 });
  } catch (error) {
    // Native RPCs cannot be aborted. Their original imperative caller can still
    // finish, but a cleared/replaced Query must never publish that late response.
    if (isCancelledError(error) && request) return request;
    throw error;
  }
}

export function peekInboxSource<T>(queryKey: readonly unknown[]): T | null {
  return queryClient.getQueryState(queryKey)?.isInvalidated ? null : queryClient.getQueryData<T>(queryKey) ?? null;
}

export async function invalidateInboxSource(queryKey: readonly unknown[]) {
  await queryClient.cancelQueries({ queryKey });
  await invalidateAfterChange(queryKey);
}
