import { loadSharedAgentDefaults, updateSharedAgentDefault } from "../../settings/model/agentPreferences";
import { preferenceStorage } from "../../settings/model/sharedPreferences";
import { pathKey } from "../../../shared/lib/paths";
import type { HarnessId } from "../../sessions/model/session";

const ACCOUNTS_KEY = "monocode.providerAccounts.v1";
const SELECTIONS_KEY = "monocode.providerAccountSelections.v1";
const SHARED_DEFAULTS_KEY = "monocode.sharedProviderDefaults.cache.v1";
const CHANGE_EVENT = "monocode-provider-accounts-changed";

export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";
const DEFAULT_PROVIDER_ACCOUNT_LABEL = "Default account";

/** Legacy sessions predate persisted account ids and belong to the default profile. */
export function sameProviderAccountId(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (
    (left ?? DEFAULT_PROVIDER_ACCOUNT_ID) ===
    (right ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

/**
 * The account a conversation is pinned to. A started conversation without a
 * stored id runs on the built-in profile (Host omits it for that profile);
 * only an unstarted draft follows the new-conversation default (undefined).
 */
export function conversationProviderAccountId(session: {
  providerAccountId?: string;
  providerSessionId?: string;
  nativeSession?: unknown;
  blocks: readonly { role: string }[];
}): string | undefined {
  if (session.providerAccountId) return session.providerAccountId;
  return session.providerSessionId ||
    session.nativeSession ||
    session.blocks.some((block) => block.role === "user")
    ? DEFAULT_PROVIDER_ACCOUNT_ID
    : undefined;
}

/** Providers whose CLIs support isolated, locally named account profiles. */
export const PROVIDER_ACCOUNT_PROVIDERS = [
  "claude",
  "codex",
] as const satisfies readonly HarnessId[];

export type ProviderAccountProvider =
  (typeof PROVIDER_ACCOUNT_PROVIDERS)[number];

export function supportsProviderAccounts(
  provider: HarnessId,
): provider is ProviderAccountProvider {
  return PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider);
}

export type ProviderAccount = {
  id: string;
  provider: ProviderAccountProvider;
  label: string;
  /** Explicit CLI data directory; absent for MonoCode-managed profiles. */
  dataHome?: string;
  /** Effective directory reported by the desktop; never published to Host clients. */
  resolvedDataHome?: string;
  isDefault?: boolean;
};

type StoredAccounts = Partial<
  Record<ProviderAccountProvider, ProviderAccount[]>
>;
type StoredSelections = Record<
  string,
  Partial<Record<ProviderAccountProvider, string>>
>;

export function providerAccounts(
  provider: ProviderAccountProvider,
): ProviderAccount[] {
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  const seen = new Set<string>([DEFAULT_PROVIDER_ACCOUNT_ID]);
  const accounts = Array.isArray(stored[provider]) ? stored[provider] : [];
  let defaultLabel = DEFAULT_PROVIDER_ACCOUNT_LABEL;
  let defaultHome: string | undefined;
  let defaultResolvedHome: string | undefined;
  let foundDefault = false;
  const profiles = accounts.flatMap((account) => {
    const id = validAccountId(account?.id) ? account.id : "";
    const label = cleanLabel(account?.label);
    if (id === DEFAULT_PROVIDER_ACCOUNT_ID) {
      if (label && !foundDefault) {
        defaultLabel = label;
        defaultHome = cleanDataHome(account.dataHome);
        defaultResolvedHome = cleanDataHome(account.resolvedDataHome);
        foundDefault = true;
      }
      return [];
    }
    if (!id || !label || seen.has(id)) {
      return [];
    }
    seen.add(id);
    const dataHome = cleanDataHome(account.dataHome);
    const resolvedDataHome = cleanDataHome(account.resolvedDataHome);
    return [{ id, provider, label, ...(dataHome ? { dataHome } : {}),
      ...(resolvedDataHome ? { resolvedDataHome } : {}),
    }];
  });
  return [
    {
      id: DEFAULT_PROVIDER_ACCOUNT_ID,
      provider,
      label: defaultLabel,
      ...(defaultHome ? { dataHome: defaultHome } : {}),
      ...(defaultResolvedHome ? { resolvedDataHome: defaultResolvedHome } : {}),
      isDefault: true,
    },
    ...profiles,
  ];
}

export function newProviderAccount(
  provider: ProviderAccountProvider,
  label: string,
  dataHome?: string,
): ProviderAccount {
  return {
    id: `account-${crypto.randomUUID()}`,
    provider,
    label:
      cleanLabel(label) || `Account ${providerAccounts(provider).length + 1}`,
    ...(cleanDataHome(dataHome) ? { dataHome: cleanDataHome(dataHome) } : {}),
  };
}

export function saveProviderAccount(account: ProviderAccount): void {
  if (!validAccountId(account.id)) {
    return;
  }
  const label = cleanLabel(account.label);
  if (!label) return;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  const next = providerAccounts(account.provider).filter(
    (entry) => entry.id !== account.id,
  );
  stored[account.provider] = serializeProviderAccounts([
    ...next,
    { id: account.id, provider: account.provider, label, dataHome: account.dataHome,
      resolvedDataHome: account.resolvedDataHome },
  ]);
  writeAccounts(stored);
  announceChange();
}

export function renameProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
  label: string,
): ProviderAccount | null {
  if (!validAccountId(accountId)) return null;
  const nextLabel = cleanLabel(label);
  if (!nextLabel) return null;
  const accounts = providerAccounts(provider);
  const target = accounts.find((account) => account.id === accountId);
  if (!target) return null;
  const renamed = { ...target, label: nextLabel };
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.map((account) => (account.id === accountId ? renamed : account)),
  );
  writeAccounts(stored);
  announceChange();
  return renamed;
}

