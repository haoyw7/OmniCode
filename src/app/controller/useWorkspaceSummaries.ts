import { useMemo, type RefObject } from "react";
import { useInboxActivity } from "../../features/inbox/hooks/useInboxUnseen";
import { ciRepairSessions } from "../../features/inbox/model/ciRepairSessions";
import { conversationRowsFrom } from "../../features/search/model/appSearch";
import type { useProjectBranches } from "../../features/source-control/hooks/useProjectBranches";
import { type WorkspaceTab } from "../../features/workspace/model/layout";
import { openSessionIds } from "../model/workspaceSelectors";
import { sameProjectPath, type RecentProject } from "../../features/projects/model/recents";
import { type Session } from "../../features/sessions/model/session";
import { projectName } from "../../shared/lib/paths";
import { type SessionSummary } from "../../features/sessions/data/sessionStore";
import { useStableSummaries } from "../../features/sessions/hooks/useStableSummaries";
import type { LinkedSessionUpdate } from "../../features/inbox/model/linkedSessionUpdates";
import {
  allProjectHistoryWithLiveSessions,
  historyWithLiveSessions,
  sidebarLiveSessions,
  summaryFromSession,
} from "../../features/sessions/data/sessionHistory";

type Options = {
  history: SessionSummary[];
  storedLinkedSessions: readonly SessionSummary[];
  sessions: Session[];
  tabs: WorkspaceTab[];
  recents: RecentProject[];
  sidebarCwd: string;
  projectBranches: ReturnType<typeof useProjectBranches>;
  orchestrationRuns: Parameters<typeof historyWithLiveSessions>[4];
  paletteOpen: boolean;
  onInboxAppeared: NonNullable<Parameters<typeof useInboxActivity>[3]>["onAppeared"];
  linkedSessionUpdatesRef: RefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
};

/** Session lists the sidebar, Quick Open and inbox show, merged with live sessions. */
export function useWorkspaceSummaries({
  history,
  storedLinkedSessions,
  sessions,
  tabs,
  recents,
  sidebarCwd,
  projectBranches,
  orchestrationRuns,
  paletteOpen,
  onInboxAppeared,
  linkedSessionUpdatesRef,
}: Options) {
  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const projectHistory = useMemo(
    () => history.filter((entry) => sameProjectPath(entry.cwd, sidebarCwd)),
    [history, sidebarCwd],
  );

  // Quick Open's `#` mode: every project's unarchived sessions.
  const paletteSessions = useMemo(
    () =>
      paletteOpen
        ? conversationRowsFrom(
            history.filter((entry) => !entry.archived),
            sessions.filter((session) => !session.inboxAsk),
          )
        : [],
    [paletteOpen, history, sessions],
  );

  const liveSidebarHistory = useMemo(
    () =>
      historyWithLiveSessions(
        history,
        sessions,
        sidebarCwd,
        {
          ...(projectBranches?.current
            ? { branch: projectBranches.current }
            : {}),
          ...(sidebarCwd && sidebarCwd !== "~"
            ? { repo: projectName(sidebarCwd) }
            : {}),
        },
        orchestrationRuns,
      ),
    [history, projectBranches, sessions, sidebarCwd, orchestrationRuns],
  );
  const liveTreeHistory = useMemo(() => {
    return allProjectHistoryWithLiveSessions(
      history,
      sessions,
      (cwd) =>
        sameProjectPath(cwd, sidebarCwd)
          ? { branch: projectBranches?.current ?? undefined }
          : undefined,
      orchestrationRuns,
    );
  }, [history, sessions, sidebarCwd, projectBranches, orchestrationRuns]);
  const sidebarHistory = useStableSummaries(liveSidebarHistory);
  const treeHistory = useStableSummaries(liveTreeHistory);
  const {
    unseen: inboxUnseen,
    linkedSessionUpdateIds,
    linkedSessionUpdates,
  } = useInboxActivity(recents, sidebarCwd, sidebarHistory, {
    onAppeared: onInboxAppeared,
  });
  linkedSessionUpdatesRef.current = linkedSessionUpdates;
  const liveInboxRelatedSessions = useMemo(() => {
    const byId = new Map<string, SessionSummary>();
    for (const session of storedLinkedSessions) byId.set(session.id, session);
    for (const session of history) {
      if (session.linkedWorkItem) byId.set(session.id, session);
    }
    for (const session of sessions) {
      if (session.inboxAsk || !session.linkedWorkItem) continue;
      const current = byId.get(session.id);
      const summary = summaryFromSession(session);
      byId.set(
        session.id,
        current
          ? {
              ...current,
              harness: summary.harness,
              model: summary.model,
              runtimeMode: summary.runtimeMode,
              title: summary.title,
              cwd: summary.cwd,
              linkedWorkItem: summary.linkedWorkItem,
            }
          : summary,
      );
    }
    return [...byId.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }, [history, sessions, storedLinkedSessions]);
  const inboxRelatedSessions = useStableSummaries(liveInboxRelatedSessions);
  const liveRepairSessions = useMemo(
    () => ciRepairSessions(history, sessions),
    [history, sessions],
  );
  const repairSessions = useStableSummaries(liveRepairSessions);
  const sidebarOpenSessionIds = useMemo(() => openSessionIds(tabs), [tabs]);
  const liveOpenProjectSessions = useMemo(
    () =>
      sidebarLiveSessions(sessions).map((session) =>
        summaryFromSession(session, {
          ...(sameProjectPath(session.cwd, sidebarCwd) &&
          projectBranches?.current
            ? { branch: projectBranches.current }
            : {}),
          ...(session.cwd && session.cwd !== "~"
            ? { repo: projectName(session.cwd) }
            : {}),
        }),
      ),
    [projectBranches, sessions, sidebarCwd],
  );
  const openProjectSessions = useStableSummaries(liveOpenProjectSessions);

  return {
    projectHistory,
    paletteSessions,
    sidebarHistory,
    treeHistory,
    inboxUnseen,
    linkedSessionUpdateIds,
    inboxRelatedSessions,
    repairSessions,
    sidebarOpenSessionIds,
    openProjectSessions,
  };
}
