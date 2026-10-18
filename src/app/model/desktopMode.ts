import { isChatFolder } from "../../features/projects/model/chatFolderPath";
import { looksLikeProject } from "../../features/projects/model/recents";
import { preferenceStorage } from "../../features/settings/model/sharedPreferences";
import {
  findSurfacePane,
  leafIds,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";

export type DesktopMode = "chat" | "code";
export type DesktopLocation = {
  tabId: string;
  sessionId?: string;
  paneId?: string;
  cwd: string;
};
export type DesktopLocations = Partial<Record<DesktopMode, DesktopLocation>>;
export const DESKTOP_MODE_KEY = "monocode.desktopMode";
export const DESKTOP_LOCATIONS_KEY = "monocode.desktopLocations.v1";

/** Presentation grouping only: never rewrite a session's cwd or provider. */
export function desktopModeForCwd(cwd: string): DesktopMode {
  return isChatFolder(cwd) || !looksLikeProject(cwd) ? "chat" : "code";
}

export function loadDesktopMode(): DesktopMode {
  try {
    return preferenceStorage.getItem(DESKTOP_MODE_KEY) === "chat"
      ? "chat"
      : "code";
  } catch {
    return "code";
  }
}

export function loadDesktopLocations(): DesktopLocations {
  try {
    const value: unknown = JSON.parse(
      preferenceStorage.getItem(DESKTOP_LOCATIONS_KEY) ?? "{}",
    );
    if (!value || typeof value !== "object") return {};
    const result: DesktopLocations = {};
    for (const mode of ["chat", "code"] as const) {
      const location = (value as DesktopLocations)[mode];
      if (
        location &&
        typeof location.tabId === "string" &&
        typeof location.cwd === "string" &&
        (location.sessionId === undefined ||
          typeof location.sessionId === "string") &&
        (location.paneId === undefined ||
          typeof location.paneId === "string") &&
        desktopModeForCwd(location.cwd) === mode
      )
        result[mode] = location;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveDesktopMode(
  mode: DesktopMode,
  locations?: DesktopLocations,
) {
  try {
    preferenceStorage.setItem(DESKTOP_MODE_KEY, mode);
    if (locations)
      preferenceStorage.setItem(
        DESKTOP_LOCATIONS_KEY,
        JSON.stringify(locations),
      );
  } catch {
    /* View navigation still works when local storage is unavailable. */
  }
}

export function desktopModeTarget(
  mode: DesktopMode,
  locations: DesktopLocations,
  tabs: readonly WorkspaceTab[],
  sessions: readonly { id: string; cwd: string }[],
): DesktopLocation | undefined {
  const saved = locations[mode];
  const candidates = tabs.flatMap((tab) =>
    leafIds(tab.layout).flatMap((id) => {
      const session = sessions.find((entry) => entry.id === id);
      const pane = findSurfacePane(tab, id)?.pane;
      const file = pane?.files.find((entry) => entry.id === pane.activeFileId);
      if (file?.appView) return [];
      const cwd = file?.projectCwd ?? file?.cwd ?? session?.cwd;
      return cwd && desktopModeForCwd(cwd) === mode
        ? [{ tabId: tab.id, paneId: id, sessionId: session?.id, cwd }]
        : [];
    }),
  );
  return (
    candidates.find(
      (target) =>
        target.tabId === saved?.tabId &&
        target.paneId === (saved.paneId ?? saved.sessionId),
    ) ??
    candidates.find(
      (target) =>
        target.tabId === saved?.tabId && target.sessionId === saved?.sessionId,
    ) ??
    candidates.find(
      (target) => saved?.sessionId && target.sessionId === saved.sessionId,
    ) ??
    candidates[0]
  );
}