/** Remove account metadata after native credential cleanup has succeeded. */
export function removeProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
): boolean {
  if (accountId === DEFAULT_PROVIDER_ACCOUNT_ID || !validAccountId(accountId)) {
    return false;
  }
  const accounts = providerAccounts(provider);
  // Host hydration may already have removed the row before this device clears
  // its shared project overrides. Always clear those stale selections too.
  const existed = accounts.some((account) => account.id === accountId);
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.filter((account) => account.id !== accountId),
  );
  writeAccounts(stored);

  const selections = readRecord<StoredSelections>(SELECTIONS_KEY);
  for (const [key, selection] of Object.entries(selections)) {
    if (!isRecord(selection) || selection[provider] !== accountId) continue;
    const nextSelection = { ...selection };
    delete nextSelection[provider];
    if (Object.keys(nextSelection).length === 0) delete selections[key];
    else selections[key] = nextSelection;
  }
  writeJson(SELECTIONS_KEY, selections);
  if (loadSharedAgentDefaults().agents?.[provider]?.accountId === accountId) updateSharedAgentDefault(provider, { accountId: undefined });
  announceChange();
  return existed;
}

function serializeProviderAccounts(
  accounts: ProviderAccount[],
): ProviderAccount[] {
  return accounts.flatMap((account) => {
    const label = cleanLabel(account.label);
    if (!label) return [];
    if (
      account.id === DEFAULT_PROVIDER_ACCOUNT_ID &&
      label === DEFAULT_PROVIDER_ACCOUNT_LABEL &&
      !cleanDataHome(account.dataHome) && !cleanDataHome(account.resolvedDataHome)
    ) {
      return [];
    }
    const dataHome = cleanDataHome(account.dataHome);
    const resolvedDataHome = cleanDataHome(account.resolvedDataHome);
    return [{ id: account.id, provider: account.provider, label,
      ...(dataHome ? { dataHome } : {}),
      ...(resolvedDataHome ? { resolvedDataHome } : {}),
    }];
  });
}

export function providerAccountExists(
  provider: ProviderAccountProvider,
  accountId: string | undefined,
): boolean {
  return providerAccounts(provider).some((account) => account.id === accountId);
}

