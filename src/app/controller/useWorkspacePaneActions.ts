import { supportsProjectTerminal } from "../../features/terminal/model/terminalAvailability";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { rememberRemoteSession, remoteSessionFor } from "../../features/connections/model/connections";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { findProjectTerminal, mapProjectTerminal, moveDockToPane, movePaneToDock, takeSessionTerminals, withDockOpen, type DockSide, type ProjectTerminalDock as ProjectTerminal } from "../../features/projects/model/projectTerminal";
import { sameProjectPath } from "../../features/projects/model/recents";
import type { RuntimeMode, Session } from "../../contracts/session";
import { newDefaultSession } from "../../features/sessions/model/session";

import { leafIds, moveTabPane, neighborLeafId, newTerminalFile, sessionToolPanes, setSplitRatio, splitPane, type FocusDir, type LayoutNode, type PaneEdge, type SplitDir, type WorkspaceTab } from "../../features/workspace/model/layout";
import { applyPlaceSessionOnPane } from "../../features/workspace/model/workspaceTabGroups";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";

type Options = {
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  projectCwdRef: RefObject<string>;
  projectTerminalsRef: RefObject<ProjectTerminal[]>;
  lastDockSideRef: RefObject<DockSide | null>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setProjectTerminals: Dispatch<SetStateAction<ProjectTerminal[]>>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setActiveTabId: (id: string) => void;
  activeTab: WorkspaceTab | undefined;
  activeTabId: string;
  projectCwd: string;
  sessionDefaults: Session | undefined;
  newSessionRuntimeMode: RuntimeMode | undefined;
  inboxSessionId?: string;
  cancelNavigation: () => void;
  ensureOpenSession: (id: string) => Promise<Session | null>;
  canDiscardEmptySession: (id: string) => boolean;
  sessionData: Pick<WorkspaceSessionData, "resetPersistence">;
  tabCloseScope: "project";
};

