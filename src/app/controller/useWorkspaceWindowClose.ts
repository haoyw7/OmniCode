import type { RefObject } from "react";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { onWorkspaceWindowCloseRequested } from "../../platform/tauri/workspaceWindow";
import { useEffect } from "react";
import {
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../features/projects/model/projectTerminal";
import { type WorkspaceTab } from "../../features/workspace/model/layout";
import { IS_MAC } from "../../platform/tauri/platform";
import type { HarnessEventQueue } from "../model/harnessFlush";
import { type Session } from "../../features/sessions/model/session";
import { loadCloseToTray } from "../../features/settings/model/settings";
import {
  closeBusyWindow,
  closeCurrentWindow,
  hasInFlightSessions,
  hideCurrentWindow,
  persistLiveTranscripts,
  persistQuitState,
  setQuitWorkspace,
} from "../model/appLifecycle";

type Options = {
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  projectCwdRef: RefObject<string>;
  projectTerminalsRef: RefObject<ProjectTerminal[]>;
  lastDockSideRef: RefObject<DockSide | null>;
  readProjectReturnMemory: WorkspaceNavigation["readProjectReturnMemory"];
  flushHarnessEvents: HarnessEventQueue["flush"];
  keepWorkspaceTab: WorkspaceNavigation["keepWorkspaceTab"];
};

/** Registers quit persistence and preserves the busy-window and close-to-tray policy. */
export function useWorkspaceWindowClose({
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  projectTerminalsRef,
  lastDockSideRef,
  readProjectReturnMemory,
  flushHarnessEvents,
  keepWorkspaceTab,
}: Options) {
  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      readProjectReturnMemory,
      flushHarnessEvents,
      () => lastDockSideRef.current,
      keepWorkspaceTab,
    );
    void onWorkspaceWindowCloseRequested((event) => {
      // Listening here makes close our job. Letting the default path run
      // calls JS `window.destroy`, which Tauri denies without a permission.
      event.preventDefault();
      const toTray = loadCloseToTray();
      if (hasInFlightSessions(sessionsRef.current)) {
        flushHarnessEvents();
        if (!toTray && !IS_MAC) {
          void closeBusyWindow();
          return;
        }
        // Not `persistQuitState`: that marks the live turns interrupted.
        void persistLiveTranscripts(sessionsRef.current);
        void hideCurrentWindow();
        return;
      }
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
        keepWorkspaceTab,
      ).finally(() => {
        void (toTray ? hideCurrentWindow() : closeCurrentWindow());
      });
    }).then((fn) => {
      unlistenClose = fn;
    });
    return () => {
      releaseQuit();
      unlistenClose?.();
    };
  }, [flushHarnessEvents, keepWorkspaceTab, readProjectReturnMemory]);
}
