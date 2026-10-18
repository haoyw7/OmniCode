import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
  NEW_THREAD_BACKGROUND_EFFECTS,
  type ChatBackgroundScope,
  type NewThreadBackgroundEffect,
} from "../../settings/model/appearance";
import { activePreferenceStore, preferenceStorage, SHARED_PREFERENCES_CHANGED } from "../../settings/model/sharedPreferences";
import { parsePreferenceAsset } from "../../settings/model/preferenceAssets";
import { pathKey } from "../../../shared/lib/paths";

const KEY = "monocode:project-chat-backgrounds";
const SHARED_KEY = "monocode.projectBackgroundAssets";
const projectKey = (project: string) => activePreferenceStore() ? pathKey(project) : project;

export const PROJECT_CHAT_BACKGROUND_CHANGED =
  "monocode:project-chat-background-changed";

export type ProjectChatBackground = {
  path: string;
  opacity: number;
  scope: ChatBackgroundScope;
};

export type ProjectChatBackgroundSettings = {
  path: string;
  emptyOpacity: number;
  sessionOpacity: number;
  scope: ChatBackgroundScope;
  effect: NewThreadBackgroundEffect;
};

type StoredProjectChatBackground = Partial<ProjectChatBackground> & {
  emptyOpacity?: number;
  sessionOpacity?: number;
  effect?: NewThreadBackgroundEffect;
};

let revision = Date.now();
let imageRevision = revision;

function clampOpacity(value: number): number {
  return Math.min(
    CHAT_BACKGROUND_OPACITY_MAX,
    Math.max(CHAT_BACKGROUND_OPACITY_MIN, value),
  );
}

function read(): Record<string, StoredProjectChatBackground> {
  try {
    const raw = activePreferenceStore() ? preferenceStorage.getItem(SHARED_KEY) : localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, StoredProjectChatBackground>)
      : {};
  } catch {
    return {};
  }
}

function write(value: Record<string, StoredProjectChatBackground>) {
  try {
    if (activePreferenceStore()) preferenceStorage.setItem(SHARED_KEY, JSON.stringify(value));
    else localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
}

function validScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

function validEffect(value: unknown): value is NewThreadBackgroundEffect {
  return NEW_THREAD_BACKGROUND_EFFECTS.includes(
    value as NewThreadBackgroundEffect,
  );
}

function storedOpacity(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampOpacity(value)
    : fallback;
}

export function loadProjectChatBackgroundSettings(
  project: string,
): ProjectChatBackgroundSettings | null {
  const stored = read()[projectKey(project)];
  const path = typeof stored?.path === "string" ? stored.path.trim() : "";
  if (!path) return null;
  if (activePreferenceStore() && !parsePreferenceAsset(path)) return null;
  const legacyOpacity = storedOpacity(
    stored.opacity,
    loadChatBackgroundEmptyOpacity(),
  );
  const hasStoredOpacity =
    typeof stored.opacity === "number" && Number.isFinite(stored.opacity);
  const hasStoredEmptyOpacity =
    typeof stored.emptyOpacity === "number" &&
    Number.isFinite(stored.emptyOpacity);
  return {
    path,
    emptyOpacity: storedOpacity(stored.emptyOpacity, legacyOpacity),
    sessionOpacity: storedOpacity(
      stored.sessionOpacity,
      hasStoredEmptyOpacity
        ? storedOpacity(stored.emptyOpacity, legacyOpacity)
        : hasStoredOpacity
          ? legacyOpacity
          : loadChatBackgroundSessionOpacity(),
    ),
    scope: validScope(stored.scope) ? stored.scope : loadChatBackgroundScope(),
    effect: validEffect(stored.effect)
      ? stored.effect
      : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  };
}

export function saveProjectChatBackgroundSettings(
  project: string,
  value: ProjectChatBackgroundSettings,
  imageChanged = false,
) {
  const path = value.path.trim();
  if (!project || !path) return;
  if (activePreferenceStore() && !parsePreferenceAsset(path)) throw new Error("Upload the background to its Host before saving.");
  const next = read();
  next[projectKey(project)] = {
    path,
    emptyOpacity: clampOpacity(value.emptyOpacity),
    sessionOpacity: clampOpacity(value.sessionOpacity),
    scope: validScope(value.scope)
      ? value.scope
      : CHAT_BACKGROUND_SCOPE_DEFAULT,
    effect: validEffect(value.effect)
      ? value.effect
      : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  };
  write(next);
  notifyProjectChatBackgroundChanged(imageChanged);
}

export function loadProjectChatBackground(
  project: string,
): ProjectChatBackground | null {
  const settings = loadProjectChatBackgroundSettings(project);
  if (!settings) return null;
  return {
    path: settings.path,
    opacity: settings.emptyOpacity,
    scope: settings.scope,
  };
}

export function saveProjectChatBackground(
  project: string,
  value: ProjectChatBackground,
) {
  const path = value.path.trim();
  if (!project || !path) return;
  if (activePreferenceStore() && !parsePreferenceAsset(path)) throw new Error("Upload the background to its Host before saving.");
  const next = read();
  next[projectKey(project)] = {
    path,
    opacity: clampOpacity(value.opacity),
    scope: validScope(value.scope)
      ? value.scope
      : CHAT_BACKGROUND_SCOPE_DEFAULT,
  };
  write(next);
  notifyProjectChatBackgroundChanged();
}

export function clearProjectChatBackgroundSetting(project: string) {
  project = projectKey(project);
  const next = read();
  if (!(project in next)) return;
  delete next[project];
  write(next);
  notifyProjectChatBackgroundChanged();
}

export function rebaseProjectChatBackgroundSetting(from: string, to: string) {
  from = projectKey(from);
  to = projectKey(to);
  if (!from || !to || from === to) return;
  const next = read();
  if (!(from in next)) return;
  if (!(to in next)) next[to] = next[from];
  delete next[from];
  write(next);
  notifyProjectChatBackgroundChanged();
}

export function notifyProjectChatBackgroundChanged(imageChanged = true) {
  revision += 1;
  if (imageChanged) imageRevision += 1;
  window.dispatchEvent(new CustomEvent(PROJECT_CHAT_BACKGROUND_CHANGED));
}

export function projectChatBackgroundRevision(): number {
  return revision;
}

export function projectChatBackgroundImageRevision(): number {
  return imageRevision;
}

export function subscribeProjectChatBackground(listener: () => void) {
  const shared = (event: Event) => {
    const keys = (event as CustomEvent<string[]>).detail;
    if (keys && !keys.includes(SHARED_KEY)) return;
    revision += 1;
    imageRevision += 1;
    listener();
  };
  window.addEventListener(PROJECT_CHAT_BACKGROUND_CHANGED, listener);
  window.addEventListener(SHARED_PREFERENCES_CHANGED, shared);
  return () => {
    window.removeEventListener(PROJECT_CHAT_BACKGROUND_CHANGED, listener);
    window.removeEventListener(SHARED_PREFERENCES_CHANGED, shared);
  };
}
