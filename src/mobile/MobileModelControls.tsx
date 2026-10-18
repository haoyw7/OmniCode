import { MobileSpinner } from "./MobileSpinner";
import { sessionComposerConfiguration } from "../features/sessions/model/composerConfiguration";
import { useLayoutEffect, useState, type RefObject } from "react";
import {
  Check,
  ChevronRight,
  Gauge,
  SlidersHorizontal,
  Sparkles,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import {
  HARNESS_TITLE,
  type RuntimeMode,
} from "../features/sessions/model/session";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { modelGroups } from "../features/sessions/model/modelGroups";
import {
  isEffortSettingId,
  type AgentModel,
  type ModelSetting,
} from "../features/sessions/model/models";
import {
  remoteModelControls,
  carryModelSettings,
} from "../features/connections/model/remoteModels";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
  type HostModelCatalog,
  type HostSession,
} from "../features/connections/model/protocol";

export type MobileConfiguration = {
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
};
export function configurationForModel(
  model: AgentModel,
  values: Record<string, string> = {},
  runtimeMode: RuntimeMode = "supervised",
): MobileConfiguration {
  return {
    harness: model.harness as RemoteProvider,
    model: model.id,
    modelSettings: carryModelSettings(model.settings ?? [], values),
    runtimeMode,
  };
}
export function configurationForSession(
  snapshot: HostSession,
): MobileConfiguration {
  const { harness, model, modelSettings, runtimeMode } = sessionComposerConfiguration(snapshot.session);
  return {
    harness: harness as RemoteProvider,
    model,
    modelSettings,
    runtimeMode,
  };
}
/** Display names for a configuration's model and reasoning effort. */
export function configurationLabels(
  catalog: HostModelCatalog | undefined,
  configuration: MobileConfiguration,
  lockedModel?: string,
): { modelName: string; effort?: string } {
  const controls = remoteModelControls(
    catalog,
    configuration.harness,
    configuration.model,
    configuration.modelSettings,
    lockedModel,
  );
  const reasoning = controls.settings.find((setting) =>
    isEffortSettingId(setting.id),
  );
  const effort = reasoning?.options.find(
    (option) =>
      option.value ===
      (configuration.modelSettings[reasoning.id] ?? reasoning.value),
  )?.label;
  const modelName =
    (controls.model?.name ??
      (configuration.model.split(":").slice(1).join(":") ||
        configuration.model)) ||
    HARNESS_TITLE[configuration.harness];
  return { modelName, effort };
}
function modelSettingTitle(setting: ModelSetting): string {
  if (isEffortSettingId(setting.id)) return "Reasoning effort";
  return setting.id === "serviceTier" ? "Speed" : setting.label;
}
export function MobileModelControls({
  open = true,
  catalog,
  loading = false,
  configuration,
  lockedAgent,
  allowHandoff = false,
  disabled,
  onChange,
  onClose,
  anchor,
  preserveFocus,
  agentConfiguration,
}: {
  open?: boolean;
  catalog?: HostModelCatalog;
  loading?: boolean;
  configuration: MobileConfiguration;
  lockedAgent: boolean;
  /** Let an existing session change agents through a host handoff. */
  allowHandoff?: boolean;
  disabled: boolean;
  onChange: (configuration: MobileConfiguration) => void;
  onClose: () => void;
  anchor?: RefObject<HTMLElement | null>;
  preserveFocus?: RefObject<HTMLElement | null>;
  agentConfiguration?: (provider: RemoteProvider) => MobileConfiguration | undefined;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<
    "settings" | "models" | "agents" | "setting"
  >("settings");
  const [settingId, setSettingId] = useState<string>();
  useLayoutEffect(() => {
    if (open) {
      setPage("settings");
      setSettingId(undefined);
    }
  }, [open]);
  const models = catalog?.models[configuration.harness] ?? [];
  const groups = modelGroups(models);
  const controls = remoteModelControls(
    catalog,
    configuration.harness,
    configuration.model,
    configuration.modelSettings,
    lockedAgent ? configuration.model : undefined,
  );
  const settings = [...controls.settings].sort(
    (a, b) => Number(isEffortSettingId(b.id)) - Number(isEffortSettingId(a.id)),
  );
  const agentLocked = lockedAgent && !allowHandoff;
  const selectedSetting = settings.find((setting) => setting.id === settingId);
  const rowIndicator = loading ? (
    <MobileSpinner size={20} className="mobile-spin" role="status" aria-label={t("Loading…")} />
  ) : <ChevronRight size={20} />;
  const providers = REMOTE_PROVIDERS.filter(
    (provider) =>
      catalog?.models[provider] ||
      catalog?.errors[provider] ||
      provider === configuration.harness,
  );
  // Return to the overview so several settings can be adjusted in one visit.
  const choose = (next: MobileConfiguration) => {
    onChange(next);
    setPage("settings");
  };
  return (
    <MobileSheet
      open={open}
      placement={anchor ? "anchor" : "bottom"}
      anchor={anchor}
      preserveFocus={preserveFocus}
      width={SHEET_WIDTH.settings}
      align="end"
      title={
        page === "models"
          ? "Model"
          : page === "agents"
            ? "Agent"
            : page === "setting" && selectedSetting
              ? modelSettingTitle(selectedSetting)
              : "Model and reasoning"
      }
      onClose={onClose}
      onBack={page === "settings" ? undefined : () => setPage("settings")}
    >
      {() =>
        page === "settings" ? (
          <div className="mobile-model-options">
            <div>
              <button
                type="button"
                className="mobile-sheet-row"
                disabled={disabled || agentLocked || loading}
                aria-busy={loading || undefined}
                onClick={() => setPage("agents")}
              >
                <HarnessIcon harness={configuration.harness} />
                <span className="mobile-sheet-row-text mobile-sheet-row-inline">
                  <strong>{t("Agent")}</strong>
                  <small>{HARNESS_TITLE[configuration.harness]}</small>
                </span>
                {rowIndicator}
              </button>
              <button
                type="button"
                className="mobile-sheet-row"
                disabled={disabled || loading || !models.length}
                aria-busy={loading || undefined}
                onClick={() => setPage("models")}
              >
                <Sparkles size={20} />
                <span className="mobile-sheet-row-text mobile-sheet-row-inline">
                  <strong>{t("Model")}</strong>
                  <small>
                    {(controls.model?.name ?? configuration.model) ||
                      t(loading ? "Loading…" : "No models available")}
                  </small>
                </span>
                {rowIndicator}
              </button>
              {!settings.some((setting) => isEffortSettingId(setting.id)) && (
                <button
                  type="button"
                  className="mobile-sheet-row"
                  disabled
                  aria-busy={loading || undefined}
                >
                  <SlidersHorizontal size={20} />
                  <span className="mobile-sheet-row-text mobile-sheet-row-inline">
                    <strong>{t("Reasoning effort")}</strong>
                    <small>{t(loading ? "Loading…" : "Unavailable")}</small>
                  </span>
                  {rowIndicator}
                </button>
              )}
              {settings.map((setting) => {
                const value =
                  configuration.modelSettings[setting.id] ?? setting.value;
                const current = setting.options.find(
                  (option) => option.value === value,
                );
                return (
                  <button
                    key={setting.id}
                    type="button"
                    className="mobile-sheet-row"
                    disabled={disabled || loading || !setting.options.length}
                    aria-busy={loading || undefined}
                    onClick={() => {
                      setSettingId(setting.id);
                      setPage("setting");
                    }}
                  >
                    {setting.id === "serviceTier" ? (
                      <Gauge size={20} />
                    ) : (
                      <SlidersHorizontal size={20} />
                    )}
                    <span className="mobile-sheet-row-text mobile-sheet-row-inline">
                      <strong>{t(modelSettingTitle(setting))}</strong>
                      <small>{t(current?.label ?? value)}</small>
                    </span>
                    {rowIndicator}
                  </button>
                );
              })}
              {catalog?.errors[configuration.harness] && (
                <p className="mobile-form-error" role="alert">
                  {catalog.errors[configuration.harness]}
                </p>
              )}
            </div>
          </div>
        ) : page === "setting" ? (
          <div
            className="mobile-model-options"
            role="radiogroup"
            aria-label={t(
              selectedSetting
                ? modelSettingTitle(selectedSetting)
                : "Reasoning effort",
            )}
          >
            {selectedSetting?.options.map((option) => {
              const selected =
                (configuration.modelSettings[selectedSetting.id] ??
                  selectedSetting.value) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className="mobile-sheet-row"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() =>
                    choose({
                      ...configuration,
                      modelSettings: {
                        ...configuration.modelSettings,
                        [selectedSetting.id]: option.value,
                      },
                    })
                  }
                >
                  <span className="mobile-sheet-row-text">
                    <strong>{t(option.label)}</strong>
                  </span>
                  {selected && <Check size={20} />}
                </button>
              );
            })}
          </div>
        ) : page === "models" ? (
          <div
            className="mobile-model-options"
            role="radiogroup"
            aria-label={t("Model")}
          >
            {groups.map((group) => (
              <div
                key={group.id}
                className="mobile-sheet-group"
                role="group"
                aria-label={group.name}
              >
                {group.showLabel && <h3>{group.name}</h3>}
                {group.models.map(({ item: model }) => (
                  <button
                    type="button"
                    className="mobile-sheet-row"
                    role="radio"
                    key={model.id}
                    aria-label={`${model.name}, ${model.provider?.name ?? HARNESS_TITLE[model.harness]}`}
                    aria-checked={
                      controls.model?.id === model.id ||
                      configuration.model === model.id
                    }
                    disabled={disabled}
                    onClick={() =>
                      choose(
                        configurationForModel(
                          model,
                          configuration.modelSettings,
                          configuration.runtimeMode,
                        ),
                      )
                    }
                  >
                    <span className="mobile-sheet-row-text">
                      <strong>{model.name}</strong>
                    </span>
                    {(controls.model?.id === model.id ||
                      configuration.model === model.id) && <Check size={20} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="mobile-model-options"
            role="radiogroup"
            aria-label={t("Agent")}
          >
            {providers.map((provider) => (
              <button
                type="button"
                className="mobile-sheet-row"
                role="radio"
                key={provider}
                aria-checked={configuration.harness === provider}
                disabled={
                  disabled || agentLocked || !catalog?.models[provider]?.length
                }
                onClick={() => {
                  const next = catalog?.models[provider]?.[0];
                  if (next)
                    choose(
                      agentConfiguration?.(provider) ??
                        configurationForModel(
                          next,
                          {},
                          configuration.runtimeMode,
                        ),
                    );
                }}
              >
                <HarnessIcon harness={provider} />
                <span className="mobile-sheet-row-text">
                  <strong>{HARNESS_TITLE[provider]}</strong>
                </span>
                {configuration.harness === provider && <Check size={20} />}
              </button>
            ))}
          </div>
        )
      }
    </MobileSheet>
  );
}
