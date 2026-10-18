import { sharedHostMachineId } from "../../connections/model/remoteProjects";
import { remoteRequest } from "../../connections/model/connections";
import type { HostProviderAccounts } from "../../connections/model/protocol";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
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

export async function readProviderAccountIdentity(
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
    return (await invoke<ProviderAccountIdentity | null>(
      "provider_account_identity",
      { provider, accountId },
    )) ?? null;
  } catch {
    return null;
  }
}

const pending = new Map<string, Promise<HostProviderAccounts>>();
function hostIdentities(machineId: string): Promise<HostProviderAccounts> {
  const existing = pending.get(machineId);
  if (existing) return existing;
  const request = remoteRequest<HostProviderAccounts>(
    machineId,
    "providerAccounts.list",
  );
  pending.set(machineId, request);
  void request
    .finally(() => {
      if (pending.get(machineId) === request) pending.delete(machineId);
    })
    .catch(() => {});
  return request;
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
  const [identities, setIdentities] = useState<
    Record<string, ProviderAccountIdentity | null>
  >({});
  const key = accounts.map(identityKey).join("|");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      accounts.map(
        async (account) =>
          [
            identityKey(account),
            await readProviderAccountIdentity(account.provider, account.id, source),
          ] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setIdentities(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, source]);

  return identities;
}
