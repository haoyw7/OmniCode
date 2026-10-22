import type { RefObject } from "react";
import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { useEffect } from "react";
import {
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../../features/projects/model/projectTerminal";
import { type WorkspaceTab } from "../../features/workspace/model/layout";
import { startHarnessBridge } from "../../integrations/harness";
import type { HarnessEventQueue } from "../model/harnessFlush";
import type { AppProps } from "./workspaceTypes";
import { type Session } from "../../features/sessions/model/session";
import {
  bindResumedSessions,
  isAppQuitting,
  persistQuitState,
  reapWindowRuntime,
} from "../model/appLifecycle";

type Options = {
  resumed: AppProps["resumed"];
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  projectCwdRef: RefObject<string>;
  projectTerminalsRef: RefObject<ProjectTerminal[]>;
  lastDockSideRef: RefObject<DockSide | null>;
  readProjectReturnMemory: WorkspaceNavigation["readProjectReturnMemory"];
  harnessEvents: HarnessEventQueue;
};

/** Owns the harness bridge and unload persistence for this window. */
export function useWorkspaceRuntimeLifecycle({
  resumed,
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  projectTerminalsRef,
  lastDockSideRef,
  readProjectReturnMemory,
  harnessEvents,
}: Options) {
  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
      ).finally(() => {
        void reapWindowRuntime(
          sessionsRef.current,
          tabsRef.current,
          projectTerminalsRef.current,
        );
      });
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      harnessEvents.cancelScheduled();
    };
  }, [resumed, readProjectReturnMemory, harnessEvents]);
}
