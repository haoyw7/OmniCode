import { mergeDeclaredModelSettings, modelEffortSetting } from "../../../domain/modelSettings";
import { configureModelCatalog, lookupModel } from '../../../integrations/harness/core/modelCatalog';
import { LAST_SELECTED_MODEL, hydrateCachedModelCatalogs, defaultModelId, modelsFor, nativeModelId } from '../../../integrations/harness/core/modelCatalog';
import { type SessionModelSettings, type AgentModel, type ModelPickerTab, type LastModelChoice, type HarnessId, HARNESSES } from "../../../contracts/session";









import { loadSharedAgentDefaults, updateSharedAgentDefault } from "../../settings/model/agentPreferences";
import { preferenceStorage } from "../../settings/model/sharedPreferences";


import { loadProjectProviderSettings } from "./projectProviders";
import { hasProbedHarnessAvailability, isHarnessAvailable } from "../../providers/model/harnessAvailabilityState";

export function withSessionModelSettings(
  model: AgentModel,
  session?: SessionModelSettings,
  selectedModel = model.id,
): AgentModel {
  return session?.model === selectedModel ? { ...model, settings: session.settings } : model;
}

const FAVORITES_KEY = "omnicode.favoriteModels";
const HIDDEN_PICKER_PROVIDERS_KEY = "omnicode.hiddenPickerProviders";
const LAST_MODEL_KEY = "omnicode.lastModel";
const LAST_MODEL_SETTINGS_KEY = "omnicode.lastModelSettings";
const DEFAULT_MODELS_KEY = "omnicode.defaultModels";
const LAST_SELECTED_MODELS_KEY = "omnicode.lastSelectedModels";
const LAST_SELECTED_CHOICE_KEY = "omnicode.lastSelectedModelChoice";
const USE_LAST_SELECTION_KEY = "omnicode.useLastSelection";
const RECENT_MODELS_KEY = "omnicode.recentModels";
const RECENT_MODEL_LIMIT = 6;



export function mergeModelSettings(
  model: AgentModel,
  current?: Record<string, string>,
): Record<string, string> {
  if (modelsFor(model.harness).length === 0) return { ...current };
  return mergeDeclaredModelSettings(model, current);
}



/** True for the select setting ids that control reasoning effort. */


/** The select setting that controls reasoning effort for this model, if any. */


export function modelEffortLabel(
  model: AgentModel,
  values?: Record<string, string>,
): string | undefined {
  const setting = modelEffortSetting(model);
  if (!setting) return undefined;
  const value = values?.[setting.id] ?? setting.value;
  return (
    setting.options.find((option) => option.value === value)?.label ?? value
  );
}

/** Last chosen effort/fast/etc., applied to any model that supports those values. */
export function preferredModelSettings(
  model: AgentModel,
  current?: Record<string, string>,
): Record<string, string> {
  if (modelsFor(model.harness).length === 0) return { ...current };
  return mergeModelSettings(model, {
    ...current,
    ...loadLastModelSettings(),
    ...loadSharedAgentDefaults().agents?.[model.harness]?.modelSettings,
  });
}