export type SharedProviderDefaults = Partial<
  Record<ProviderAccountProvider, string>
>;

/** Cache only confirmed native preferences; the Host remains authoritative. */
export function rememberSharedProviderDefaults(
  defaults: SharedProviderDefaults,
): void {
  writeJson(SHARED_DEFAULTS_KEY, defaults);
  announceChange();
}
export function sharedProviderAccountId(
  provider: ProviderAccountProvider,
): string {
  const id = readRecord<SharedProviderDefaults>(SHARED_DEFAULTS_KEY)[provider];
  return validAccountId(id) ? id : DEFAULT_PROVIDER_ACCOUNT_ID;
}

export function selectedProviderAccountId(
  provider: ProviderAccountProvider,
  project: string | undefined,
): string {
  return (
    requestedProviderAccountId(provider, project) ??
    sharedProviderAccountId(provider)
  );
}

/** Explicit project choice only: let Host resolve an unspecified shared default. */
export function requestedProviderAccountId(
  provider: ProviderAccountProvider,
  project: string | undefined,
): string | undefined {
  const id =
    readRecord<StoredSelections>(SELECTIONS_KEY)[selectionKey(project)]?.[
      provider
    ];
  const shared = loadSharedAgentDefaults().agents?.[provider]?.accountId;
  const global = selectionKey(project) === "~";
  if (global && validAccountId(shared)) return shared;
  return validAccountId(id) ? id : validAccountId(shared) ? shared : undefined;
}

export function selectProviderAccount(
  provider: ProviderAccountProvider,
  project: string | undefined,
  accountId: string,
): void {
  if (!providerAccounts(provider).some((account) => account.id === accountId)) {
    return;
  }
  const selections = readRecord<StoredSelections>(SELECTIONS_KEY);
  const key = selectionKey(project);
  if (key === "~") updateSharedAgentDefault(provider, { accountId });
  selections[key] = { ...selections[key], [provider]: accountId };
  writeJson(SELECTIONS_KEY, selections);
  announceChange();
}

export function providerAccountLabel(
  provider: ProviderAccountProvider,
  accountId: string | undefined,
): string {
  return (
    providerAccounts(provider).find((account) => account.id === accountId)
      ?.label ?? "Default account"
  );
}

export function subscribeProviderAccounts(listener: () => void): () => void {
  const local = () => listener();
  const storage = (event: StorageEvent) => {
    if (
      event.key === ACCOUNTS_KEY ||
      event.key === SELECTIONS_KEY ||
      event.key === SHARED_DEFAULTS_KEY
    )
      listener();
  };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", storage);
  };
}

/** Replace the device cache with the Host catalog; removed rows and old labels never win. */
export function restoreProviderAccounts(value: unknown): void {
  if (!isRecord(value)) return;
  const stored: StoredAccounts = {};
  for (const provider of PROVIDER_ACCOUNT_PROVIDERS) {
    const entries = value[provider];
    stored[provider] = Array.isArray(entries) ? entries.flatMap(entry => {
      if (!isRecord(entry) || !validAccountId(entry.id) || !cleanLabel(entry.label)) return [];
      return [{ id: entry.id, provider, label: cleanLabel(entry.label) }];
    }) : [];
  }
  writeAccounts(stored);
  announceChange();
}

function cleanDataHome(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function writeAccounts(value: StoredAccounts): void {
  try {
    preferenceStorage.setItem(ACCOUNTS_KEY, JSON.stringify(value));
  } catch {
    throw new Error("Could not save provider accounts. Browser storage is unavailable.");
  }
}

function selectionKey(project: string | undefined): string {
  return pathKey(project?.trim() || "~");
}

function cleanLabel(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 48)
    : "";
}

function validAccountId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function readRecord<T>(key: string): T {
  const value = readJson<unknown>(key, {});
  return isRecord(value) ? (value as T) : ({} as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = preferenceStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    preferenceStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private or full storage area should not block the provider itself.
  }
}

function announceChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
