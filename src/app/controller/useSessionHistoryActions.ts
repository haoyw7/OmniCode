import { showNativeMessage } from "../../platform/tauri/dialogs";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { releaseOrchestrationWorker } from "../../features/orchestration/model/orchestrationWorkspace";
import type { ProjectTerminalDock } from "../../features/projects/model/projectTerminal";
import { type RecentProject, rememberProject } from "../../features/projects/model/recents";

import { summaryFromSession } from "../../features/sessions/data/sessionHistory";
import { flushSessionWrites, persistManualSessionTitle, setSessionArchived, setSessionLinkedWorkItem, setSessionPinned, shouldPersistSession, upsertSession, type SessionSummary } from "../../features/sessions/data/sessionStore";
import { archiveFocusedSession } from "../../features/sessions/model/archiveShortcut";
import { notifyReviewChanged } from "../../features/sessions/model/checkpoint";
import { sessionDisplayTitle } from "../../features/sessions/model/session";
import { formatSessionTitle } from "../../domain/session";
import { type LinkedWorkItem, type Session } from "../../contracts/session";
import { createSessionRemover } from "../../features/sessions/model/sessionRemoval";
import { type SessionDeleteChoice } from "../../features/sessions/ui/DeleteSessionDialog";
import { assertWorktreeFilesClosed, checkWorktreeRemoval, detachSessionWorktree, listWorktrees, removeWorktree, worktreeSessionIds } from "../../features/source-control/model/worktrees";
import { confirmCloseTerminals } from "../../features/terminal/model/terminalClose";
import { isFilesystemTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { isEqualOrInside, pathKey } from "../../shared/lib/paths";
import { translate } from "../../shared/i18n/language";
import { showStatusToast } from "../../shared/ui/StatusToast";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { confirmDiscardUnsaved } from "../model/confirmDiscardUnsaved";
import { filesInWorkspaceTabs } from "../model/workspaceSelectors";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";
import type { WorkspaceFiles } from "./useWorkspaceFiles";
import type { LinkedWorkItemPanelState } from "./workspaceTypes";

type Options = {
  sessionData: Pick<
    WorkspaceSessionData,
    | "beginRemoval"
    | "cancelSave"
    | "endRemoval"
    | "evict"
    | "forget"
    | "invalidate"
    | "isRemoving"
    | "load"
    | "mergeSummary"
    | "persist"
    | "refreshHistory"
    | "resetPersistence"
    | "retain"
    | "snapshot"
    | "updateRetained"
    | "updateSummaries"
    | "updateSummary"
  >;
  sessionsRef: RefObject<Session[]>;
  sidebarCwd: string;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  tabsRef: RefObject<WorkspaceTab[]>;
  projectTerminalsRef: RefObject<ProjectTerminalDock[]>;
  removingWorktreePaths: RefObject<Set<string>>;
  navigation: Pick<WorkspaceNavigation, "isMoving" | "hasMoveInto">;
  stopSessionForRemoval: (sessionId: string) => Promise<Session | undefined>;
  projectCwdRef: RefObject<string>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  deleteConfirmationPending: RefObject<boolean>;
  setSessionDeleteDialog: Dispatch<
    SetStateAction<
      | {
          title: string;
          unusedWorktree: string;
          resolve: (choice: SessionDeleteChoice) => void;
        }
      | undefined
    >
  >;
  tabCloseScope: "project";
  activeTabIdRef: RefObject<string>;
  fileState: Pick<
    WorkspaceFiles,
    "isDirty" | "readDirtyFiles" | "forgetDirtyFiles"
  >;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  activateTab: (id: string, paneId?: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  projectTerminalFocusedRef: RefObject<boolean>;
  appViewFocusedRef: RefObject<
    | "settings"
    | "search"
    | "inbox"
    | "notes"
    | "automations"
    | "workflows"
    | "assistant"
    | "projects"
    | undefined
  >;
  paletteOpenRef: RefObject<boolean>;
  whatsNewVersionRef: RefObject<string | null>;
  setLinkedWorkItemPanels: Dispatch<
    SetStateAction<ReadonlyMap<string, LinkedWorkItemPanelState>>
  >;
};

export function useSessionHistoryActions({
  sessionData,
  sessionsRef,
  sidebarCwd,
  setSessions,
  tabsRef,
  projectTerminalsRef,
  removingWorktreePaths,
  navigation,
  stopSessionForRemoval,
  projectCwdRef,
  setProjectCwd,
  setRecents,
  deleteConfirmationPending,
  setSessionDeleteDialog,
  tabCloseScope,
  activeTabIdRef,
  fileState,
  setTabs,
  activateTab,
  setComposerFocused,
  projectTerminalFocusedRef,
  appViewFocusedRef,
  paletteOpenRef,
  whatsNewVersionRef,
  setLinkedWorkItemPanels,
}: Options) {
  const { refreshHistory } = sessionData;
  const pendingPins = useRef(new Map<string, symbol>());
  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string) => {
      const editedCwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        sessionData.snapshot().history.find((entry) => entry.id === sessionId)
          ?.cwd ??
        sidebarCwd;
      const trimmed = displayTitle.trim();
      if (!trimmed) return;
      sessionData.invalidate(sessionId);

      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      try {
        const source = open ?? await sessionData.load(sessionId);
        if (!source) {
          void refreshHistory(editedCwd, true);
          return;
        }
        const updated = await persistManualSessionTitle(
          source, formatSessionTitle(source.harness, trimmed),
        );
        // A Host sync may have advanced this transcript while saving metadata.
        // Apply only the acknowledged title to the current projection.
        setSessions((prev) => prev.map((session) => session.id === sessionId
          ? { ...session, title: updated.title, titleState: updated.titleState }
          : session));
        sessionData.updateSummary(sessionId, (entry) => ({
          ...entry, title: updated.title, titleState: updated.titleState,
        }));
        sessionData.evict(sessionId);
        void refreshHistory(editedCwd, true);
      } catch (error) {
        showStatusToast(translate(error instanceof Error ? error.message : String(error)), "error");
      }
    },
    [sidebarCwd, sessionData],
  );

  const checkOpenWorktreeFiles = useCallback((path: string) => {
    assertWorktreeFilesClosed(path, [
      ...filesInWorkspaceTabs(tabsRef.current),
      ...projectTerminalsRef.current.flatMap((dock) => dock.pane.files),
    ]);
  }, []);

  const onCheckWorktreeRemoval = useCallback(
    async (cwd: string, path: string, force: boolean) => {
      checkOpenWorktreeFiles(path);
      await checkWorktreeRemoval(cwd, path, force);
      // Re-read UI state after the native check, before deleting sessions.
      checkOpenWorktreeFiles(path);
    },
    [checkOpenWorktreeFiles],
  );

  const onRemoveWorktree = useCallback(
    async (cwd: string, path: string, force: boolean, keepSessions = false) => {
      if (removingWorktreePaths.current.has(path)) {
        throw new Error("This worktree is already being deleted.");
      }
      removingWorktreePaths.current.add(path);
      const lockedIds = new Set<string>();
      try {
        if (navigation.hasMoveInto(path)) {
          throw new Error(
            "A session is selecting this worktree. Try deleting it again once selection finishes.",
          );
        }
        await onCheckWorktreeRemoval(cwd, path, force);
        const listed = await listWorktrees(cwd);
        const tree = listed.worktrees.find(
          (entry) => pathKey(entry.path) === pathKey(path),
        );
        if (!tree) throw new Error("This worktree is no longer available.");
        const ids = worktreeSessionIds(tree, sessionsRef.current);
        if (!keepSessions && ids.length) {
          throw new Error(
            "Move or delete the sessions using this worktree first.",
          );
        }
        if (
          ids.some(
            (id) =>
              sessionData.isRemoving(id) || navigation.isMoving(id),
          )
        ) {
          throw new Error(
            "Wait for these sessions to finish changing before deleting the worktree.",
          );
        }
        for (const id of ids) {
          sessionData.beginRemoval(id);
          lockedIds.add(id);
        }
        for (const id of ids) {
          await stopSessionForRemoval(id);
        }
        await flushSessionWrites();
        checkOpenWorktreeFiles(path);
        const removed = await removeWorktree(cwd, path, force, keepSessions);
        const affected = new Set([...ids, ...removed.sessionIds]);
        if (isEqualOrInside(projectCwdRef.current, path)) {
          setProjectCwd(removed.projectCwd);
          setRecents(rememberProject(removed.projectCwd));
        }
        for (const id of affected) {
          sessionData.invalidate(id);
          sessionData.resetPersistence(id);
        }
        sessionsRef.current = sessionsRef.current.map((session) =>
          affected.has(session.id)
            ? detachSessionWorktree(session, removed.projectCwd, path)
            : session,
        );
        setSessions(sessionsRef.current);
        const patchSummary = (entry: SessionSummary) =>
          affected.has(entry.id)
            ? detachSessionWorktree(entry, removed.projectCwd, path)
            : entry;
        sessionData.updateSummaries(patchSummary);
        for (const id of affected) notifyReviewChanged(id);
      } finally {
        removingWorktreePaths.current.delete(path);
        for (const id of lockedIds) sessionData.endRemoval(id);
      }
    },
    [
      checkOpenWorktreeFiles,
      onCheckWorktreeRemoval,
      stopSessionForRemoval,
      sessionData,
    ],
  );

  const onRemoveHistorySession = useCallback(
    async (
      sessionId: string,
      mode: "archive" | "delete",
      skipDeleteConfirm = false,
    ): Promise<boolean> => {
      if (
        sessionData.isRemoving(sessionId) ||
        navigation.isMoving(sessionId) ||
        deleteConfirmationPending.current
      )
        return false;
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const summary = sessionData
        .snapshot()
        .history.find((entry) => entry.id === sessionId);
      const seed = open ?? summary;
      const label = seed
        ? sessionDisplayTitle(seed.title, seed.harness)
        : "this session";
      sessionData.beginRemoval(sessionId);
      let deleteWorktreePath: string | undefined;
      if (mode === "delete" && !skipDeleteConfirm) {
        deleteConfirmationPending.current = true;
        let unusedWorktree: string | undefined;
        if (seed?.executionCwd) {
          try {
            const { worktrees } = await listWorktrees(seed.cwd);
            const tree = worktrees.find(
              (entry) => pathKey(entry.path) === pathKey(seed.executionCwd!),
            );
            if (
              tree &&
              !tree.isMain &&
              !tree.locked &&
              tree.branch &&
              worktreeSessionIds(tree, sessionsRef.current).every(
                (id) => id === sessionId,
              )
            )
              unusedWorktree = tree.path;
          } catch {
            // A failed lookup must never offer filesystem cleanup.
          }
        }
        if (!unusedWorktree) {
          deleteConfirmationPending.current = false;
        } else {
          const choice = await new Promise<SessionDeleteChoice>((resolve) => {
            setSessionDeleteDialog({ title: label, unusedWorktree, resolve });
          });
          deleteConfirmationPending.current = false;
          if (!choice.confirmed) {
            sessionData.endRemoval(sessionId);
            return false;
          }
          if (choice.deleteWorktree) deleteWorktreePath = unusedWorktree;
        }
      }
      sessionData.invalidate(sessionId);
      sessionData.cancelSave(sessionId);
      try {
        const remover = createSessionRemover({
          mode,
          scope: tabCloseScope,
          replacement: {
            harness: seed?.harness ?? "cursor",
            cwd: seed?.cwd ?? sidebarCwd,
            model: seed?.model,
            runtimeMode: seed?.runtimeMode,
            modelSettings: open?.modelSettings,
          },
          workspace: {
            snapshot: () => ({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              activeTabId: activeTabIdRef.current,
              dirtyFiles: fileState.readDirtyFiles(),
            }),
            apply: (change) => {
              if (change.type === "stopped") {
                const next = sessionsRef.current.map((session) =>
                  session.id === sessionId ? change.session : session,
                );
                sessionsRef.current = next;
                setSessions(next);
                return;
              }

              if (change.type === "orchestrationReleased") {
                const released = sessionsRef.current.map((session) =>
                  releaseOrchestrationWorker(session, change.leadId),
                );
                sessionsRef.current = released;
                setSessions(released);
                sessionData.updateRetained((session) =>
                  releaseOrchestrationWorker(session, change.leadId),
                );
                const releaseSummary = (entry: SessionSummary) =>
                  entry.orchestrationLeadId === change.leadId
                    ? { ...entry, orchestrationLeadId: undefined }
                    : entry;
                sessionData.updateSummaries(releaseSummary);
                return;
              }

              const { removal } = change;
              sessionData.resetPersistence(sessionId);
              const closingFiles = filesInWorkspaceTabs(removal.closedTabs);
              fileState.forgetDirtyFiles(closingFiles.map((file) => file.id));
              sessionsRef.current = removal.sessions;
              tabsRef.current = removal.tabs;
              setSessions(removal.sessions);
              setTabs(removal.tabs);
              if (removal.activeTabId !== activeTabIdRef.current) {
                activateTab(removal.activeTabId);
              }
              const activeTab = removal.tabs.find(
                (tab) => tab.id === removal.activeTabId,
              );
              setComposerFocused(
                removal.sessions.some(
                  (session) => session.id === activeTab?.focusedId,
                ),
              );
              if (change.mode === "archive") {
                if (change.session && shouldPersistSession(change.session)) {
                  sessionData.retain(change.session);
                }
                const archived =
                  change.savedSummary ??
                  summary ??
                  (change.session && summaryFromSession(change.session));
                if (archived) {
                  sessionData.mergeSummary({ ...archived, archived: true });
                }
              } else {
                sessionData.forget(sessionId);
                void refreshHistory(seed?.cwd ?? sidebarCwd, true);
              }
            },
          },
          confirm: async (closedTabs, removalMode) => {
            const files = filesInWorkspaceTabs(closedTabs);
            const unsaved = files.some(
              (file) =>
                isFilesystemTab(file) && fileState.isDirty(file.id),
            );
            if (
              unsaved &&
              !(await confirmDiscardUnsaved(
                `${removalMode === "archive" ? "Archive" : "Delete"} this conversation with unsaved files?`,
              ))
            )
              return false;
            const terminals = files.filter((file) => file.terminal);
            return (
              terminals.length === 0 || (await confirmCloseTerminals(terminals))
            );
          },
          stop: stopSessionForRemoval,
        });
        const removed = await remover.remove(sessionId);
        if (removed && deleteWorktreePath && seed) {
          try {
            await onRemoveWorktree(seed.cwd, deleteWorktreePath, false);
          } catch (error) {
            void showNativeMessage(
              `The session was deleted. Its worktree was kept.\n\n${String(error)}\n\nYou can manage it in Settings → Worktrees.`,
              { title: "OmniCode", kind: "warning" },
            );
          }
        }
        return removed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void showNativeMessage(`Could not ${mode} this conversation.\n\n${detail}`, {
          title: "OmniCode",
          kind: "error",
        });
        return false;
      } finally {
        sessionData.endRemoval(sessionId);
      }
    },
    [
      activateTab,
      sidebarCwd,
      stopSessionForRemoval,
      tabCloseScope,
      onRemoveWorktree,
      sessionData,
    ],
  );

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive");
      if (sessionData.isRemoving(sessionId)) return false;
      try {
        await setSessionArchived(sessionId, false);
        sessionData.updateSummary(sessionId, (entry) => ({
          ...entry,
          archived: false,
        }));
        return true;
      } catch (error) {
        void showNativeMessage(
          `Could not unarchive this conversation.\n\n${String(error)}`,
          {
            title: "OmniCode",
            kind: "error",
          },
        );
        return false;
      }
    },
    [onRemoveHistorySession, sessionData],
  );

  const onArchiveFocusedSession = useCallback(
    (event: KeyboardEvent) => {
      archiveFocusedSession(
        event,
        {
          activeTabId: activeTabIdRef.current,
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          projectTerminalFocused: projectTerminalFocusedRef.current,
          surfaceOpen: Boolean(
            appViewFocusedRef.current ||
            paletteOpenRef.current ||
            whatsNewVersionRef.current,
          ),
        },
        (sessionId) => {
          void onArchiveHistorySession(sessionId, true);
        },
      );
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySession = useCallback(
    async (sessionId: string, pinned: boolean) => {
      const previousPinned = sessionData.snapshot().history.find((entry) => entry.id === sessionId)?.pinned ?? false;
      const request = Symbol();
      pendingPins.current.set(sessionId, request);
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      sessionData.updateSummary(
        sessionId,
        (entry) => ({ ...entry, pinned }),
        open ? summaryFromSession(open) : undefined,
      );
      if (open && shouldPersistSession(open)) {
        await upsertSession(open).catch(() => undefined);
      }
      try {
        await setSessionPinned(sessionId, pinned);
      } catch (error) {
        if (pendingPins.current.get(sessionId) === request) {
          sessionData.updateSummary(sessionId, (entry) => entry.pinned === pinned
            ? { ...entry, pinned: previousPinned } : entry);
        }
        showStatusToast(translate(error instanceof Error ? error.message : String(error)), "error");
      } finally {
        if (pendingPins.current.get(sessionId) === request) pendingPins.current.delete(sessionId);
      }
    },
    [sessionData],
  );

  const onSetHistorySessionLinkedWorkItem = useCallback(
    (sessionId: string, linkedWorkItem: LinkedWorkItem | undefined) => {
      const editedCwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        sessionData.snapshot().history.find((entry) => entry.id === sessionId)
          ?.cwd ??
        sidebarCwd;
      const previousLinkedWorkItem =
        sessionsRef.current.find((session) => session.id === sessionId)
          ?.linkedWorkItem ??
        sessionData
          .snapshot()
          .history.find((session) => session.id === sessionId)?.linkedWorkItem;
      sessionData.invalidate(sessionId);

      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, linkedWorkItem } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      sessionData.updateSummary(sessionId, (session) => ({
        ...session,
        linkedWorkItem,
      }));
      setLinkedWorkItemPanels((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

      void setSessionLinkedWorkItem(sessionId, linkedWorkItem).catch(
        (error) => {
          const rolledBackSessions = sessionsRef.current.map((session) =>
            session.id === sessionId &&
            session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          );
          sessionsRef.current = rolledBackSessions;
          setSessions(rolledBackSessions);
          sessionData.updateSummary(sessionId, (session) =>
            session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          );
          void refreshHistory(editedCwd, true);
          void showNativeMessage(
            `Could not update this conversation's GitHub link.\n\n${String(error)}`,
            { title: "OmniCode", kind: "error" },
          );
        },
      );
    },
    [history, sessionData, refreshHistory, sidebarCwd],
  );

  const onArchiveHistorySessions = useCallback(
    async (sessionIds: readonly string[], archived: boolean) => {
      for (const sessionId of sessionIds) {
        if (!(await onArchiveHistorySession(sessionId, archived))) break;
      }
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      await Promise.all(
        sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)),
      );
    },
    [onPinHistorySession],
  );

  const onDeleteWorktreeSessions = useCallback(
    async (sessionIds: readonly string[]): Promise<boolean> => {
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) {
          return false;
        }
      }
      return true;
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySession = useCallback(
    (sessionId: string) => onRemoveHistorySession(sessionId, "delete"),
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessions = useCallback(
    async (sessionIds: readonly string[]) => {
      if (sessionIds.length === 0) return;
      if (
        !window.confirm(
          `Delete ${sessionIds.length} selected conversations? This can’t be undone.`,
        )
      )
        return;
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) break;
      }
    },
    [onRemoveHistorySession],
  );
  return {
    checkOpenWorktreeFiles,
    onArchiveFocusedSession,
    onArchiveHistorySession,
    onDeleteHistorySession,
    onRenameHistorySession,
    onRemoveWorktree,
    onCheckWorktreeRemoval,
    onDeleteWorktreeSessions,
    onArchiveHistorySessions,
    onDeleteHistorySessions,
    onPinHistorySession,
    onPinHistorySessions,
    onSetHistorySessionLinkedWorkItem,
  };
}
