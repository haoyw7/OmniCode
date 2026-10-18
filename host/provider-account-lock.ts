import { AsyncLocalStorage } from "node:async_hooks";
const pending = new Map<string, Promise<void>>();
const owned = new AsyncLocalStorage<ReadonlySet<string>>();

/** Serializes app-owned startup/refresh operations, not autonomous CLI refreshes. */
export async function withProviderAccountLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  if (owned.getStore()?.has(key)) return operation();
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pending.set(key, current);
  await previous;
  try { return await owned.run(new Set([...(owned.getStore() ?? []), key]), operation); }
  finally { release(); if (pending.get(key) === current) pending.delete(key); }
}
