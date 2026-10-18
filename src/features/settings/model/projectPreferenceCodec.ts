import { DEVICE_LOCAL_PROJECT_LIST_PREFERENCES, DEVICE_LOCAL_PROJECT_MAP_PREFERENCES, PROJECT_LIST_PREFERENCES, PROJECT_MAP_PREFERENCES } from "./sharedPreferenceSchema";
import type { PreferenceCodec } from "./sharedPreferences";
import {
  parseRemotePath, remoteProjectFor, remoteProjectKey, remoteProjectsOn,
  sharedHostEnvironment, sharedProjects,
} from "../../connections/model/remoteProjects";
import { remoteSessionFor } from "../../connections/model/connections";
import { pathKey } from "../../../shared/lib/paths";

const PREFIX = "@project:";
export function projectPreferenceIdentity(environmentId: string, projectId: string): string {
  return `${PREFIX}${encodeURIComponent(environmentId)}:${encodeURIComponent(projectId)}`;
}
export function parseProjectPreferenceIdentity(value: string): { environmentId: string; projectId: string } | undefined {
  if (!value.startsWith(PREFIX)) return;
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return;
  try {
    const [environmentId, projectId] = parts.map(decodeURIComponent);
    if (environmentId && projectId) return { environmentId, projectId };
  } catch { /* Malformed identities never become filesystem paths. */ }
}
const absolute = (path: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path) || !!parseRemotePath(path);
const MIXED_PINS_KEY = "omnicode.sidebarPinnedOrder.v1";
function pinnedSession(value: string): [string, string] | undefined {
  if (!value.startsWith("session:")) return;
  try {
    const parsed: unknown = JSON.parse(value.slice("session:".length));
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(part => typeof part === "string")) return parsed as [string, string];
  } catch { /* Legacy opaque entries remain unchanged. */ }
}

/** Preflight and encode mixed project/session order with the same identity rules. */
export function encodeProjectPreferenceListPath(key: string, path: string): string {
  const session = key === MIXED_PINS_KEY ? pinnedSession(path) : undefined;
  return session ? `session:${JSON.stringify([encodeProjectPreferencePath(session[0]), remoteSessionFor(session[1]) ?? session[1]])}`
    : encodeProjectPreferencePath(path);
}
function decodeProjectPreferenceListPath(key: string, identity: string): string | undefined {
  const session = key === MIXED_PINS_KEY ? pinnedSession(identity) : undefined;
  if (!session) return decodeProjectPreferencePath(identity);
  const path = decodeProjectPreferencePath(session[0]);
  return path === undefined ? undefined : `session:${JSON.stringify([pathKey(path), session[1]])}`;
}
function projectListIdentity(key: string, identity: string): boolean {
  const session = key === MIXED_PINS_KEY ? pinnedSession(identity) : undefined;
  return !!parseProjectPreferenceIdentity(session?.[0] ?? identity);
}

export function encodeProjectPreferencePath(path: string): string {
  if (parseProjectPreferenceIdentity(path)) return path;
  if (!absolute(path)) return path;
  let project = remoteProjectFor(path);
  if (!project?.projectId) project = sharedProjects().find((entry) => pathKey(entry.key) === pathKey(path));
  if (!project?.projectId) throw new Error("Open this project on its Host before saving shared project settings.");
  return projectPreferenceIdentity(project.environmentId, project.projectId);
}

export function decodeProjectPreferencePath(value: string): string | undefined {
  const identity = parseProjectPreferenceIdentity(value);
  if (!identity) return absolute(value) ? undefined : value;
  const local = identity.environmentId === sharedHostEnvironment();
  const projects = local ? sharedProjects() : remoteProjectsOn(identity.environmentId);
  const project = projects.find((entry) => entry.projectId === identity.projectId);
  return project ? local ? project.key : remoteProjectKey(identity.environmentId, project.cwd) : undefined;
}

const casePreservingMaps = new Set([
  "omnicode.sessionFolders", "omnicode.pinnedSessionsCollapsed", "omnicode.reminderSessionsCollapsed", "omnicode.sessionSidebarOrder.v1",
]);
function mapSessionIds(key: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (key === "omnicode.sessionSidebarOrder.v1") return value.map((id) => typeof id === "string" ? remoteSessionFor(id) ?? id : id);
  if (key === "omnicode.sessionFolders") return value.map((folder) => {
    if (!folder || typeof folder !== "object" || !Array.isArray(folder.sessionIds)) return folder;
    return { ...folder, sessionIds: folder.sessionIds.map((id: unknown) => typeof id === "string" ? remoteSessionFor(id) ?? id : id) };
  });
  return value;
}

/** Unknown remote projects stay on the Host and survive edits to visible projects. */
export function createProjectPreferenceCodec(): PreferenceCodec {
  const hiddenMaps = new Map<string, Record<string, unknown>>();
  const hiddenLists = new Map<string, { index: number; value: unknown }[]>();
  const itemPath = (item: unknown): string | undefined => typeof item === "string" ? item
    : item && typeof item === "object" && "path" in item && typeof item.path === "string" ? item.path : undefined;
  const withPath = (item: unknown, path: string): unknown => typeof item === "string" ? path : { ...(item as object), path };
  return {
    encode(key, value) {
      if (PROJECT_MAP_PREFERENCES.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
        return { ...hiddenMaps.get(key), ...Object.fromEntries(Object.entries(value).map(([path, entry]) => [encodeProjectPreferencePath(path), mapSessionIds(key, entry)])) };
      }
      if (PROJECT_LIST_PREFERENCES.has(key) && Array.isArray(value)) {
        const next = value.map((entry) => {
          const path = itemPath(entry);
          return path === undefined ? entry : withPath(entry, encodeProjectPreferenceListPath(key, path));
        });
        const identities = new Set(next.map(itemPath));
        for (const hidden of hiddenLists.get(key) ?? []) {
          if (!identities.has(itemPath(hidden.value))) next.splice(Math.min(hidden.index, next.length), 0, hidden.value);
        }
        return next;
      }
      return value;
    },
    decode(key, value) {
      if ((PROJECT_MAP_PREFERENCES.has(key) || DEVICE_LOCAL_PROJECT_MAP_PREFERENCES.has(key)) && value && typeof value === "object" && !Array.isArray(value)) {
        const hidden: Record<string, unknown> = {};
        const result: Record<string, unknown> = {};
        for (const [identity, entry] of Object.entries(value)) {
          const path = decodeProjectPreferencePath(identity);
          if (path === undefined) {
            if (parseProjectPreferenceIdentity(identity)) hidden[identity] = entry;
          }
          else result[casePreservingMaps.has(key) ? path : pathKey(path)] = entry;
        }
        hiddenMaps.set(key, hidden);
        return result;
      }
      if ((PROJECT_LIST_PREFERENCES.has(key) || DEVICE_LOCAL_PROJECT_LIST_PREFERENCES.has(key)) && Array.isArray(value)) {
        const hidden: { index: number; value: unknown }[] = [];
        const result: unknown[] = [];
        value.forEach((entry, index) => {
          const identity = itemPath(entry);
          if (identity === undefined) { result.push(entry); return; }
          const path = decodeProjectPreferenceListPath(key, identity);
          if (path === undefined) {
            if (projectListIdentity(key, identity)) hidden.push({ index, value: entry });
          }
          else result.push(withPath(entry, path));
        });
        hiddenLists.set(key, hidden);
        return result;
      }
      return value;
    },
  };
}

