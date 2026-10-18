import { useEffect, useState } from "react";
import {
  REMOTE_PROJECTS_CHANGED,
  sharedProjects,
} from "../../connections/model/remoteProjects";
import { pathKey } from "../../../shared/lib/paths";
import { isChatFolder } from "./chatFolderPath";

export { CHAT_ROOT, chatFolderRelativePath, isChatFolder } from "./chatFolderPath";

const KEY = "monocode.chatFolders.v1";
const CHANGED = "monocode:chat-folders-changed";

function loadRegistered(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Chat folders started here plus any the shared Host already knows. */
export function loadChatFolders(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of [
    ...loadRegistered(),
    ...sharedProjects().map((project) => project.cwd),
  ]) {
    const key = pathKey(path);
    if (!isChatFolder(path) || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function rememberChatFolder(path: string): void {
  const key = pathKey(path);
  const next = [path, ...loadRegistered().filter((item) => pathKey(item) !== key)];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function useChatFolders(enabled = true): string[] {
  const [folders, setFolders] = useState(() =>
    enabled ? loadChatFolders() : [],
  );
  useEffect(() => {
    if (!enabled) return;
    const refresh = () =>
      setFolders((current) => {
        const next = loadChatFolders();
        return next.join("\n") === current.join("\n") ? current : next;
      });
    refresh();
    window.addEventListener(CHANGED, refresh);
    window.addEventListener(REMOTE_PROJECTS_CHANGED, refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener(REMOTE_PROJECTS_CHANGED, refresh);
    };
  }, [enabled]);
  return folders;
}
