import { pathKey } from "../../shared/lib/paths";
import { queryClient } from "../../shared/lib/queryClient";
import { normalizeProjectPath } from "../../features/projects/model/recents";

let historyLoaderId = 0;
/** Independent project reads feed the workspace's optimistic summary projection. */
export function createProjectHistoryLoader<T>(callbacks: {
  list: (cwd: string) => Promise<T[]>;
  start?: (cwd: string) => void;
  success: (cwd: string, rows: T[], startedAt: number) => void;
  failure?: (cwd: string) => void;
}) {
  const scope = ++historyLoaderId;
  // These generations invalidate navigation callbacks, not cached remote data.
  const generations = new Map<string, number>();
  return {
    invalidate(cwd: string): void {
      if (!cwd || cwd === "~") return;
      const key = pathKey(normalizeProjectPath(cwd));
      generations.set(key, (generations.get(key) ?? 0) + 1);
    },
    load(cwd: string, force = false): Promise<null> {
      if (!cwd || cwd === "~") return Promise.resolve(null);
      const path = normalizeProjectPath(cwd), key = pathKey(path);
      const generation = (generations.get(key) ?? 0) + (force ? 1 : 0);
      generations.set(key, generation);
      const queryKey = ["projectHistory", scope, key, generation];
      const current = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (current?.state.fetchStatus === "fetching") return current.promise as Promise<null>;
      void queryClient.fetchQuery({ queryKey, gcTime: 0, queryFn: async () => {
        const startedAt = Date.now();
        callbacks.start?.(path);
        try {
          const rows = await callbacks.list(path);
          if (generations.get(key) === generation) callbacks.success(path, rows, startedAt);
        } catch {
          if (generations.get(key) === generation) callbacks.failure?.(path);
        }
        return null;
      } }).catch(() => undefined);
      return queryClient.getQueryCache().find({ queryKey, exact: true })!.promise as Promise<null>;
    },
  };
}
