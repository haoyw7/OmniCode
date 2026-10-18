import { preferenceStorage } from "../../settings/model/sharedPreferences";
import { pathKey, prettyCwd, slash } from "../../../shared/lib/paths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { WSL_PATH_PREFIX } from "../../../shared/lib/wslPaths";
import {
  clearProjectTreeExpanded,
  rebaseProjectTreeExpanded,
} from "./projectTree";
import { isChatFolder } from "./chatFolderPath";

const KEY = "monocode.recentProjects";
const RAIL_ORDER_KEY = "monocode.projectRailOrder";
const RAIL_ORDER_VERSION_KEY = "monocode.projectRailOrderVersion";
const RAIL_PINNED_KEY = "monocode.projectRailPinned";
const ARCHIVED_KEY = "monocode.archivedProjects";
const ARCHIVED_CHANGED = "monocode:archived-projects-changed";
const PROJECT_PATHS_CHANGED = "monocode:project-paths-changed";

export type RecentProject = {
  path: string;
  openedAt: number;
};

export type ArchivedProject = {
  path: string;
  archivedAt: number;
};

export function normalizeProjectPath(path: string): string {
  return slash(path).replace(/\/+$/, "") || "/";
}

function normalize(path: string): string {
  return normalizeProjectPath(path);
}

export function sameProjectPath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = preferenceStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; openedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const openedAt =
        typeof rec.openedAt === "number" && Number.isFinite(rec.openedAt)
          ? rec.openedAt
          : 0;
      out.push({ path: normalize(rec.path), openedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function save(next: RecentProject[]) {
  try {
    preferenceStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

export function rememberProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (normalized === "~" || isChatFolder(normalized)) return loadRecents();
  dropArchived(normalized);
  const prev = loadRecents().filter(
    (p) => !sameProjectPath(p.path, normalized),
  );
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev];
  save(next);
  return next;
}

/** Importing history is not a project visit; keep existing sidebar positions. */
export function rememberImportedProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  const previous = loadRecents();
  if (
    !looksLikeProject(normalized) ||
    isChatFolder(normalized) ||
    previous.some((project) => sameProjectPath(project.path, normalized)) ||
    loadArchivedProjects().some((project) => sameProjectPath(project.path, normalized))
  ) return previous;

  const order = syncProjectRailOrder(
    loadProjectRailOrder(),
    collectRailProjects(previous, ""),
  );
  const next = [...previous, { path: normalized, openedAt: 0 }];
  saveProjectRailOrder([...order, normalized]);
  save(next);
  notifyProjectPathsChanged();
  return next;
}

function replacePath(paths: string[], from: string, to: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const next = sameProjectPath(path, from) ? to : path;
    const key = pathKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

/** Replace a renamed project's path everywhere the project rail stores it. */
export function replaceProjectPath(from: string, to: string): RecentProject[] {
  const previous = normalize(from);
  const nextPath = normalize(to);
  if (sameProjectPath(previous, nextPath)) return loadRecents();

  const recents: RecentProject[] = [];
  const seen = new Set<string>();
  for (const item of loadRecents()) {
    const path = sameProjectPath(item.path, previous) ? nextPath : item.path;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    recents.push({ ...item, path });
  }
  save(recents);
  rebaseProjectTreeExpanded(previous, nextPath);
  saveProjectRailOrder(replacePath(loadProjectRailOrder(), previous, nextPath));
  savePinnedProjects(replacePath(loadPinnedProjects(), previous, nextPath));

  const archived = loadArchivedProjects();
  if (archived.some((item) => sameProjectPath(item.path, previous))) {
    const replaced: ArchivedProject[] = [];
    const archivedSeen = new Set<string>();
    for (const item of archived) {
      const path = sameProjectPath(item.path, previous) ? nextPath : item.path;
      const key = pathKey(path);
      if (archivedSeen.has(key)) continue;
      archivedSeen.add(key);
      replaced.push({ ...item, path });
    }
    saveArchived(replaced);
  }
  notifyProjectPathsChanged();
  return recents;
}

/** Rail projects, pins, groups, or their appearance changed in storage. */
export function notifyProjectPathsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROJECT_PATHS_CHANGED));
  }
}

