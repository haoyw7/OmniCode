import {
  REMOTE_PROVIDERS,
  type HostModelCatalog,
  type HostProviderAccounts,
  type RemoteProvider,
} from "../features/connections/model/protocol";
import { findRemoteModel } from "../features/connections/model/remoteModels";
import {
  DEFAULT_RUNTIME_MODE,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../features/sessions/model/session";
import {
  configurationForModel,
  type MobileConfiguration,
} from "./MobileModelControls";
import { activePreferenceStore, preferenceStorage } from "../features/settings/model/sharedPreferences";

const KEY = "monocode.mobileAgentDefaults";
const SHARED_KEY = "monocode.agentDefaults";
export const ACCOUNT_AGENTS = [
  "codex",
  "claude",
] as const satisfies readonly RemoteProvider[];

type AgentDefaults = {
  model?: string;
  modelSettings?: Record<string, string>;
  accountId?: string;
  /** Legacy account IDs had no Host identity; verify before using them. */
  accountNeedsConfirmation?: true;
};
/** New-conversation defaults shared by all clients of the verified Host. */
export type MobileAgentDefaults = {
  harness?: RemoteProvider;
  runtimeMode?: RuntimeMode;
  agents?: Partial<Record<RemoteProvider, AgentDefaults>>;
};
type StoredDefaults = {
  version: 2;
  hosts: Record<string, MobileAgentDefaults>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
function parseDefaults(raw: unknown): MobileAgentDefaults {
  if (!isRecord(raw)) return {};
  const harness = REMOTE_PROVIDERS.find((value) => value === raw.harness);
  const runtimeMode = RUNTIME_MODES.find((value) => value === raw.runtimeMode);
  const agents: MobileAgentDefaults["agents"] = {};
  for (const provider of REMOTE_PROVIDERS) {
    const value = isRecord(raw.agents) ? raw.agents[provider] : undefined;
    if (!isRecord(value)) continue;
    agents[provider] = {
      ...(typeof value.model === "string" && value.model
        ? { model: value.model }
        : {}),
      ...(strings(value.modelSettings)
        ? { modelSettings: strings(value.modelSettings) }
        : {}),
      ...(ACCOUNT_AGENTS.some((agent) => agent === provider) &&
      typeof value.accountId === "string" &&
      value.accountId
        ? {
            accountId: value.accountId,
            ...(value.accountNeedsConfirmation === true
              ? { accountNeedsConfirmation: true as const }
              : {}),
          }
        : {}),
    };
  }
  return {
    ...(harness ? { harness } : {}),
    ...(runtimeMode ? { runtimeMode } : {}),
    agents,
  };
}
function read(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}
function write(value: StoredDefaults): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function hosts(raw: Record<string, unknown>): StoredDefaults["hosts"] {
  return raw.version === 2 && isRecord(raw.hosts)
    ? Object.fromEntries(
        Object.entries(raw.hosts).map(([id, value]) => [
          id,
          parseDefaults(value),
        ]),
      )
    : {};
}

/**
 * A paired connection: Host-shared preferences follow the Host identity, while
 * the phone's own fallback stays keyed by connection address (see
 * `migrateConnectionSettings`). A plain string serves as both.
 */
export type MobileDefaultsHost = string | { endpoint: string; environmentId?: string };
const sharedHostId = (host: MobileDefaultsHost) =>
  typeof host === "string" ? host : (host.environmentId ?? host.endpoint);
const localHostId = (host: MobileDefaultsHost) =>
  typeof host === "string" ? host : host.endpoint;

/** Call with a verified Host only. An unscoped legacy record is claimed once. */
export function loadMobileAgentDefaults(host?: MobileDefaultsHost): MobileAgentDefaults {
  if (!host) return {};
  const active = activePreferenceStore();
  if (active) {
    if (active.hostId !== sharedHostId(host)) return {};
    const shared = preferenceStorage.getItem(SHARED_KEY);
    // Until this Host shares defaults, keep the ones this phone already saved.
    const local = shared == null ? read() : undefined;
    if (local?.version === 2) {
      const saved = hosts(local);
      if (Object.prototype.hasOwnProperty.call(saved, localHostId(host)))
        return saved[localHostId(host)];
    }
    try { return parseDefaults(JSON.parse(shared ?? "{}")); }
    catch { return {}; }
  }
  const hostId = localHostId(host);
  const raw = read();
  if (raw.version === 2) {
    const saved = hosts(raw);
    return Object.prototype.hasOwnProperty.call(saved, hostId)
      ? saved[hostId]
      : {};
  }
  if (!Object.keys(raw).length) return {};
  const harness = REMOTE_PROVIDERS.find((value) => value === raw.harness);
  const agents: MobileAgentDefaults["agents"] = {};
  if (harness)
    agents[harness] = {
      ...(typeof raw.model === "string" ? { model: raw.model } : {}),
      ...(strings(raw.modelSettings)
        ? { modelSettings: strings(raw.modelSettings) }
        : {}),
    };
  const accounts = strings(raw.accounts);
  for (const agent of ACCOUNT_AGENTS) {
    const id = accounts?.[agent];
    if (id && id !== "default")
      agents[agent] = {
        ...agents[agent],
        accountId: id,
        accountNeedsConfirmation: true,
      };
  }
  const migrated = { ...(harness ? { harness } : {}), agents };
  // Do not reuse unscoped identities on several Hosts if storage is unavailable.
  return write({ version: 2, hosts: { [hostId]: migrated } }) ? migrated : {};
}
export function saveMobileAgentDefaults(
  host: MobileDefaultsHost,
  value: MobileAgentDefaults,
) {
  const active = activePreferenceStore();
  if (active) {
    if (active.hostId === sharedHostId(host)) preferenceStorage.setItem(SHARED_KEY, JSON.stringify(parseDefaults(value)));
    return;
  }
  write({
    version: 2,
    hosts: { ...hosts(read()), [localHostId(host)]: parseDefaults(value) },
  });
}

/** Project-specific desktop choices override global defaults for a new mobile draft. */
export function loadMobileProjectDefaults(host: MobileDefaultsHost | undefined, projectId: string): MobileAgentDefaults {
  const defaults = loadMobileAgentDefaults(host);
  const hostId = host && sharedHostId(host);
  if (!hostId || activePreferenceStore()?.hostId !== hostId) return defaults;
  const identity = `@project:${encodeURIComponent(hostId)}:${encodeURIComponent(projectId)}`;
  try {
    const project = JSON.parse(preferenceStorage.getItem("monocode.projectProviderSettings.v1") ?? "{}")[identity];
    const accounts = JSON.parse(preferenceStorage.getItem("monocode.providerAccountSelections.v1") ?? "{}")[identity];
    const agents = { ...defaults.agents };
    const harness = REMOTE_PROVIDERS.find(provider => provider === project?.defaultHarness) ?? defaults.harness;
    for (const provider of REMOTE_PROVIDERS) {
      const model = provider === project?.defaultHarness && typeof project?.defaultModel === "string"
        ? project.defaultModel : project?.models?.[provider];
      const accountId = accounts?.[provider];
      agents[provider] = { ...agents[provider], ...(typeof model === "string" ? { model } : {}),
        ...(typeof accountId === "string" ? { accountId } : {}) };
    }
    return { ...defaults, harness, agents };
  } catch { return defaults; }
}

/** Moves a record saved under an earlier key (the Host identity) to its connection address. */
export function moveMobileAgentDefaults(from: string, to: string) {
  const raw = read();
  if (raw.version !== 2) return;
  const saved = hosts(raw);
  if (!Object.prototype.hasOwnProperty.call(saved, from)) return;
  const { [from]: value, ...rest } = saved;
  write({
    version: 2,
    hosts: Object.prototype.hasOwnProperty.call(rest, to) ? rest : { ...rest, [to]: value },
  });
}

export function configurationForAgent(
  catalog: HostModelCatalog,
  defaults: MobileAgentDefaults,
  harness: RemoteProvider,
): MobileConfiguration | undefined {
  const models = catalog.models[harness];
  if (!models?.length) return undefined;
  const saved = defaults.agents?.[harness];
  return configurationForModel(
    findRemoteModel(models, saved?.model ?? "") ?? models[0],
    saved?.modelSettings,
    defaults.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  );
}
/** Resolve against the actual catalog without overwriting saved preferences. */
export function defaultConfiguration(
  catalog: HostModelCatalog,
  defaults: MobileAgentDefaults = {},
): MobileConfiguration | undefined {
  if (defaults.harness) {
    const preferred = configurationForAgent(
      catalog,
      defaults,
      defaults.harness,
    );
    if (preferred) return preferred;
  }
  for (const provider of REMOTE_PROVIDERS) {
    const configuration = configurationForAgent(catalog, defaults, provider);
    if (configuration) return configuration;
  }
}
export function withDefaultConfiguration(
  defaults: MobileAgentDefaults,
  next: MobileConfiguration,
): MobileAgentDefaults {
  return {
    ...defaults,
    harness: next.harness,
    agents: {
      ...defaults.agents,
      [next.harness]: {
        ...defaults.agents?.[next.harness],
        model: next.model,
        modelSettings: next.modelSettings,
      },
    },
  };
}
export function withDefaultAccount(
  defaults: MobileAgentDefaults,
  agent: RemoteProvider,
  accountId: string,
): MobileAgentDefaults {
  const { accountNeedsConfirmation: _pending, ...previous } =
    defaults.agents?.[agent] ?? {};
  return {
    ...defaults,
    agents: { ...defaults.agents, [agent]: { ...previous, accountId } },
  };
}
export function confirmLegacyAccounts(
  defaults: MobileAgentDefaults,
  accounts: HostProviderAccounts,
): MobileAgentDefaults {
  let next = defaults;
  for (const agent of ACCOUNT_AGENTS) {
    const saved = defaults.agents?.[agent];
    if (
      saved?.accountNeedsConfirmation &&
      accounts[agent]?.some((account) => account.id === saved.accountId)
    )
      next = withDefaultAccount(next, agent, saved.accountId!);
  }
  return next;
}
export function defaultProviderAccount(
  harness: RemoteProvider,
  defaults: MobileAgentDefaults,
): string | undefined {
  const id = defaults.agents?.[harness]?.accountId;
  return id &&
    id !== "default" &&
    ACCOUNT_AGENTS.some((agent) => agent === harness)
    ? id
    : undefined;
}
/** Keep removed and unverified selections visible so they cannot look like default logins. */
export function accountChoices(
  accounts: HostProviderAccounts | undefined,
  defaults: MobileAgentDefaults,
) {
  return ACCOUNT_AGENTS.flatMap((agent) =>
    accounts?.[agent]?.some(account => account.defaultAccountId || account.defaultError) ||
    (accounts?.[agent]?.length ?? 0) > 1 ||
    defaultProviderAccount(agent, defaults)
      ? [
          {
            agent,
            accounts: accounts?.[agent] ?? [
              { id: "default", label: "Default account" },
            ],
          },
        ]
      : [],
  );
}
