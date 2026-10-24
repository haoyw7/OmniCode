// Workflow views opened as workspace tabs: a run's detail (the run side
// pane: status, phases, agents with their runtimes, usage, artifacts) and a
// subagent's read-only transcript.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FilePaneTab, WorkflowAgentTabSource, WorkflowRunTabSource, WorkflowArtifactTabSource } from "../../workspace/model/layout";
import { useWorkflowPresentation } from "./workflowPresentation";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { WorkflowRunSidePane } from "../kit/app-shell/WorkflowRunSidePane";
import { TooltipProvider } from "../../../shared/ui/primitives/Tooltip";
import type { WorkflowRunSidePaneTab } from "../kit/lib/workspaceSidePane";
import { watchHostSession, type HostSessionLease } from "../model/workflowSessionWatch";
import { useWorkflowApp } from "./workflowAppContext";
import { V4PaneConversationProvider, useV4Conversation } from "../kit/v4/V4ConversationContext";
import { useConversationProjection } from "../kit/v4/useConversationProjection";
import { useWorkflowRunArtifacts } from "../kit/hooks/useWorkflowRunArtifacts";
import { useWorkflowIntl } from "../kit/i18n/IntlProvider";
import { WorkflowArtifactContent } from "../kit/app-shell/workflow-artifacts/WorkflowArtifactContent";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { revealPath } from "../../../platform/tauri/fs";

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
                  onOpenWorkflowArtifact: (request) => app.openArtifact({
                    cwd: request.workspacePath,
                    parentSessionId: request.parentSessionId,
                    runId: request.runId,
                    artifactId: request.artifactId,
                    title: request.title,
                    kind: request.kind,
                    contentType: request.contentType,
                    sourcePath: request.sourcePath,
                    sourceFileId: file.id,
                  }),
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
                        ...(request.avatar ? { avatar: request.avatar } : {}),
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

type ArtifactTabFile = FilePaneTab & { workflowArtifact: WorkflowArtifactTabSource };

export function WorkflowArtifactTabView({ file }: { file: ArtifactTabFile }) {
  const scope = useMemo(() => ({ workspacePath: file.cwd }), [file.cwd]);
  return (
    <V4PaneConversationProvider scope={scope}>
      <WorkflowArtifactView key={`${file.cwd}:${file.workflowArtifact.parentSessionId}:${file.workflowArtifact.runId}:${file.workflowArtifact.artifactId}`} file={file} />
    </V4PaneConversationProvider>
  );
}

function WorkflowArtifactView({ file }: { file: ArtifactTabFile }) {
  const { intl } = useWorkflowIntl();
  const { layer } = useV4Conversation();
  const source = file.workflowArtifact;
  // Artifact storage belongs to the Host, even when its workspace runs in WSL.
  const storedLocally = remoteProjectFor(file.cwd)?.local === true;
  const [lease, setLease] = useState<HostSessionLease | null>(null);
  useEffect(() => {
    const next = layer.acquire(source.parentSessionId);
    setLease(next);
    return () => next.release();
  }, [layer, source.parentSessionId]);
  const { snapshot } = useConversationProjection(lease);
  const run = snapshot?.workflowRuns?.runs.find((candidate) => candidate.runId === source.runId);
  const state = useWorkflowRunArtifacts({ sessionId: source.parentSessionId, runId: source.runId,
    ...(run ? { live: run.artifacts } : {}) });
  const artifact = state.artifacts.find((candidate) => candidate.id === source.artifactId);
  const message = (name: string) => intl.formatMessage({ id: `chat.toolCall.workflow.run.artifacts.${name}` });
  return (
    <div className="content-surface h-full min-h-0 overflow-auto p-4" data-workflow-artifact-tab>
      <div className="mx-auto w-full max-w-5xl" data-workflow-artifact-viewer>
        {state.error ? <div role="alert"><p>{message("loadError")}</p><p>{state.error}</p></div>
          : state.unavailable ? <p>{message("unavailable")}</p>
          : !artifact ? <p role="status">{message(state.loading || !state.complete ? "loading" : "missing")}</p>
          : <WorkflowArtifactContent key={`${artifact.id}:${artifact.version}`} artifact={artifact}
              sessionId={source.parentSessionId} runId={source.runId} storedLocally={storedLocally}
              {...(storedLocally ? { onRevealStoredFile: revealPath } : {})} />}
      </div>
    </div>
  );
}

export function WorkflowAgentTabView({ file, visible, onOpenFile }: {
  file: FilePaneTab & { workflowAgent: WorkflowAgentTabSource };
  visible: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const presentation = useWorkflowPresentation();
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
        {presentation?.renderTranscript({ session, visible,
          onApproval: (requestId, decision) => void lease?.approve(requestId, decision).catch(() => undefined),
          ...(onOpenFile ? { onOpenFile } : {}),
        })}
      </div>
    </div>
  );
}
