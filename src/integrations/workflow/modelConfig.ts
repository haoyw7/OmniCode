// Resolves a workflow agent's runtime (provider, model, thinking, speed) into the
// harness, model id and model settings a Monocode session runs with.

import type { AgentModel, ModelSetting } from "../../features/sessions/model/models";
import { modelEffortSetting } from "../../features/sessions/model/models";
import type { HarnessId } from "../../features/sessions/model/session";
import type { WorkflowAgentRuntime } from "./createWorkflow";

export const WORKFLOW_HARNESSES: readonly HarnessId[] = [
  "claude", "codex", "cursor", "grok", "opencode", "pi", "omp", "fx", "hermes", "antigravity",
];

export function isWorkflowHarness(value: unknown): value is HarnessId {
  return typeof value === "string" && (WORKFLOW_HARNESSES as readonly string[]).includes(value);
}

/** Provider aliases accepted in scripts and control input. */
const HARNESS_ALIASES: Record<string, HarnessId> = {
  "claude-code": "claude",
  claudecode: "claude",
  "claude code": "claude",
  anthropic: "claude",
  openai: "codex",
  "oh-my-pi": "omp",
};

export function normalizeWorkflowHarness(value: string | undefined): HarnessId | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  if (isWorkflowHarness(key)) return key;
  return HARNESS_ALIASES[key];
}

/** Setting ids used when a provider catalog has not been loaded yet. */
const FALLBACK_THINKING_SETTING: Partial<Record<HarnessId, string>> = {
  claude: "effort",
  codex: "reasoningEffort",
  pi: "thinking",
  omp: "thinking",
  cursor: "thinking",
  opencode: "variant",
  grok: "effort",
  fx: "effort",
  antigravity: "effort",
};

const FALLBACK_SPEED_SETTING: Partial<Record<HarnessId, { id: string; kind: "toggle" | "select" }>> = {
  claude: { id: "fast", kind: "toggle" },
  codex: { id: "serviceTier", kind: "select" },
  omp: { id: "fast", kind: "toggle" },
  pi: { id: "fast", kind: "toggle" },
  cursor: { id: "fast", kind: "toggle" },
  fx: { id: "fast", kind: "toggle" },
};

/** The concrete session configuration a workflow agent runs with. */
export type WorkflowResolvedRuntime = {
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
};

/** Full Monocode model id (`harness:native`) for a script- or user-provided model. */
export function workflowModelId(harness: HarnessId, model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith(`${harness}:`) ? trimmed : `${harness}:${trimmed}`;
}

function speedSetting(harness: HarnessId, model: AgentModel | undefined): { id: string; kind: "toggle" | "select"; options?: ModelSetting["options"] } | undefined {
  const fromCatalog = model?.settings?.find((setting) => setting.id === "fast" || setting.id === "serviceTier");
  if (fromCatalog) return { id: fromCatalog.id, kind: fromCatalog.kind, options: fromCatalog.options };
  return model ? undefined : FALLBACK_SPEED_SETTING[harness];
}

/**
 * Apply `thinking` and `speed` to model settings. A level the model does not
 * offer is left out so the provider keeps its own default instead of failing.
 */
export function applyThinkingAndSpeed(
  harness: HarnessId,
  model: AgentModel | undefined,
  settings: Record<string, string>,
  thinking: string | undefined,
  speed: string | undefined,
): Record<string, string> {
  const next = { ...settings };
  if (thinking !== undefined) {
    const effort = model ? modelEffortSetting(model) : undefined;
    const id = effort?.id ?? (model ? undefined : FALLBACK_THINKING_SETTING[harness]);
    const level = thinking.trim().toLowerCase();
    if (id && (!effort || effort.options.some((option) => option.value === level))) next[id] = level;
  }
  if (speed !== undefined) {
    const setting = speedSetting(harness, model);
    const fast = speed.trim().toLowerCase() === "fast";
    if (setting?.kind === "toggle") next[setting.id] = fast ? "true" : "false";
    else if (setting) {
      const value = fast ? "fast" : speed.trim().toLowerCase() === "default" ? "default" : speed.trim();
      if (!setting.options || setting.options.some((option) => option.value === value)) next[setting.id] = value;
    }
  }
  return next;
}

/**
 * Layered resolution: per-agent override, then the script persona, then the run
 * defaults, then the launching session. Thinking and speed apply on top of the
 * settings inherited from the session only when the provider stays the same.
 */
export function resolveWorkflowRuntime(options: {
  layers: readonly (WorkflowAgentRuntime | undefined)[];
  session: WorkflowResolvedRuntime;
  catalog?: (harness: HarnessId) => readonly AgentModel[] | undefined;
  defaultModel?: (harness: HarnessId) => string | undefined;
}): WorkflowResolvedRuntime {
  const pick = <K extends keyof WorkflowAgentRuntime>(key: K) =>
    options.layers.find((layer) => layer?.[key] !== undefined)?.[key];
  const requested = pick("provider");
  const harness = normalizeWorkflowHarness(requested) ?? options.session.harness;
  if (requested !== undefined && normalizeWorkflowHarness(requested) === undefined)
    throw new Error(`Unknown workflow agent provider "${requested}". Use one of: ${WORKFLOW_HARNESSES.join(", ")}.`);
  const sameHarness = harness === options.session.harness;
  const requestedModel = pick("model");
  const model = requestedModel !== undefined
    ? workflowModelId(harness, requestedModel)
    : sameHarness ? options.session.model : options.defaultModel?.(harness) ?? `${harness}:default`;
  const catalogModel = options.catalog?.(harness)?.find((candidate) => candidate.id === model);
  const inherited = sameHarness && model === options.session.model ? options.session.modelSettings : {};
  const base = catalogModel ? { ...Object.fromEntries((catalogModel.settings ?? []).map((setting) => [setting.id, setting.value])), ...inherited } : { ...inherited };
  // Exact picker settings apply only to the layer's own provider and model.
  const exact = options.layers.find((layer) => layer?.modelSettings !== undefined && (layer.provider === undefined || normalizeWorkflowHarness(layer.provider) === harness));
  const picked = exact?.modelSettings ? { ...base, ...exact.modelSettings } : base;
  return { harness, model, modelSettings: applyThinkingAndSpeed(harness, catalogModel, picked, pick("thinking"), pick("speed")) };
}

/** Short label for a resolved runtime, e.g. "codex · gpt-5.5 · high · fast". */
export function describeWorkflowRuntime(runtime: WorkflowResolvedRuntime): string {
  const native = runtime.model.startsWith(`${runtime.harness}:`) ? runtime.model.slice(runtime.harness.length + 1) : runtime.model;
  const parts: string[] = [runtime.harness, native || "default"];
  for (const id of ["effort", "reasoningEffort", "thinking", "variant"]) {
    const value = runtime.modelSettings[id];
    if (value && value !== "false" && value !== "true") { parts.push(value); break; }
  }
  if (runtime.modelSettings.fast === "true" || runtime.modelSettings.serviceTier === "fast") parts.push("fast");
  return parts.join(" · ");
}
