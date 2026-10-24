import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import { rememberRemotePendingExecutionCwd, rememberRemoteSession, remoteSessionFor } from "../../features/connections/model/connections";
import { sameProjectPath } from "../../features/projects/model/recents";
import { newSession } from "../../features/sessions/model/session";
import { type Session } from "../../contracts/session";
import { worktreeFocus } from "../../features/source-control/model/worktreeFocus";
import { confirmCloseTerminal, confirmCloseTerminals } from "../../features/terminal/model/terminalClose";
import { closeLeaf, closeSurfacePanes, findSurfacePane, firstLeafId, isFilesystemTab, leaf, leafIds, removePane, resetTabToSession, siblingLeafId, surfacePanes, withSurfacePanes, type WorkspaceTab } from "../../features/workspace/model/layout";
import { planWorkspaceTabClose } from "../../features/workspace/model/workspaceTabGroups";
import { basename } from "../../platform/tauri/fs";
import { confirmDiscardUnsaved } from "../model/confirmDiscardUnsaved";
import { isBlankWorkspaceTab } from "../model/workspaceSelectors";
import type { WorkspaceFiles } from "./useWorkspaceFiles";

type Options = {
  tabsRef: RefObject<WorkspaceTab[]>;
  sessionsRef: RefObject<Session[]>;
  tabCloseScope: "project";
  tabWorktreeOf: (tab: WorkspaceTab) => string | null;
  fileState: Pick<WorkspaceFiles, "isDirty" | "forgetDirtyFiles">;
  persistSession: (session: Session | undefined) => void;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  activeTabIdRef: RefObject<string>;
  activateTab: (id: string, paneId?: string) => void;
  refreshHistory: (cwd: string, force?: boolean) => Promise<void>;
  sidebarCwd: string;
  projectCwd: string;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  activeTabId: string;
  notesEnabled: boolean;
  appPage: "inbox" | "notes" | "automations" | "workflows" | "projects" | null;
  closeAppPage: () => void;
  tabs: WorkspaceTab[];
  tabWorkspace: (tab: WorkspaceTab, list: readonly Session[]) => string | null;
  projectCwdRef: RefObject<string>;
  activeTab: WorkspaceTab;
};

