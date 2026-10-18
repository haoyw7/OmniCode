import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { usePreferenceState } from "../../../model/usePreferenceState";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Globe, Loader, RefreshCw } from "../../../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "../../../../../shared/ui/forms/Button";
import {
  announceHarnessesRefreshed,
  readHarnessVersions,
  type HarnessVersionInfo,
} from "../../../../providers/model/harnessUpdates";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../../../integrations/harness/core/registry";
import {
  defaultModelId,
  firstEnabledHarness,
  getModelSnapshot,
  loadDefaultModels,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  saveDefaultModel,
  saveLastModelChoice,
  savePickerProviderVisible,
  subscribeModels,
} from "../../../../sessions/model/models";
import { pathKey, projectKey, projectName } from "../../../../../shared/lib/paths";
import { looksLikeProject, type RecentProject } from "../../../../projects/model/recents";
import { HARNESSES, type HarnessId } from "../../../../sessions/model/session";
import {
  loadProjectProviderSettings,
  projectProvidersRevision,
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectProviderHidden,
  subscribeProjectProviders,
} from "../../../../sessions/model/projectProviders";
import {
  saveMaskEmails,
  saveShowRemainingUsage,
  useMaskEmails,
  useShowRemainingUsage,
} from "../../../model/displayPrefs";
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
import { loadClaudeHooks, saveClaudeHooks } from "../../../model/settings";
import { ProviderAccountsSettings } from "./ProviderAccountsSettings";
import { Group, Row, Toggle } from "../../settingsLayout";
import { ProviderRow } from "./ProviderRow";



const GLOBAL_PROVIDER_SCOPE = "global";

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
  const [claudeHooks, setClaudeHooks] = usePreferenceState(loadClaudeHooks);
  const [scope, setScope] = useState<string>(GLOBAL_PROVIDER_SCOPE);
  const [hiddenGlobally, setHiddenGlobally] = usePreferenceState(
    loadHiddenPickerProviders,
  );

  const scopeOptions = useMemo(() => {
    const options: { value: string; label: string; icon?: ReactNode }[] = [
      {
        value: GLOBAL_PROVIDER_SCOPE,
        label: uiT("Global"),
        icon: (
          <Globe
            className="size-3.5 shrink-0 text-content/60"
          />
        ),
      },
    ];
    const seen = new Set<string>();
    for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
      if (!path || !looksLikeProject(path)) continue;
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: path,
        label: projectName(path),
        icon: <ProjectScopeIcon path={path} />,
      });
    }
    return options;
  }, [cwd, recents, uiT]);

  const project = scope === GLOBAL_PROVIDER_SCOPE ? null : scope;
  const projectSettings = project ? loadProjectProviderSettings(project) : {};
  // A project without overrides inherits the global default provider, the same
  // way `defaultSessionChoice` resolves it for new conversations.
  const effectiveDefaultHarness = project
    ? firstEnabledHarness(
        project,
        projectSettings.defaultHarness ?? choice?.harness ?? "cursor",
      )
    : (choice?.harness ?? null);

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
        refreshHarnessCatalogs(installed, { force: true }),
      ]);
      // Other windows' model pickers keep their own stores.
      void announceHarnessesRefreshed([...HARNESSES]).catch(() => undefined);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!scopeOptions.some((option) => option.value === scope)) {
      setScope(GLOBAL_PROVIDER_SCOPE);
    }
  }, [scope, scopeOptions]);

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const onModelChange = (harness: HarnessId, model: string) => {
    if (project) {
      setProjectDefaultModel(project, harness, model);
      return;
    }
    saveDefaultModel(harness, model);
    setDefaultModels((prev) => ({ ...prev, [harness]: model }));
    if (choice?.harness === harness) {
      saveLastModelChoice(harness, model);
      setChoice({ harness, model });
    }
  };

  const onDefault = (harness: HarnessId, model: string) => {
    if (project) {
      setProjectDefaultProvider(project, harness, model);
      return;
    }
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

  return (
    <>
      <ProviderAccountsSettings />

      <UsageDisplaySettings />

      <Group
        id="agent-clis"
        title={uiT("Agent CLIs")}
        action={
          <div className="flex items-center gap-2">
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
            <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
              label={uiT("Provider defaults scope")}
              value={scope}
              options={scopeOptions}
              onChange={setScope}
            />
          </div>
        }
        description={
          project
            ? uiT(
                "These defaults apply to {value0} only. A provider with Show in picker off is also kept out of new conversations started in this project. CLI paths remain global for OmniCode.",
                { value0: String(projectName(project)) },
              )
            : uiT(
                "A provider is listed as installed once its CLI is found on your PATH. Uninstalled CLIs stay listed but are left out of the model picker, as are installed ones with Show in picker off. The model beside a provider is what its new conversations start with; Use by default picks the provider itself. CLI paths are global for OmniCode and apply to every project.",
              )
        }
      >
        {HARNESSES.map((harness) => {
          const inPicker = project
            ? !(projectSettings.hidden ?? []).includes(harness) &&
              !hiddenGlobally.includes(harness)
            : !hiddenGlobally.includes(harness);
          // A globally hidden provider stays out of every project's picker, so
          // the project toggle is shown locked rather than appearing to work.
          const pickerLocked =
            project != null && hiddenGlobally.includes(harness);
          const selectedModel = project
            ? (projectSettings.models?.[harness] ??
              (projectSettings.defaultHarness === harness
                ? projectSettings.defaultModel
                : undefined) ??
              defaultModels[harness] ??
              (choice?.harness === harness
                ? choice.model
                : defaultModelId(harness)))
            : (defaultModels[harness] ??
              (choice?.harness === harness
                ? choice.model
                : defaultModelId(harness)));
          const isDefault = project
            ? effectiveDefaultHarness === harness
            : choice?.harness === harness;
          return (
            <ProviderRow
              key={harness}
              harness={harness}
              selectedModel={selectedModel}
              isDefault={isDefault}
              inPicker={inPicker}
              pickerLocked={pickerLocked}
              version={versions[harness]}
              onUpdated={() => void loadVersions([harness])}
              onDefault={onDefault}
              onModelChange={onModelChange}
              onPickerVisible={(visible) => onPickerVisible(harness, visible)}
            />
          );
        })}
      </Group>

      <Group title={uiT("Advanced")}>
        <Row
          id="claude-hooks"
          label={uiT("Claude Code hooks")}
          description={uiT(
            "Run the hooks configured in your settings.json files — PreToolUse command rewrites, blocks, notifications, and the rest — just as the Claude Code CLI would. Turn this off if a hook is misbehaving and you need the session back. Takes effect on the next turn.",
          )}
        >
          <Toggle
            label={uiT("Claude Code hooks")}
            on={claudeHooks}
            onChange={onClaudeHooks}
          />
        </Row>
      </Group>
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
