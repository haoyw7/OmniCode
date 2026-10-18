// Workflow views opened as workspace tabs: a run's detail (the run side
// pane: status, phases, agents with their runtimes, usage, artifacts) and a
// subagent's read-only transcript.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FilePaneTab, WorkflowAgentTabSource, WorkflowRunTabSource } from "../../workspace/model/layout";
import { AgentTranscript } from "../../sessions/ui/AgentTranscript";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { WorkflowRunSidePane } from "../kit/app-shell/WorkflowRunSidePane";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import type { WorkflowRunSidePaneTab } from "../kit/lib/workspaceSidePane";
import { watchHostSession, type HostSessionLease } from "../model/workflowSessionWatch";
import { useWorkflowApp } from "./workflowAppContext";

export function WorkflowRunTabView({ file }: { file: FilePaneTab & { workflowRun: WorkflowRunTabSource } }) {
  const app = useWorkflowApp();
  const source = file.workflowRun;
  const tab = useMemo<WorkflowRunSidePaneTab>(() => ({
    id: file.id,
    type: "workflow-run",
    workspaceKey: file.cwd,
    workspacePath: file.cwd,
    parentSessionId: source.parentSessionId,
    toolCallId: source.toolCallId ?? `workflow-${source.runId}`,
    runId: source.runId,
    ...(source.workflowName ? { workflowName: source.workflowName } : {}),
  }), [file.cwd, file.id, source.parentSessionId, source.runId, source.toolCallId, source.workflowName]);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="content-surface h-full min-h-0 overflow-y-auto font-sans" data-workflow-run-tab>
        <div className="mx-auto w-full max-w-3xl">
          <WorkflowRunSidePane
            tab={tab}
            {...(app
              ? {
                  onOpenWorkflowRun: (request) => app.openRun({
                    cwd: request.workspacePath,
                    parentSessionId: request.parentSessionId,
                    runId: request.runId,
                    toolCallId: request.toolCallId,
                    ...(request.workflowName ? { workflowName: request.workflowName } : {}),
                    ...(request.replaceRunId ? { replaceRunId: request.replaceRunId } : {}),
                  }),
                  onOpenWorkflowActorSession: (request) => {
                    if (request.actorSessionId)
                      app.openAgent({
                        cwd: request.workspacePath,
                        parentSessionId: request.parentSessionId,
                        runId: request.runId,
                        sessionId: request.actorSessionId,
                        title: request.actorName ?? request.siteId,
                        sourceFileId: file.id,
                      });
                  },
                }
              : {})}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

const subscribeNothing = () => () => {};

export function WorkflowAgentTabView({ file, visible, onOpenFile }: {
  file: FilePaneTab & { workflowAgent: WorkflowAgentTabSource };
  visible: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [lease, setLease] = useState<HostSessionLease | null>(null);
  const sessionId = file.workflowAgent.sessionId;
  useEffect(() => {
    if (!visible) return;
    const next = watchHostSession(file.cwd, sessionId);
    setLease(next);
    return () => next.release();
  }, [file.cwd, sessionId, visible]);
  const session = useSyncExternalStore(lease?.subscribe ?? subscribeNothing, () => lease?.getSnapshot(), () => undefined);
  if (!session) {
    return <div className="p-4 text-ui-sm text-foreground-subtle">{t("Loading this subagent's conversation…")}</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-workflow-agent-tab>
      <div className="border-b border-stroke px-4 py-2 text-ui-sm text-foreground-subtle">
        {t("Workflow subagent · read-only")}
      </div>
      <div className="min-h-0 flex-1">
        <AgentTranscript
          blocks={session.blocks}
          busy={!!session.busy}
          visible={visible}
          cwd={session.cwd}
          harness={session.harness}
          model={session.model}
          modelSettings={session.modelSettings}
          executionState={session.executionState}
          managed
          onApproval={(requestId, decision) => void lease?.approve(requestId, decision).catch(() => undefined)}
          {...(onOpenFile ? { onOpenFile } : {})}
        />
      </div>
    </div>
  );
}
