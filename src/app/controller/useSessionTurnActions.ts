import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import type { PlanBuildTarget, Session } from "../../contracts/session";
import type { HostCommand, HostSession } from "../../contracts/protocol";
import { mutateHostSession } from "../../features/connections/model/hostSessionSubmission";
import { projectPath, remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { saveLastModelSettings } from "../../features/sessions/model/models";
import { showStatusToast } from "../../shared/ui/StatusToast";
import { translate } from "../../shared/i18n/language";
import type { Submit } from "./workspaceTypes";

type Options = {
  setSessions: Dispatch<SetStateAction<Session[]>>;
  sessionsRef: RefObject<Session[]>;
  onSubmit: (...args: Parameters<Submit>) => boolean;
};

/** Queue dispatch, plan edits, and usage-limit timers are owned by Host. */
export function useSessionTurnActions({ setSessions, sessionsRef, onSubmit }: Options) {
  const mutate = useCallback((sessionId: string, capability: string,
    command: (snapshot: HostSession, commandId: string) => HostCommand) => {
    const session = sessionsRef.current.find(entry => entry.id === sessionId);
    if (!session) return;
    void mutateHostSession(session, command, capability).then(snapshot => {
      const project = remoteProjectFor(session.cwd);
      setSessions(current => current.map(entry => entry.id === sessionId
        ? { ...snapshot.session, id: sessionId, cwd: session.cwd,
          executionCwd: snapshot.session.executionCwd && project
            ? projectPath(project, snapshot.session.executionCwd) : entry.executionCwd } : entry));
    }).catch(error => showStatusToast(translate(error instanceof Error ? error.message : String(error)), "error"));
  }, [setSessions, sessionsRef]);
  const queue = useCallback((sessionId: string, action: Extract<HostCommand, { type: "queue" }>["action"],
    messageId?: string, beforeId?: string) => mutate(sessionId, "sessions.queue", (snapshot, commandId) => ({
      type: "queue", commandId, sessionId: snapshot.session.id, action, messageId, beforeId,
      ...(action === "steer" ? { runId: snapshot.runId } : {}),
    })), [mutate]);
  const onUpdatePlan = useCallback((sessionId: string, blockId: string, text: string) =>
    mutate(sessionId, "sessions.planEdit.v1", (snapshot, commandId) => ({
      type: "editPlan", commandId, sessionId: snapshot.session.id, blockId, text,
    })), [mutate]);
  const onBuildPlan = useCallback((sessionId: string, blockId: string, target?: PlanBuildTarget) => {
    const session = sessionsRef.current.find(entry => entry.id === sessionId);
    const block = session?.blocks.find(entry => entry.id === blockId);
    if (!session || session.busy || block?.role !== "plan" || block.orchestration || !block.text.trim() ||
      block.plan?.status === "streaming" || block.plan?.status === "building" || block.plan?.status === "built") return;
    if (target && session.modelSettings) saveLastModelSettings(session.modelSettings, "fill");
    onSubmit(sessionId, "Build approved plan", [], { intent: "build", planBlockId: blockId, buildTarget: target });
  }, [onSubmit, sessionsRef]);
  const usage = useCallback((sessionId: string, action: "dismiss" | "resume" | "resumeAtReset", enabled?: boolean) =>
    mutate(sessionId, "sessions.usageLimit.v1", (snapshot, commandId) => ({
      type: "usageLimit", commandId, sessionId: snapshot.session.id,
      ...(action === "resumeAtReset" ? { action, enabled: !!enabled } : { action }),
    })), [mutate]);
  return {
    onDeleteQueuedMessage: useCallback((id: string, messageId: string) => queue(id, "remove", messageId), [queue]),
    onReorderQueuedMessage: useCallback((id: string, messageId: string, beforeId?: string) => queue(id, "move", messageId, beforeId), [queue]),
    onSteerQueuedMessage: useCallback((id: string, messageId: string) => queue(id, "steer", messageId), [queue]),
    onResumeQueue: useCallback((id: string) => queue(id, "resume"), [queue]),
    onUsageLimitResume: useCallback((id: string) => usage(id, "resume"), [usage]),
    onUsageLimitResumeAtReset: useCallback((id: string, enabled: boolean) => usage(id, "resumeAtReset", enabled), [usage]),
    onUsageLimitDismiss: useCallback((id: string) => usage(id, "dismiss"), [usage]),
    onBuildPlan, onUpdatePlan,
  };
}