/** Split, move and focus workspace panes without taking ownership of PTYs. */
export function useWorkspacePaneActions({
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  projectTerminalsRef,
  lastDockSideRef,
  setSessions,
  setTabs,
  setProjectTerminals,
  setProjectTerminalFocused,
  setComposerFocused,
  setActiveTabId,
  activeTab,
  activeTabId,
  projectCwd,
  sessionDefaults,
  newSessionRuntimeMode,
  inboxSessionId,
  cancelNavigation,
  ensureOpenSession,
  canDiscardEmptySession,
  sessionData,
  tabCloseScope,
}: Options) {
  const sessionLoader = useRef(ensureOpenSession);
  sessionLoader.current = ensureOpenSession;
  const onSplit = useCallback(
    (dir: SplitDir) => {
      if (!activeTab) return;
      const session = newDefaultSession(
        sessionDefaults?.cwd ?? projectCwd,
        newSessionRuntimeMode,
      );
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return {
            ...t,
            layout: splitPane(t.layout, t.focusedId, dir, session.id),
            focusedId: session.id,
          };
        }),
      );
      setComposerFocused(true);
    },
    [activeTab, projectCwd, sessionDefaults?.cwd, newSessionRuntimeMode],
  );

  const focusProjectTerminal = useCallback(() => {
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, []);

  const onFocusPane = useCallback(
    (paneId: string) => {
      if (
        tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
          ?.focusedId !== paneId
      )
        cancelNavigation();
      setProjectTerminalFocused(false);
      if (inboxSessionId === paneId) {
        setComposerFocused(true);
        return;
      }
      // Refocusing the already-focused pane must keep the same tabs array, or
      // every click inside a pane re-renders the whole workspace.
      setTabs((prev) => {
        const current = prev.find((t) => t.id === activeTabId);
        if (!current || (current.focusedId === paneId && !current.diffFocused))
          return prev;
        return prev.map((t) =>
          t === current ? { ...t, focusedId: paneId, diffFocused: false } : t,
        );
      });
      setComposerFocused(
        sessionsRef.current.some((session) => session.id === paneId),
      );
    },
    [activeTabId, inboxSessionId, cancelNavigation],
  );

  const onMovePane = useCallback(
    (fromId: string, toId: string, edge: PaneEdge) => {
      setTabs((prev) =>
        prev.map((tab) => {
          return leafIds(tab.layout).includes(fromId)
            ? moveTabPane(tab, fromId, toId, edge)
            : tab;
        }),
      );
    },
    [],
  );

  /** The project dock's terminals become one pane in the split; the dock closes. */
  const onMoveDockToPane = useCallback((targetId: string, edge: PaneEdge) => {
    const projectPath = projectCwdRef.current;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    const tab = tabsRef.current.find((entry) =>
      leafIds(entry.layout).includes(targetId),
    );
    if (!dock || !tab) return;
    const moved = moveDockToPane(tab, dock, targetId, edge);
    if (!moved) return;
    const nextTabs = tabsRef.current.map((entry) =>
      entry.id === tab.id ? { ...moved, autoArrangeTools: false } : entry,
    );
    const nextDocks = projectTerminalsRef.current.filter(
      (entry) => entry !== dock,
    );
    tabsRef.current = nextTabs;
    projectTerminalsRef.current = nextDocks;
    setTabs(nextTabs);
    setProjectTerminals(nextDocks);
    setProjectTerminalFocused(false);
  }, []);

  /**
   * The chat header's terminal toggle works like its files toggle: this chat's
   * own terminals join its layout beside it, so split view shows them as a
   * card and full view as a tab. Other chats in the split keep theirs. Hiding
   * returns them to the closed dock, where their shells keep running.
   */
  const onToggleSessionTerminal = useCallback(
    (sessionId: string, cwd: string, sessionProject?: string) => {
      // A chat's hidden terminals wait in its own project's dock.
      const projectPath = sessionProject && supportsProjectTerminal(sessionProject)
        ? sessionProject
        : projectCwdRef.current;
      if (!supportsProjectTerminal(projectPath)) return;
      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).includes(sessionId),
      );
      if (!tab) return;
      const shown = sessionToolPanes(tab, sessionId, "terminal");
      let nextTab = tab;
      let nextDocks = projectTerminalsRef.current;
      if (shown.length > 0) {
        const dockWasOpen = findProjectTerminal(nextDocks, projectPath)?.open ?? false;
        const side =
          findProjectTerminal(nextDocks, projectPath)?.side ??
          lastDockSideRef.current ??
          "bottom";
        for (const pane of shown) {
          const moved = movePaneToDock(nextTab, nextDocks, pane.id, projectPath, side, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          if (!moved) continue;
          nextTab = moved.tab;
          nextDocks = moved.docks;
        }
        // Other terminals already in an open dock stay visible.
        nextDocks = mapProjectTerminal(nextDocks, projectPath, (dock) =>
          withDockOpen(dock, dockWasOpen),
        );
      } else {
        const taken = takeSessionTerminals(
          nextDocks,
          projectPath,
          sessionId,
          () => newTerminalFile(cwd || projectPath, undefined, projectPath),
          findProjectTerminal(nextDocks, projectPath)?.side ?? lastDockSideRef.current ?? "bottom",
        );
        const moved = moveDockToPane(tab, taken.dock, sessionId, taken.dock.side);
        if (!moved) return;
        nextTab = moved;
        nextDocks = taken.docks;
        setComposerFocused(false);
      }
      const nextTabs = tabsRef.current.map((entry) =>
        entry.id === tab.id ? nextTab : entry,
      );
      tabsRef.current = nextTabs;
      projectTerminalsRef.current = nextDocks;
      setTabs(nextTabs);
      setProjectTerminals(nextDocks);
      setProjectTerminalFocused(false);
    },
    [],
  );

  /** A split terminal pane returns to the project's dock, opening one if needed. */
  const onMovePaneToDock = useCallback(
    (paneId: string) => {
      const projectPath = projectCwdRef.current;
      if (!supportsProjectTerminal(projectPath)) return;
      const tab = tabsRef.current.find((entry) =>
        (entry.terminalPanes ?? []).some((pane) => pane.id === paneId),
      );
      if (!tab) return;
      const moved = movePaneToDock(
        tab,
        projectTerminalsRef.current,
        paneId,
        projectPath,
        lastDockSideRef.current ?? "bottom",
        { width: window.innerWidth, height: window.innerHeight },
      );
      if (!moved) return;
      const nextTabs = tabsRef.current.map((entry) =>
        entry.id === tab.id ? moved.tab : entry,
      );
      tabsRef.current = nextTabs;
      projectTerminalsRef.current = moved.docks;
      setTabs(nextTabs);
      setProjectTerminals(moved.docks);
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onPlaceSessionOnPane = useCallback(
    async (
      droppedId: string,
      targetId: string,
      edge: PaneEdge,
      hostProject?: string,
    ) => {
      const targetTab = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(targetId),
      );
      if (!targetTab) return;
      // A Host session opens through a local shell, as a sidebar click does:
      // reuse the shell already showing it, or bind a new one.
      let sessionId = droppedId;
      if (hostProject) {
        const shell = sessionsRef.current.find(
          (session) =>
            remoteSessionFor(session.id) === droppedId &&
            sameProjectPath(session.cwd, hostProject),
        );
        if (shell) sessionId = shell.id;
        else {
          const created = newDefaultSession(hostProject, newSessionRuntimeMode);
          rememberRemoteSession(
            created.id,
            droppedId,
            remoteProjectFor(hostProject),
          );
          sessionsRef.current = [...sessionsRef.current, created];
          setSessions(sessionsRef.current);
          sessionId = created.id;
        }
      }
      if (sessionId === targetId) return;

      const alreadyHere = leafIds(targetTab.layout).includes(sessionId);
      if (!alreadyHere) {
        const session = await sessionLoader.current(sessionId);
        if (!session) return;
      }

      const tab = tabsRef.current.find((entry) => entry.id === targetTab.id);
      if (!tab || !leafIds(tab.layout).includes(targetId)) return;

      const replaceTarget =
        !leafIds(tab.layout).includes(sessionId) &&
        canDiscardEmptySession(targetId);

      if (replaceTarget) {
        sessionData.resetPersistence(targetId);
      }

      const result = applyPlaceSessionOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sessionId,
        targetId,
        edge,
        replaceTarget,
        scope: tabCloseScope,
        createReplacement: (seed) =>
          newDefaultSession(
            seed?.cwd ?? projectCwdRef.current,
            seed?.runtimeMode,
          ),
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    },
    [newSessionRuntimeMode, tabCloseScope, sessionData],
  );

  const onFocusDir = useCallback(
    (dir: FocusDir) => {
      if (!activeTab) return;
      const next = neighborLeafId(activeTab.layout, activeTab.focusedId, dir);
      if (next) onFocusPane(next);
    },
    [activeTab, onFocusPane],
  );

  const onFitPaneLayout = useCallback(
    (tabId: string, previous: LayoutNode, next: LayoutNode) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId && tab.layout === previous
            ? { ...tab, layout: next }
            : tab,
        ),
      );
    },
    [],
  );

  const onRatio = useCallback(
    (tabId: string, splitId: string, index: number, ratio: number) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, layout: setSplitRatio(t.layout, splitId, index, ratio) }
            : t,
        ),
      );
    },
    [],
  );

  const onSplitSession = useCallback(
    (sessionId: string) => {
      const session = newDefaultSession(
        sessionDefaults?.cwd ?? projectCwd,
        newSessionRuntimeMode,
      );
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((tab) =>
          leafIds(tab.layout).includes(sessionId)
            ? {
                ...tab,
                layout: splitPane(tab.layout, sessionId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : tab,
        ),
      );
      setComposerFocused(true);
    },
    [sessionDefaults?.cwd, projectCwd, newSessionRuntimeMode],
  );
  return {
    onSplit,
    onSplitSession,
    onFocusPane,
    onFocusDir,
    focusProjectTerminal,
    onMovePane,
    onMoveDockToPane,
    onMovePaneToDock,
    onToggleSessionTerminal,
    onPlaceSessionOnPane,
    onFitPaneLayout,
    onRatio,
  };
}
