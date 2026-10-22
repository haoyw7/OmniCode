import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import { orchestrator } from "../../features/orchestration/model/orchestration";
import {
  buildDeterministicHandoff,
  completeHandoff,
  isPreparingHandoff,
  sessionChildHarnesses,
} from "../../features/sessions/model/handoff";
import { type WorkspaceTab } from "../../features/workspace/model/layout";
import {
  applyHarnessEvent,
  canCompactHarnessContext,
  cancelHarnessTurn,
  compactHarnessContext,
  keepHarnessQuestionOpen,
  respondHarnessApproval,
  respondHarnessQuestion,
  stopStreaming,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../../integrations/harness";
import type { SessionTitleCoordinator } from "../../integrations/harness/core/titleCoordinator";
import { notifyGitChanged } from "../../platform/tauri/fs";
import type { HarnessEventQueue } from "../model/harnessFlush";
import { nudgeWorkspace } from "../model/sessionEditTracking";
import { nudgeWatchedFiles } from "../../features/connections/files/model/fileWatch";
import {
  finishSessionTurn,
  notifyReviewChanged,
} from "../../features/sessions/model/checkpoint";
import {
  conversationProviderAccountId,
  selectedProviderAccountId,
  supportsProviderAccounts,
} from "../../features/providers/model/providerAccounts";
import {
  HARNESS_TITLE,
  sessionExecutionCwd,
  type Session,
} from "../../features/sessions/model/session";
import { syncDockBadge } from "../../features/notifications/model/dockBadge";
import {
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldStopFocusedTurnOnEscape,
} from "../../features/workspace/model/tabKeys";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../features/connections/model/remoteSessionActions";

type Options = {
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  projectTerminalFocusedRef: RefObject<boolean>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  turnGen: RefObject<Map<string, number>>;
  titleCoordinator: RefObject<SessionTitleCoordinator | null>;
  enqueueHarnessEvent: HarnessEventQueue["enqueue"];
  flushHarnessEvents: HarnessEventQueue["flush"];
};

/** Routes runtime controls and deferred Escape handling without owning session storage. */
export function useSessionRuntimeActions({
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  projectTerminalFocusedRef,
  setSessions,
  turnGen,
  titleCoordinator,
  enqueueHarnessEvent,
  flushHarnessEvents,
}: Options) {
  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (current && sessionUsesHost(current))
        return remoteSessionActions(sessionId)?.compact() ?? false;
      if (!current || current.busy || current.worktreeRemoved) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionExecutionCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            nativeSession: current.nativeSession,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? (conversationProviderAccountId(current) ??
                selectedProviderAccountId(current.harness, current.cwd))
              : undefined,
            runtimeMode: current.runtimeMode,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          const finished = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, busy: false } : session,
          );
          sessionsRef.current = finished;
          syncDockBadge(finished);
          setSessions(finished);
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      titleCoordinator.current!.cancel(sessionId);
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (remote && sessionUsesHost(remote)) {
        remoteSessionActions(sessionId)?.stop();
        return;
      }
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return;
        }
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      const cancelling = Promise.all(
        (session ? sessionChildHarnesses(session) : []).map((id) =>
          cancelHarnessTurn(id, sessionId),
        ),
      );
      // Record the turn's final workspace once its providers have stopped.
      if (session) {
        void finishSessionTurn(sessionId, sessionExecutionCwd(session), {
          after: cancelling.catch(() => undefined),
        }).catch(() => undefined);
      }
      void cancelling.catch(() => undefined);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const stopped = stopStreaming(s);
          const completed = isPreparingHandoff(stopped)
            ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
            : stopped;
          const ready = { ...completed, worktreePreparing: undefined };
          return ready.queuedMessages?.length
            ? { ...ready, queueStatus: "paused" }
            : ready;
        }),
      );
      if (session) {
        notifyReviewChanged(sessionId);
        nudgeWorkspace(sessionExecutionCwd(session));
        notifyGitChanged();
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents],
  );

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".omnicode-terminal"));
      const activeTabId = activeTabIdRef.current;
      const sessionId = focusedBusyAgentSessionId(
        activeTabId,
        tabsRef.current,
        sessionsRef.current,
        projectTerminalFocusedRef.current,
      );
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
        if (
          activeTabIdRef.current !== activeTabId ||
          stillFocusedSessionId !== sessionId
        ) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.approve(requestId, decision);
        return;
      }
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.answer(requestId, reply);
        return;
      }
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onQuestionInteraction = useCallback(
    (sessionId: string, requestId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session && sessionUsesHost(session)) {
        remoteSessionActions(sessionId)?.keepQuestionOpen?.(requestId);
        return;
      }
      if (session && !session.worktreeRemoved)
        keepHarnessQuestionOpen(session.harness, sessionId, requestId);
    },
    [],
  );

  return {
    onCompactContext,
    onStop,
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
  };
}
