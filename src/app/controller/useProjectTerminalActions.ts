import { supportsProjectTerminal } from "../../features/terminal/model/terminalAvailability";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import type { ProjectTerminalDock } from "../../features/projects/model/projectTerminal";
import {
  addTerminalToDock,
  closeTerminalInDock,
  createProjectTerminal,
  findProjectTerminal,
  mapProjectTerminal,
  nextDockTerminalTitle,
  patchProjectTerminals,
  reorderDockTerminals,
  selectDockTerminal,
  withDockOpen,
  withDockSide,
  withDockSize,
  type DockSide,
} from "../../features/projects/model/projectTerminal";
import type { Session } from "../../features/sessions/model/session";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../../features/terminal/model/terminalClose";
import { type TerminalMetaPatch } from "../../features/terminal/model/terminalTab";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  openTerminalTab,
  updateTerminalTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { forgetHarnessSession } from "../../integrations/harness";
import { orderByIds } from "../../shared/lib/reorder";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";

type Options = {
  sessionData: Pick<WorkspaceSessionData, "resetPersistence">;
  projectCwdRef: RefObject<string>;
  setProjectTerminals: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  lastDockSideRef: RefObject<DockSide | null>;
  focusProjectTerminal: () => void;
  terminalCwd: string;
  activeTab: WorkspaceTab;
  sidebarCwd: string;
  appendTab: (tab: WorkspaceTab, cwd?: string | undefined) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  projectCwd: string;
  projectTerminalsRef: RefObject<ProjectTerminalDock[]>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setLastDockSide: Dispatch<SetStateAction<DockSide | null>>;
};

export function useProjectTerminalActions({
  sessionData,
  projectCwdRef,
  setProjectTerminals,
  lastDockSideRef,
  focusProjectTerminal,
  terminalCwd,
  activeTab,
  sidebarCwd,
  appendTab,
  setActiveTabId,
  setComposerFocused,
  sessionsRef,
  setSessions,
  setTabs,
  projectCwd,
  projectTerminalsRef,
  setProjectTerminalFocused,
  setLastDockSide,
}: Options) {
  const openProjectTerminal = useCallback(
    (cwd: string) => {
      const workdir = cwd || projectCwdRef.current;
      const projectPath = projectCwdRef.current;
      if (!supportsProjectTerminal(projectPath)) return false;
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
          projectPath,
        );
        if (!existing) {
          return [
            ...prev,
            createProjectTerminal(
              projectPath,
              file,
              lastDockSideRef.current ?? "bottom",
            ),
          ];
        }
        return mapProjectTerminal(prev, projectPath, (dock) =>
          addTerminalToDock(dock, file),
        );
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string) => {
      const workdir = cwd || terminalCwd;
      if (!supportsProjectTerminal(projectCwdRef.current) || !supportsProjectTerminal(workdir))
        return;
      if (openProjectTerminal(workdir)) return;

      if (asWorkspaceTab || !activeTab) {
        const file = newTerminalFile(workdir, undefined, sidebarCwd);
        const tab = newTerminalWorkspaceTab(file);
        appendTab(tab, sidebarCwd);
        setActiveTabId(tab.id);
        setComposerFocused(false);
        return;
      }

      const occupying = sessionsRef.current.find(
        (session) => session.id === (occupySessionId ?? activeTab.focusedId),
      );
      const occupyPaneId =
        occupying && isBlankSession(occupying) ? occupying.id : undefined;
      if (occupyPaneId && occupying) {
        sessionData.resetPersistence(occupyPaneId);
        void forgetHarnessSession(occupying.harness, occupyPaneId);
        setSessions((prev) =>
          prev.filter((session) => session.id !== occupyPaneId),
        );
      }

      const file = newTerminalFile(
        workdir,
        nextTerminalTitle(activeTab, workdir),
        sidebarCwd,
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? openTerminalTab(tab, file, occupyPaneId)
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [
      terminalCwd,
      activeTab,
      appendTab,
      openProjectTerminal,
      sidebarCwd,
      sessionData,
    ],
  );

  const onNewTerminal = useCallback(() => {
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, onOpenTerminal]);


  const onToggleProjectTerminal = useCallback(() => {
    if (!supportsProjectTerminal(projectCwd)) return;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (!dock) {
      openProjectTerminal(terminalCwd);
      return;
    }
    const nextOpen = !dock.open;
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwd, (entry) =>
        withDockOpen(entry, nextOpen),
      ),
    );
    if (nextOpen) focusProjectTerminal();
    else setProjectTerminalFocused(false);
  }, [terminalCwd, focusProjectTerminal, openProjectTerminal, projectCwd]);

  const onHideProjectTerminal = useCallback(() => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockOpen(dock, false),
      ),
    );
    setProjectTerminalFocused(false);
  }, []);

  const onProjectTerminalSide = useCallback((side: DockSide) => {
    setLastDockSide(side);
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSide(dock, side, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onProjectTerminalSize = useCallback((size: number) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSize(dock, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onSelectProjectTerminal = useCallback(
    (fileId: string) => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
          selectDockTerminal(dock, fileId),
        ),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onReorderProjectTerminals = useCallback((ids: string[]) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        reorderDockTerminals(dock, orderByIds(dock.pane.files, ids)),
      ),
    );
  }, []);

  const onCloseProjectTerminal = useCallback((fileId: string) => {
    const dock = findProjectTerminal(
      projectTerminalsRef.current,
      projectCwdRef.current,
    );
    const file = dock?.pane.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (entry) =>
          closeTerminalInDock(entry, fileId),
        ),
      );
    };
    void confirmCloseTerminal(file).then((ok) => ok && finishClose());
  }, []);

  const onCloseOtherProjectTerminals = useCallback((fileId: string) => {
    const projectPath = projectCwdRef.current;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    if (!dock?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = dock.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));

    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (entry) => {
          if (!entry.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          const files = entry.pane.files.filter(
            (file) => !closingIds.has(file.id),
          );
          return {
            ...entry,
            pane: { ...entry.pane, files, activeFileId: fileId },
          };
        }),
      );
    };

    void confirmCloseTerminals(closingFiles).then((ok) => ok && finishClose());
  }, []);

  const onTerminalMetaChange = useCallback(
    (fileId: string, patch: TerminalMetaPatch) => {
      setProjectTerminals((prev) => patchProjectTerminals(prev, fileId, patch));
      setTabs((prev) =>
        prev.map((tab) => updateTerminalTab(tab, fileId, patch)),
      );
    },
    [],
  );

  const onNewTerminalTab = useCallback(() => {
    onOpenTerminal(terminalCwd, true);
  }, [terminalCwd, onOpenTerminal]);
  return {
    onNewTerminal,
    onToggleProjectTerminal,
    onNewTerminalTab,
    onCloseOtherProjectTerminals,
    onCloseProjectTerminal,
    onHideProjectTerminal,
    onOpenTerminal,
    onProjectTerminalSide,
    onProjectTerminalSize,
    onReorderProjectTerminals,
    onSelectProjectTerminal,
    onTerminalMetaChange,
  };
}
