import { usePreferenceState } from "../../../model/usePreferenceState";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Loader, RefreshCw } from "../../../../../shared/ui/icons";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../../../shared/ui/forms/Button";
import { useInlineBreakpoints } from "../../../../../shared/hooks/useInlineBreakpoints";
import { announceHarnessesRefreshed, hasHarnessUpdate, readHarnessVersions, type HarnessVersionInfo } from "../../../../providers/model/harnessUpdates";
import { getHarnessAvailabilitySnapshot, isHarnessAvailable, probeHarnessAvailability, subscribeHarnessAvailability } from "../../../../providers/model/harnessAvailability";
import { refreshHostModelCatalogs } from "../../../../providers/model/hostModelCatalog";
import { loadDefaultModels, loadHiddenPickerProviders, loadLastModelChoice, loadLastSelectedModelChoice, loadUseLastSelection, saveDefaultModel, saveLastModelChoice, savePickerProviderVisible, saveUseLastSelection } from "../../../../sessions/model/models";
import { getModelSnapshot, subscribeModels } from "../../../../../integrations/harness/core/modelCatalog";
import { pathKey } from "../../../../../shared/lib/paths";
import { looksLikeProject, type RecentProject } from "../../../../projects/model/recents";
import { HARNESSES, type HarnessId } from "../../../../../contracts/session";
import { loadProjectProviderSettings, projectProvidersRevision, setProjectDefaultModel, setProjectDefaultProvider, setProjectProviderHidden, subscribeProjectProviders } from "../../../../sessions/model/projectProviders";
import { saveMaskEmails, saveShowRemainingUsage, useMaskEmails, useShowRemainingUsage } from "../../../model/displayPrefs";
import { effectiveDefaultHarness, providerScopeState, type ProviderDefaultsScope } from "../../../model/providerDefaults";
import { Group, RevealedSetting, Row, Toggle } from "../../settingsLayout";
import { GLOBAL_PROVIDER_SCOPE, globalScopeOption, LAST_SELECTION_SCOPE, lastSelectionScopeOption, NewSessionDefaults, projectScopeOption } from "./NewSessionDefaults";
import { ProviderDetail } from "./ProviderDetail";
import { ProviderList, type ProviderListEntry } from "./ProviderList";
import { hasProviderAccounts, useProviderAccounts } from "./useProviderAccounts";

/** Below this width the provider list folds into a menu above the detail. */
const COMPACT_BREAKPOINTS = [640] as const;

