import { pathKey } from "../../shared/lib/paths";
import { normalizeProjectPath } from "../../features/projects/model/recents";

/** Concurrent summary reads are independent by project; a forced refresh wins. */
export function createProjectHistoryLoader<T>(callbacks: {
  list: (cwd: string) => Promise<T[]>;
  start?: (cwd: string) => void;
  success: (cwd: string, rows: T[], startedAt: number) => void;
  failure?: (cwd: string) => void;
}) {
  const requests = new Map<string, Promise<void>>();
  const generations = new Map<string, number>();
  return {
    /** Removed or moved projects must not accept reads from their old location. */
    invalidate(cwd: string): void {
      if (!cwd || cwd === "~") return;
      const key = pathKey(normalizeProjectPath(cwd));
      generations.set(key, (generations.get(key) ?? 0) + 1);
      requests.delete(key);
    },
    load(cwd: string, force = false): Promise<void> {
      if (!cwd || cwd === "~") return Promise.resolve();
      const path = normalizeProjectPath(cwd);
      const key = pathKey(path);
      const pending = requests.get(key);
      if (pending && !force) return pending;
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      const startedAt = Date.now();
      callbacks.start?.(path);
      const request = callbacks
        .list(path)
        .then(
          (rows) => {
            if (generations.get(key) === generation)
              callbacks.success(path, rows, startedAt);
          },
          () => {
            if (generations.get(key) === generation) callbacks.failure?.(path);
          },
        )
        .finally(() => {
          if (requests.get(key) === request) requests.delete(key);
        });
      requests.set(key, request);
      return request;
    },
  };
}
