import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import { btwTurnHarness, supportsBtwHarness } from "../../domain/btw";
import { harnessForTurn } from "../../domain/secondOpinion";
import type { HostSession } from "../../contracts/protocol";
import type { BtwAction } from "../../contracts/submission";
import type { Block, Session } from "../../contracts/session";
import { mutateHostSession } from "../../features/connections/model/hostSessionSubmission";
import { projectPath, remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { showStatusToast } from "../../shared/ui/StatusToast";
import { translate } from "../../shared/i18n/language";

type Options = {
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
};

/** Side conversations run on the Host; the open pane's sync streams their blocks. */
export function useBtwConversations({ sessionsRef, setSessions }: Options) {
  const dispatch = useCallback((session: Session, action: BtwAction) => {
    void mutateHostSession(session, (snapshot: HostSession, commandId) => ({
      ...action, commandId, sessionId: snapshot.session.id,
    }), "sessions.btw.v1").then(snapshot => {
      const project = remoteProjectFor(session.cwd);
      setSessions(current => current.map(entry => entry.id === session.id
        ? { ...snapshot.session, id: session.id, cwd: session.cwd,
          executionCwd: snapshot.session.executionCwd && project
            ? projectPath(project, snapshot.session.executionCwd) : entry.executionCwd } : entry));
    }).catch(error => showStatusToast(translate(error instanceof Error ? error.message : String(error)), "error"));
  }, [setSessions]);

  /** Resolves the anchor turn the same way the Host validates it. */
  const target = useCallback((sessionId: string, turn: Block[], threadId: string) => {
    const source = sessionsRef.current.find(session => session.id === sessionId);
    const userBlockId = turn.find(block => block.role === "user")?.id;
    if (!source || source.worktreeRemoved || !userBlockId) return undefined;
    const thread = source.blocks.find(block => block.id === userBlockId && block.role === "user")
      ?.btwThreads?.find(entry => entry.id === threadId);
    const harness = thread?.harness ?? btwTurnHarness(source.blocks, turn, source.harness)
      ?? harnessForTurn(source.blocks, turn, source.harness);
    if (!supportsBtwHarness(harness)) return undefined;
    return { source, userBlockId, thread };
  }, [sessionsRef]);

  const onBtwSubmit = useCallback((sessionId: string, turn: Block[], threadId: string, messageId: string,
    text: string, model?: string, modelSettings?: Record<string, string>) => {
    const found = target(sessionId, turn, threadId);
    const sourceEndBlockId = turn[turn.length - 1]?.id;
    if (!found || !sourceEndBlockId || found.thread?.status === "running") return false;
    if (found.thread && found.thread.sourceEndBlockId !== sourceEndBlockId) return false;
    dispatch(found.source, { type: "btw", action: "send", userBlockId: found.userBlockId, threadId,
      sourceEndBlockId, messageId, text, ...(model?.trim() ? { model: model.trim() } : {}),
      ...(modelSettings ? { modelSettings } : {}) });
    return true;
  }, [dispatch, target]);

  const onBtwModelChange = useCallback((sessionId: string, turn: Block[], threadId: string,
    model: string, modelSettings: Record<string, string>) => {
    const found = target(sessionId, turn, threadId);
    // A thread that has not been sent yet keeps its choice in the composer.
    if (!found?.thread || !model.trim() || found.thread.status === "running") return;
    dispatch(found.source, { type: "btw", action: "configure", userBlockId: found.userBlockId, threadId,
      model: model.trim(), modelSettings });
  }, [dispatch, target]);

  const simple = useCallback((action: "retry" | "stop" | "delete") =>
    (sessionId: string, turn: Block[], threadId: string) => {
      const found = target(sessionId, turn, threadId);
      if (!found?.thread) return;
      if (action === "retry" && found.thread.status !== "error") return;
      if (action === "stop" && found.thread.status !== "running") return;
      dispatch(found.source, { type: "btw", action, userBlockId: found.userBlockId, threadId });
    }, [dispatch, target]);

  const actions = useMemo(() => ({
    onBtwRetry: simple("retry"), onBtwDelete: simple("delete"), onBtwStop: simple("stop"),
  }), [simple]);
  return { onBtwSubmit, onBtwModelChange, ...actions };
}
