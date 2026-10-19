import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import {
  ArrowDownCircle,
  ExternalLink,
  FolderOpen,
  Loader,
  Pencil,
  RefreshCw,
} from "../../../../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { HarnessIcon } from "../../../../sessions/ui/HarnessIcon";
import { Popover } from "../../../../../shared/ui/Popover";
import { Button } from "../../../../../shared/ui/forms/Button";
import {
  hasHarnessUpdate,
  type HarnessVersionInfo,
} from "../../../../providers/model/harnessUpdates";
import {
  harnessInstallUnavailableReason,
  runHarnessInstall,
  useHarnessInstall,
} from "../../../../providers/model/harnessInstall";
import {
  runHarnessUpdate,
  type HarnessUpdateState,
} from "../../../../providers/ui/HarnessUpdateNotice";
import {
  harnessUnavailableHint,
  isHarnessAvailable,
} from "../../../../../integrations/harness/core/availability";
import {
  inspectHarnessBinary,
  type HarnessBinaryInspection,
} from "../../../../../integrations/harness/core/child";
import {
  loadProviderBinaryPath,
  providerBinaryPathChangePending,
  saveProviderBinaryPath,
  type ConfigurableBinaryProvider,
} from "../../../../providers/model/providerBinaryPaths";
import {
  compareSemver,
  MINIMUM_OPENCODE_VERSION,
  parseOpenCodeVersion,
} from "../../../../../integrations/harness/providers/opencode/opencodeProtocol";
import { refreshHarnessCatalogs } from "../../../../../integrations/harness/core/registry";
import { hasFreshCatalog, modelsFor, resolveModel } from "../../../../sessions/model/models";
import { revealPath } from "../../../../../platform/tauri/fs";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import { Row, Toggle } from "../../settingsLayout";



