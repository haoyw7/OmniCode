import {
  isAppViewOnlyTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { workspaceTabCwd } from "../../features/workspace/model/workspaceTabGroups";
import { sameProjectPath } from "../../features/projects/model/recents";
import type { Session } from "../../features/sessions/model/session";

/** App-only tabs preserve the project's last document/chat destination. */
export function contentTabTarget(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Pick<Session, "id" | "cwd">[],
  activeId: string,
  project: string,
  visits: readonly string[],
): WorkspaceTab | undefined {
  const active = tabs.find((tab) => tab.id === activeId);
  if (active && !isAppViewOnlyTab(active)) return active;
  const candidates = tabs.filter((tab) => {
    if (isAppViewOnlyTab(tab)) return false;
    const cwd = workspaceTabCwd(tab, sessions);
    return cwd ? sameProjectPath(cwd, project) : project === "~";
  });
  for (const id of [...visits].reverse()) {
    const visited = candidates.find((tab) => tab.id === id);
    if (visited) return visited;
  }
  return candidates[0];
}
