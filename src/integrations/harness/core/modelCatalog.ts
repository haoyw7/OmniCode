import type { AgentModel, HarnessId } from '../../../contracts/session';
import { HARNESSES } from '../../../contracts/session';
import { parseDeepseekModelRoute } from '../../../domain/modelRoute';


export const MODELS: AgentModel[] = [
  {
    id: "claude:sonnet-5",
    harness: "claude",
    name: "Claude Sonnet 5",
    nativeId: "claude-sonnet-5",
  },
  {
    id: "claude:opus-5",
    harness: "claude",
    name: "Claude Opus 5",
    nativeId: "claude-opus-5",
  },
  {
    id: "claude:opus-5-5",
    harness: "claude",
    name: "Claude Opus 5.5",
    nativeId: "claude-opus-5-5",
  },
  {
    id: "claude:fable-5",
    harness: "claude",
    name: "Claude Fable 5",
    nativeId: "claude-fable-5",
  },
  {
    id: "claude:opus-4.6",
    harness: "claude",
    name: "Opus 4.6",
    nativeId: "claude-opus-4-6",
  },
  {
    id: "claude:sonnet-4.6",
    harness: "claude",
    name: "Sonnet 4.6",
    nativeId: "claude-sonnet-4-6",
  },
  {
    id: "claude:haiku-4.5",
    harness: "claude",
    name: "Haiku 4.5",
    nativeId: "claude-haiku-4-5",
  },
  {
    id: "claude:opus-4.5",
    harness: "claude",
    name: "Opus 4.5",
    nativeId: "claude-opus-4-5",
  },

  {
    id: "cursor:composer-2.5",
    harness: "cursor",
    name: "Composer 2.5",
    nativeId: "composer-2.5",
  },
  {
    id: "cursor:gpt-5.4",
    harness: "cursor",
    name: "GPT-5.4",
    nativeId: "gpt-5.4",
  },
  {
    id: "cursor:claude-sonnet-4-6",
    harness: "cursor",
    name: "Sonnet 4.6",
    nativeId: "claude-sonnet-4-6",
  },
  {
    id: "cursor:grok-4.6",
    harness: "cursor",
    name: "Cursor Grok 4.6",
    nativeId: "grok-4.6",
  },

  {
    id: "grok:grok-4.6",
    harness: "grok",
    name: "Grok 4.6",
    nativeId: "grok-4.6",
    contextWindow: 500_000,
    settings: [
      {
        id: "effort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "xhigh", label: "Extra High" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ],
  },
  {
    id: "grok:grok-4.5",
    harness: "grok",
    name: "Grok 4.5",
    nativeId: "grok-4.5",
    contextWindow: 500_000,
    settings: [
      {
        id: "effort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ],
  },

  { id: "opencode:glm-5", harness: "opencode", name: "GLM 5" },
  { id: "opencode:minimax-m2.5", harness: "opencode", name: "MiniMax M2.5" },
  { id: "opencode:kimi-k2.5", harness: "opencode", name: "Kimi K2.5" },
  {
    id: "opencode:deepseek-v4-flash",
    harness: "opencode",
    name: "DeepSeek V4 Flash",
  },
  { id: "opencode:qwen-3.5", harness: "opencode", name: "Qwen 3.5" },
  { id: "opencode:grok-4.5", harness: "opencode", name: "Grok 4.5" },
  {
    id: "opencode:claude-sonnet-4.6",
    harness: "opencode",
    name: "Claude Sonnet 4.6",
  },
  { id: "opencode:gpt-5.4", harness: "opencode", name: "GPT-5.4" },
  {
    id: "pi:default",
    harness: "pi",
    name: "Default",
    nativeId: "",
  },
  {
    id: "omp:default",
    harness: "omp",
    name: "Default",
    nativeId: "",
  },
  {
    id: "fx:zai/glm-5.2-fast",
    harness: "fx",
    name: "GLM 5.2 Fast",
    nativeId: "zai/glm-5.2-fast",
  },
  {
    id: "hermes:default",
    harness: "hermes",
    name: "Configured model",
    nativeId: "",
  },
  {
    id: "antigravity:gemini-3.8-flash-high",
    harness: "antigravity",
    name: "Gemini 3.8 Flash (High)",
    nativeId: "gemini-3.8-flash-high",
  },
];


export const DEFAULT_MODEL_ID: Record<HarnessId, string> = {
  deepseek: "",
  workbuddy: "workbuddy:cn:auto",
  claude: "claude:sonnet-5",
  codex: "",
  cursor: "cursor:composer-2.5",
  grok: "grok:grok-4.6",
  opencode: "opencode:glm-5",
  pi: "pi:default",
  omp: "omp:default",
  fx: "fx:zai/glm-5.2-fast",
  hermes: "hermes:default",
  antigravity: "antigravity:gemini-3.8-flash-high",
};

const LIVE_CATALOGS_KEY = "omnicode.liveModelCatalogs";


/** A default-model preference, never a provider model ID. */
export const LAST_SELECTED_MODEL = "omnicode:last-selected-model";


const HARNESS_ORDER: HarnessId[] = [
  "workbuddy",
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
  "deepseek",
];


const EMPTY_MODELS: AgentModel[] = [];


let overlays: Partial<Record<HarnessId, AgentModel[]>> = {};

let overlayDefaults: Partial<Record<HarnessId, string>> = {};

const freshCatalogs = new Set<HarnessId>();

const loadingCatalogs = new Map<HarnessId, number>();

let catalogVersion = 0;

const listeners = new Set<() => void>();


function emit() {
  catalogVersion += 1;
  baseByHarness = null;
  indexById = null;
  allCache = null;
  for (const listener of listeners) listener();
}


export function subscribeModels(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}


export function getModelSnapshot(): number {
  return catalogVersion;
}


export function setHarnessModels(harness: HarnessId, models: AgentModel[]) {
  if (models.length === 0) return;
  applyOverlay(harness, models);
  freshCatalogs.add(harness);
  persistCatalogs();
  emit();
}


function applyOverlay(harness: HarnessId, models: AgentModel[]) {
  overlays = { ...overlays, [harness]: models };
  overlayDefaults = {
    ...overlayDefaults,
    [harness]: pickDefaultId(harness, models),
  };
}


/** True after a live CLI catalog, fresh or cached, replaced the fallback list. */
export function hasLiveCatalog(harness: HarnessId): boolean {
  return overlays[harness] != null;
}


/**
 * True once this run has loaded the harness catalog itself. A catalog cached
 * by an earlier run still shows at once, but is re-read in the background.
 */
export function hasFreshCatalog(harness: HarnessId): boolean {
  return freshCatalogs.has(harness as HarnessId);
}


/** True while a catalog read for this harness is in flight. */
export function isCatalogLoading(harness: HarnessId): boolean {
  return (loadingCatalogs.get(harness) ?? 0) > 0;
}


/** Bracket one catalog read; overlapping reads keep the flag until the last. */
export function beginCatalogLoad(harness: HarnessId): () => void {
  const wasLoading = isCatalogLoading(harness);
  loadingCatalogs.set(harness, (loadingCatalogs.get(harness) ?? 0) + 1);
  if (!wasLoading) emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (loadingCatalogs.get(harness) ?? 1) - 1;
    if (left > 0) loadingCatalogs.set(harness, left);
    else loadingCatalogs.delete(harness);
    if (left <= 0) emit();
  };
}


/** Catalog rows a harness may hold; drops anything malformed or misfiled. */
export function validCatalogModels(
  harness: HarnessId,
  models: unknown[],
): AgentModel[] {
  return models.filter(
    (model): model is AgentModel =>
      !!model &&
      typeof model === "object" &&
      typeof (model as AgentModel).id === "string" &&
      typeof (model as AgentModel).name === "string" &&
      (model as AgentModel).harness === harness,
  );
}


function persistCatalogs() {
  try {
    catalogOptions.storage?.setItem(LIVE_CATALOGS_KEY, JSON.stringify(overlays));
  } catch {
    // private mode / quota
  }
}


/**
 * Restore the catalogs the previous run discovered, so a new session shows
 * real models immediately instead of waiting for each CLI to start.
 */
export function hydrateCachedModelCatalogs() {
  let parsed: unknown;
  try {
    const raw = catalogOptions.storage?.getItem(LIVE_CATALOGS_KEY);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  let restored = false;
  for (const [harness, models] of Object.entries(parsed)) {
    // A catalog this run already loaded is newer than the cache.
    if (!HARNESSES.includes(harness as HarnessId) || freshCatalogs.has(harness as HarnessId)) continue;
    if (!Array.isArray(models)) continue;
    const valid = validCatalogModels(harness as HarnessId, models);
    if (valid.length === 0) continue;
    applyOverlay(harness as HarnessId, valid);
    restored = true;
  }
  if (restored) emit();
}


/** Test seam. */
export function resetHarnessModelOverlays() {
  overlays = {};
  overlayDefaults = {};
  freshCatalogs.clear();
  loadingCatalogs.clear();
  try {
    catalogOptions.storage?.removeItem(LIVE_CATALOGS_KEY);
  } catch {
    // private mode / unavailable
  }
  emit();
}


export function defaultModelId(harness: HarnessId): string {
  return overlayDefaults[harness] ?? DEFAULT_MODEL_ID[harness];
}


// `modelsFor`/`findModel` sit in render bodies (every session card, every
// provider row, the picker itself), so they must not rebuild the catalog on
// each call. These caches are dropped in `emit()` whenever an overlay lands.
let baseByHarness: Partial<Record<HarnessId, AgentModel[]>> | null = null;

let allCache: AgentModel[] | null = null;

let indexById: Map<string, AgentModel> | null = null;


function baseModelsFor(harness: HarnessId): AgentModel[] {
  if (!baseByHarness) {
    const grouped: Partial<Record<HarnessId, AgentModel[]>> = {};
    for (const model of MODELS) {
      (grouped[model.harness] ??= []).push(model);
    }
    baseByHarness = grouped;
  }
  return baseByHarness[harness] ?? EMPTY_MODELS;
}


export function modelsFor(harness: HarnessId): AgentModel[] {
  return overlays[harness] ?? baseModelsFor(harness);
}


export function allModels(): AgentModel[] {
  return (allCache ??= HARNESS_ORDER.flatMap(modelsFor));
}


export function findModel(id: string): AgentModel | undefined {
  if (!indexById) {
    const index = new Map<string, AgentModel>();
    // First writer wins, matching the previous `allModels().find(...)` order.
    for (const model of allModels()) {
      if (!index.has(model.id)) index.set(model.id, model);
    }
    indexById = index;
  }
  return indexById.get(id);
}


/** The bundled list never changes, so index it once for `lookupModel`. */
const bundledById = new Map(MODELS.map((model) => [model.id, model]));


/**
 * Catalog entry for a saved model id, live list first and bundled list second.
 *
 * A live overlay replaces the bundled list rather than adding to it, so a
 * model the CLI stops advertising misses `findModel` entirely. Falling back to
 * the bundle keeps the full native id (`claude:opus-5-5` → `claude-opus-5-5`)
 * instead of re-deriving one from the key, which strips the provider prefix
 * and hands the CLI an id it rejects.
 */
export function lookupModel(id: string): AgentModel | undefined {
  return findModel(id) ?? bundledById.get(id);
}


/** A readable saved selection while its execution Host's catalog is unavailable. */
export function fallbackModelName(harness: HarnessId, id: string): string {
  if (harness === "deepseek") {
    const route = parseDeepseekModelRoute(id);
    if (route) return route[1];
  }
  return id.replace(/^[a-z]+:/, "");
}


export function resolveModel(harness: HarnessId, id?: string): AgentModel {
  if (id === LAST_SELECTED_MODEL) id = catalogOptions.selectedModel?.(harness) ?? defaultModelId(harness);
  const available = modelsFor(harness);
  if (id) {
    const exact = findModel(id);
    if (exact && exact.harness === harness) return exact;
    if (harness === "deepseek") {
      const route = parseDeepseekModelRoute(id);
      if (route) {
        const nativeId = id.replace(/^deepseek:/, "");
        return available.find(model => model.nativeId === nativeId) ?? {
          id, harness, nativeId, name: route[1],
          provider: { id: route[0], name: route[0] },
        };
      }
    }
    const slug = nativeIdFrom(id);
    const byNative = available.find(
      (model) => (model.nativeId ?? nativeIdFrom(model.id)) === slug,
    );
    if (byNative) return byNative;
    // Keep moving Claude aliases as aliases until the CLI advertises them.
    if (harness === "claude" && /^(opus|sonnet|haiku)$/.test(slug)) {
      return {
        id: `claude:${slug}`,
        harness,
        name: `Claude ${slug.charAt(0).toUpperCase()}${slug.slice(1)}`,
        nativeId: slug,
      };
    }
    // A versioned id may differ only by Claude's provider prefix. Do not
    // resolve it to a moving alias or another version via a prefix match.
    const comparableSlug = comparableNativeId(harness, slug);
    const hits = available.filter((model) => {
      const native = model.nativeId ?? nativeIdFrom(model.id);
      const comparableNative = comparableNativeId(harness, native);
      return (
        comparableNative.startsWith(comparableSlug) ||
        comparableSlug.startsWith(comparableNative)
      );
    });
    if (/\d/.test(comparableSlug)) {
      const same = hits.find(
        (model) =>
          comparableNativeId(
            harness,
            model.nativeId ?? nativeIdFrom(model.id),
          ) === comparableSlug,
      );
      if (same) return same;
      if (
        harness !== "claude" &&
        hits.length === 1 &&
        !/\d/.test(
          comparableNativeId(
            harness,
            hits[0].nativeId ?? nativeIdFrom(hits[0].id),
          ),
        )
      )
        return hits[0];
    } else if (hits.length === 1) {
      return hits[0];
    } else if (hits.length > 0) {
      return hits[0];
    }
    const bundled = bundledById.get(id);
    if (bundled && bundled.harness === harness) return bundled;

    // A saved concrete Claude version may be absent from both catalogs.
    // Keep the requested id so a new session does not silently switch models.
    const requested = id.trim();
    if (harness === "claude" && /^claude:[a-z][a-z0-9-]*-\d/.test(requested)) {
      const nativeId = nativeIdForUnknownKey(requested);
      return { id: requested, harness, name: nativeId, nativeId };
    }
  }
  // Codex has no built-in catalog. During startup, retain the saved model
  // until discovery finishes instead of borrowing another provider's model.
  if (available.length === 0) {
    const requested = id?.trim() ?? "";
    const modelId =
      requested &&
      (!requested.includes(":") || requested.startsWith(`${harness}:`))
        ? requested
        : "";
    const nativeId = nativeIdFrom(modelId);
    return {
      id: modelId,
      harness,
      name: nativeId
        ? nativeId
            .replace(/^gpt/i, "GPT")
            .replace(
              /-([a-z])/g,
              (_, letter: string) => `-${letter.toUpperCase()}`,
            )
        : harness.charAt(0).toUpperCase() + harness.slice(1),
      nativeId,
    };
  }
  const fallbackId = defaultModelId(harness);
  return (fallbackId ? findModel(fallbackId) : undefined) ?? available[0];
}


/** Catalog-reported context window for a model id, when known. */
export function modelContextWindow(id: string): number | undefined {
  const window = findModel(id)?.contextWindow;
  return window && window > 0 ? window : undefined;
}


export function nativeModelId(model: AgentModel | string): string {
  if (typeof model !== "string") {
    return claudeNativeId(
      model.harness,
      model.nativeId ?? nativeIdFrom(model.id),
    );
  }
  const found = lookupModel(model);
  if (found) {
    return claudeNativeId(
      found.harness,
      found.nativeId ?? nativeIdFrom(found.id),
    );
  }
  return nativeIdForUnknownKey(model);
}


/**
 * Last-resort native id for a saved key no catalog knows.
 *
 * Every concrete Claude model is `claude-` plus a digit-bearing slug
 * (`claude:opus-5-5` → `claude-opus-5-5`); only family aliases (`opus`,
 * `sonnet`) reach the CLI bare. Reconstructing from that convention keeps the
 * provider prefix instead of emitting `opus-5-5`, which the CLI rejects.
 */
function nativeIdForUnknownKey(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("deepseek:") && parseDeepseekModelRoute(trimmed))
    return trimmed.slice("deepseek:".length);
  const slug = nativeIdFrom(trimmed);
  const colon = trimmed.indexOf(":");
  const harness = colon >= 0 ? trimmed.slice(0, colon).toLowerCase() : "";
  // Picker keys can use dotted versions (`opus-4.8`), while Claude's CLI
  // expects hyphenated native ids (`claude-opus-4-8`).
  return harness === "claude"
    ? claudeNativeId("claude", slug.replace(/\.(?=\d)/g, "-"))
    : slug;
}


/**
 * Claude's CLI rejects digit-bearing slugs without the `claude-` prefix
 * (`opus-5-5` is invalid; `claude-opus-5-5` and the alias `opus` both work).
 * Live `list_models` can still advertise the short form as `value`.
 */
function claudeNativeId(harness: HarnessId, native: string): string {
  if (harness !== "claude" || !native || native.startsWith("claude-")) {
    return native;
  }
  return /\d/.test(native) ? `claude-${native}` : native;
}


function nativeIdFrom(id: string): string {
  const trimmed = id.trim();
  const colon = trimmed.indexOf(":");
  const slug = colon >= 0 ? trimmed.slice(colon + 1) : trimmed;
  const bracket = slug.indexOf("[");
  return bracket >= 0 ? slug.slice(0, bracket) : slug;
}


/** Match Claude ids with and without the provider prefix. */
function comparableNativeId(harness: HarnessId, id: string): string {
  return harness === "claude" ? id.replace(/^claude-/, "") : id;
}


function pickDefaultId(harness: HarnessId, models: AgentModel[]): string {
  if (harness === "claude") {
    return (
      models.find((model) => model.nativeId === "claude-sonnet-5")?.id ??
      models.find((model) => model.nativeId === "sonnet")?.id ??
      models.find((model) => model.id === DEFAULT_MODEL_ID.claude)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.claude
    );
  }
  if (harness === "cursor") {
    return (
      models.find((model) => model.nativeId === "composer-2.5")?.id ??
      models.find(
        (model) => model.nativeId === "default" || model.nativeId === "auto",
      )?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.cursor
    );
  }
  if (harness === "codex") {
    return models[0]?.id ?? "";
  }
  if (harness === "grok") {
    return (
      models.find((model) => model.nativeId === "grok-4.6")?.id ??
      models.find((model) => model.id === DEFAULT_MODEL_ID.grok)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.grok
    );
  }
  if (harness === "fx") {
    const preferred = [
      "zai/glm-5.2-fast",
      "zai/glm-5.2",
      "zai/glm-4.7-flash",
      "zai/glm-4.7",
      "openai/gpt-5.2",
    ];
    for (const nativeId of preferred) {
      const hit = models.find((model) => model.nativeId === nativeId);
      if (hit) return hit.id;
    }
    return (
      models.find((model) => model.id === DEFAULT_MODEL_ID.fx)?.id ??
      models[0]?.id ??
      DEFAULT_MODEL_ID.fx
    );
  }
  return (
    models.find((model) => model.id === DEFAULT_MODEL_ID[harness])?.id ??
    models[0]?.id ??
    DEFAULT_MODEL_ID[harness]
  );
}
export type ModelCatalogStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
let catalogOptions: { storage?: ModelCatalogStorage; selectedModel?: (harness: HarnessId) => string | undefined } = {};

/** Runtime composition chooses persistence and optional client selection semantics. */
export function configureModelCatalog(options: typeof catalogOptions): void {
  catalogOptions = options;
}
