import { sharedHostMachineId } from "../../connections/model/remoteProjects";
import { remoteRequest } from "../../connections/model/connections";
import type { HostProviderAccounts } from "../../connections/model/protocol";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import type {
  ProviderAccount,
  ProviderAccountProvider,
} from "./providerAccounts";

/** Identity the provider CLI cached on disk after sign-in. */
export type ProviderAccountIdentity = {
  email?: string | null;
  name?: string | null;
  plan?: string | null;
  organization?: string | null;
};

async function fetchProviderAccountIdentity(
  provider: ProviderAccountProvider,
  accountId: string,
  source: "host" | "local" = "host",
): Promise<ProviderAccountIdentity | null> {
  try {
    const machineId = source === "host" ? sharedHostMachineId() : undefined;
    if (machineId) {
      const accounts = await hostIdentities(machineId);
      if (sharedHostMachineId() !== machineId) return null;
      // Missing metadata/old Hosts must not fall back to the desktop process.
      return (
        accounts[provider]?.find((account) => account.id === accountId)
          ?.identity ?? null
      );
    }
    if (source === "host") return null;
    if (provider === "workbuddy") {
      const accounts = await invoke<import("../../../integrations/harness/core/catalog").WorkBuddyAccount[]>("harness_workbuddy_accounts");
      return accounts.find(account => account.id === accountId)?.identity ?? null;
    }
    return (await invoke<ProviderAccountIdentity | null>(
      "provider_account_identity",
      { provider, accountId },
    )) ?? null;
  } catch {
    return null;
  }
}

function hostIdentities(machineId: string): Promise<HostProviderAccounts> {
  return queryClient.fetchQuery({
    queryKey: ["providerIdentities", "host", machineId],
    queryFn: () => remoteRequest<HostProviderAccounts>(machineId, "providerAccounts.list"),
  });
}
export const providerAccountIdentityQuery = (provider: ProviderAccountProvider, accountId: string, source: "host" | "local" = "host") => queryOptions({
  queryKey: ["providerIdentities", source, source === "host" ? sharedHostMachineId() : null, provider, accountId],
  queryFn: () => fetchProviderAccountIdentity(provider, accountId, source),
});
export function readProviderAccountIdentity(provider: ProviderAccountProvider, accountId: string, source: "host" | "local" = "host") {
  return queryClient.fetchQuery(providerAccountIdentityQuery(provider, accountId, source));
}

/** Org chip text: "Personal" for Claude's default "<name>'s Organization". */
export function identityOrganizationTag(
  identity: ProviderAccountIdentity | null | undefined,
): string | null {
  const name = identity?.organization?.trim();
  if (!name) return null;
  return /['’]s Organization$/.test(name) ? "Personal" : name;
}

export function identityKey(account: ProviderAccount): string {
  return `${account.provider}:${account.id}`;
}

/**
 * Load identities for `accounts`, keyed by `identityKey`. Re-reads whenever
 * `refreshKey` changes.
 */
export function useProviderAccountIdentities(
  accounts: ProviderAccount[],
  refreshKey?: unknown,
  source: "host" | "local" = "host",
): Record<string, ProviderAccountIdentity | null> {
  const reads = useQueries({ queries: accounts.map(account => providerAccountIdentityQuery(account.provider, account.id, source)) }, queryClient);
  const previous = useRef(refreshKey);
  useEffect(() => {
    if (previous.current === refreshKey) return;
    previous.current = refreshKey;
    void invalidateAfterChange(["providerIdentities", source]);
  }, [refreshKey, source]);
  return Object.fromEntries(accounts.map((account, index) => [identityKey(account), reads[index]?.data ?? null]));
}
