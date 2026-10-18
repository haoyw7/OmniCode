import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { OrchestrationReadRun } from "../../features/orchestration/model/orchestrationClient";
import { shouldPersistSession } from "../../features/sessions/data/sessionStore";
import { sessionChildHarnesses } from "../../features/sessions/model/handoff";
import type { Session } from "../../features/sessions/model/session";
import {
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { forgetHarnessSession } from "../../integrations/harness/core/registry";
import type { WorkspaceSessionData } from "../model/workspaceSessionData";

const SESSION_DETACH_DELAY_MS = 250;

export function useIdleSessionDetach({
  sessions,
  sessionsRef,
  tabs,
  tabsRef,
  orchestrationRuns,
  liveAgentsEnabled,
  unseenFinishedIds,
  sessionData,
  skipForgetSessionIds,
  setSessions,
}: {
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  tabs: WorkspaceTab[];
  tabsRef: RefObject<WorkspaceTab[]>;
  orchestrationRuns: readonly OrchestrationReadRun[];
  liveAgentsEnabled: boolean;
  unseenFinishedIds: ReadonlySet<string>;
  sessionData: Pick<
    WorkspaceSessionData,
    "activate" | "isOpening" | "retain" | "persist"
  >;
  skipForgetSessionIds: RefObject<Set<string>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
}) {
  // Dropping a session re-renders the whole app, so it waits until a switch
  // has painted, and a burst of switches pays for it once.
  const detachInputs = useRef({ orchestrationRuns, liveAgentsEnabled });
  detachInputs.current = { orchestrationRuns, liveAgentsEnabled };
  const unseenFinishedRef = useRef(unseenFinishedIds);
  unseenFinishedRef.current = unseenFinishedIds;
  const detachTimer = useRef<number | null>(null);
  const detachIdleSessions = useCallback(() => {
    detachTimer.current = null;
    const sessions = sessionsRef.current;
    const { orchestrationRuns, liveAgentsEnabled } = detachInputs.current;
    const visibleIds = new Set(
      tabsRef.current.flatMap((tab) => leafIds(tab.layout)),
    );
    // A provider subagent tab reads its parent's blocks, even if that chat closes.
    for (const tab of tabsRef.current) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (file.subagent) visibleIds.add(file.subagent.parentSessionId);
        }
      }
    }
    // Inbox owns these panes independently of project tabs. Keep their drafts
    // and attachments mounted when the panel closes or switches items.
    for (const session of sessions) {
      if (session.inboxAsk) visibleIds.add(session.id);
    }
    // Internal workers stay attached to the lead, even while idle between
    // turns. They must not be discarded merely because they have no tab.
    for (const session of sessions) {
      if (
        session.orchestrationLeadId &&
        (visibleIds.has(session.orchestrationLeadId) ||
          orchestrationRuns.some(
            (run) =>
              run.leadId === session.orchestrationLeadId &&
              ["active", "paused"].includes(run.status),
          ))
      )
        visibleIds.add(session.id);
    }
    for (const sessionId of visibleIds) {
      sessionData.activate(sessionId);
    }
    const keepUnseen = liveAgentsEnabled;
    const idleDetached = sessions.filter(
      (session) =>
        !visibleIds.has(session.id) &&
        !session.busy &&
        !sessionData.isOpening(session.id) &&
        !(keepUnseen && unseenFinishedRef.current.has(session.id)),
    );
    if (idleDetached.length === 0) return;
    for (const session of idleDetached) {
      if (skipForgetSessionIds.current.has(session.id)) continue;
      if (shouldPersistSession(session)) {
        sessionData.retain(session);
      }
      void sessionData.persist(session);
      for (const harness of sessionChildHarnesses(session)) {
        void forgetHarnessSession(harness, session.id);
      }
    }
    setSessions((prev) =>
      prev.filter(
        (session) =>
          visibleIds.has(session.id) ||
          session.busy ||
          sessionData.isOpening(session.id) ||
          (keepUnseen && unseenFinishedRef.current.has(session.id)) ||
          skipForgetSessionIds.current.has(session.id),
      ),
    );
  }, [sessionsRef, tabsRef, sessionData, skipForgetSessionIds, setSessions]);

  useEffect(() => {
    if (detachTimer.current != null) return;
    detachTimer.current = window.setTimeout(
      detachIdleSessions,
      SESSION_DETACH_DELAY_MS,
    );
  }, [
    sessions,
    tabs,
    liveAgentsEnabled,
    orchestrationRuns,
    detachIdleSessions,
  ]);

  useEffect(
    () => () => {
      if (detachTimer.current != null) window.clearTimeout(detachTimer.current);
    },
    [],
  );
}