export function subscribeProjectPathsChanged(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const keys = new Set([KEY, RAIL_ORDER_KEY, RAIL_PINNED_KEY, ARCHIVED_KEY, "monocode.projectGroups", "monocode.projectGroupAssignments"]);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || keys.has(event.key)) onChange();
  };
  window.addEventListener(PROJECT_PATHS_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PROJECT_PATHS_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Drops a project from the rail: its recent entry, saved order slot, and pin. */
function dropFromRail(path: string): RecentProject[] {
  const normalized = normalize(path);
  clearProjectTreeExpanded(normalized);
  const next = loadRecents().filter(
    (item) => !sameProjectPath(item.path, normalized),
  );
  save(next);
  saveProjectRailOrder(
    loadProjectRailOrder().filter(
      (entry) => !sameProjectPath(entry, normalized),
    ),
  );
  savePinnedProjects(
    loadPinnedProjects().filter((entry) => !sameProjectPath(entry, normalized)),
  );
  return next;
}

/** Removes a project from the rail and from the archive (Delete). */
export function forgetProject(path: string): RecentProject[] {
  dropArchived(path);
  return dropFromRail(path);
}

/** Removes a project from the rail and files it in the archive (Archive). */
export function archiveProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (!looksLikeProject(normalized)) return loadRecents();
  const recents = dropFromRail(normalized);
  const rest = loadArchivedProjects().filter(
    (item) => !sameProjectPath(item.path, normalized),
  );
  saveArchived([{ path: normalized, archivedAt: Date.now() }, ...rest]);
  return recents;
}

