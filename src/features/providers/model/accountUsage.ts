import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ProviderRateLimits } from "../../../contracts/session";
import { getAllRateLimits, loadRateLimits, subscribeRateLimits } from "./rateLimitsCache";
import { PROVIDER_ACCOUNT_PROVIDERS, providerAccounts, type ProviderAccount, type ProviderAccountProvider } from "./providerAccounts";
import { identityKey } from "./providerAccountIdentity";
import { useNow } from "../../../shared/hooks/useNow";
import { providerUsageSourceKey } from "./providerUsageSource";

const CLOCK_MS = 30_000;
export { accountHeadroom, accountStatus, bestAlternativeAccount, type AccountStatus, type AccountStatusTone } from "./accountUsageStatus";

export const accountUsageKey = identityKey;

function accountsFor(provider?: ProviderAccountProvider): ProviderAccount[] {
  if (provider === "workbuddy") return [];
  return provider
    ? providerAccounts(provider)
    : PROVIDER_ACCOUNT_PROVIDERS.flatMap((entry) => providerAccounts(entry));
}

export type AccountUsage = {
  usage: Record<string, ProviderRateLimits>;
  now: number;
  refreshing: boolean;
  refresh: () => void;
};

/**
 * Usage windows for every account of `provider` (or of every provider), so
 * Settings and the footer account picker can show which account has
 * headroom. `accountsVersion` should change when accounts are added or
 * removed. While `enabled`, accounts without a window snapshot load once;
 * `refresh` explicitly reloads every account.
 */
export function useProviderAccountUsage(
  accountsVersion: unknown,
  {
    provider,
    enabled = true,
  }: { provider?: ProviderAccountProvider; enabled?: boolean } = {},
): AccountUsage {
  const source = providerUsageSourceKey();
  const usage = useSyncExternalStore(
    subscribeRateLimits,
    getAllRateLimits,
    getAllRateLimits,
  );
  const [inflight, setInflight] = useState(0);
  const clock = useNow(CLOCK_MS);
  // A fresh load re-reads reset windows without waiting for the next tick.
  const [loadedAt, setLoadedAt] = useState(0);
  const now = Math.max(clock, loadedAt);

  const load = useCallback(
    async (targets: ProviderAccount[], force = false) => {
      if (targets.length === 0) return;
      setInflight((count) => count + 1);
      try {
        await Promise.allSettled(
          targets.map((account) =>
            account.provider === "workbuddy" ? Promise.resolve() : loadRateLimits(account.provider, account.id, force),
          ),
        );
      } finally {
        setInflight((count) => count - 1);
        setLoadedAt(Date.now());
      }
    },
    [],
  );

  // Renames also bump the version; the shared cache prevents repeat probes.
  useEffect(() => {
    if (!enabled) return;
    const cached = getAllRateLimits();
    void load(
      accountsFor(provider).filter(
        (account) => !cached[accountUsageKey(account)],
      ),
    );
  }, [accountsVersion, enabled, load, provider, source]);

  const refresh = useCallback(
    () => void load(accountsFor(provider), true),
    [load, provider],
  );

  return { usage, now, refreshing: inflight > 0, refresh };
}
