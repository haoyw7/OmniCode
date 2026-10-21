import { AsyncLocalStorage } from "node:async_hooks";
import type { StartupProgress } from "../src/integrations/harness/core/startupProgress";

type Reporter = (progress: StartupProgress) => void;
const scope = new AsyncLocalStorage<Reporter>();
export const startupProgressReporter = (): Reporter | undefined => scope.getStore();
export const reportStartupProgress = (progress: StartupProgress): void => { scope.getStore()?.(progress); };
export function withStartupProgress<T>(report: Reporter, operation: () => T): T { return scope.run(report, operation); }

const pending = new Map<string | symbol, { promise: Promise<unknown>; listeners: Set<Reporter>; latest?: StartupProgress }>();
/** Concurrent sessions waiting on one install/connection each receive its progress. */
export async function sharedStartupProgress<T>(key: string | symbol, operation: () => Promise<T>): Promise<T> {
  let task = pending.get(key);
  if (!task) {
    const listeners = new Set<Reporter>();
    const created = { listeners, latest: undefined as StartupProgress | undefined, promise: Promise.resolve() as Promise<unknown> };
    created.promise = Promise.resolve().then(() => withStartupProgress(progress => {
      created.latest = progress;
      for (const listener of listeners) listener(progress);
    }, operation));
    task = created;
    pending.set(key, task);
    void task.promise.finally(() => { if (pending.get(key) === created) pending.delete(key); }).catch(() => {});
  }
  const report = startupProgressReporter();
  if (report) { task.listeners.add(report); if (task.latest) report(task.latest); }
  try { return await task.promise as T; }
  finally { if (report) task.listeners.delete(report); }
}