export function loadArchivedProjects(): ArchivedProject[] {
  try {
    const raw = preferenceStorage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ArchivedProject[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; archivedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const path = normalize(rec.path);
      const key = pathKey(path);
      if (seen.has(key) || !looksLikeProject(path)) continue;
      seen.add(key);
      const archivedAt =
        typeof rec.archivedAt === "number" && Number.isFinite(rec.archivedAt)
          ? rec.archivedAt
          : 0;
      out.push({ path, archivedAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function subscribeArchivedProjects(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ARCHIVED_KEY) onChange();
  };
  window.addEventListener(ARCHIVED_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ARCHIVED_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function saveArchived(next: ArchivedProject[]) {
  try {
    preferenceStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVED_CHANGED));
  }
}

function dropArchived(path: string) {
  const normalized = normalize(path);
  const prev = loadArchivedProjects();
  const next = prev.filter((item) => !sameProjectPath(item.path, normalized));
  if (next.length === prev.length) return;
  saveArchived(next);
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

export type ProjectRailSections = {
  pinned: RecentProject[];
  projects: RecentProject[];
};

function readPathList(key: string): string[] {
  try {
    const raw = preferenceStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      const normalized = pathKey(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function savePathList(key: string, paths: string[]) {
  try {
    preferenceStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailOrder(): string[] {
  const order = readPathList(RAIL_ORDER_KEY);
  try {
    if (preferenceStorage.getItem(RAIL_ORDER_VERSION_KEY)) return order;

    // Preserve the order users saw before ordinary projects became sortable.
    const projects = collectRailProjects(loadRecents(), "");
    const saved = new Set(order.map(pathKey));
    const previousOrder = [
      ...order,
      ...[...projects.values()]
        .filter((project) => !saved.has(pathKey(project.path)))
        .sort((a, b) => b.openedAt - a.openedAt)
        .map((project) => project.path),
    ];
    const pinned = new Set(loadPinnedProjects().map(pathKey));
    previousOrder.sort((a, b) => {
      const aKey = pathKey(a);
      const bKey = pathKey(b);
      const aPinned = pinned.has(aKey);
      const bPinned = pinned.has(bKey);
      if (aPinned || bPinned) return Number(bPinned) - Number(aPinned);
      return (
        (projects.get(bKey)?.openedAt ?? 0) - (projects.get(aKey)?.openedAt ?? 0)
      );
    });
    saveProjectRailOrder(previousOrder);
    return previousOrder;
  } catch {
    return order;
  }
}

export function saveProjectRailOrder(order: string[]) {
  try {
    preferenceStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(order.map(normalize)));
    preferenceStorage.setItem(RAIL_ORDER_VERSION_KEY, "1");
  } catch {
    // private mode / quota
  }
}

export function loadPinnedProjects(): string[] {
  return readPathList(RAIL_PINNED_KEY);
}

export function savePinnedProjects(pinned: string[]) {
  savePathList(RAIL_PINNED_KEY, pinned.map(normalize));
  notifyProjectPathsChanged();
}

export function toggleProjectPin(path: string): void {
  const pinned = loadPinnedProjects();
  savePinnedProjects(
    pinned.some((item) => sameProjectPath(item, path))
      ? pinned.filter((item) => !sameProjectPath(item, path))
      : [...pinned, path],
  );
}

/** Every project path we still remember — rail, pins, saved order, archive. */
export function knownProjectPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const paths = [
    ...loadRecents().map((item) => item.path),
    ...loadProjectRailOrder(),
    ...loadPinnedProjects(),
    ...loadArchivedProjects().map((item) => item.path),
  ];
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalize(path));
  }
  return out;
}

/** All projects for the rail, keyed by normalized path. */
export function collectRailProjects(
  recents: RecentProject[],
  currentCwd: string,
): Map<string, RecentProject> {
  const map = new Map<string, RecentProject>();
  for (const item of recents) {
    if (!looksLikeProject(item.path) || isChatFolder(item.path)) continue;
    const path = normalize(item.path);
    map.set(pathKey(path), { path, openedAt: item.openedAt });
  }
  if (currentCwd && looksLikeProject(currentCwd) && !isChatFolder(currentCwd)) {
    const path = normalize(currentCwd);
    const key = pathKey(path);
    if (!map.has(key)) {
      map.set(key, { path, openedAt: Date.now() });
    }
  }
  return map;
}

/** Prepend new projects by recency without moving existing entries. */
export function syncProjectRailOrder(
  order: string[],
  projects: Map<string, RecentProject>,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const key = pathKey(path);
    const project = projects.get(key);
    if (!project || seen.has(key)) continue;
    seen.add(key);
    next.push(project.path);
  }
  const newcomers = [...projects.entries()]
    .filter(([key]) => !seen.has(key))
    .sort(([, a], [, b]) => b.openedAt - a.openedAt)
    .map(([, project]) => project.path);
  return [...newcomers, ...next];
}

export function projectRailSections(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
): ProjectRailSections {
  const projects = collectRailProjects(recents, currentCwd);
  const syncedOrder = syncProjectRailOrder(order, projects);
  const pinnedSet = new Set(pinnedPaths.map(pathKey));
  const pinned: RecentProject[] = [];
  const unpinned: RecentProject[] = [];
  for (const path of syncedOrder) {
    const key = pathKey(path);
    const item = projects.get(key);
    if (!item) continue;
    if (pinnedSet.has(key)) pinned.push(item);
    else unpinned.push(item);
  }
  return { pinned, projects: unpinned };
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(
  recents: RecentProject[],
  currentCwd: string,
): RecentProject[] {
  const projects = collectRailProjects(recents, currentCwd);
  const order = syncProjectRailOrder(loadProjectRailOrder(), projects);
  const { pinned, projects: unpinned } = projectRailSections(
    recents,
    currentCwd,
    order,
    loadPinnedProjects(),
  );
  return [...pinned, ...unpinned];
}

/** True if this looks like a user project, not an app bundle or system root. */
/** Projects on another machine use `remote://<host id>/<host path>` keys. They
 * appear in the rail like any project, but are never folders on this computer. */
export const REMOTE_PROJECT_PREFIX = REMOTE_PATH_PREFIX;

export function isRemoteProjectPath(path: string): boolean {
  return slash(path).startsWith(REMOTE_PROJECT_PREFIX);
}

/** A project folder on this computer: safe to index, search, or run git and
 * terminals in. Use `looksLikeProject` where a remote project also counts. */
export function isLocalProject(path: string): boolean {
  return looksLikeProject(path) && !isRemoteProjectPath(path) && !path.startsWith(WSL_PATH_PREFIX);
}

export function looksLikeProject(path: string): boolean {
  if (!path || path === "/" || path === "~") return false;
  const normalized = slash(path).replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(normalized) || normalized === "/") return false;
  // Home itself arrives expanded (`/Users/me`), so the `~` check above misses
  // it. Indexing it walks `~/Library`, which trips the OS consent prompt.
  if (prettyCwd(path) === "~") return false;
  if (path.includes(".app/") || path.includes(".app\\")) return false;
  return true;
}