export function useWorkspaceTabClosing({
  tabsRef,
  sessionsRef,
  tabCloseScope,
  tabWorktreeOf,
  fileState,
  persistSession,
  setTabs,
  activeTabIdRef,
  activateTab,
  refreshHistory,
  sidebarCwd,
  projectCwd,
  setSessions,
  setComposerFocused,
  activeTabId,
  notesEnabled,
  appPage,
  closeAppPage,
  tabs,
  tabWorkspace,
  projectCwdRef,
  activeTab,
}: Options) {
  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      const current = tabsRef.current;
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const closePlan = planWorkspaceTabClose({
        tabs: current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") return;
      const closing = current[index];
      const closingFiles = [
        ...closing.editorPanes.flatMap((pane) => pane.files),
        ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
      );
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const terminals = closingFiles.filter(
        (file) => file.terminal && !confirmed.has(file.id),
      );

      const finishClose = () => {
        const nextActiveTabId = closePlan.nextActiveTabId;
        const next = current.filter((t) => t.id !== id);
        const gone = new Set(
          leafIds(closing.layout).filter((paneId) =>
            sessionsRef.current.some((session) => session.id === paneId),
          ),
        );
        for (const sessionId of gone) {
          persistSession(sessionsRef.current.find((s) => s.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingExecutionCwd(sessionId);
        }
        fileState.forgetDirtyFiles(closingFiles.map((file) => file.id));
        setTabs(next);
        if (id === activeTabIdRef.current && nextActiveTabId) {
          activateTab(nextActiveTabId);
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close this tab with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd, tabCloseScope],
  );

  const onCloseTabs = useCallback(
    (ids: string[], fallbackId: string, opts?: { confirmed?: boolean }) => {
      const current = tabsRef.current;
      const closingIds = new Set(ids);
      const closing = current.filter((tab) => closingIds.has(tab.id));
      const fallback = current.find(
        (tab) => tab.id === fallbackId && !closingIds.has(tab.id),
      );
      if (!fallback || closing.length === 0) return;

      const closingFiles = closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = () => {
        const sessionIds = new Set(
          closing.flatMap((tab) =>
            leafIds(tab.layout).filter((paneId) =>
              sessionsRef.current.some((session) => session.id === paneId),
            ),
          ),
        );
        for (const sessionId of sessionIds) {
          persistSession(
            sessionsRef.current.find((session) => session.id === sessionId),
          );
          rememberRemoteSession(sessionId);
          rememberRemotePendingExecutionCwd(sessionId);
        }
        fileState.forgetDirtyFiles(closingFiles.map((file) => file.id));
        setTabs((prev) => prev.filter((tab) => !closingIds.has(tab.id)));
        if (closingIds.has(activeTabIdRef.current)) activateTab(fallback.id);
        void refreshHistory(sidebarCwd);
      };

      // The caller already confirmed unsaved files and terminals.
      if (opts?.confirmed) {
        finishClose();
        return;
      }

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close these tabs with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd],
  );

  const onCloseOtherTabs = useCallback(() => {
    const current = tabsRef.current;
    const activeId = activeTabIdRef.current;
    if (!current.some((tab) => tab.id === activeId)) return;
    onCloseTabs(
      current.filter((tab) => tab.id !== activeId).map((tab) => tab.id),
      activeId,
    );
  }, [onCloseTabs]);

  const onCloseFile = useCallback(
    (paneId: string, fileId: string) => {
      const tab = tabsRef.current.find((entry) =>
        findSurfacePane(entry, paneId),
      );
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const { kind, pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        isFilesystemTab(file) && fileState.isDirty(fileId);

      const finishClose = () => {
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        let nextLayout = tab.layout;
        let nextPanes = surfacePanes(tab, kind);
        if (files.length > 0) {
          nextFocus = paneId;
          const activeFileId =
            pane.activeFileId === fileId
              ? files[Math.min(index, files.length - 1)].id
              : pane.activeFileId;
          nextPanes = nextPanes.map((entry) =>
            entry.id === paneId ? { ...entry, files, activeFileId } : entry,
          );
        } else {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            fileState.forgetDirtyFiles([fileId]);
            const closePlan = planWorkspaceTabClose({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              closingTabId: tab.id,
              scope: tabCloseScope,
              worktreeOf: tabWorktreeOf,
            });
            if (closePlan.action === "close") {
              onCloseTab(
                tab.id,
                file.terminal ? { confirmedTerminalIds: [fileId] } : undefined,
              );
              return;
            }
            const seed = sessionsRef.current[0];
            const session = newSession(
              seed?.harness ?? "claude",
              file.appView ? projectCwd : file.cwd || projectCwd,
              seed?.model,
              seed?.runtimeMode,
              seed?.modelSettings,
            );
            setSessions((prev) => [...prev, session]);
            setTabs((prev) =>
              prev.map((entry) =>
                entry.id === tab.id
                  ? {
                      ...entry,
                      layout: leaf(session.id),
                      focusedId: session.id,
                      editorPanes: [],
                      terminalPanes: [],
                      diffOpen: false,
                      diffFocused: false,
                    }
                  : entry,
              ),
            );
            setComposerFocused(true);
            return;
          }
          nextLayout = withoutPane;
          nextFocus =
            tab.focusedId === paneId
              ? (sibling ?? firstLeafId(withoutPane))
              : tab.focusedId;
          nextPanes = nextPanes.filter((entry) => entry.id !== paneId);
        }

        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === tab.id
              ? withSurfacePanes(
                  {
                    ...entry,
                    layout: nextLayout,
                    focusedId: nextFocus,
                  },
                  kind,
                  nextPanes,
                )
              : entry,
          ),
        );
        fileState.forgetDirtyFiles([fileId]);
        if (tab.id === activeTabId && files.length === 0) {
          setComposerFocused(
            sessionsRef.current.some((session) => session.id === nextFocus),
          );
        }
      };

      void (async () => {
        if (needsUnsavedConfirm) {
          const ok = await confirmDiscardUnsaved(
            `Close ${basename(file.path)} without saving?`,
          );
          if (!ok) return;
        }
        if (file.terminal) {
          const ok = await confirmCloseTerminal(file);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activeTabId, onCloseTab, projectCwd, tabCloseScope],
  );

  useEffect(() => {
    if (!notesEnabled && appPage === "notes") closeAppPage();
  }, [notesEnabled, appPage, closeAppPage]);

  const onCloseOtherFiles = useCallback((paneId: string, fileId: string) => {
    const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
    if (!tab) return;
    const found = findSurfacePane(tab, paneId);
    if (!found?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = found.pane.files.filter(
      (file) => file.id !== fileId && !file.explorer,
    );
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    const finishClose = () => {
      setTabs((prev) =>
        prev.map((entry) => {
          if (entry.id !== tab.id) return entry;
          const current = findSurfacePane(entry, paneId);
          if (!current?.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          return withSurfacePanes(
            { ...entry, focusedId: paneId },
            current.kind,
            surfacePanes(entry, current.kind).map((pane) =>
              pane.id === paneId
                ? {
                    ...pane,
                    files: pane.files.filter(
                      (file) => !closingIds.has(file.id),
                    ),
                    activeFileId: fileId,
                  }
                : pane,
            ),
          );
        }),
      );
      fileState.forgetDirtyFiles(closingIds);
    };

    void (async () => {
      if (unsaved.length > 0) {
        const ok = await confirmDiscardUnsaved(
          "Close other tabs with unsaved files?",
        );
        if (!ok) return;
      }
      if (terminals.length > 0) {
        const ok = await confirmCloseTerminals(terminals);
        if (!ok) return;
      }
      finishClose();
    })();
  }, []);

  const onClearTabSession = useCallback(
    (id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab || isBlankWorkspaceTab(tab, sessionsRef.current)) return;

      const closingFiles = [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
      );

      const oldSessionId = leafIds(tab.layout).find((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      const oldSession = sessionsRef.current.find(
        (session) => session.id === oldSessionId,
      );
      if (!oldSession) return;

      const finishClear = () => {
        persistSession(oldSession);
        for (const shellId of leafIds(tab.layout)) {
          rememberRemoteSession(shellId);
          rememberRemotePendingExecutionCwd(shellId);
        }

        // The blank replacement stays in the tab's worktree, so clearing the
        // last tab there does not switch the workspace back to the project.
        const workspace = tabWorkspace(tab, sessionsRef.current);
        const focus = worktreeFocus(oldSession.cwd);
        const session = {
          ...newSession(
            oldSession.harness,
            oldSession.cwd,
            oldSession.model,
            oldSession.runtimeMode,
            oldSession.modelSettings,
          ),
          ...(workspace
            ? {
                executionCwd: workspace,
                branch:
                  (focus && sameProjectPath(focus.path, workspace)
                    ? focus.branch
                    : undefined) ??
                  (oldSession.executionCwd &&
                  sameProjectPath(oldSession.executionCwd, workspace)
                    ? oldSession.branch
                    : undefined) ??
                  undefined,
              }
            : {}),
        };

        setSessions((prev) => [...prev, session]);
        fileState.forgetDirtyFiles(closingFiles.map((file) => file.id));
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id ? resetTabToSession(entry, session.id) : entry,
          ),
        );
        setComposerFocused(true);
        void refreshHistory(sidebarCwd);
      };

      if (unsaved.length === 0) {
        finishClear();
        return;
      }
      void confirmDiscardUnsaved(
        "Close this conversation with unsaved files?",
      ).then((ok) => ok && finishClear());
    },
    [tabs, persistSession, refreshHistory, sidebarCwd],
  );

  const onRemoteSessionDeleted = useCallback(
    (remoteSessionId: string, project?: string) => {
      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).some(
          (shellId) =>
            remoteSessionFor(shellId) === remoteSessionId &&
            (!project ||
              sessionsRef.current.some(
                (session) =>
                  session.id === shellId &&
                  sameProjectPath(session.cwd, project),
              )),
        ),
      );
      if (!tab) return;
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: tab.id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") onClearTabSession(tab.id);
      else onCloseTab(tab.id);
    },
    [onClearTabSession, onCloseTab, tabCloseScope],
  );

  const onCloseAllTabs = useCallback(() => {
    const tab = tabsRef.current.find(
      (entry) => entry.id === activeTabIdRef.current,
    );
    if (!tab) return;

    const seedSession = (cwd: string) => {
      const seed = sessionsRef.current[0];
      return newSession(
        seed?.harness ?? "claude",
        cwd,
        seed?.model,
        seed?.runtimeMode,
        seed?.modelSettings,
      );
    };

    // Stage one: files open in the active tab's editor panes close first.
    // Only when none are open does the command close every workspace tab.
    const editorFiles = tab.editorPanes.flatMap((pane) => pane.files);
    if (editorFiles.length > 0) {
      const remaining = closeSurfacePanes(tab, "editor");
      if (!remaining) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: tab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "close") {
          onCloseTab(tab.id);
          return;
        }
      }
      const unsaved = editorFiles.filter(
        (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
      );

      const finishClose = () => {
        let nextTab: WorkspaceTab;
        let focusesSession: boolean;
        if (remaining) {
          nextTab = remaining;
          focusesSession = sessionsRef.current.some(
            (session) => session.id === remaining.focusedId,
          );
        } else {
          // The tab held only editor panes and must stay: seed a session.
          const session = seedSession(
            editorFiles[0].appView
              ? projectCwdRef.current
              : editorFiles[0].cwd || projectCwd,
          );
          setSessions((prev) => [...prev, session]);
          nextTab = resetTabToSession(tab, session.id);
          focusesSession = true;
        }
        setTabs((prev) =>
          prev.map((entry) => (entry.id === tab.id ? nextTab : entry)),
        );
        fileState.forgetDirtyFiles(editorFiles.map((file) => file.id));
        setComposerFocused(focusesSession);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close all open files with unsaved changes?",
          );
          if (!ok) return;
        }
        finishClose();
      })();
      return;
    }

    // Stage two: the workspace always keeps one tab, so close every other
    // tab and reset the active one to a blank session. Every confirmation
    // runs before any tab changes, so a cancelled prompt leaves all tabs.
    const otherIds = tabsRef.current
      .filter((entry) => entry.id !== tab.id)
      .map((entry) => entry.id);
    const terminalFiles = (tab.terminalPanes ?? []).flatMap(
      (pane) => pane.files,
    );
    const closingFiles = [
      ...tabsRef.current
        .filter((entry) => otherIds.includes(entry.id))
        .flatMap((entry) => [
          ...entry.editorPanes.flatMap((pane) => pane.files),
          ...(entry.terminalPanes ?? []).flatMap((pane) => pane.files),
        ]),
      ...terminalFiles,
    ];
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && fileState.isDirty(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    void (async () => {
      if (unsaved.length > 0) {
        const ok = await confirmDiscardUnsaved(
          "Close all tabs with unsaved files?",
        );
        if (!ok) return;
      }
      if (terminals.length > 0) {
        const ok = await confirmCloseTerminals(terminals);
        if (!ok) return;
      }
      if (otherIds.length > 0) {
        onCloseTabs(otherIds, tab.id, { confirmed: true });
      }
      const hasSession = leafIds(tab.layout).some((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (hasSession) {
        // No editor files remain, so this commits without a prompt.
        onClearTabSession(tab.id);
        return;
      }
      // The tab held no session: seed one so the workspace stays usable.
      const session = seedSession(terminalFiles[0]?.cwd || projectCwd);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id ? resetTabToSession(entry, session.id) : entry,
        ),
      );
      setComposerFocused(true);
    })();
  }, [onCloseTab, onCloseTabs, onClearTabSession, projectCwd, tabCloseScope]);

  const onClosePane = useCallback(
    (sessionId?: string) => {
      // The project terminal is shared by every workspace tab in the project.
      // Keep the global close command scoped to workspace tabs and panes even
      // while the dock has focus; terminal tabs have their own close buttons.
      if (!activeTab) return;
      const explorerPane = activeTab.editorPanes.find(
        (pane) =>
          pane.id === sessionId && pane.files.some((file) => file.explorer),
      );
      if (explorerPane) {
        void (async () => {
          const dirty = explorerPane.files.some((file) =>
            fileState.isDirty(file.id),
          );
          if (
            dirty &&
            !(await confirmDiscardUnsaved("Close tabs with unsaved files?"))
          )
            return;
          if (!closeLeaf(activeTab, explorerPane.id)) {
            onCloseTab(activeTab.id);
            return;
          }
          setTabs((current) =>
            current.map((tab) => {
              if (tab.id !== activeTab.id) return tab;
              const next = closeLeaf(tab, explorerPane.id);
              return next
                ? {
                    ...next,
                    editorPanes: next.editorPanes.filter(
                      (pane) => pane.id !== explorerPane.id,
                    ),
                  }
                : tab;
            }),
          );
          fileState.forgetDirtyFiles(explorerPane.files.map((file) => file.id));
        })();
        return;
      }
      const focusedSurface = findSurfacePane(activeTab, activeTab.focusedId);
      if (sessionId === undefined && focusedSurface) {
        onCloseFile(focusedSurface.pane.id, focusedSurface.pane.activeFileId);
        return;
      }
      const closingId = sessionId ?? activeTab.focusedId;
      const ids = leafIds(activeTab.layout);
      const sessionIds = ids.filter((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (!sessionIds.includes(closingId)) return;
      const nextTab = closeLeaf(activeTab, closingId);
      if (!nextTab || sessionIds.length === 1) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: activeTab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "keep") onClearTabSession(activeTab.id);
        else onCloseTab(activeTab.id);
        return;
      }
      persistSession(sessionsRef.current.find((s) => s.id === closingId));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, layout: nextTab.layout, focusedId: nextTab.focusedId }
            : t,
        ),
      );
      if (closingId === activeTab.focusedId) {
        setComposerFocused(
          nextTab &&
            sessionsRef.current.some(
              (session) => session.id === nextTab.focusedId,
            ),
        );
      }
      void refreshHistory(sidebarCwd);
    },
    [
      activeTab,
      onCloseFile,
      onCloseTab,
      onClearTabSession,
      persistSession,
      refreshHistory,
      sidebarCwd,
      tabCloseScope,
    ],
  );

  const onCloseTitleTab = useCallback(
    (id: string) => {
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep" && id === activeTabIdRef.current) {
        onClosePane();
        return;
      }
      onCloseTab(id);
    },
    [onClosePane, onCloseTab, tabCloseScope],
  );
  return {
    onClosePane,
    onCloseTitleTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onCloseFile,
    onCloseOtherFiles,
    onRemoteSessionDeleted,
  };
}
