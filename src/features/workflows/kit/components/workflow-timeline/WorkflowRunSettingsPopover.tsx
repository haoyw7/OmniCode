// ============================================================
// Run settings popover
// ============================================================
// ZCode's popover (Apache-2.0) retunes one run-level subagent model and the
// concurrency limit. Monocode's version keeps the popover, the anchor model and
// the concurrency stepper, and replaces the single model with per-agent runtime
// rows: a default runtime, and for each subagent an optional override of its
// provider, model, thinking level and speed, picked with Monocode's model picker.
// Apply retunes the run in place: concurrency applies immediately, runtimes to
// subagents that start afterwards (and to the run's resume or amend).

import { useCallback, useRef, useState, type RefObject } from "react";
import { RotateCcw as RotateCcwIcon } from "../../../../../shared/ui/icons";
import type { WorkflowRunState } from "../../_shims/protocol.js";
import { Button } from "../../../../../shared/ui/forms/Button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "../../../../../shared/ui/primitives/Popover.js";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner.js";
import { useWorkflowIntl } from "../../i18n/IntlProvider.js";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { ModelControlPills, ModelPicker } from "../../../../sessions/ui/ModelPicker";
import { isWorkflowHarness } from "../../../../../integrations/workflow/modelConfig";
import type { WorkflowAgentRuntime } from "../../../../../integrations/workflow/createWorkflow";
import type { WorkflowRunSettings } from "../../../../../integrations/workflow/sessionTypes";
import type { HarnessId } from "../../../../sessions/model/session";
import { FieldLabel, WorkflowRunSettingsBoundField } from "./WorkflowRunSettingsFields.js";
import { workflowRunSettingsCeiling } from "./workflowRunSettings.js";

export interface WorkflowRunSettingsChange {
  maxConcurrency?: number | null;
  defaults?: WorkflowAgentRuntime | null;
  agents?: Record<string, WorkflowAgentRuntime> | null;
}

/** Everything the popover needs from its host: current settings, the session runtime, Apply. */
export interface WorkflowRunSettingsHost {
  workspacePath: string;
  settings: WorkflowRunSettings | undefined;
  /** The launching conversation's runtime (what subagents use without overrides). */
  sessionRuntime?: { harness: HarnessId; model: string; modelSettings: Record<string, string> };
  apply: (change: WorkflowRunSettingsChange) => Promise<{ status: string; message?: string }>;
}

export interface WorkflowRunSettingsAccepted {
  runId: string;
  toolCallId: string;
}

export function useWorkflowRunSettingsPopoverState() {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const toggleFrom = useCallback(
    (element: HTMLElement) => {
      if (open && anchorRef.current === element) {
        setOpen(false);
        return;
      }
      anchorRef.current = element;
      setOpen(true);
    },
    [open],
  );
  return { anchorRef, open, setOpen, toggleFrom };
}

type RuntimeDraft = { harness: HarnessId; model: string; modelSettings: Record<string, string> };

function draftOf(runtime: WorkflowAgentRuntime | undefined, fallback: RuntimeDraft | undefined): RuntimeDraft | undefined {
  if (!runtime) return undefined;
  const harness = runtime.provider && isWorkflowHarness(runtime.provider) ? runtime.provider : fallback?.harness;
  if (!harness) return undefined;
  const model = runtime.model ? (runtime.model.startsWith(`${harness}:`) ? runtime.model : `${harness}:${runtime.model}`) : fallback?.harness === harness ? fallback.model : `${harness}:default`;
  return { harness, model, modelSettings: runtime.modelSettings ?? (fallback?.harness === harness ? fallback.modelSettings : {}) };
}

function runtimeOf(draft: RuntimeDraft): WorkflowAgentRuntime {
  return { provider: draft.harness, model: draft.model, modelSettings: draft.modelSettings };
}

function RuntimeRow({ label, draft, seed, cwd, placeholder, onChange, onReset }: {
  label: string;
  /** Where a new override starts: the default runtime, else the conversation's. */
  seed: RuntimeDraft | undefined;
  draft: RuntimeDraft | undefined;
  cwd: string;
  placeholder: string;
  onChange: (draft: RuntimeDraft) => void;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const shown = draft;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="workflow-run-settings-runtime">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        {draft && onReset ? (
          <button type="button" className="flex items-center gap-1 text-ui-xs text-foreground-subtlest hover:text-foreground-subtle" onClick={onReset}>
            <RotateCcwIcon className="size-3" aria-hidden="true" />
            {t("Inherit")}
          </button>
        ) : null}
      </div>
      {shown ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ModelPicker
            harness={shown.harness}
            model={shown.model}
            values={shown.modelSettings}
            project={cwd}
            hideSettings
            onChange={(harness, model) => onChange({ harness, model, modelSettings: harness === shown.harness ? shown.modelSettings : {} })}
            onSettingsChange={(modelSettings) => onChange({ ...shown, modelSettings })}
          />
          <ModelControlPills
            harness={shown.harness}
            model={shown.model}
            values={shown.modelSettings}
            onSettingsChange={(modelSettings) => onChange({ ...shown, modelSettings })}
          />
        </div>
      ) : (
        <button
          type="button"
          className="w-fit rounded-md border border-dashed border-border px-2 py-1 text-ui-sm text-foreground-subtle hover:border-border-hover hover:text-foreground"
          onClick={() => onChange(seed ?? { harness: "claude", model: "claude:sonnet-5", modelSettings: {} })}
        >
          {placeholder}
        </button>
      )}
    </div>
  );
}

