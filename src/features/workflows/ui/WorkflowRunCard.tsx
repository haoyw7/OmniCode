import { RotatingIcon } from "../../../shared/ui/RotatingIcon";
import { motionGeometry } from "../../../shared/motion/tokens";
// A workflow run's card in its launching conversation: the run digest
// (horizontal phase timeline, agent pills, artifacts) over the Host's live run
// state, or — while an agent-launched run waits — the approval view with
// Run / Discard.
import { useMemo, useState } from "react";
import type { Block, Session } from "../../sessions/model/session";

/** The launching conversation, as the transcript knows it. */
export type WorkflowRunParent = Pick<Session, "id" | "harness" | "model" | "modelSettings" | "workflowRuns"> & {
  /** Project folder (desktop path) whose Host runs the workflow. */
  cwd: string;
};
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { WorkflowRunDigest } from "../kit/components/workflow-timeline/WorkflowRunDigest";
import {
  WorkflowRunSettingsForm,
  type WorkflowRunSettingsHost,
} from "../kit/components/workflow-timeline/WorkflowRunSettingsPopover";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { ChevronRight } from "../../../shared/ui/icons";
import { isWorkflowRunConfigurable } from "../kit/components/workflow-timeline/workflowRunSettings";
import { WorkflowPermissionBlock } from "../kit/WorkflowPermissionBlock";
import { Button } from "../../../shared/ui/forms/Button";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import { V4PaneConversationProvider } from "../kit/v4/V4ConversationContext";
import { buildWorkflowRunByRunId } from "../kit/v4/workflowRunCardJoin";
import { workflowActions } from "../model/workflowClient";
import { useWorkflowApp } from "./workflowAppContext";

export function WorkflowRunCard({ block, parent: session }: { block: Block; parent: WorkflowRunParent }) {
  const cwd = session.cwd;
  const meta = block.workflowRun!;
  const app = useWorkflowApp();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const summary = useMemo(() => buildWorkflowRunByRunId(session.workflowRuns?.runs).get(meta.runId), [meta.runId, session.workflowRuns]);
  const scope = useMemo(() => ({ workspacePath: cwd }), [cwd]);
  const run = summary?.run;
  const [configuring, setConfiguring] = useState(false);
  const agentNames = useMemo(
    () => [...new Set((meta.graph?.lanes ?? []).map((lane) => lane.name).filter((name): name is string => !!name))],
    [meta.graph],
  );

  const act = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    void action()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const settingsHostFor = (): WorkflowRunSettingsHost => ({
    workspacePath: cwd,
    settings: meta.settings,
    sessionRuntime: { harness: session.harness, model: session.model, modelSettings: session.modelSettings ?? {} },
    apply: async (change) => {
      await workflowActions.retune(cwd, meta.runId, change);
      return { status: "accepted" };
    },
  });

  if (meta.approval === "pending") {
    const request = {
      type: "permission_request" as const,
      taskId: session.id,
      requestId: meta.runId,
      description: "",
      kind: "CreateWorkflow",
      options: [],
      raw: {
        name: meta.name,
        ...(meta.settings.maxConcurrency ? { max_concurrency: meta.settings.maxConcurrency } : {}),
        ...(meta.source.kind === "saved" ? { saved: { name: meta.source.name, scope: meta.source.scope, args: {} } } : {}),
      },
      ...(meta.graph ? { display: { kind: "create_workflow" as const, causalityGraph: meta.graph } } : {}),
    };
    return (
      <TooltipProvider delayDuration={300}>
        <div className="desktop-card flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 font-sans" data-workflow-approval>
          <WorkflowPermissionBlock request={request} />
          {meta.commands?.length ? (
            <p className="text-ui-xs text-foreground-subtle">
              {t("Commands this workflow may run: {commands}", { commands: meta.commands.join(", ") })}
            </p>
          ) : null}
          {app ? (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <button
                type="button"
                aria-expanded={configuring}
                className="flex w-fit items-center gap-1 text-ui-sm text-foreground-subtle hover:text-foreground"
                onClick={() => setConfiguring((value) => !value)}
              >
                <RotatingIcon icon={ChevronRight} angle={configuring ? motionGeometry.disclosureAngle : 0} className="size-3.5" aria-hidden="true" />
                {t("Adjust configuration")}
              </button>
              <AnimatedCollapse expanded={configuring} motion="height">
                {() => (
                  <WorkflowRunSettingsForm
                    // Remount on each settings change so the form starts from what is saved.
                    key={JSON.stringify(meta.settings)}
                    host={settingsHostFor()}
                    subject={{ agentNames, ceiling: undefined, stage: "pending" }}
                    applyLabel={t("Save configuration")}
                    onClose={() => setConfiguring(false)}
                  />
                )}
              </AnimatedCollapse>
            </div>
          ) : null}
          {error ? <p className="text-ui-xs text-destructive" role="alert">{error}</p> : null}
          {app ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => workflowActions.discard(cwd, meta.runId))}>
                {t("Discard")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => act(() => workflowActions.approve(cwd, meta.runId))}>
                {t("Run workflow")}
              </Button>
            </div>
          ) : null}
        </div>
      </TooltipProvider>
    );
  }
  if (meta.approval === "discarded") {
    return <p className="px-1 text-ui-sm text-foreground-subtle">{t("Workflow “{name}” was discarded.", { name: meta.name })}</p>;
  }

  const settingsHost: WorkflowRunSettingsHost | undefined = app && isWorkflowRunConfigurable(run) ? settingsHostFor() : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <V4PaneConversationProvider scope={scope}>
        <WorkflowRunDigest
          name={meta.name}
          runId={meta.runId}
          graph={meta.graph}
          summary={summary}
          pendingQuestions={run?.pendingQuestions?.length ?? 0}
          testIdKey={block.id}
          {...(settingsHost ? { settingsHost } : {})}
          {...(app
            ? {
                onOpenRun: () => app.openRun({ cwd, parentSessionId: session.id, runId: meta.runId, toolCallId: block.id, workflowName: meta.name }),
                onCancel: () => act(() => workflowActions.cancel(cwd, meta.runId)),
                onResume: () => act(() => workflowActions.resume(cwd, meta.runId)),
                onOpenPill: (pill) => {
                  const sessionId = pill.instance?.sessionId;
                  if (sessionId) app.openAgent({ cwd, parentSessionId: session.id, runId: meta.runId, sessionId, title: pill.runtimeName ?? meta.name });
                },
                onOpenArtifact: () => app.openRun({ cwd, parentSessionId: session.id, runId: meta.runId, toolCallId: block.id, workflowName: meta.name }),
              }
            : {})}
        />
        {error ? <p className="px-1 pt-1 text-ui-xs text-destructive" role="alert">{error}</p> : null}
      </V4PaneConversationProvider>
    </TooltipProvider>
  );
}
