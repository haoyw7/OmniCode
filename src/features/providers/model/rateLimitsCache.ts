import { useSyncExternalStore } from "react";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";
import { providerUsageHost, providerUsageSourceKey } from "./providerUsageSource";

const snapshots = new Map<string, ProviderRateLimits>();
const pending = new Map<string, Promise<ProviderRateLimits>>();
const queuedRefreshes = new Map<string, Promise<ProviderRateLimits>>();
const listeners = new Set<() => void>();
let allSnapshots: Record<string, ProviderRateLimits> = {};
let sourceKey = providerUsageSourceKey();

function currentSource(): string {
  const next = providerUsageSourceKey();
  if (next !== sourceKey) {
    sourceKey = next;
    snapshots.clear();
    allSnapshots = {};
  }
  return sourceKey;
}

function keyFor(provider: RateLimitProvider, accountId: string): string {
  return `${provider}:${accountId}`;
}

function publish(key: string, value: ProviderRateLimits, source = currentSource()): void {
  if (source !== currentSource()) return;
  snapshots.set(key, value);
  allSnapshots = { ...allSnapshots, [key]: value };
  for (const listener of listeners) listener();
}

export function subscribeRateLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllRateLimits(): Record<string, ProviderRateLimits> {
  currentSource();
  return allSnapshots;
}

export function getCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  currentSource();
  return snapshots.get(keyFor(provider, accountId)) ?? idle[provider];
}

const idle: Record<RateLimitProvider, ProviderRateLimits> = {
  claude: idleRateLimits("claude"),
  codex: idleRateLimits("codex"),
  opencode: idleRateLimits("opencode"),
};

export function useCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  return useSyncExternalStore(
    subscribeRateLimits,
    () => getCachedRateLimits(provider, accountId),
    () => getCachedRateLimits(provider, accountId),
  );
}

export function setCachedRateLimits(
  provider: RateLimitProvider,
  accountId: string,
  value: ProviderRateLimits,
): void {
  publish(keyFor(provider, accountId), value);
}

/** Fetch an account once per window lifetime, or again on explicit refresh. */
export function loadRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
  force = false,
): Promise<ProviderRateLimits> {
  const source = currentSource();
  const key = keyFor(provider, accountId);
  const requestKey = JSON.stringify([source, key]);
  const running = pending.get(requestKey);
  if (running) {
    if (!force) return running;
    const queued = queuedRefreshes.get(requestKey);
    if (queued) return queued;
    const next = running.then((value) => source === currentSource()
      ? loadRateLimits(provider, accountId, true) : value);
    queuedRefreshes.set(requestKey, next);
    void next.finally(() => {
      if (queuedRefreshes.get(requestKey) === next) queuedRefreshes.delete(requestKey);
    });
    return next;
  }
  const cached = snapshots.get(key);
  if (cached && !force) return Promise.resolve(cached);

  publish(key, fetchingRateLimits(provider, cached), source);
  const run = (async () => {
    try {
      const result =
        provider === "claude"
          ? await (force && providerUsageHost() ? fetchClaudeRateLimits(accountId, true) : fetchClaudeRateLimits(accountId))
          : provider === "codex"
            ? await (force && providerUsageHost() ? fetchCodexRateLimits(accountId, true) : fetchCodexRateLimits(accountId))
            : await fetchOpencodeGoRateLimits();
      publish(key, result, source);
      return result;
    } catch (error) {
      const result = errorRateLimits(
        provider,
        error instanceof Error ? error.message : String(error),
        source === currentSource() ? getCachedRateLimits(provider, accountId) : undefined,
      );
      publish(key, result, source);
      return result;
    } finally {
      pending.delete(requestKey);
    }
  })();
  pending.set(requestKey, run);
  return run;
}

/** Also used when an account is removed and by tests that need a clean cache. */
export function clearCachedRateLimits(
  provider?: RateLimitProvider,
  accountId?: string,
): void {
  currentSource();
  if (provider && accountId) {
    const key = keyFor(provider, accountId);
    snapshots.delete(key);
    const { [key]: _removed, ...rest } = allSnapshots;
    allSnapshots = rest;
  } else {
    snapshots.clear();
    allSnapshots = {};
  }
  for (const listener of listeners) listener();
}