export function WorkflowRunSettingsPopover({
  anchorRef,
  host,
  onOpenChange,
  open,
  run,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  host: WorkflowRunSettingsHost;
  onAccepted?: (accepted: WorkflowRunSettingsAccepted) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  run: WorkflowRunState;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        align="end"
        className="w-[26rem] max-w-[calc(100vw-2rem)] gap-2.5"
        data-testid="workflow-run-settings-popover"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault();
          // The model picker renders its menu outside the popover.
          if (target instanceof Element && target.closest("[data-model-picker], .model-picker, [role='listbox'], [role='menu']")) event.preventDefault();
        }}
      >
        <WorkflowRunSettingsForm host={host} subject={settingsSubjectOfRun(run)} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** What the form edits: a run's agents and limits, live, settled, or not started yet. */
export interface WorkflowRunSettingsSubject {
  agentNames: readonly string[];
  ceiling: number | undefined;
  stage: "live" | "settled" | "pending";
  /** The runtime an agent ran on, shown when it has no override. */
  actorRuntime?: (name: string) => string | undefined;
}

function settingsSubjectOfRun(run: WorkflowRunState): WorkflowRunSettingsSubject {
  return {
    agentNames: [...new Set(run.actors.map((actor) => actor.name).filter((name): name is string => !!name))],
    ceiling: workflowRunSettingsCeiling(run),
    stage: run.status === "running" || run.status === "pending" ? "live" : "settled",
    actorRuntime: (name) => run.actors.find((actor) => actor.name === name)?.runtime?.label,
  };
}

export function WorkflowRunSettingsForm({ host, subject, onClose, applyLabel }: {
  host: WorkflowRunSettingsHost;
  subject: WorkflowRunSettingsSubject;
  onClose: () => void;
  applyLabel?: string;
}) {
  const { intl } = useWorkflowIntl();
  const { t } = useTranslation();
  const session = host.sessionRuntime;
  const ceiling = subject.ceiling;
  const [bound, setBound] = useState<number | null>(host.settings?.maxConcurrency ?? ceiling ?? null);
  const [defaults, setDefaults] = useState<RuntimeDraft | undefined>(() => draftOf(host.settings?.defaults, session));
  const agentNames = subject.agentNames;
  const [agents, setAgents] = useState<Record<string, RuntimeDraft | undefined>>(() =>
    Object.fromEntries(agentNames.map((name) => [name, draftOf(host.settings?.agents?.[name], defaults ?? session)])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const apply = async () => {
    setPending(true);
    setError(undefined);
    const overrides = Object.fromEntries(Object.entries(agents).filter((entry): entry is [string, RuntimeDraft] => entry[1] !== undefined).map(([name, draft]) => [name, runtimeOf(draft)]));
    try {
      const result = await host.apply({
        maxConcurrency: bound,
        defaults: defaults ? runtimeOf(defaults) : null,
        agents: Object.keys(overrides).length ? overrides : null,
      });
      if (result.status === "accepted") onClose();
      else setError(result.message ?? intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.rejected.generic", defaultMessage: "The change was not applied." }));
    } finally {
      setPending(false);
    }
  };

  const actorRuntime = (name: string) => subject.actorRuntime?.(name);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {subject.stage === "pending" ? null : (
        <PopoverTitle className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.title" })}
        </PopoverTitle>
      )}

      <RuntimeRow
        label={t("Default subagent model")}
        draft={defaults}
        seed={session}
        cwd={host.workspacePath}
        placeholder={session ? t("Conversation model ({model})", { model: session.model }) : t("Conversation model")}
        onChange={setDefaults}
        {...(defaults ? { onReset: () => setDefaults(undefined) } : {})}
      />

      {agentNames.length ? (
        <div className="flex max-h-64 min-w-0 flex-col gap-2.5 overflow-y-auto pr-1">
          {agentNames.map((name) => (
            <RuntimeRow
              key={name}
              label={name}
              draft={agents[name]}
              seed={defaults ?? session}
              cwd={host.workspacePath}
              placeholder={actorRuntime(name) ?? t("Uses the default")}
              onChange={(draft) => setAgents((current) => ({ ...current, [name]: draft }))}
              onReset={() => setAgents((current) => ({ ...current, [name]: undefined }))}
            />
          ))}
        </div>
      ) : null}

      <WorkflowRunSettingsBoundField bound={bound} ceiling={ceiling} disabled={pending} onChange={setBound} />

      <p className="text-ui-xs text-foreground-subtle">
        {subject.stage === "live"
          ? t("Concurrency changes apply now. Model changes apply to subagents that start after this; running ones keep their model.")
          : subject.stage === "pending"
            ? t("These settings apply when you start the run.")
            : t("These settings apply when the run is resumed or amended.")}
      </p>

      {error ? <p className="text-ui-xs text-destructive" role="alert">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          {t("Cancel")}
        </Button>
        <Button size="sm" onClick={() => void apply()} disabled={pending} data-testid="workflow-run-settings-apply">
          {pending ? <Spinner className="size-3" /> : null}
          {applyLabel ?? intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.apply" })}
        </Button>
      </div>
    </div>
  );
}