export function ProvidersPage({
  cwd,
  recents,
}: {
  cwd?: string;
  recents?: RecentProject[];
}) {
  const { t: uiT } = useTranslation();
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const providersRevision = useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  void providersRevision;
  const [choice, setChoice] = usePreferenceState(loadLastModelChoice);
  const [defaultModels, setDefaultModels] = usePreferenceState(loadDefaultModels);
  const [scope, setScope] = useState<string>(GLOBAL_PROVIDER_SCOPE);
  const [useLastSelection, setUseLastSelection] = usePreferenceState(loadUseLastSelection);
  const [lastSelected] = usePreferenceState(loadLastSelectedModelChoice);
  const [hiddenGlobally, setHiddenGlobally] = usePreferenceState(
    loadHiddenPickerProviders,
  );
  const accounts = useProviderAccounts();

  const scopeOptions = useMemo(() => {
    const options = [
      globalScopeOption(uiT("Global")),
      lastSelectionScopeOption(uiT("Last selection")),
    ];
    const seen = new Set<string>();
    for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
      if (!path || !looksLikeProject(path)) continue;
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(projectScopeOption(path));
    }
    return options;
  }, [cwd, recents, uiT]);

  useEffect(() => {
    if (!scopeOptions.some((option) => option.value === scope)) {
      setScope(GLOBAL_PROVIDER_SCOPE);
    }
  }, [scope, scopeOptions]);

  const project = scope === GLOBAL_PROVIDER_SCOPE ? null : scope;
  const followLastSelection = !project && useLastSelection;
  const selectedChoice = lastSelected ?? choice;
  const onScope = (next: string) => {
    if (next === GLOBAL_PROVIDER_SCOPE || next === LAST_SELECTION_SCOPE) {
      const follow = next === LAST_SELECTION_SCOPE;
      saveUseLastSelection(follow);
      setUseLastSelection(follow);
      setScope(GLOBAL_PROVIDER_SCOPE);
    } else {
      setScope(next);
    }
  };
  const defaults: ProviderDefaultsScope = {
    project,
    projectSettings: project ? loadProjectProviderSettings(project) : {},
    defaultModels: useLastSelection && lastSelected
      ? { ...defaultModels, [lastSelected.harness]: lastSelected.model }
      : defaultModels,
    choice: useLastSelection ? selectedChoice : choice,
    hiddenGlobally,
  };
  const defaultHarness = effectiveDefaultHarness(defaults);
  const stateFor = (harness: HarnessId) =>
    providerScopeState(harness, defaults, defaultHarness);

  const [versions, setVersions] = useState<
    Partial<Record<HarnessId, HarnessVersionInfo>>
  >({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const loadVersions = useCallback(
    async (harnesses: HarnessId[], force = false) => {
      const entries = await Promise.all(
        harnesses.map(
          async (harness) =>
            [harness, await readHarnessVersions(harness, { force })] as const,
        ),
      );
      if (!mounted.current) return;
      setVersions((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    [],
  );

  useEffect(() => {
    void probeHarnessAvailability().then(() =>
      loadVersions(HARNESSES.filter((harness) => isHarnessAvailable(harness))),
    );
  }, [loadVersions]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Re-detect binaries (a CLI may have been installed or removed since the
      // last probe), then re-read versions and model catalogs of whatever is
      // installed.
      await probeHarnessAvailability({ force: true });
      const installed = HARNESSES.filter((harness) =>
        isHarnessAvailable(harness),
      );
      setVersions({});
      await Promise.all([
        loadVersions(installed, true),
        refreshHostModelCatalogs(installed, { force: true }),
      ]);
      // Other windows' model pickers keep their own stores.
      void announceHarnessesRefreshed([...HARNESSES]).catch(() => undefined);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  const onModelChange = (harness: HarnessId, model: string) => {
    if (project) {
      setProjectDefaultModel(project, harness, model);
      return;
    }
    if (useLastSelection) onScope(GLOBAL_PROVIDER_SCOPE);
    saveDefaultModel(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (choice?.harness === harness) {
      saveLastModelChoice(harness, model);
      setChoice({ harness, model });
    }
  };

  const onDefault = (harness: HarnessId, model: string) => {
    // Installed providers can be selected before their model catalog is ready.
    if (isHarnessAvailable(harness)) void refreshHostModelCatalogs([harness]);
    if (project) {
      setProjectDefaultProvider(project, harness, model);
      return;
    }
    if (useLastSelection) onScope(GLOBAL_PROVIDER_SCOPE);
    saveLastModelChoice(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    setChoice({ harness, model });
  };

  const onPickerVisible = (harness: HarnessId, visible: boolean) => {
    if (project) {
      setProjectProviderHidden(project, harness, !visible);
      return;
    }
    savePickerProviderVisible(harness, visible);
    setHiddenGlobally((prev) =>
      visible
        ? prev.filter((id) => id !== harness)
        : [...new Set([...prev, harness])],
    );
  };

  const entries: ProviderListEntry[] = HARNESSES.map((harness) => {
    const available = isHarnessAvailable(harness);
    const version = versions[harness];
    return {
      harness,
      available,
      isDefault: defaultHarness === harness,
      updatable: available && hasHarnessUpdate(version) && !version?.bundledBy,
    };
  });

  const [selected, setSelected] = useState<HarnessId>(
    () =>
      defaultHarness ??
      HARNESSES.find((harness) => isHarnessAvailable(harness)) ??
      HARNESSES[0],
  );
  // Search lands on a section that only one provider's detail shows; switch to
  // it during render so the target exists when Settings scrolls to it.
  const revealed = useContext(RevealedSetting);
  const revealedProvider: HarnessId | null =
    revealed === "claude-hooks"
      ? "claude"
      : revealed === "provider-accounts" && !hasProviderAccounts(selected)
        ? "claude"
        : null;
  if (revealedProvider && revealedProvider !== selected) {
    setSelected(revealedProvider);
  }

  const masterDetail = useInlineBreakpoints(COMPACT_BREAKPOINTS);

  return (
    <>
      <NewSessionDefaults
        scope={followLastSelection ? LAST_SELECTION_SCOPE : scope}
        scopeOptions={scopeOptions}
        project={project}
        defaultHarness={followLastSelection ? selectedChoice?.harness ?? defaultHarness : defaultHarness}
        selectedModel={(harness) => followLastSelection && selectedChoice?.harness === harness
          ? selectedChoice.model : stateFor(harness).selectedModel}
        onScope={onScope}
        onDefault={onDefault}
        onModelChange={onModelChange}
      />

      <Group
        id="agent-clis"
        title={uiT("Agent CLIs")}
        description={uiT(
          "A CLI is installed once it is found on your PATH. CLI paths and accounts apply to every project.",
        )}
        action={
          <Button variant="secondary"
            aria-label={uiT("Refresh agent CLIs")}
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={() => void onRefresh()}
          >
            {refreshing ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            {refreshing ? uiT("Refreshing") : uiT("Refresh")}
          </Button>
        }
      >
        <div ref={masterDetail} data-ui="provider-master-detail">
          <ProviderList
            entries={entries}
            selected={selected}
            onSelect={setSelected}
          />
          <ProviderDetail
            harness={selected}
            project={project}
            state={stateFor(selected)}
            version={versions[selected]}
            accounts={accounts}
            onUpdated={() => void loadVersions([selected])}
            onDefault={onDefault}
            onModelChange={onModelChange}
            onPickerVisible={onPickerVisible}
          />
        </div>
      </Group>

      <UsageDisplaySettings />
    </>
  );
}

function UsageDisplaySettings() {
  const { t: uiT } = useTranslation();
  const showRemainingUsage = useShowRemainingUsage();
  const maskEmails = useMaskEmails();
  return (
    <Group title={uiT("Usage and privacy")}>
      <Row
        id="show-remaining-usage"
        label={uiT("Show remaining usage")}
        description={uiT(
          "Fill usage meters with what is left in each limit instead of what has been used.",
        )}
      >
        <Toggle
          label={uiT("Show remaining usage")}
          on={showRemainingUsage}
          onChange={saveShowRemainingUsage}
        />
      </Row>
      <Row
        id="mask-emails"
        label={uiT("Mask account emails")}
        description={uiT(
          "Blur account emails in Settings and the usage popover until you click one, so they stay out of screenshots.",
        )}
      >
        <Toggle
          label={uiT("Mask account emails")}
          on={maskEmails}
          onChange={saveMaskEmails}
        />
      </Row>
    </Group>
  );
}
