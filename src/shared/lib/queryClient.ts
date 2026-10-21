import { notifyManager, QueryClient } from "@tanstack/react-query";

// The stores these queries replace published synchronously; flush observer
// batches on a microtask instead of a timer so results land in the same task.
notifyManager.setScheduler(queueMicrotask);

/**
 * The application's TanStack Query cache. Every window, portal and test
 * shares this instance, so hooks pass it explicitly and model code can
 * invalidate or seed entries without a React context.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Host and Git reads report failures in place; a retry would only delay them.
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

// TanStack refetches when visibility changes. Desktop windows also regain
// focus while staying visible, and every such focus revalidates stale reads.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    if (!document.hidden) queryClient.getQueryCache().onFocus();
  });
}

/**
 * Invalidate after an external change. A first read already in flight is
 * shared rather than restarted, so follow it up once it settles; otherwise
 * it could land data from before the change.
 */
export async function invalidateAfterChange(queryKey: readonly unknown[]) {
  const refetchType = typeof document !== "undefined" && document.hidden ? "none" : "active";
  const shared = queryClient
    .getQueryCache()
    .findAll({ queryKey, fetchStatus: "fetching" })
    .some((query) => query.state.data === undefined);
  await queryClient.invalidateQueries({ queryKey, refetchType });
  if (shared) await queryClient.invalidateQueries({ queryKey, refetchType });
}
