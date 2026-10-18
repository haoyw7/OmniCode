import { useEffect, useState } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ChevronRight, Internet, Laptop, Plus } from "../../../shared/ui/icons";
import {
  OPEN_NEW_ENVIRONMENT_EVENT,
  OPEN_REMOTE_PROJECT_EVENT,
  knownRemoteMachine,
} from "../../connections/model/connections";
import { ensureSharedProject, parseRemotePath } from "../../connections/model/remoteProjects";
import {
  environmentForPath,
  environmentProjectPath,
  useHostEnvironments,
} from "../../connections/model/hostEnvironments";
import { withStatusToast } from "../../../shared/ui/StatusToast";
import { parseWslPath } from "../../../shared/lib/wslPaths";
import { listWslDistributions } from "../../../platform/tauri/wsl";
import type { MenuSubmenuHandlers } from "../../../shared/ui/primitives/MenuSubmenu";

/** Environment entry points use the existing project/connection flows. */
export function ComposerEnvironmentPicker({
  remote,
  cwd,
  onCwdChange,
  selectedDistribution,
  onEnvironmentChange,
}: {
  remote: boolean;
  cwd?: string;
  /** Opens a saved environment's first folder as this composer's project. */
  onCwdChange?: (cwd: string) => void;
  selectedDistribution?: string | null;
  onEnvironmentChange?: (distribution: string | null) => void;
}) {
  const { t } = useTranslation();
  const { environments } = useHostEnvironments();
  const current = remote || (selectedDistribution !== undefined && selectedDistribution !== (parseWslPath(cwd ?? "")?.machine.distribution ?? null))
    ? undefined : environmentForPath(environments, cwd);
  const environment = cwd ? parseRemotePath(cwd)?.environmentId : undefined;
  const distribution = selectedDistribution !== undefined ? selectedDistribution :
    (cwd ? parseWslPath(cwd)?.machine.distribution : undefined) ?? (remote && environment
      ? knownRemoteMachine(environment)?.wsl?.distribution
      : undefined);
  return (
    <SearchableSelect
      label={t("Environment")}
      value={distribution ? "wsl" : current ? `environment:${current.id}` : remote ? "remote" : "local"}
      triggerLabel={
        current?.name ?? (distribution ? `WSL · ${distribution}` : t(remote ? "Remote" : "Local"))
      }
      triggerIcon={remote && !distribution ? <Internet /> : <Laptop />}
      className="composer-environment-picker hidden"
      triggerClassName="composer-environment-badge"
      menuClassName="composer-environment-menu"
      variant="row"
      side="top"
      width={326}
      maxHeight={320}
      checkPosition="end"
      searchPlaceholder={t("Search environments…")}
      emptyLabel={t("No matching environments")}
      options={[
        {
          value: "local",
          label: t("This machine"),
          group: t("Local"),
          icon: <Laptop />,
          disabled: remote,
          description: remote
            ? t("Open a local project to run on this computer.")
            : undefined,
        },
        ...environments
          .filter((entry) => entry.folders.length > 0)
          .map((entry) => ({
            value: `environment:${entry.id}`,
            label: entry.name,
            group: t("Local"),
            icon: <Laptop />,
            keywords: entry.folders.join(" "),
            description: entry.machine ? `WSL · ${entry.machine.distribution}` : undefined,
            disabled: remote || !onCwdChange,
          })),
        {
          value: "remote",
          label: t("Remote Control"),
          separatorBefore: true,
          trailing: <ChevronRight className="size-4 text-content/50" />,
        },
        {
          value: "wsl",
          label: "WSL",
          disabled: remote || !onEnvironmentChange,
          renderSubmenu: (handlers) => (
            <WslDistributionMenu {...handlers} selected={distribution ?? undefined} onSelect={onEnvironmentChange!} />
          ),
        },
        {
          value: "new",
          label: t("New environment"),
          icon: <Plus />,
          separatorBefore: true,
        },
      ]}
      onChange={(value) => {
        if (value === "local") onEnvironmentChange?.(null);
        if (value === "remote")
          window.dispatchEvent(new Event(OPEN_REMOTE_PROJECT_EVENT));
        if (value === "new")
          window.dispatchEvent(new Event(OPEN_NEW_ENVIRONMENT_EVENT));
        const environment = environments.find((entry) => value === `environment:${entry.id}`);
        if (environment && onCwdChange) {
          const path = environmentProjectPath(environment, environment.folders[0]);
          // WSL folders open through the shared Host before the composer adopts them.
          if (!environment.machine) onCwdChange(path);
          else void withStatusToast(() => ensureSharedProject(path), {
            loading: t("Opening {value0}…", { value0: environment.name }),
            success: () => { onCwdChange(path); return ""; },
          }).catch(() => undefined);
        }
      }}
    />
  );
}

function WslDistributionMenu({
  anchor,
  onOpenChange,
  onFinish,
  selected,
  onSelect,
}: MenuSubmenuHandlers & { selected?: string; onSelect: (distribution: string) => void }) {
  const { t } = useTranslation();
  const [distributions, setDistributions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void listWslDistributions()
      .then(
        (names) => {
          if (!disposed) setDistributions(names);
        },
        (reason) => {
          if (!disposed) setError(String(reason).replace(/^Error: /, ""));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <SearchableSelect
      label={t("WSL distribution")}
      menuAnchor={anchor}
      onOpenChange={onOpenChange}
      value={selected ?? ""}
      variant="row"
      checkPosition="end"
      width={280}
      options={distributions.map((name) => ({ value: name, label: name }))}
      searchable={false}
      emptyLabel={
        loading
          ? t("Loading WSL distributions…")
          : error
            ? t(error)
            : distributions.length
              ? t("No matching environments")
              : t(
                  "No WSL distributions found. Install a Linux distribution in WSL, then try again.",
                )
      }
      onChange={(distribution) => {
        onSelect(distribution);
        onFinish();
      }}
    />
  );
}
