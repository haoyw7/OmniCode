import type { ReactNode } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Globe, RotateCcw } from "../../../../../shared/ui/icons";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { isHarnessAvailable } from "../../../../../integrations/harness/core/availability";
import { projectKey, projectName } from "../../../../../shared/lib/paths";
import { LAST_SELECTED_MODEL, modelsFor, resolveModel } from "../../../../sessions/model/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import { HarnessIcon } from "../../../../sessions/ui/HarnessIcon";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../../../workspace/model/tabGroups";
import { useTabGroupLogos } from "../../../../projects/hooks/useTabGroupLogos";
import { ProjectLogoIcon } from "../../../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../../../projects/ui/ProjectMascot";
import { usePreferenceState } from "../../../model/usePreferenceState";
import { Group, Row } from "../../settingsLayout";

export const GLOBAL_PROVIDER_SCOPE = "global";
export const LAST_SELECTION_SCOPE = "last-selection";

export type ProviderScopeOption = { value: string; label: string; icon?: ReactNode };

export function globalScopeOption(label: string): ProviderScopeOption {
  return {
    value: GLOBAL_PROVIDER_SCOPE,
    label,
    icon: <Globe className="size-3.5 shrink-0 text-content/60" />,
  };
}

export function lastSelectionScopeOption(label: string): ProviderScopeOption {
  return {
    value: LAST_SELECTION_SCOPE,
    label,
    icon: <RotateCcw className="size-3.5 shrink-0 text-content/60" />,
  };
}

export function projectScopeOption(path: string): ProviderScopeOption {
  return { value: path, label: projectName(path), icon: <ProjectScopeIcon path={path} /> };
}

/** Where new conversations start: the scope, its provider and that provider's model. */
export function NewSessionDefaults({
  scope,
  scopeOptions,
  project,
  defaultHarness,
  selectedModel,
  onScope,
  onDefault,
  onModelChange,
}: {
  scope: string;
  scopeOptions: readonly ProviderScopeOption[];
  project: string | null;
  defaultHarness: HarnessId | null;
  /** The default provider's model in this scope. */
  selectedModel: (harness: HarnessId) => string;
  onScope: (scope: string) => void;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const choices = HARNESSES.filter(isHarnessAvailable);
  const models = defaultHarness ? modelsFor(defaultHarness) : [];
  const followLastSelection = scope === LAST_SELECTION_SCOPE;
  const currentModel =
    defaultHarness && models.length > 0
      ? resolveModel(defaultHarness, selectedModel(defaultHarness))
      : null;
  return (
    <Group
      id="new-session-defaults"
      title={uiT("New conversations")}
      description={
        followLastSelection
          ? uiT("New conversations use the provider and model you last selected. Project overrides still apply.")
          : project
          ? uiT(
              "These defaults apply to {value0} only. A provider with Show in picker off is also kept out of new conversations started in this project. CLI paths remain global for OmniCode.",
              { value0: String(projectName(project)) },
            )
          : uiT("The provider and model new conversations start with. Choose a project to override them there.")
      }
      action={
        <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
          label={uiT("Provider defaults scope")}
          value={scope}
          options={scopeOptions}
          onChange={onScope}
        />
      }
    >
      <Row label={uiT("Default provider")}>
        <SearchableSelect searchable={false} align="end" width={280} maxHeight={360} commitOnTab checkPosition="end" className="max-w-52"
          label={uiT("Default provider")}
          disabled={followLastSelection}
          value={defaultHarness ?? ""}
          placeholder={uiT("Choose a provider")}
          options={choices.map((harness) => ({
            value: harness,
            label: HARNESS_TITLE[harness],
            icon: <HarnessIcon harness={harness} className="size-4" />,
          }))}
          onChange={(next) => {
            const harness = next as HarnessId;
            const selected = selectedModel(harness);
            onDefault(harness, selected === LAST_SELECTED_MODEL ? selected : resolveModel(harness, selected).id);
          }}
        />
      </Row>
      {defaultHarness && currentModel ? (
        <Row label={uiT("Default model")}>
          <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
            label={uiT("Default model")}
            disabled={followLastSelection}
            value={currentModel.id}
            options={models.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(next) => onModelChange(defaultHarness, next)}
          />
        </Row>
      ) : null}
    </Group>
  );
}

/** The icon the activity bar shows: custom logo, else the project mascot. */
function ProjectScopeIcon({ path }: { path: string }) {
  const logos = useTabGroupLogos();
  const [colors] = usePreferenceState(loadTabGroupColors);
  const [customColors] = usePreferenceState(loadTabGroupCustomColors);
  const [mascots] = usePreferenceState(loadTabGroupMascots);
  const key = projectKey(path);
  const name = projectName(path);
  const logoPath = resolveTabGroupLogo(key, logos);
  if (logoPath) {
    return (
      <ProjectLogoIcon
        path={logoPath}
        className="size-4 rounded-sm"
        imageClassName="size-4"
      />
    );
  }
  return (
    <ProjectMascot
      project={name}
      color={resolveTabGroupColor(key, colors, customColors, name)}
      name={resolveTabGroupMascot(key, mascots)}
      className="size-3.5"
    />
  );
}
