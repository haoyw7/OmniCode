import { sharedHostMachineId, sharedHostEnvironment } from "../../connections/model/remoteProjects";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { remoteRequest } from "../../connections/model/connections";
import type { HostProviderAccounts } from "../../connections/model/protocol";
import { translate } from "../../../shared/i18n/language";
import {
  rememberSharedProviderDefaults, newProviderAccount, restoreProviderAccounts,
  type ProviderAccount, type SharedProviderDefaults, type ProviderAccountProvider,
} from "./providerAccounts";

type AccountSnapshot = { revision: number; accounts: HostProviderAccounts; defaults: SharedProviderDefaults };
const CACHE_PREFIX = "monocode.hostAccounts.cache.v1:";
let loading: Promise<void> | undefined;
let loadedIdentity: string | undefined;
let loadedRevision: number | undefined;
let stopAccountSync: (() => void) | undefined;
let syncGeneration = 0;

function unavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unreachable|offline|failed to fetch|fetch failed|network|timed?\s*out|timeout|connection (?:refused|reset)|load failed/i.test(message);
}

function validAccountSnapshot(value: unknown): value is AccountSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as AccountSnapshot;
  return Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 1
    && !!snapshot.accounts && typeof snapshot.accounts === "object" && !Array.isArray(snapshot.accounts)
    && !!snapshot.defaults && typeof snapshot.defaults === "object" && !Array.isArray(snapshot.defaults);
}

function cachedAccounts(environmentId: string): AccountSnapshot | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + environmentId);
    if (!raw) return;
    const value = JSON.parse(raw) as AccountSnapshot;
    if (!validAccountSnapshot(value)) return;
    return value;
  } catch { return; }
}

function host() {
  const machineId = sharedHostMachineId(), environmentId = sharedHostEnvironment();
  if (!machineId || !environmentId) throw new Error("Connect to the shared Host to manage accounts.");
  return { machineId, environmentId };
}
function apply(snapshot: AccountSnapshot, environmentId: string): void {
  if (sharedHostEnvironment() !== environmentId) return;
  if (!validAccountSnapshot(snapshot)) throw new Error(translate("Host returned invalid account metadata."));
  const encoded = JSON.stringify(snapshot);
  const cached = localStorage.getItem(CACHE_PREFIX + environmentId);
  if (loadedIdentity === environmentId && loadedRevision !== undefined && cached) {
    // A slow poll can finish after a mutation has already committed locally.
    if (snapshot.revision < loadedRevision) return;
    // CLI sign-in can change public identity without changing account metadata.
    if (snapshot.revision === loadedRevision && cached === encoded) return;
  }
  restoreProviderAccounts(snapshot.accounts);
  rememberSharedProviderDefaults(snapshot.defaults);
  loadedIdentity = environmentId;
  loadedRevision = snapshot.revision;
  try { localStorage.setItem(CACHE_PREFIX + environmentId, encoded); } catch { /* Host remains authoritative. */ }
}
async function commit(method: string, params: Record<string, unknown>): Promise<AccountSnapshot> {
  await requireSharedAccountHost();
  const target = host();
  const result = await remoteRequest<AccountSnapshot>(target.machineId, method, { ...params, operationId: crypto.randomUUID() });
  apply(result, target.environmentId);
  return result;
}

export async function removeProviderAccountCredentials(provider: ProviderAccountProvider, accountId: string): Promise<void> {
  await commit("providerAccounts.remove", { provider, accountId });
}

export async function loadProviderAccounts(): Promise<void> {
  if (loading) return loading;
  const target = host();
  loading = remoteRequest<AccountSnapshot>(target.machineId, "providerAccounts.read")
    .then(snapshot => apply(snapshot, target.environmentId)).finally(() => { loading = undefined; });
  return loading;
}

/** Compatibility name: account metadata is now hydrated, never published from a webview. */
export async function initProviderAccountPublishing(): Promise<() => void> {
  stopAccountSync?.();
  const generation = ++syncGeneration;
  const target = host();
  loadedRevision = undefined;
  const cached = cachedAccounts(target.environmentId);
  if (cached) apply(cached, target.environmentId);
  else { restoreProviderAccounts({}); rememberSharedProviderDefaults({}); }
  let compatible = false;
  const hydrate = async () => {
    if (!compatible) { await requireSharedAccountHost(); compatible = true; }
    await loadProviderAccounts();
  };
  try { await hydrate(); }
  catch (error) {
    // Public cache from this verified Host can render offline. Account mutations
    // still require a live capability check and are never queued for replay.
    if (!cached || !unavailable(error)) throw error;
  }
  if (generation !== syncGeneration) return () => {};
  const refresh = () => { if (document.visibilityState !== "hidden") void hydrate().catch(() => {}); };
  const timer = setInterval(refresh, 2_000);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", refresh);
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", refresh);
    if (stopAccountSync === stop) stopAccountSync = undefined;
  };
  stopAccountSync = stop;
  return stop;
}

export async function addProviderAccountProfile(provider: ProviderAccountProvider, label: string, dataHome?: string): Promise<ProviderAccount> {
  const account = newProviderAccount(provider, label, dataHome);
  await commit("providerAccounts.save", { provider, accountId: account.id, label: account.label, ...(dataHome ? { dataHome } : {}) });
  return { id: account.id, provider, label: account.label };
}

export async function updateProviderAccountProfile(account: ProviderAccount): Promise<void> {
  await commit("providerAccounts.save", { provider: account.provider, accountId: account.id, label: account.label,
    // undefined preserves the private Host selector; an explicit empty value resets it.
    ...(account.dataHome !== undefined ? { dataHome: account.dataHome } : {}) });
}

export async function loadSharedProviderDefaults(): Promise<SharedProviderDefaults> {
  const target = host();
  const snapshot = await remoteRequest<AccountSnapshot>(target.machineId, "providerAccounts.read");
  apply(snapshot, target.environmentId);
  return snapshot.defaults;
}

export async function setSharedProviderDefault(provider: ProviderAccountProvider, accountId: string): Promise<SharedProviderDefaults> {
  return (await commit("providerAccounts.setDefault", { provider, accountId })).defaults;
}

export async function importCurrentCodexAccount(label: string): Promise<ProviderAccount> {
  const account = newProviderAccount("codex", label);
  await commit("providerAccounts.importCodex", { provider: "codex", accountId: account.id, label: account.label });
  return account;
}

export async function requireSharedAccountHost(): Promise<void> {
  const target = host();
  const descriptor = await loadRemoteHostDescriptor(target.machineId, target.environmentId);
  if (!descriptor.capabilities.includes("providerAccounts.manage.v1")) throw new Error("Update the Host to manage shared accounts.");
}

/** The execution Host chooses the CLI Home and owns sign-in, even after the initiating window closes. */
export async function loginProviderAccount(provider: ProviderAccountProvider, accountId: string): Promise<void> {
  await requireSharedAccountHost();
  const target = host();
  type Status = { id: string; status: "running" | "succeeded" | "failed"; error?: string };
  let status = await remoteRequest<Status>(target.machineId, "providerAccounts.loginStart", { provider, accountId, operationId: crypto.randomUUID() });
  const deadline = Date.now() + 11 * 60_000;
  while (status.status === "running" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    status = await remoteRequest<Status>(target.machineId, "providerAccounts.loginStatus", { id: status.id });
  }
  if (status.status !== "succeeded") throw new Error(status.error || "Provider sign-in timed out");
  // Identities may change without changing metadata revision.
  loadedRevision = undefined;
  await loadProviderAccounts();
}