export function loadLastModelSettings(): Record<string, string> {
  try {
    const raw = preferenceStorage.getItem(LAST_MODEL_SETTINGS_KEY);
    if (!raw) return {};
    return parseStringRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveLastModelSettings(
  settings: Record<string, string>,
  mode: "overwrite" | "fill" = "overwrite",
) {
  const prev = loadLastModelSettings();
  const incoming = parseStringRecord(settings);
  const next =
    mode === "fill" ? { ...incoming, ...prev } : { ...prev, ...incoming };
  try {
    preferenceStorage.setItem(LAST_MODEL_SETTINGS_KEY, JSON.stringify(next));
    const harness = loadLastModelChoice()?.harness;
    if (harness) updateSharedAgentDefault(harness, { modelSettings: next });
  } catch {
    // private mode / quota
  }
}

/** Compound launch id, e.g. `claude-opus-4-8[effort=high,fast=false]`. */
export function encodeModelLaunchId(
  modelId: string,
  settings?: Record<string, string>,
): string {
  const model = lookupModel(modelId);
  const native = nativeModelId(model ?? modelId);
  const defs = model?.settings ?? [];
  if (!native || defs.length === 0) return native;
  const parts = defs.map(
    (setting) => `${setting.id}=${settings?.[setting.id] ?? setting.value}`,
  );
  return `${native}[${parts.join(",")}]`;
}

export function loadFavoriteModels(): string[] {
  try {
    const raw = preferenceStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveFavoriteModels(ids: string[]) {
  try {
    preferenceStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // private mode / quota
  }
}

function isHarnessId(value: string): value is HarnessId {
  return HARNESSES.includes(value as HarnessId);
}

let pickerVisibilityVersion = 0;
const pickerVisibilityListeners = new Set<() => void>();

function emitPickerVisibility() {
  pickerVisibilityVersion += 1;
  for (const listener of pickerVisibilityListeners) listener();
}

export function subscribePickerVisibility(
  onStoreChange: () => void,
): () => void {
  pickerVisibilityListeners.add(onStoreChange);
  return () => {
    pickerVisibilityListeners.delete(onStoreChange);
  };
}

export function getPickerVisibilitySnapshot(): number {
  return pickerVisibilityVersion;
}

export function loadHiddenPickerProviders(): HarnessId[] {
  try {
    const raw = preferenceStorage.getItem(HIDDEN_PICKER_PROVIDERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is HarnessId => typeof id === "string" && isHarnessId(id),
    );
  } catch {
    return [];
  }
}

export function isPickerProviderVisible(id: HarnessId): boolean {
  return !loadHiddenPickerProviders().includes(id);
}

export function savePickerProviderVisible(id: HarnessId, visible: boolean) {
  const hidden = new Set(loadHiddenPickerProviders());
  if (visible) hidden.delete(id);
  else hidden.add(id);
  try {
    preferenceStorage.setItem(
      HIDDEN_PICKER_PROVIDERS_KEY,
      JSON.stringify([...hidden]),
    );
  } catch {
    // private mode / quota
  }
  emitPickerVisibility();
}

/**
 * Installed providers the user has not hidden appear as picker tabs.
 * Before the first probe we keep them visible so the tab strip does not
 * collapse to Favorites and then jump once CLIs are found.
 */
export function showProviderInModelPicker(
  id: HarnessId,
  installed: boolean,
  probed: boolean,
): boolean {
  if (!isPickerProviderVisible(id)) return false;
  return !probed || installed;
}

export function modelPickerTabs(
  available: (id: HarnessId) => boolean,
): ModelPickerTab[] {
  return ["favorites", ...HARNESSES.filter(available)];
}

export function coerceModelPickerTab(
  tab: ModelPickerTab,
  available: (id: HarnessId) => boolean,
): ModelPickerTab {
  const tabs = modelPickerTabs(available);
  return tabs.includes(tab) ? tab : "favorites";
}

export function stepModelPickerTab(
  tab: ModelPickerTab,
  delta: -1 | 1,
  available: (id: HarnessId) => boolean,
): ModelPickerTab {
  const tabs = modelPickerTabs(available);
  if (tabs.length === 0) return tab;
  const index = tabs.indexOf(tab);
  const from = index < 0 ? 0 : index;
  return tabs[(from + delta + tabs.length) % tabs.length] ?? tab;
}

export function loadDefaultModels(): Partial<Record<HarnessId, string>> {
  const shared = Object.fromEntries(Object.entries(loadSharedAgentDefaults().agents ?? {}).flatMap(([harness, value]) => isHarnessId(harness) && value?.model ? [[harness, value.model]] : []));
  try {
    const raw = preferenceStorage.getItem(DEFAULT_MODELS_KEY);
    if (!raw) return shared;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return shared;
    }
    const out: Partial<Record<HarnessId, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isHarnessId(key) && typeof value === "string" && value) {
        out[key] = value;
      }
    }
    return { ...out, ...shared };
  } catch {
    return shared;
  }
}

export function saveDefaultModel(harness: HarnessId, model: string) {
  updateSharedAgentDefault(harness, { model });
  const next = { ...loadDefaultModels(), [harness]: model };
  try {
    preferenceStorage.setItem(DEFAULT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

/** User-picked model for a provider, else the catalog default. */
export function preferredModelId(harness: HarnessId): string {
  const saved = loadDefaultModels()[harness];
  if (saved) return resolveDefaultModelId(harness, saved);
  const last = loadLastModelChoice();
  if (last?.harness === harness) return resolveDefaultModelId(harness, last.model);
  return defaultModelId(harness);
}

function loadLastSelectedModels(): Record<string, string> {
  try {
    return parseStringRecord(JSON.parse(preferenceStorage.getItem(LAST_SELECTED_MODELS_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function lastSelectedModelId(harness: HarnessId): string | undefined {
  const model = loadLastSelectedModels()[harness];
  return model && model !== LAST_SELECTED_MODEL ? model : undefined;
}

export function loadUseLastSelection(): boolean {
  return preferenceStorage.getItem(USE_LAST_SELECTION_KEY) === "1";
}

export function saveUseLastSelection(value: boolean): void {
  preferenceStorage.setItem(USE_LAST_SELECTION_KEY, value ? "1" : "0");
}

export function loadLastSelectedModelChoice(): LastModelChoice | null {
  try {
    const value = JSON.parse(preferenceStorage.getItem(LAST_SELECTED_CHOICE_KEY) ?? "null");
    return value && isHarnessId(value.harness) && typeof value.model === "string" && value.model
      ? { harness: value.harness, model: value.model }
      : null;
  } catch {
    return null;
  }
}

/** Record explicit composer picks separately from recently submitted models. */
export function saveLastSelectedModel(harness: HarnessId, model: string): void {
  if (!model || model === LAST_SELECTED_MODEL) return;
  const previous = loadLastSelectedModels();
  const last = loadLastSelectedModelChoice();
  try {
    if (last?.harness !== harness || last.model !== model) {
      preferenceStorage.setItem(LAST_SELECTED_CHOICE_KEY, JSON.stringify({ harness, model }));
    }
    if (previous[harness] !== model) {
      preferenceStorage.setItem(
        LAST_SELECTED_MODELS_KEY,
        JSON.stringify({ ...previous, [harness]: model }),
      );
    }
  } catch {
    // private mode / quota
  }
}

/** Resolve the preference before a session or provider receives a model ID. */
export function resolveDefaultModelId(harness: HarnessId, model: string): string {
  return model === LAST_SELECTED_MODEL
    ? lastSelectedModelId(harness) ?? defaultModelId(harness)
    : model;
}

/**
 * `preferred` unless the project hides it, in which case the first provider the
 * project still allows. Falls back to `preferred` when a project has hidden
 * everything, so a conversation always has a provider.
 */
export function firstEnabledHarness(
  cwd: string | undefined,
  preferred: HarnessId,
): HarnessId {
  const hidden = new Set(loadProjectProviderSettings(cwd).hidden ?? []);
  const enabled = (id: HarnessId) =>
    !hidden.has(id) &&
    showProviderInModelPicker(
      id,
      isHarnessAvailable(id),
      hasProbedHarnessAvailability(),
    );
  if (enabled(preferred)) return preferred;
  return HARNESSES.find(enabled) ?? preferred;
}

/** Provider + model new conversations should start with. */
export function defaultSessionChoice(cwd?: string): LastModelChoice {
  const project = loadProjectProviderSettings(cwd);
  const selected = loadUseLastSelection() ? loadLastSelectedModelChoice() : null;
  const last = selected ?? loadLastModelChoice();
  const harness = firstEnabledHarness(
    cwd,
    project.defaultHarness ?? last?.harness ?? "cursor",
  );
  const model =
    project.models?.[harness] ??
    (project.defaultHarness === harness ? project.defaultModel : undefined) ??
    (selected?.harness === harness ? selected.model : undefined) ??
    preferredModelId(harness);
  return { harness, model: resolveDefaultModelId(harness, model) };
}

export function loadLastModelChoice(): LastModelChoice | null {
  const shared = loadSharedAgentDefaults();
  if (shared.harness && isHarnessId(shared.harness) && shared.agents?.[shared.harness]?.model) return { harness: shared.harness, model: shared.agents[shared.harness]!.model! };
  try {
    const raw = preferenceStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      "harness" in parsed &&
      "model" in parsed &&
      typeof (parsed as LastModelChoice).harness === "string" &&
      typeof (parsed as LastModelChoice).model === "string" &&
      isHarnessId((parsed as LastModelChoice).harness)
    ) {
      return parsed as LastModelChoice;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastModelChoice(harness: HarnessId, model: string) {
  saveDefaultModel(harness, model);
  updateSharedAgentDefault(harness, { model }, true);
  try {
    preferenceStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ harness, model }));
  } catch {
    // private mode / quota
  }
}

export function loadRecentModelChoices(): LastModelChoice[] {
  try {
    const raw = preferenceStorage.getItem(RECENT_MODELS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const choices: LastModelChoice[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item == null ||
        !("harness" in item) ||
        !("model" in item) ||
        typeof (item as LastModelChoice).harness !== "string" ||
        typeof (item as LastModelChoice).model !== "string" ||
        !isHarnessId((item as LastModelChoice).harness)
      ) {
        continue;
      }
      const choice = item as LastModelChoice;
      const key = `${choice.harness}\0${choice.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      choices.push(choice);
      if (choices.length === RECENT_MODEL_LIMIT) break;
    }
    return choices;
  } catch {
    return [];
  }
}

export function saveRecentModelChoice(
  harness: HarnessId,
  model: string,
): LastModelChoice[] {
  const next = [
    { harness, model },
    ...loadRecentModelChoices().filter(
      (choice) => choice.harness !== harness || choice.model !== model,
    ),
  ].slice(0, RECENT_MODEL_LIMIT);
  try {
    preferenceStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  return next;
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Cursor CLI uses `extra-high`; Claude uses `xhigh`. */




configureModelCatalog({
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  },
  selectedModel: lastSelectedModelId,
});
hydrateCachedModelCatalogs();
