import { leafIds, type WorkspaceTab } from "./layout";

/** Chat leaves are the leaves that are not editor or terminal panes. */
export function sessionLeafIds(tab: WorkspaceTab): string[] {
  const surfaces = new Set(
    [...tab.editorPanes, ...(tab.terminalPanes ?? [])].map((pane) => pane.id),
  );
  return leafIds(tab.layout).filter((id) => !surfaces.has(id));
}

/** The chat column actions apply to: the focused one, else the first. */
export function anchorSessionId(tab: WorkspaceTab): string | undefined {
  const sessions = sessionLeafIds(tab);
  return sessions.includes(tab.focusedId) ? tab.focusedId : sessions[0];
}
