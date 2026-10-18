import { useEffect, useState } from "react";
import {
  providerAccountExists,
  providerAccounts,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../features/providers/model/providerAccounts";
import {
  unavailableRateLimits,
  type RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import {
  loadRateLimits,
  useCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import type { HarnessId } from "../../features/sessions/model/session";
import { useNow } from "../../shared/hooks/useNow";

/** A pane and the footer resolve usage against the same account and cache. */
export function useProviderUsage(
  provider: RateLimitProvider,
  session?: { harness: HarnessId; providerAccountId?: string },
  project?: string,
  enabled = true,
) {
  const [, setAccountsVersion] = useState(0);
  useEffect(
    () => subscribeProviderAccounts(() => setAccountsVersion((v) => v + 1)),
    [],
  );
  const accountProvider = supportsProviderAccounts(provider) ? provider : null;
  const accountId = accountProvider
    ? session?.harness === provider && session.providerAccountId
      ? session.providerAccountId
      : selectedProviderAccountId(accountProvider, project)
    : "default";
  const accounts = accountProvider ? providerAccounts(accountProvider) : [];
  const available =
    !accountProvider || providerAccountExists(accountProvider, accountId);
  const cached = useCachedRateLimits(provider, accountId);
  const limits = available
    ? cached
    : unavailableRateLimits(
        provider,
        "This conversation uses a removed account",
      );

  // The shared cache loads once and coalesces requests from different surfaces.
  useEffect(() => {
    if (enabled && available) void loadRateLimits(provider, accountId);
  }, [provider, accountId, available, enabled]);

  return { limits, accountId, accounts, available };
}

export function useUsageClock() {
  return useNow(30_000);
}
