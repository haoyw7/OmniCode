import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { orchestrator } from "../../features/orchestration/model/orchestration";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import {
  shouldPersistSession,
  upsertSession,
} from "../../features/sessions/data/sessionStore";
import {
  flushSessionCheckpoint,
  keepSessionChanges,
  notifyReviewChanged,
} from "../../features/sessions/model/checkpoint";
import { sessionChildHarnesses } from "../../features/sessions/model/handoff";
import {
  sessionExecutionCwd,
  type Session,
  type WorkspaceMode,
} from "../../features/sessions/model/session";
import {
  listWorktrees,
  sessionInWorktree,
  type Worktree,
} from "../../features/source-control/model/worktrees";
import {
  newTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { forgetHarnessSession } from "../../integrations/harness";
import { notifyGitChanged } from "../../platform/tauri/fs";
import { isEqualOrInside, pathKey } from "../../shared/lib/paths";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";

type Options = {
  navigation: Pick<
    WorkspaceNavigation,
    | "isMoving"
    | "beginMove"
    | "pinSessionToCurrentWorkspace"
    | "unpinSession"
    | "setActiveTabId"
  >;
  sessionData: Pick<
    WorkspaceSessionData,
    "isRemoving" | "cancelSave" | "invalidate" | "persist" | "refreshHistory"
  >;
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  removingWorktreePaths: RefObject<Set<string>>;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
};

/** Checkout changes keep conversation bindings and navigation locks together. */
export function useSessionWorktreeActions({
  navigation,
  sessionData,
  sessionsRef,
  setSessions,
  removingWorktreePaths,
  appendTab,
  setComposerFocused,
}: Options) {
  const {
    isMoving,
    beginMove,
    pinSessionToCurrentWorkspace,
    unpinSession,
    setActiveTabId,
  } = navigation;
  const { persist: persistSession, refreshHistory } = sessionData;
  const onBranchChange = useCallback(
    (sessionId: string) => {
      notifyGitChanged();
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      void forgetHarnessSession(current.harness, sessionId);
      const next = {
        ...current,
        branch: undefined,
        providerSessionId: undefined,
        context: undefined,
      };
      sessionsRef.current = sessionsRef.current.map((s) =>
        s.id === sessionId ? next : s,
      );
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? next : s)));
      persistSession(next);
      notifyReviewChanged(sessionId);
    },
    [persistSession, sessionsRef, setSessions],
  );

  const onWorkspaceModeChange = useCallback(
    (sessionId: string, mode: WorkspaceMode, base?: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (
            session.id !== sessionId ||
            (!isBlankSession(session) &&
              !(session.workspaceMode && !session.busy))
          ) {
            return session;
          }
          return mode === "worktree"
            ? base || session.worktreeBase
              ? {
                  ...session,
                  workspaceMode: "worktree",
                  worktreeBase: base || session.worktreeBase,
                }
              : session
            : {
                ...session,
                workspaceMode: undefined,
                worktreeBase: undefined,
              };
        }),
      );
    },
    [setSessions],
  );

  const onWorktreeBaseChange = useCallback(
    (sessionId: string, base: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId &&
          (isBlankSession(session) ||
            (!!session.workspaceMode && !session.busy)) &&
          session.workspaceMode === "worktree"
            ? { ...session, worktreeBase: base }
            : session,
        ),
      );
    },
    [setSessions],
  );

  const onWorktreeChange = useCallback(
    async (
      sessionId: string,
      tree: Worktree,
      fromComposer = false,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (
        !current ||
        current.busy ||
        sessionData.isRemoving(sessionId) ||
        isMoving(sessionId)
      ) {
        throw new Error(
          "Wait for this session to finish before changing working copies.",
        );
      }
      if (
        !current.worktreeRemoved &&
        pathKey(sessionExecutionCwd(current)) === pathKey(tree.path)
      )
        return;
      if (
        [...removingWorktreePaths.current].some((path) =>
          isEqualOrInside(tree.path, path),
        )
      ) {
        throw new Error(
          "This worktree is being deleted. Select another working copy.",
        );
      }
      if (!current.worktreeRemoved && current.queuedMessages?.length) {
        throw new Error(
          "Clear queued messages before changing working copies.",
        );
      }
      const run = orchestrator.forSession(sessionId);
      if (run && ["active", "paused"].includes(run.status)) {
        throw new Error(
          "Stop this orchestration run before changing working copies.",
        );
      }
      const finishMove = beginMove(sessionId, tree.path);
      if (!finishMove) {
        throw new Error(
          "Wait for this session to finish before changing working copies.",
        );
      }
      sessionData.cancelSave(sessionId);
      try {
        const listed = await listWorktrees(current.cwd);
        if (!isCurrent()) return;
        const target = listed.worktrees.find(
          (entry) =>
            pathKey(entry.path) === pathKey(tree.path) && !entry.missing,
        );
        if (!target) {
          throw new Error(
            "This worktree is no longer available. Refresh the picker.",
          );
        }
        const source = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !source ||
          source.busy ||
          source.cwd !== current.cwd ||
          sessionExecutionCwd(source) !== sessionExecutionCwd(current)
        ) {
          throw new Error(
            "The session changed. Try selecting the working copy again.",
          );
        }
        const selected = sessionInWorktree(source, target);
        if (selected.id !== sessionId) {
          // Leave the original conversation, checkpoints, and live provider
          // context attached to the files they describe.
          const tab = newTab(selected.id);
          if (fromComposer)
            pinSessionToCurrentWorkspace(selected.id, source.cwd);
          sessionsRef.current = [...sessionsRef.current, selected];
          setSessions(sessionsRef.current);
          appendTab(tab, selected.cwd);
          setActiveTabId(tab.id);
          setComposerFocused(true);
          return;
        }
        await flushSessionCheckpoint(sessionId);
        if (!isCurrent()) return;
        for (const harness of sessionChildHarnesses(source)) {
          await forgetHarnessSession(harness, sessionId);
          if (!isCurrent()) return;
        }
        const latest = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !latest ||
          (!latest.worktreeRemoved && !isBlankSession(latest)) ||
          latest.cwd !== current.cwd ||
          sessionExecutionCwd(latest) !== sessionExecutionCwd(current)
        ) {
          throw new Error(
            "The session changed. Try selecting the working copy again.",
          );
        }
        const next = sessionInWorktree(latest, target);
        if (latest.worktreeRemoved)
          await keepSessionChanges(sessionId, target.path);
        sessionData.cancelSave(sessionId);
        if (shouldPersistSession(next)) await upsertSession(next);
        if (!isCurrent()) return;
        if (fromComposer) pinSessionToCurrentWorkspace(sessionId, latest.cwd);
        else unpinSession(sessionId);
        sessionData.invalidate(sessionId);
        sessionsRef.current = sessionsRef.current.map((s) =>
          s.id === sessionId ? next : s,
        );
        setSessions(sessionsRef.current);
        notifyGitChanged();
        notifyReviewChanged(sessionId);
        void refreshHistory(next.cwd);
      } finally {
        finishMove();
      }
    },
    [
      appendTab,
      sessionData,
      refreshHistory,
      sessionsRef,
      setSessions,
      setComposerFocused,
      removingWorktreePaths,
      isMoving,
      beginMove,
      pinSessionToCurrentWorkspace,
      unpinSession,
      setActiveTabId,
    ],
  );

  const onComposerWorktreeChange = useCallback(
    (sessionId: string, tree: Worktree) =>
      onWorktreeChange(sessionId, tree, true),
    [onWorktreeChange],
  );

  return {
    onBranchChange,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onWorktreeChange,
    onComposerWorktreeChange,
  };
}
