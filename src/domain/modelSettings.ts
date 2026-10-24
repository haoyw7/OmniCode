import type { AgentModel, ModelSetting } from "../contracts/session";

export function defaultModelSettings(
  model: AgentModel,
): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const setting of model.settings ?? []) {
    settings[setting.id] = setting.value;
  }
  return settings;
}

const EFFORT_SETTING_IDS = new Set([
  "effort",
  "reasoning",
  "reasoningEffort",
  // Pi and OMP expose their reasoning level as a `thinking` select.
  "thinking",
  // OpenCode exposes reasoning levels as `variant`; treat it as effort so the
  // standalone effort control and dedup behave like Codex/Cursor/Grok.
  "variant",
]);

export function isEffortSettingId(id: string): boolean {
  return EFFORT_SETTING_IDS.has(id);
}

export function modelEffortSetting(
  model: AgentModel,
): ModelSetting | undefined {
  return model.settings?.find(
    (setting) =>
      setting.kind === "select" && EFFORT_SETTING_IDS.has(setting.id),
  );
}

const SETTING_VALUE_ALIASES: Record<string, string> = {
  "extra-high": "xhigh",
  xhigh: "extra-high",
};

function compatibleSettingValue(
  setting: ModelSetting,
  value: string | undefined,
): string | undefined {
  if (value == null) return undefined;
  if (setting.options.some((option) => option.value === value)) return value;
  const alias = SETTING_VALUE_ALIASES[value];
  if (alias && setting.options.some((option) => option.value === alias)) {
    return alias;
  }
  return undefined;
}

/** Resolve model-declared defaults and compatible persisted selections. */
export function mergeDeclaredModelSettings(model: AgentModel, current?: Record<string, string>): Record<string, string> {
  const next = defaultModelSettings(model);
  if (!current) return next;
  for (const setting of model.settings ?? []) {
    const value = compatibleSettingValue(setting, current[setting.id]);
    if (value != null) next[setting.id] = value;
  }
  return next;
}
