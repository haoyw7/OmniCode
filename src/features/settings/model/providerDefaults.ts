import {
  defaultModelId,
  firstEnabledHarness,
  type LastModelChoice,
} from "../../sessions/model/models";
import type { ProjectProviderSettings } from "../../sessions/model/projectProviders";
import type { HarnessId } from "../../sessions/model/session";

/** What Settings shows for the global defaults or one project's overrides. */
export type ProviderDefaultsScope = {
  /** Null for the global defaults. */
  project: string | null;
  projectSettings: ProjectProviderSettings;
  defaultModels: Partial<Record<HarnessId, string>>;
  choice: LastModelChoice | null;
  hiddenGlobally: readonly HarnessId[];
};

/**
 * The provider new conversations start with in this scope. A project without
 * overrides inherits the global default provider, the same way
 * `defaultSessionChoice` resolves it for new conversations.
 */
export function effectiveDefaultHarness(
  scope: Pick<ProviderDefaultsScope, "project" | "projectSettings" | "choice">,
): HarnessId | null {
  if (!scope.project) return scope.choice?.harness ?? null;
  return firstEnabledHarness(
    scope.project,
    scope.projectSettings.defaultHarness ?? scope.choice?.harness ?? "cursor",
  );
}

export type ProviderScopeState = {
  selectedModel: string;
  isDefault: boolean;
  inPicker: boolean;
  /** Globally hidden providers cannot be turned on per project. */
  pickerLocked: boolean;
};

export function providerScopeState(
  harness: HarnessId,
  scope: ProviderDefaultsScope,
  defaultHarness: HarnessId | null = effectiveDefaultHarness(scope),
): ProviderScopeState {
  const { project, projectSettings, defaultModels, choice, hiddenGlobally } = scope;
  const hiddenHere = hiddenGlobally.includes(harness);
  const globalModel =
    defaultModels[harness] ??
    (choice?.harness === harness ? choice.model : defaultModelId(harness));
  return {
    selectedModel: project
      ? (projectSettings.models?.[harness] ??
        (projectSettings.defaultHarness === harness
          ? projectSettings.defaultModel
          : undefined) ??
        globalModel)
      : globalModel,
    isDefault: defaultHarness === harness,
    inPicker: project
      ? !(projectSettings.hidden ?? []).includes(harness) && !hiddenHere
      : !hiddenHere,
    // A globally hidden provider stays out of every project's picker, so the
    // project toggle is shown locked rather than appearing to work.
    pickerLocked: project != null && hiddenHere,
  };
}
