import {
  closeLeaf,
  focusedFileTab,
  isAppViewOnlyTab,
  isAppViewTab,
  firstLeafId,
  leaf,
  leafIds,
  placePane,
  replaceLeafId,
  splitPane,
  type PaneEdge,
  type WorkspaceTab,
} from "./layout";
import { projectName } from "../../../shared/lib/paths";
import { sameProjectPath } from "../../projects/model/recents";
import {
  sessionExecutionCwd,
  type Session,
} from "../../sessions/model/session";

export function workspaceTabCwd(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd">[],
): string | null {
  if (isAppViewOnlyTab(tab)) return null;
  for (const id of leafIds(tab.layout)) {
    const session = sessions.find((entry) => entry.id === id);
    if (session?.cwd && session.cwd !== "~") return session.cwd;
  }

  const file = focusedFileTab(tab);
  const cwd = file?.projectCwd ?? file?.cwd;
  if (cwd && cwd !== "~") return cwd;

  for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
    const projectFile = pane.files.find(
      (entry) => !isAppViewTab(entry) && entry.cwd !== "~",
    );
    if (projectFile) return projectFile.projectCwd ?? projectFile.cwd;
  }

  return null;
}

/** Working copy a tab runs in: its first session's worktree, else the folder
 * its focused file was opened from. Null when the tab has neither. */
export function workspaceTabWorktree(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd" | "executionCwd">[],
): string | null {
  if (isAppViewOnlyTab(tab)) return null;
  for (const id of leafIds(tab.layout)) {
    const session = sessions.find((entry) => entry.id === id);
    if (session?.cwd && session.cwd !== "~") return sessionExecutionCwd(session);
  }
  const cwd = focusedFileTab(tab)?.cwd;
  if (cwd && cwd !== "~") return cwd;
  for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
    const file = pane.files.find((entry) => !isAppViewTab(entry) && entry.cwd !== "~");
    if (file) return file.cwd;
  }
  return null;
}

/** Tabs without a working copy show in every worktree. */
export function tabInWorktree(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd" | "executionCwd">[],
  worktree: string,
): boolean {
  const cwd = workspaceTabWorktree(tab, sessions);
  return !cwd || sameProjectPath(cwd, worktree);
}

export function focusedWorkspaceTabCwd(
  tab: WorkspaceTab,
  sessions: readonly Pick<Session, "id" | "cwd">[],
): string | null {
  const session = sessions.find((entry) => entry.id === tab.focusedId);
  const file = focusedFileTab(tab);
  return (
    session?.cwd ??
    (file && !isAppViewTab(file) ? file.projectCwd ?? file.cwd : undefined) ??
    workspaceTabCwd(tab, sessions)
  );
}

export function workspaceTabProject(
  tab: WorkspaceTab,
  sessions: Session[],
): string | null {
  const cwd = workspaceTabCwd(tab, sessions);
  if (!cwd) return null;
  const name = projectName(cwd);
  return name === "~" ? null : name;
}

export function findTabForProject(
  tabs: WorkspaceTab[],
  sessions: Session[],
  path: string,
): WorkspaceTab | undefined {
  return tabs.find((tab) => {
    const cwd = workspaceTabCwd(tab, sessions);
    return cwd ? sameProjectPath(cwd, path) : false;
  });
}

/** A tab is only openable as a chat when its session object is also mounted. */
export function findOpenSessionTab(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Pick<Session, "id">[],
  sessionId: string,
): WorkspaceTab | undefined {
  if (!sessions.some((session) => session.id === sessionId)) return undefined;
  return tabs.find((tab) => leafIds(tab.layout).includes(sessionId));
}

/** Show another session in the focused pane without changing the active tab. */
export function switchSessionInTab(
  tabs: readonly WorkspaceTab[],
  activeTabId: string,
  currentSessionId: string,
  targetSessionId: string,
): WorkspaceTab[] | null {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab || activeTab.diffFocused) return null;
  if (activeTab.focusedId !== currentSessionId) return null;
  if (!leafIds(activeTab.layout).includes(currentSessionId)) return null;
  if (currentSessionId === targetSessionId) return null;

  const targetTab = tabs.find((tab) =>
    leafIds(tab.layout).includes(targetSessionId),
  );
  if (targetTab?.id === activeTabId) {
    return tabs.map((tab) =>
      tab.id === activeTabId
        ? { ...tab, focusedId: targetSessionId, diffFocused: false }
        : tab,
    );
  }

  return tabs.map((tab) => {
    if (tab.id === activeTabId) {
      return {
        ...tab,
        layout: replaceLeafId(tab.layout, currentSessionId, targetSessionId),
        focusedId: targetSessionId,
        diffFocused: false,
      };
    }
    if (tab.id === targetTab?.id) {
      return {
        ...tab,
        layout: replaceLeafId(tab.layout, targetSessionId, currentSessionId),
        focusedId:
          tab.focusedId === targetSessionId ? currentSessionId : tab.focusedId,
      };
    }
    return tab;
  });
}

/** Add a chat beside a file-only tab so an add-to-chat request has a target. */
export function openAddToChatSessionPane({
  tab,
  sessions,
  sessionId,
}: {
  tab: WorkspaceTab;
  sessions: readonly Pick<Session, "id">[];
  sessionId: string;
}): WorkspaceTab | null {
  const paneIds = leafIds(tab.layout);
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (paneIds.some((id) => sessionIds.has(id))) return null;

  const sourceId = paneIds.includes(tab.focusedId)
    ? tab.focusedId
    : firstLeafId(tab.layout);
  return {
    ...tab,
    layout: splitPane(tab.layout, sourceId, "right", sessionId),
    focusedId: sessionId,
    diffFocused: false,
  };
}

