import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { Button } from "../../../../../shared/ui/forms/Button";
import { ArrowDownCircle, FolderOpen, Trash2 } from "../../../../../shared/ui/icons";
import {
  localHarnessCliPlan,
} from "../../../../../platform/tauri/harnessInstall";
import { revealPath } from "../../../../../platform/tauri/fs";
import {
  harnessInstallUnavailableReason,
  runHarnessInstall,
  runHarnessUninstall,
  useHarnessInstall,
} from "../../../../providers/model/harnessInstall";
import { runtimeProviderBinaryPath } from "../../../../providers/model/providerBinaryPaths";
import type { HarnessId } from "../../../../sessions/model/session";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner";

export type ProviderCliPanelKind = "install" | "uninstall";

/** Inline install or removal step under a provider row. */
export function ProviderCliPanel({
  id,
  opening,
  harness,
  kind,
  onClose,
  onUpdated,
}: {
  id: string;
  /** Changes on each opening so the plan is re-read; the CLI may have changed. */
  opening: number;
  harness: HarnessId;
  kind: ProviderCliPanelKind;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t: uiT } = useTranslation();
  const { state, busy } = useHarnessInstall(harness);
  const unavailable = harnessInstallUnavailableReason(harness);
  const settled = state.status === "installed" || state.status === "uninstalled";

  const planRead = useQuery({ queryKey: ["harnessCliPlan", harness, kind, opening, settled, runtimeProviderBinaryPath(harness)], queryFn: () => localHarnessCliPlan(harness, runtimeProviderBinaryPath(harness)) }, queryClient);
  const plan = planRead.data, planError = planRead.error ? String(planRead.error instanceof Error ? planRead.error.message : planRead.error) : null;
  const operation = useMutation({ mutationFn: () => kind === "install" ? runHarnessInstall(harness) : runHarnessUninstall(harness), onSuccess: () => onUpdated() }, queryClient);

  const failure = state.status === "failed" && state.action === kind ? state.error : null;
  const running = kind === "install"
    ? state.status === "installing"
    : state.status === "uninstalling";
  const code = kind === "install"
    ? plan?.installCommand
    : plan?.uninstallCommand ?? (plan?.removes.length ? plan.removes.join("\n") : null);

  let summary: string;
  if (planError) summary = planError;
  else if (!plan) summary = uiT("Checking the CLI location…");
  else if (kind === "install") {
    summary = unavailable
      ? uiT(unavailable)
      : plan.installCommand?.startsWith("npm ")
        ? uiT("Installs the npm package globally. Requires Node.js.")
        : uiT("Runs the official installer for your user account.");
  } else if (!plan.path) summary = uiT("No CLI was found to remove.");
  else if (plan.uninstallBlocker) summary = uiT(plan.uninstallBlocker);
  else if (plan.uninstallCommand) summary = uiT("Removes the global npm package:");
  else summary = uiT("Removes these files:");

  const canUninstall = Boolean(plan?.path && !plan.uninstallBlocker);
  const run = () => {
    operation.mutate();
  };

  return (
    <div id={id} className="px-4 pb-3">
      <div
        className={`rounded-lg border px-3 py-2.5 text-ui-caption leading-5 text-foreground-subtle ${
          kind === "uninstall" ? "border-destructive/30" : "border-border"
        }`}
      >
        <p>{summary}</p>
        {code && !(kind === "uninstall" && plan?.uninstallBlocker) ? (
          <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-md bg-content/5 px-2 py-1.5 font-mono text-[11px] text-content/70">
            {code}
          </pre>
        ) : null}
        {kind === "uninstall" && plan?.path && plan.uninstallBlocker ? (
          <p className="mt-1.5 break-all font-mono text-[11px] text-content/55">{plan.path}</p>
        ) : null}
        {kind === "uninstall" && canUninstall ? (
          <p className="mt-1.5">{uiT("Settings and sign-in data are kept.")}</p>
        ) : null}
        {running ? (
          <p role="status" className="mt-1.5 flex items-center gap-1.5 text-foreground">
            <Spinner className="size-3.5" aria-hidden />
            {kind === "install"
              ? uiT("Downloading and installing CLI…")
              : uiT("Removing CLI…")}
          </p>
        ) : failure ? (
          <p role="alert" className="mt-1.5 whitespace-pre-wrap break-words text-destructive">
            {kind === "install"
              ? uiT("Installation failed: {error}", { error: failure })
              : uiT("Removal failed: {error}", { error: failure })}
          </p>
        ) : kind === "uninstall" && state.status === "uninstalled" && state.remaining ? (
          <p role="status" className="mt-1.5 text-foreground">
            {uiT("Removed. Another copy of this CLI is still detected and will be used.")}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {kind === "uninstall" && plan?.path && plan.uninstallBlocker ? (
            <Button variant="secondary" size="sm" onClick={() => void revealPath(plan.path!)}>
              <FolderOpen aria-hidden />
              {uiT("Show in folder")}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {running || (kind === "uninstall" && !canUninstall) ? uiT("Close") : uiT("Cancel")}
          </Button>
          {kind === "install" ? (
            <Button variant="primary" size="sm"
              aria-busy={running}
              disabled={busy || Boolean(unavailable) || !plan?.installCommand}
              onClick={run}
            >
              <ArrowDownCircle aria-hidden />
              {failure ? uiT("Retry") : uiT("Install")}
            </Button>
          ) : canUninstall ? (
            <Button variant="danger" size="sm"
              aria-busy={running}
              disabled={busy}
              onClick={run}
            >
              <Trash2 aria-hidden />
              {failure ? uiT("Retry") : uiT("Remove CLI")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
