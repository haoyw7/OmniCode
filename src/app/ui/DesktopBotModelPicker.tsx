import { useMemo } from "react";
import { useTranslation } from "../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../shared/ui/SurfaceVisibility";
import { remoteModelControls } from "../../features/connections/model/remoteModels";
import { ModelPicker } from "../../features/sessions/ui/ModelPicker";
import { ModelSourceContext, type ModelSource } from "../../features/sessions/model/modelSource";
import type { BotModelPickerProps } from "../../features/bots/ui/BotChatChrome";

/** Reuse the conversation menu with this assistant's Host catalog. */
export function DesktopBotModelPicker({ catalog, catalogState, harness, model, savedModel, values, disabled, onChange, onSettingsChange, onRefresh }: BotModelPickerProps) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const source = useMemo<ModelSource>(() => ({
    id: "assistant",
    modelsFor: provider => catalog.models[provider] ?? [],
    resolve: (provider, id = "") => {
      const controls = remoteModelControls(catalog, provider, id, provider === harness && id === model ? values : {}, provider === harness ? savedModel : undefined);
      return {
        ...(controls.model ?? { id, harness: provider, name: id || t(catalogState === "loading" ? "Loading models…" : "Choose a model") }),
        settings: controls.settings,
      };
    },
    find: id => Object.values(catalog.models).flatMap(models => models ?? []).find(model => model.id === id),
    available: provider => !!catalog.models[provider]?.length,
    probed: () => catalogState !== "loading" || Object.keys(catalog.models).length > 0,
    loading: provider => catalogState === "loading" && !catalog.models[provider]?.length,
    refresh: () => onRefresh?.(),
  }), [catalog, catalogState, harness, model, savedModel, values, onRefresh, t]);
  return <SurfaceVisibilityContext.Provider value={visible && !disabled}>
    <ModelSourceContext.Provider value={source}>
      <div className="desktop-bot-model-picker">
        <ModelPicker harness={harness ?? "codex"} model={model ?? ""} values={values}
          allowedHarnesses={Object.keys(catalog.models) as NonNullable<BotModelPickerProps["harness"]>[]}
          disabled={disabled} onChange={onChange} onSettingsChange={onSettingsChange} />
      </div>
    </ModelSourceContext.Provider>
  </SurfaceVisibilityContext.Provider>;
}