export function filterTabsForProject(
  tabs: WorkspaceTab[],
  sessions: Session[],
  path: string,
): WorkspaceTab[] {
  return tabs.filter((tab) => {
    if (isAppViewOnlyTab(tab)) return true;
    const cwd = workspaceTabCwd(tab, sessions);
    return cwd ? sameProjectPath(cwd, path) : false;
  });
}

export type WorkspaceTabCloseScope = "project" | "workspace";

export type WorkspaceTabClosePlan =
  | { action: "keep" }
  | { action: "close"; nextActiveTabId?: string };

export function planWorkspaceTabClose({
  tabs,
  sessions,
  closingTabId,
  scope,
  worktreeOf,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  closingTabId: string;
  scope: WorkspaceTabCloseScope;
  /** When given, the next tab also has to share the closing tab's worktree,
   * so closing a tab never leaves the worktree on screen. */
  worktreeOf?: (tab: WorkspaceTab) => string | null;
}): WorkspaceTabClosePlan {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingTabId);
  if (closingIndex < 0) return { action: "keep" };

  const remaining = tabs.filter((tab) => tab.id !== closingTabId);
  if (remaining.length === 0) return { action: "keep" };

  const globalTarget = remaining[Math.max(0, closingIndex - 1)] ?? remaining[0];
  if (scope === "workspace") {
    return { action: "close", nextActiveTabId: globalTarget?.id };
  }

  const closingCwd = workspaceTabCwd(tabs[closingIndex], sessions);
  if (!closingCwd) {
    return { action: "close", nextActiveTabId: globalTarget?.id };
  }
  const closingWorktree = worktreeOf?.(tabs[closingIndex]) ?? null;
  const sameScope = (tab: WorkspaceTab) => {
    const cwd = workspaceTabCwd(tab, sessions);
    if (!cwd || !sameProjectPath(cwd, closingCwd)) return false;
    const worktree = closingWorktree && worktreeOf?.(tab);
    return !worktree || sameProjectPath(worktree, closingWorktree);
  };

  for (let index = closingIndex - 1; index >= 0; index -= 1) {
    if (sameScope(tabs[index])) {
      return { action: "close", nextActiveTabId: tabs[index].id };
    }
  }

  for (let index = closingIndex + 1; index < tabs.length; index += 1) {
    if (sameScope(tabs[index])) {
      return { action: "close", nextActiveTabId: tabs[index].id };
    }
  }

  // Deck mode is one project (and worktree) at a time. Closing the last tab
  // there must not jump to another one's tab; the caller keeps this one.
  return { action: "keep" };
}

/**
 * Drop a session onto a pane edge in the tab that owns `targetId`.
 * Already-open chats move; a blank target is replaced; a chat open
 * in another tab is relocated (that tab closes when it was the last leaf).
 */
export function applyPlaceSessionOnPane({
  tabs,
  sessions,
  sessionId,
  targetId,
  edge,
  replaceTarget,
  scope,
  createReplacement,
}: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sessionId: string;
  targetId: string;
  edge: PaneEdge;
  replaceTarget: boolean;
  scope: WorkspaceTabCloseScope;
  createReplacement: (seed: Session | undefined) => Session;
}): {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
} | null {
  if (sessionId === targetId) return null;
  const targetIndex = tabs.findIndex((tab) =>
    leafIds(tab.layout).includes(targetId),
  );
  if (targetIndex < 0) return null;

  let nextSessions = replaceTarget
    ? sessions.filter((session) => session.id !== targetId)
    : sessions;
  const targetTabId = tabs[targetIndex]!.id;

  let nextTabs = tabs.map((tab, index) => {
    if (index !== targetIndex) return tab;
    const layout = replaceTarget
      ? replaceLeafId(tab.layout, targetId, sessionId)
      : placePane(tab.layout, sessionId, targetId, edge);
    return { ...tab, layout, focusedId: sessionId, diffFocused: false };
  });

  for (const tab of [...nextTabs]) {
    if (tab.id === targetTabId) continue;
    if (!leafIds(tab.layout).includes(sessionId)) continue;
    const tabIndex = nextTabs.findIndex((entry) => entry.id === tab.id);
    if (tabIndex < 0) continue;

    const closed = closeLeaf(tab, sessionId);
    if (closed) {
      nextTabs[tabIndex] = closed;
      continue;
    }

    const closePlan = planWorkspaceTabClose({
      tabs: nextTabs,
      sessions: nextSessions,
      closingTabId: tab.id,
      scope,
    });
    if (closePlan.action === "close") {
      nextTabs = nextTabs.filter((entry) => entry.id !== tab.id);
      continue;
    }

    const replacement = createReplacement(
      nextSessions.find((session) => session.id === sessionId),
    );
    nextSessions = [...nextSessions, replacement];
    nextTabs[tabIndex] = {
      ...tab,
      layout: leaf(replacement.id),
      focusedId: replacement.id,
      editorPanes: [],
      terminalPanes: [],
      diffOpen: false,
      diffFocused: false,
    };
  }

  return { tabs: nextTabs, sessions: nextSessions, activeTabId: targetTabId };
}

export function replaceGroupInTabOrder(
  allIds: string[],
  startIndex: number,
  length: number,
  newGroupIds: string[],
): string[] {
  const next = allIds.slice();
  next.splice(startIndex, length, ...newGroupIds);
  return next;
}
