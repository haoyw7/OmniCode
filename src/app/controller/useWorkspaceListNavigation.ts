import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import {
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import {
  isRemoteProjectPath,
  loadRecents,
  normalizeProjectPath,
  projectRailItems,
  sameProjectPath,
} from "../../features/projects/model/recents";
import { type Session } from "../../features/sessions/model/session";
import { pathKey } from "../../shared/lib/paths";
import { adjacentItemId } from "../../features/workspace/model/tabKeys";
import { remoteSessionFor } from "../../features/connections/model/connections";
import { sessionUsesHost } from "../../features/connections/model/remoteProjects";

type Options = {
  sessionsRef: RefObject<Session[]>;
  tabsRef: RefObject<WorkspaceTab[]>;
  activeTabIdRef: RefObject<string>;
  projectCwdRef: RefObject<string>;
  sidebarCwd: string;
  onPrefetchHistorySession: (id: string) => void;
  onSelectHistorySession: (id: string) => Promise<void>;
  onSelectRemoteSession: (project: string, id: string) => void;
  onSelectProject: (path: string) => void;
};

/** Navigates the rendered sidebar order and prefetches the next local conversation. */
export function useWorkspaceListNavigation({
  sessionsRef,
  tabsRef,
  activeTabIdRef,
  projectCwdRef,
  sidebarCwd,
  onPrefetchHistorySession,
  onSelectHistorySession,
  onSelectRemoteSession,
  onSelectProject,
}: Options) {
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const sessionNavigationProjectRef = useRef<string | null>(null);
  const onSessionNavigationOrder = useCallback(
    (ids: readonly string[]) => {
      sessionNavigationIdsRef.current = ids;
      sessionNavigationProjectRef.current = pathKey(sidebarCwd);
    },
    [sidebarCwd],
  );

  const onNavigateSessionList = useCallback(
    (delta: number, _inCurrentTab = false) => {
      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current =
        sessionsRef.current.find(
          (session) => session.id === activeWorkspace.focusedId,
        ) ??
        sessionsRef.current.find((session) =>
          leafIds(activeWorkspace.layout).includes(session.id),
        );
      if (
        !current ||
        sessionNavigationProjectRef.current !== pathKey(current.cwd)
      )
        return;
      const remoteProject =
        isRemoteProjectPath(current.cwd) || !!sessionUsesHost(current);
      const navigationId = remoteProject
        ? remoteSessionFor(current.id)
        : current.id;
      if (!navigationId) return;

      const next = adjacentItemId(
        sessionNavigationIdsRef.current,
        navigationId,
        delta,
      );
      if (!next || next === navigationId) return;
      if (remoteProject) {
        onSelectRemoteSession(current.cwd, next);
        return;
      }
      // Stepping gives no hover to warm the transcript, so load the one a
      // further step away once this switch has its own session.
      const prefetchAhead = () => {
        const ahead = adjacentItemId(
          sessionNavigationIdsRef.current,
          next,
          delta,
        );
        if (ahead && ahead !== current.id) onPrefetchHistorySession(ahead);
      };
      void onSelectHistorySession(next).then(prefetchAhead);
    },
    [onPrefetchHistorySession, onSelectHistorySession, onSelectRemoteSession],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = projectRailItems(loadRecents(), current).map(
        (project) => project.path,
      );
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  return {
    onSessionNavigationOrder,
    onNavigateSessionList,
    onNavigateProjectList,
  };
}
