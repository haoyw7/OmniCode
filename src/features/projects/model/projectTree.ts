import { preferenceStorage } from "../../settings/model/sharedPreferences";
import { pathKey } from "../../../shared/lib/paths";

const KEY = "monocode.projectTreeExpanded.v1";
const CHANGED = "monocode:project-tree-expanded-changed";

function readExpanded(): Set<string> | undefined {
  try {
    const raw = preferenceStorage.getItem(KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return new Set(
      parsed
        .filter((path): path is string => typeof path === "string" && !!path)
        .map(pathKey),
    );
  } catch {
    return undefined;
  }
}

/** The initial tree only opens the current project; an explicitly empty tree stays empty. */
export function loadProjectTreeExpanded(cwd: string): ReadonlySet<string> {
  return readExpanded() ?? new Set(cwd && cwd !== "~" ? [pathKey(cwd)] : []);
}

export function saveProjectTreeExpanded(paths: Iterable<string>): void {
  const next = new Set([...paths].filter(Boolean).map(pathKey));
  try {
    preferenceStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // Storage can be unavailable in private mode.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function rebaseProjectTreeExpanded(from: string, to: string): void {
  const expanded = readExpanded();
  if (!expanded?.delete(pathKey(from))) return;
  expanded.add(pathKey(to));
  saveProjectTreeExpanded(expanded);
}

export function clearProjectTreeExpanded(path: string): void {
  const expanded = readExpanded();
  if (!expanded?.delete(pathKey(path))) return;
  saveProjectTreeExpanded(expanded);
}

export function subscribeProjectTreeExpanded(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
