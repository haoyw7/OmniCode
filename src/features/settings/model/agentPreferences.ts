import { activePreferenceStore, preferenceStorage } from "./sharedPreferences";
import { RUNTIME_MODES, type HarnessId, type RuntimeMode } from "../../sessions/model/session";

export type SharedAgentDefaults = {
  harness?: HarnessId;
  runtimeMode?: RuntimeMode;
  agents?: Partial<Record<HarnessId, { model?: string; modelSettings?: Record<string, string>; accountId?: string }>>;
};
export const AGENT_DEFAULTS_KEY = "monocode.agentDefaults";
export function loadSharedAgentDefaults(): SharedAgentDefaults {
  if (!activePreferenceStore()) return {};
  try {
    const value = JSON.parse(preferenceStorage.getItem(AGENT_DEFAULTS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    if (!RUNTIME_MODES.includes(value.runtimeMode)) delete value.runtimeMode;
    return value;
  } catch { return {}; }
}
export function updateSharedAgentDefault(harness: HarnessId, value: NonNullable<SharedAgentDefaults["agents"]>[HarnessId], select = false): void {
  if (!activePreferenceStore()) return;
  const defaults = loadSharedAgentDefaults();
  preferenceStorage.setItem(AGENT_DEFAULTS_KEY, JSON.stringify({ ...defaults,
    ...(select ? { harness } : {}), agents: { ...defaults.agents, [harness]: { ...defaults.agents?.[harness], ...value } } }));
}
/** Release import only. Keep the original values as recovery data. */
export function legacyAgentDefaults(read: (key: string) => string | null): string | null {
  try {
    const previous = read(AGENT_DEFAULTS_KEY);
    if (previous) return previous;
    const last = JSON.parse(read("monocode.lastModel") ?? "null");
    const models = JSON.parse(read("monocode.defaultModels") ?? "{}");
    const settings = JSON.parse(read("monocode.lastModelSettings") ?? "{}");
    const accounts = JSON.parse(read("monocode.providerAccountSelections.v1") ?? "{}")["~"] ?? {};
    const agents: Record<string, unknown> = {};
    for (const [harness, model] of Object.entries(models)) if (typeof model === "string") agents[harness] = { model, modelSettings: settings };
    if (last?.harness && last?.model) agents[last.harness] = { model: last.model, modelSettings: settings };
    for (const [harness, accountId] of Object.entries(accounts)) if (typeof accountId === "string") agents[harness] = { ...(agents[harness] as object ?? {}), accountId };
    return Object.keys(agents).length ? JSON.stringify({ ...(last?.harness ? { harness: last.harness } : {}), agents }) : null;
  } catch { return null; }
}
