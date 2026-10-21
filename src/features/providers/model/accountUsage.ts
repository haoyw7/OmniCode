import { useMemo } from "react";
import { useMutation, useQueries } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import type { ProviderRateLimits } from "./rateLimits";
import {
  rateLimitsQuery,
  rateLimitsSnapshot,
  loadRateLimits,
} from "./rateLimitsQueries";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "./providerAccounts";
import { identityKey } from "./providerAccountIdentity";
import { useNow } from "../../../shared/hooks/useNow";
import { providerUsageSourceKey } from "./providerUsageSource";

const CLOCK_MS = 30_000;
export { accountHeadroom, accountStatus, bestAlternativeAccount, type AccountStatus, type AccountStatusTone } from "./accountUsageStatus";

export const accountUsageKey = identityKey;

function accountsFor(provider?: ProviderAccountProvider): ProviderAccount[] {
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
  const accounts = useMemo(() => accountsFor(provider), [accountsVersion, provider, source]);
  const queries = useQueries({
    queries: accounts.map((account) => ({ ...rateLimitsQuery(account.provider, account.id), enabled })),
  }, queryClient);
  const refreshMutation = useMutation({
    mutationFn: () => Promise.all(accounts.map((account) => loadRateLimits(account.provider, account.id, true))),
  }, queryClient);
  const clock = useNow(CLOCK_MS);
  const usage = Object.fromEntries(accounts.map((account, index) => [
    accountUsageKey(account),
    rateLimitsSnapshot(account.provider, queries[index].data, queries[index].isFetching),
  ]));
  const now = Math.max(clock, ...queries.map((query) => query.dataUpdatedAt));
  return {
    usage, now,
    refreshing: refreshMutation.isPending || queries.some((query) => query.isFetching),
    refresh: () => refreshMutation.mutate(),
  };
}
