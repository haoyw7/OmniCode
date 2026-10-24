import { remotePendingExecutionCwd, remoteSessionFor } from "../../features/connections/model/connections";
import { isBlankSession } from "../../features/projects/model/projectReturn";
import { type Session } from "../../contracts/session";
import { firstLeafId, focusedFileTab, isAppViewOnlyTab, isFilesystemTab, leafIds, removePane, siblingLeafId, type EditorPane, type FilePaneTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { projectName } from "../../shared/lib/paths";

export function sameWorktreeTabStats(
  a: ReadonlyMap<string, { tabs: number; busy: boolean }>,
  b: ReadonlyMap<string, { tabs: number; busy: boolean }>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, entry] of a) {
    const other = b.get(key);
    if (!other || other.tabs !== entry.tabs || other.busy !== entry.busy) {
      return false;
    }
  }
  return true;
}

export function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

export function filesInWorkspaceTabs(
  tabs: readonly WorkspaceTab[],
): FilePaneTab[] {
  return tabs.flatMap((tab) => [
    ...tab.editorPanes.flatMap((pane) => pane.files),
    ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
  ]);
}

export function isBlankWorkspaceTab(
  tab: WorkspaceTab,
  sessions: Session[],
): boolean {
  if (tab.editorPanes.some((pane) => pane.files.length > 0)) return false;
  if ((tab.terminalPanes ?? []).some((pane) => pane.files.length > 0))
    return false;
  const ids = leafIds(tab.layout);
  if (ids.length !== 1) return false;
  if (remoteSessionFor(ids[0]) || remotePendingExecutionCwd(ids[0])) return false;
  return isBlankSession(sessions.find((entry) => entry.id === ids[0]));
}

/** Project folder name a workspace tab belongs to; empty for app-only tabs. */
export function tabProjectName(tab: WorkspaceTab, sessions: Session[]): string {
  if (isAppViewOnlyTab(tab)) return "";
  const tabSessions = leafIds(tab.layout)
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session != null);
  const focused =
    sessions.find((session) => session.id === tab.focusedId) ?? tabSessions[0];
  if (focused) return projectName(focused.cwd);
  const focusedFile = focusedFileTab(tab);
  return focusedFile
    ? projectName(focusedFile.projectCwd ?? focusedFile.cwd)
    : "~";
}

export function dropOpenFiles(
  tab: WorkspaceTab,
  shouldDrop: (path: string) => boolean,
): WorkspaceTab {
  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  for (const pane of tab.editorPanes) {
    const files = pane.files.filter(
      (file) => !isFilesystemTab(file) || !shouldDrop(file.path),
    );
    if (files.length === 0) {
      const sibling = siblingLeafId(layout, pane.id);
      const withoutPane = removePane(layout, pane.id);
      if (withoutPane) {
        layout = withoutPane;
        if (focusedId === pane.id)
          focusedId = sibling ?? firstLeafId(withoutPane);
      }
      continue;
    }
    editorPanes.push({
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    });
  }
  return { ...tab, layout, focusedId, editorPanes };
}

/** Mirrors PaneTree: only a lone pane or a single chat's unified view is one card. */
export function tabIsOneCard(
  tab: WorkspaceTab,
  sessions: readonly Session[],
): boolean {
  const leaves = leafIds(tab.layout);
  if (leaves.length <= 1) return true;
  const chats = leaves.filter((id) =>
    sessions.some((session) => session.id === id),
  );
  return chats.length === 1 && tab.surfaceMode === "unified";
}
