import type { WorkspaceNavigation } from "../hooks/useWorkspaceNavigation";
import { useCallback, useMemo, useRef } from "react";
import {
  isAppViewOnlyTab,
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { sameWorktreeTabStats } from "../model/workspaceSelectors";
import {
  isRemoteProjectPath,
  sameProjectPath,
} from "../../features/projects/model/recents";
import { type Session } from "../../features/sessions/model/session";
import {
  filterTabsForProject,
  workspaceTabCwd,
} from "../../features/workspace/model/workspaceTabGroups";
import { pathKey } from "../../shared/lib/paths";

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

type Options = {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sidebarCwd: string;
  activeTabId: string;
  projectCwd: string;
  projectWorktreePath: string | undefined;
  tabWorkspace: WorkspaceNavigation["tabWorkspace"];
  navigationRevision: number;
  activateTab: WorkspaceNavigation["activateTab"];
};

/** Owns worktree tab counts, the visible tab deck and keyboard tab selection. */
export function useWorkspaceTabNavigation({
  tabs,
  sessions,
  sidebarCwd,
  activeTabId,
  projectCwd,
  projectWorktreePath,
  tabWorkspace,
  navigationRevision,
  activateTab,
}: Options) {
  /** Open tabs per workspace in the sidebar's project, keyed by worktree
   * path, so the switcher can show what each worktree still has open. */
  const nextWorktreeTabStats = useMemo(() => {
    const stats = new Map<string, { tabs: number; busy: boolean }>();
    if (!sidebarCwd || sidebarCwd === "~" || isRemoteProjectPath(sidebarCwd))
      return stats;
    for (const tab of filterTabsForProject(tabs, sessions, sidebarCwd)) {
      if (isAppViewOnlyTab(tab)) continue;
      const workspace = tabWorkspace(tab, sessions) ?? sidebarCwd;
      const key = pathKey(workspace);
      const entry = stats.get(key) ?? { tabs: 0, busy: false };
      entry.tabs += 1;
      entry.busy ||= leafIds(tab.layout).some(
        (id) => sessions.find((session) => session.id === id)?.busy,
      );
      stats.set(key, entry);
    }
    return stats;
  }, [tabs, sessions, sidebarCwd, tabWorkspace, navigationRevision]);
  // Rebuilt on every streamed frame; the sidebar only cares when counts move.
  const worktreeTabStatsRef = useRef(nextWorktreeTabStats);
  if (
    !sameWorktreeTabStats(worktreeTabStatsRef.current, nextWorktreeTabStats)
  ) {
    worktreeTabStatsRef.current = nextWorktreeTabStats;
  }
  const worktreeTabStats = worktreeTabStatsRef.current;
  const nextDeckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (
      active &&
      !isAppViewOnlyTab(active) &&
      !workspaceTabCwd(active, sessions)
    )
      return [active, ...tabs.filter(isAppViewOnlyTab)];
    // Each worktree keeps its own tabs; the others stay open, just hidden.
    const worktree = projectWorktreePath ?? projectCwd;
    return filterTabsForProject(tabs, sessions, projectCwd).filter((tab) => {
      if (tab.id === activeTabId) return true;
      const workspace = tabWorkspace(tab, sessions);
      return !workspace || sameProjectPath(workspace, worktree);
    });
  }, [
    activeTabId,
    tabs,
    sessions,
    projectCwd,
    projectWorktreePath,
    tabWorkspace,
    navigationRevision,
  ]);
  // Rebuilt on every streamed frame; tab navigation callbacks key off it.
  const deckProjectTabsRef = useRef(nextDeckProjectTabs);
  if (!sameItems(deckProjectTabsRef.current, nextDeckProjectTabs)) {
    deckProjectTabsRef.current = nextDeckProjectTabs;
  }
  const deckProjectTabs = deckProjectTabsRef.current;

  const onNext = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0)
      activateTab(deckProjectTabs[(index + 1) % deckProjectTabs.length].id);
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onPrev = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      activateTab(
        deckProjectTabs[
          (index - 1 + deckProjectTabs.length) % deckProjectTabs.length
        ].id,
      );
    }
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onActivate = useCallback(
    (slot: number) => {
      const tab =
        slot < 0
          ? deckProjectTabs[deckProjectTabs.length - 1]
          : deckProjectTabs[slot];
      if (tab) activateTab(tab.id);
    },
    [activateTab, deckProjectTabs],
  );

  return { worktreeTabStats, deckProjectTabs, onNext, onPrev, onActivate };
}
