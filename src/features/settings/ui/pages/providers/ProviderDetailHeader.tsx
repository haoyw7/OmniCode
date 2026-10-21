import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { Button } from "../../../../../shared/ui/forms/Button";
import { ArrowDownCircle, Trash2 } from "../../../../../shared/ui/icons";
import { HarnessIcon } from "../../../../sessions/ui/HarnessIcon";
import {
  hasHarnessUpdate,
  type HarnessVersionInfo,
} from "../../../../providers/model/harnessUpdates";
import {
  harnessInstallUnavailableReason,
  useHarnessInstall,
} from "../../../../providers/model/harnessInstall";
import {
  runHarnessUpdate,
  type HarnessUpdateState,
} from "../../../../providers/ui/HarnessUpdateNotice";
import { harnessUnavailableHint } from "../../../../../integrations/harness/core/availability";
import { inspectHarnessBinary } from "../../../../../integrations/harness/core/child";
import {
  loadProviderBinaryPath,
  providerBinaryPathChangePending,
  saveProviderBinaryPath,
} from "../../../../providers/model/providerBinaryPaths";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import { ProviderCliPanel, type ProviderCliPanelKind } from "./ProviderCliPanel";
import { binaryInspectionError } from "./providerBinaryValidation";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner";

/** A provider's name, CLI state and the actions that change its CLI. */
export function ProviderDetailHeader({
  harness,
  available,
  modelCount,
  version,
  isDefault,
  canUseDefault,
  onUseDefault,
  onUpdated,
  onBinaryChanged,
}: {
  harness: HarnessId;
  available: boolean;
  modelCount: number;
  version?: HarnessVersionInfo;
  isDefault: boolean;
  canUseDefault: boolean;
  onUseDefault: () => void;
  /** Re-reads the installed version once a CLI changes. */
  onUpdated: () => void;
  /** A switched CLI copy re-reads the path row. */
  onBinaryChanged: () => void;
}) {
  const { t: uiT } = useTranslation();
  const title = HARNESS_TITLE[harness];
  const { state: installation } = useHarnessInstall(harness);
  const installUnavailableReason = harnessInstallUnavailableReason(harness);
  // A failure from an earlier visit reopens its step so the error stays visible.
  const [panel, setPanel] = useState<{
    open: boolean;
    kind: ProviderCliPanelKind;
    opening: number;
  }>(() =>
    installation.status === "failed"
      ? { open: true, kind: installation.action, opening: 0 }
      : { open: false, kind: "install", opening: 0 },
  );
  const panelId = `${harness}-cli-panel`;
  const togglePanel = (kind: ProviderCliPanelKind) =>
    setPanel((current) =>
      current.open && current.kind === kind
        ? { ...current, open: false }
        : { open: true, kind, opening: current.opening + 1 },
    );
  useEffect(() => {
    if (installation.status === "failed") {
      setPanel((current) =>
        current.open && current.kind === installation.action
          ? current
          : { open: true, kind: installation.action, opening: current.opening + 1 },
      );
    } else if (
      installation.status === "installed" ||
      (installation.status === "uninstalled" && !installation.remaining)
    ) {
      setPanel((current) => ({ ...current, open: false }));
    }
  }, [installation]);

  const updateMutation = useMutation({ mutationFn: (input: Parameters<typeof runHarnessUpdate>[0]) => runHarnessUpdate(input) }, queryClient);
  const update: HarnessUpdateState = updateMutation.isPending ? { status: "updating" } : updateMutation.data ?? { status: "idle" };
  const installed = available ? version?.installed : undefined;
  const latest = version?.latest;
  const bundledBy = available ? version?.bundledBy : undefined;
  const behind = available && hasHarnessUpdate(version);
  // A bundled copy updates only with its app, so it never gets an Update button.
  const updatable = behind && !bundledBy;
  const onUpdate = async () => {
    if (!installed || !latest || update.status === "updating") return;
    await updateMutation.mutateAsync({ harness, installed, latest });
    onUpdated();
  };

  // Saved path overrides apply on the next launch, like the CLI path editor.
  const [switchError, setSwitchError] = useState<string | null>(null);
  const switchMutation = useMutation({ mutationFn: async (action: () => Promise<void>) => action() }, queryClient);
  const switching = switchMutation.isPending;
  const [, setSwitchRevision] = useState(0);
  const pendingPath = providerBinaryPathChangePending(harness)
    ? loadProviderBinaryPath(harness)
    : null;
  const newerCopy = bundledBy ? version?.newerCopy : undefined;
  const switched = newerCopy != null && pendingPath === newerCopy.path;
  const onUseCopy = async (copy: { path: string; version: string }) => {
    if (switching) return;
    setSwitchError(null);
    try {
      await switchMutation.mutateAsync(async () => {
      const inspection = await queryClient.fetchQuery({ queryKey: ["providerBinary", harness, copy.path], queryFn: () => inspectHarnessBinary(harness, copy.path) });
      const problem = binaryInspectionError(harness, inspection);
      if (problem) throw new Error(problem);
      if (!saveProviderBinaryPath(harness, copy.path)) {
        throw new Error("Could not save the binary path.");
      }
      setSwitchRevision((value) => value + 1);
      onBinaryChanged();
      });
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const versionText: ReactNode = !installed ? null : updatable && latest ? (
    <span
      className="font-mono"
      title={uiT("Version {value0} installed, {value1} available", {
        value0: installed,
        value1: latest,
      })}
    >
      <span className="text-warning">{installed}</span>
      {" → "}
      <span className="font-medium text-success">{latest}</span>
    </span>
  ) : latest
    ? uiT("Version {value0} (latest)", { value0: installed })
    : uiT("Version {value0}", { value0: installed });
  const sourceText = !bundledBy
    ? null
    : switched && newerCopy
      ? uiT("Switched to {value0}. Restart OmniCode to apply.", {
          value0: newerCopy.version,
        })
      : behind
        ? uiT("Bundled with {app}; it updates with {app}.", { app: bundledBy })
        : uiT("Bundled with {app}", { app: bundledBy });
  const modelsText = available
    ? uiT("{value0} {value1} available.", {
        value0: String(modelCount),
        value1: String(modelCount === 1 ? "model" : "models"),
      })
    : harnessUnavailableHint(harness) || uiT("Not installed");
  const status: ReactNode =
    installation.status === "installing" ? (
      <span role="status">{uiT("Downloading and installing CLI…")}</span>
    ) : installation.status === "uninstalling" ? (
      <span role="status">{uiT("Removing CLI…")}</span>
    ) : !available && installUnavailableReason ? (
      uiT(installUnavailableReason)
    ) : update.status === "failed" ? (
      <span role="alert" className="text-destructive">{update.error}</span>
    ) : switchError ? (
      <span role="alert" className="text-destructive">{switchError}</span>
    ) : versionText ? (
      <>
        {versionText}
        {sourceText ? ` · ${sourceText}` : null} · {modelsText}
      </>
    ) : (
      modelsText
    );

  return (
    <>
      <div data-ui="provider-detail-header">
        <span data-ui="provider-detail-icon" aria-hidden>
          <HarnessIcon harness={harness} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-ui-lg font-semibold text-foreground">
            {title}
            {isDefault ? (
              <span data-ui="provider-chip" data-tone="accent">
                {uiT("Default")}
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-ui-caption leading-5 text-foreground-subtle">
            {status}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {newerCopy && !switched ? (
            <Button variant="secondary"
              aria-label={uiT("Use {value0} {value1} at {value2}", {
                value0: String(title),
                value1: newerCopy.version,
                value2: newerCopy.path,
              })}
              title={newerCopy.path}
              disabled={switching}
              onClick={() => void onUseCopy(newerCopy)}
            >
              {switching ? (
                <Spinner className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
              )}
              {uiT("Use {value0}", { value0: newerCopy.version })}
            </Button>
          ) : null}
          {updatable && update.status !== "updated" ? (
            <Button variant="secondary"
              aria-label={uiT("Update {value0}", { value0: String(title) })}
              disabled={update.status === "updating"}
              onClick={() => void onUpdate()}
            >
              {update.status === "updating" ? (
                <Spinner className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
              )}
              {update.status === "updating"
                ? uiT("Updating")
                : update.status === "failed"
                  ? uiT("Retry")
                  : uiT("Update")}
            </Button>
          ) : null}
          {!available || installation.status === "installing" ? (
            <Button variant="secondary"
              aria-label={uiT("Download and install {value0}", { value0: title })}
              title={installUnavailableReason
                ? uiT(installUnavailableReason)
                : installation.status === "installing"
                  ? uiT("Installing…")
                  : uiT("Download and install this CLI on this computer")}
              aria-busy={installation.status === "installing"}
              aria-expanded={panel.open && panel.kind === "install"}
              aria-controls={panelId}
              onClick={() => togglePanel("install")}
            >
              {installation.status === "installing" ? (
                <Spinner className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownCircle className="size-3.5" aria-hidden />
              )}
              {uiT("Install")}
            </Button>
          ) : null}
          {available && !bundledBy ? (
            <Button variant="secondary"
              aria-label={uiT("Remove {value0} CLI", { value0: title })}
              title={uiT("Remove this CLI from this computer")}
              aria-busy={installation.status === "uninstalling"}
              aria-expanded={panel.open && panel.kind === "uninstall"}
              aria-controls={panelId}
              onClick={() => togglePanel("uninstall")}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {uiT("Remove")}
            </Button>
          ) : null}
          <Button variant="secondary"
            onClick={onUseDefault}
            disabled={isDefault || !canUseDefault}
          >
            {isDefault ? uiT("Default") : uiT("Use by default")}
          </Button>
        </div>
      </div>
      <AnimatedCollapse expanded={panel.open}>
        <ProviderCliPanel
          id={panelId}
          opening={panel.opening}
          harness={harness}
          kind={panel.kind}
          onClose={() => setPanel((current) => ({ ...current, open: false }))}
          onUpdated={onUpdated}
        />
      </AnimatedCollapse>
    </>
  );
}
