import { ensureSharedProject, sharedHostMachineId } from "../../features/connections/model/remoteProjects";
import { loadRemoteSession, rememberRemoteSession } from "../../features/connections/model/connections";
import { remoteSessionState } from "../../features/connections/model/remoteSessionState";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { type AppSessionPlacement } from "../../contracts/app";
import type { Automation, AutomationRun } from "../../contracts/automations";

import { type RecentProject, sameProjectPath } from "../../features/projects/model/recents";

import { useQuickComposerLaunches } from "../../features/quick-composer/hooks/useQuickComposerLaunches";
import type { QuickLaunch } from "../../features/quick-composer/model/quickComposer";
import { type Attachment, type Session } from "../../contracts/session";
import { type SidebarTabId } from "../../features/settings/model/appearance";
import { leafIds, newTab, splitPane, type WorkspaceTab } from "../../features/workspace/model/layout";
import { acceptQuickLaunch } from "../model/quickLaunchSession";
import type { Submit } from "./workspaceTypes";

type Options = {
  sessionsRef: RefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  appendTab: (tab: WorkspaceTab, cwd?: string | undefined) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  focusOpenSession: (sessionId: string) => boolean;
  setSidebarTab: (tab: SidebarTabId, project?: string | undefined) => void;
  submitSession: Submit;
  tabsRef: RefObject<WorkspaceTab[]>;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  onSaveDraft: (
    sessionId: string,
    text: string,
    attachments?: Attachment[],
    appRequestId?: string | undefined,
  ) => boolean;
};

export function useSessionLaunches({
  sessionsRef,
  setSessions,
  appendTab,
  setActiveTabId,
  setComposerFocused,
  focusOpenSession,
  setSidebarTab,
  submitSession,
  tabsRef,
  setTabs,
  setProjectCwd,
  setRecents,
  onSaveDraft,
}: Options) {
  // Launching and recovering runs belongs to Host; this callback only opens its projection.
  const launchAutomation = useCallback(async (automation: Automation, run: AutomationRun, reveal = false) => {
    if (!run.sessionId) throw new Error(run.error || "The Host could not start this automation run.");
    const project = await ensureSharedProject(automation.cwd);
    const machineId = sharedHostMachineId();
    if (!machineId) throw new Error("Shared conversation service is not connected");
    const snapshot = await loadRemoteSession(machineId, run.sessionId);
    const existing = sessionsRef.current.find(session => session.id === run.sessionId);
    const session = remoteSessionState(existing ?? { ...snapshot.session, cwd: automation.cwd }, snapshot, project);
    rememberRemoteSession(session.id, run.sessionId, { environmentId: project.environmentId, projectId: project.projectId });
    if (!existing) {
      sessionsRef.current = [...sessionsRef.current, session];
      setSessions(current => [...current, session]);
      const tab = newTab(session.id);
      appendTab(tab, automation.cwd);
      if (reveal) { setActiveTabId(tab.id); setComposerFocused(false); }
    } else if (reveal) focusOpenSession(session.id);
    if (reveal) setSidebarTab("sessions", session.cwd);
  }, [appendTab, focusOpenSession]);

  const launchQuickSession = useCallback(
    (
      launch: QuickLaunch,
      deliveryId: string,
      placement?: AppSessionPlacement,
    ) =>
      acceptQuickLaunch(
        launch,
        deliveryId,
        {
          getSessions: () => sessionsRef.current,
          updateSessions: (update) => {
            sessionsRef.current = update(sessionsRef.current);
            // Compose with submission's queued transcript updates.
            setSessions(update);
          },
          appendTab,
          placeSession: (sessionId, target, cwd) => {
            const anchor = sessionsRef.current.find(
              (session) => session.id === target.besideSessionId,
            );
            const tab = tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(target.besideSessionId),
            );
            if (!anchor || !sameProjectPath(anchor.cwd, cwd) || !tab)
              throw new Error(
                "The target session must be open in this project",
              );
            const nextTabs = tabsRef.current.map((entry) =>
              entry.id === tab.id
                ? {
                    ...entry,
                    layout: splitPane(
                      entry.layout,
                      target.besideSessionId,
                      target.direction,
                      sessionId,
                    ),
                    focusedId: launch.reveal ? sessionId : entry.focusedId,
                    diffFocused: launch.reveal ? false : entry.diffFocused,
                  }
                : entry,
            );
            tabsRef.current = nextTabs;
            setTabs(nextTabs);
            return tab.id;
          },
          setProjectCwd,
          setRecents,
          revealTab: (id, cwd) => {
            setActiveTabId(id);
            setComposerFocused(false);
            setSidebarTab("sessions", cwd);
          },
          submit: submitSession,
          saveDraft: (id, prompt, attachments, requestId) =>
            flushSync(() => onSaveDraft(id, prompt, attachments, requestId)),
        },
        placement,
      ),
    [appendTab, submitSession, onSaveDraft],
  );

  useQuickComposerLaunches(launchQuickSession);

  return { launchQuickSession, launchAutomation };
}
