import { useEffect, useState } from "react";
import {
  providerAccountExists,
  providerAccounts,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "./providerAccounts";
import {
  unavailableRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import {
  loadRateLimits,
  useCachedRateLimits,
} from "./rateLimitsCache";
import type { HarnessId } from "../../sessions/model/session";
import { useNow } from "../../../shared/hooks/useNow";
import { providerUsageHost, providerUsageSourceKey } from "./providerUsageSource";

/** Usage surfaces resolve against the conversation's account and shared cache. */
export function useProviderUsage(
  provider: RateLimitProvider,
  session?: { harness: HarnessId; providerAccountId?: string },
  project?: string,
  enabled = true,
) {
  const source = providerUsageSourceKey();
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
  }, [provider, accountId, available, enabled, source]);

  return { limits, accountId, accounts, available, local: !providerUsageHost() };
}

export function useUsageClock() {
  return useNow(30_000);
}