function binaryInspectionError(
  provider: ConfigurableBinaryProvider,
  inspection: HarnessBinaryInspection,
): string | null {
  if (inspection.error) return inspection.error;
  if (
    provider === "codex" &&
    !/^codex-cli\s+\d+\.\d+\.\d+/.test(inspection.version ?? "")
  ) {
    return "Codex CLI returned an invalid version.";
  }
  if (provider === "opencode") {
    const version = parseOpenCodeVersion(inspection.version ?? "");
    if (!version) return "OpenCode CLI returned an invalid version.";
    if (compareSemver(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`;
    }
  }
  return null;
}

function ProviderBinaryControl({
  provider,
}: {
  provider: ConfigurableBinaryProvider;
}) {
  const { t: uiT } = useTranslation();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    () => loadProviderBinaryPath(provider) ?? "",
  );
  const [overridden, setOverridden] = useState(() =>
    Boolean(loadProviderBinaryPath(provider)),
  );
  const [inspection, setInspection] = useState<
    HarnessBinaryInspection & { overridden: boolean }
  >();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const inspect = useCallback(
    async (binaryPath?: string | null) => {
      setWorking(true);
      setInspection(undefined);
      setError(null);
      setRevealError(null);
      try {
        const next = await inspectHarnessBinary(provider, binaryPath);
        setInspection({
          ...next,
          overridden: Boolean(binaryPath?.trim()),
        });
        setError(binaryInspectionError(provider, next));
        return next;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        return null;
      } finally {
        setWorking(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    if (editing) editInput.current?.focus();
  }, [editing]);

  const dismiss = (restoreFocus = false) => {
    setOpen(false);
    setEditing(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    const value = draft.trim();
    if (!value) {
      await useAuto();
      return;
    }
    const next = await inspect(value);
    if (!next) return;
    const validationError = binaryInspectionError(provider, next);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!saveProviderBinaryPath(provider, value)) {
      setInspection(undefined);
      setError("Could not save the binary path.");
      return;
    }
    setOverridden(true);
    dismiss(true);
  };

  const useAuto = async () => {
    if (working) return;
    const next = await inspect(null);
    if (!next || binaryInspectionError(provider, next)) return;
    if (!saveProviderBinaryPath(provider, null)) {
      setInspection(undefined);
      setError("Could not save the binary path.");
      return;
    }
    setDraft("");
    setOverridden(false);
    dismiss(true);
  };

  const title = HARNESS_TITLE[provider];
  const restartRequired = providerBinaryPathChangePending(provider);

  return (
    <span ref={root} className="inline-flex align-middle">
      <button
        ref={trigger}
        type="button"
        aria-label={
          restartRequired
            ? uiT("Show {value0} CLI details, restart required", {
                value0: String(title),
              })
            : uiT("Show {value0} CLI details", { value0: String(title) })
        }
        aria-expanded={open}
        aria-controls={`${provider}-binary-popover`}
        aria-haspopup="dialog"
        title={uiT("{value0} CLI path{value1}", {
          value0: String(title),
          value1: String(restartRequired ? " — restart required" : ""),
        })}
        onClick={() => {
          if (!open && !inspection && !working && !error) {
            void inspect(loadProviderBinaryPath(provider));
          }
          setOpen((value) => !value);
          setEditing(false);
        }}
        className={`grid size-6 place-items-center rounded hover:bg-content/6 focus-visible:outline-2 focus-visible:outline-accent ${
          restartRequired
            ? "text-amber-300"
            : "text-content/35 hover:text-content"
        }`}
      >
        <FolderOpen className="size-3.5" />
      </button>
      <Popover
        open={open}
        id={`${provider}-binary-popover`}
        role="dialog"
        aria-label={uiT("{value0} CLI details", { value0: String(title) })}
        aria-busy={working}
        tabIndex={-1}
        anchor={root}
        side="bottom"
        align="start"
        width={440}
        className="p-3"
        autoFocus
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            ),
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onDismiss={(reason) => dismiss(reason === "escape")}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-content">
            {title} {uiT("CLI")}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] text-content/50">
              {uiT("Global path")}
            </span>
            <span className="rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] text-content/50">
              {error
                ? uiT("Needs attention")
                : restartRequired
                  ? uiT("Restart required")
                  : overridden
                    ? uiT("Configured")
                    : uiT("Auto-detected")}
            </span>
          </div>
        </div>
        {editing ? (
          <form className="mt-2" onSubmit={submit}>
            <label
              htmlFor={`${provider}-binary-path`}
              className="text-[11px] text-content/50"
            >
              {uiT("CLI path")}
            </label>
            <input data-ui="input"
              id={`${provider}-binary-path`}
              ref={editInput}
              type="text"
              value={draft}
              placeholder={inspection?.path ?? uiT("Auto-detected path")}
              disabled={working}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1.5 h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2 font-mono text-[11px] text-content outline-none placeholder:font-sans placeholder:text-content/35 focus:border-input-border-hover disabled:opacity-50"
            />
            <p className="mt-1.5 text-[10px] text-content/40">
              {uiT(
                "Enter the absolute path to the CLI executable. Changes apply after restarting OmniCode.",
              )}
            </p>
            {error ? (
              <span
                role="alert"
                className="mt-1.5 block text-[11px] text-red-400"
              >
                {error}
              </span>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary"
                disabled={working}
                onClick={() => {
                  setDraft(loadProviderBinaryPath(provider) ?? "");
                  setEditing(false);
                  queueMicrotask(() => trigger.current?.focus());
                }}
              >
                {uiT("Cancel")}
              </Button>
              {overridden ? (
                <Button variant="secondary"
                  disabled={working}
                  onClick={() => void useAuto()}
                >
                  {uiT("Use auto-detected path")}
                </Button>
              ) : null}
              <Button variant="secondary" type="submit" disabled={working}>
                {uiT("Save path")}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-2 rounded-md border border-content/10 bg-content/[0.03] px-2.5 py-2">
              <span className="block max-h-12 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-content/65">
                {inspection?.path ??
                  (error
                    ? uiT("CLI could not be resolved")
                    : uiT("Checking the selected CLI…"))}
              </span>
              <span className="mt-1 block max-h-10 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-content/40">
                {inspection?.version ??
                  (error
                    ? uiT("Retry to check this CLI")
                    : uiT("Checking version…"))}
              </span>
            </div>
            {error ? (
              <span
                role="alert"
                title={error}
                className="mt-1.5 block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-red-400"
              >
                {error}
              </span>
            ) : null}
            {revealError ? (
              <span
                role="alert"
                className="mt-1.5 block max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-red-400"
              >
                {uiT("Could not open the CLI location: ")}
                {revealError}
              </span>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              {error ? (
                <Button variant="secondary"
                  disabled={working}
                  aria-label={uiT("Retry {value0} {value1}", {
                    value0: String(title),
                    value1: String(
                      overridden ? "configured path" : "auto-detect",
                    ),
                  })}
                  onClick={() =>
                    void inspect(overridden ? draft.trim() || null : null)
                  }
                >
                  <RefreshCw className="size-3.5" />
                  {overridden
                    ? uiT("Retry configured path")
                    : uiT("Retry auto-detect")}
                </Button>
              ) : null}
              <Button variant="secondary"
                aria-label={uiT("Open {value0} CLI location", {
                  value0: String(title),
                })}
                disabled={!inspection}
                onClick={() => {
                  if (inspection) {
                    void revealPath(inspection.path).catch((cause) => {
                      setRevealError(
                        cause instanceof Error
                          ? cause.message
                          : String(cause),
                      );
                    });
                  }
                }}
              >
                <ExternalLink className="size-3.5" />
                {uiT("Open location")}
              </Button>
              <Button variant="secondary"
                aria-label={uiT("Edit {value0} CLI path", {
                  value0: String(title),
                })}
                disabled={working}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" />
                {uiT("Edit path")}
              </Button>
            </div>
          </>
        )}
      </Popover>
    </span>
  );
}

export function ProviderRow({
  harness,
  selectedModel,
  isDefault,
  inPicker,
  pickerLocked = false,
  version,
  onUpdated,
  onDefault,
  onModelChange,
  onPickerVisible,
}: {
  harness: HarnessId;
  selectedModel: string;
  isDefault: boolean;
  inPicker: boolean;
  /** Globally hidden providers cannot be turned on per project. */
  pickerLocked?: boolean;
  version?: HarnessVersionInfo;
  /** Re-reads the installed version once a self-update finishes. */
  onUpdated: () => void;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onPickerVisible: (visible: boolean) => void;
}) {
  const { t: uiT } = useTranslation();
  const models = modelsFor(harness);
  const available = isHarnessAvailable(harness);
  const { state: installation, busy: installingAny } = useHarnessInstall(harness);
  const installUnavailableReason = harnessInstallUnavailableReason(harness);
  const current =
    models.length > 0 ? resolveModel(harness, selectedModel) : null;

  useEffect(() => {
    if (!available || hasFreshCatalog(harness)) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness]);

  const [update, setUpdate] = useState<HarnessUpdateState>({
    status: "idle",
  });
  const installed = available ? version?.installed : undefined;
  const latest = version?.latest;
  const bundledBy = available ? version?.bundledBy : undefined;
  const behind = available && hasHarnessUpdate(version);
  // A bundled copy updates only with its app, so it never gets an Update button.
  const updatable = behind && !bundledBy;
  const onUpdate = async () => {
    if (!installed || !latest || update.status === "updating") return;
    setUpdate({ status: "updating" });
    const result = await runHarnessUpdate({ harness, installed, latest });
    setUpdate(result);
    onUpdated();
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
  // Saved path overrides apply on the next launch, like the CLI path editor.
  const [binaryRevision, setBinaryRevision] = useState(0);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const pendingPath = providerBinaryPathChangePending(harness)
    ? loadProviderBinaryPath(harness)
    : null;
  const newerCopy = bundledBy ? version?.newerCopy : undefined;
  const switched = newerCopy != null && pendingPath === newerCopy.path;
  const onUseCopy = async (copy: { path: string; version: string }) => {
    if (switching) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const inspection = await inspectHarnessBinary(harness, copy.path);
      const problem = binaryInspectionError(harness, inspection);
      if (problem) throw new Error(problem);
      if (!saveProviderBinaryPath(harness, copy.path)) {
        throw new Error("Could not save the binary path.");
      }
      setBinaryRevision((value) => value + 1);
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(false);
    }
  };
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
        value0: String(models.length),
        value1: String(models.length === 1 ? "model" : "models"),
      })
    : harnessUnavailableHint(harness);

  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <HarnessIcon harness={harness} className="size-4 shrink-0" />
          {HARNESS_TITLE[harness]}
          <ProviderBinaryControl key={binaryRevision} provider={harness} />
          {isDefault ? (
            <span className="rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content/60">
              {uiT("Default")}
            </span>
          ) : null}
        </span>
      }
      description={
        installation.status === "installing" ? (
          <span role="status">{uiT("Downloading and installing CLI…")}</span>
        ) : installation.status === "failed" ? (
          <span role="alert" className="whitespace-pre-wrap break-words text-destructive">
            {uiT("Installation failed: {error}", { error: installation.error })}
          </span>
        ) : !available && installUnavailableReason ? (
          uiT(installUnavailableReason)
        ) : update.status === "failed" ? (
          update.error
        ) : switchError ? (
          switchError
        ) : versionText ? (
          <>
            {versionText}
            {sourceText ? ` · ${sourceText}` : null} · {modelsText}
          </>
        ) : (
          modelsText
        )
      }
    >
      {!available || installation.status === "installing" ? (
        <Button variant="secondary"
          aria-label={uiT("Download and install {value0}", {
            value0: HARNESS_TITLE[harness],
          })}
          title={installUnavailableReason
            ? uiT(installUnavailableReason)
            : uiT("Download and install this CLI on this computer")}
          aria-busy={installation.status === "installing"}
          disabled={installingAny || Boolean(installUnavailableReason)}
          onClick={() => void runHarnessInstall(harness).then(onUpdated)}
        >
          <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
          {installation.status === "installing"
            ? uiT("Installing…")
            : installation.status === "failed"
              ? uiT("Retry download")
              : uiT("One-click download")}
        </Button>
      ) : null}
      {newerCopy && !switched ? (
        <Button variant="secondary"
          aria-label={uiT("Use {value0} {value1} at {value2}", {
            value0: String(HARNESS_TITLE[harness]),
            value1: newerCopy.version,
            value2: newerCopy.path,
          })}
          title={newerCopy.path}
          disabled={switching}
          onClick={() => void onUseCopy(newerCopy)}
        >
          {switching ? (
            <Loader className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
          )}
          {uiT("Use {value0}", { value0: newerCopy.version })}
        </Button>
      ) : null}
      {updatable && update.status !== "updated" ? (
        <Button variant="secondary"
          aria-label={uiT("Update {value0}", {
            value0: String(HARNESS_TITLE[harness]),
          })}
          disabled={update.status === "updating"}
          onClick={() => void onUpdate()}
        >
          {update.status === "updating" ? (
            <Loader className="size-3.5 animate-spin" aria-hidden />
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
      {current ? (
        <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
          label={uiT("{value0} model", {
            value0: String(HARNESS_TITLE[harness]),
          })}
          value={current.id}
          onChange={(next) => onModelChange(harness, next)}
          onOpen={() => {
            // Fallbacks keep models non-empty and routine refreshes skip live
            // catalogs. Explicitly opening the picker must refresh either one.
            if (available) {
              void refreshHarnessCatalogs([harness], { force: true });
            }
          }}
          options={models.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
      ) : null}
      <Button variant="secondary"
        onClick={() => current && onDefault(harness, current.id)}
        disabled={isDefault || !current}
      >
        {isDefault ? uiT("Default") : uiT("Use by default")}
      </Button>
      {available ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-content/50">
            {pickerLocked ? uiT("Hidden globally") : uiT("Show in picker")}
          </span>
          <Toggle
            label={uiT("Show {value0} in the model picker", {
              value0: String(HARNESS_TITLE[harness]),
            })}
            on={inPicker}
            onChange={onPickerVisible}
            disabled={pickerLocked}
          />
        </div>
      ) : null}
    </Row>
  );
}
