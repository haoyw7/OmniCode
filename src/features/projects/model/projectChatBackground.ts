import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  loadChatBackgroundOpacity,
  NEW_THREAD_BACKGROUND_EFFECTS,
  type NewThreadBackgroundEffect,
} from "../../settings/model/appearance";
import { activePreferenceStore, preferenceStorage, SHARED_PREFERENCES_CHANGED } from "../../settings/model/sharedPreferences";
import { parsePreferenceAsset } from "../../settings/model/preferenceAssets";
import { pathKey } from "../../../shared/lib/paths";
import { createStore } from "zustand/vanilla";

const KEY = "omnicode:project-chat-backgrounds";
const SHARED_KEY = "omnicode.projectBackgroundAssets";
const projectKey = (project: string) => activePreferenceStore() ? pathKey(project) : project;

export const PROJECT_CHAT_BACKGROUND_CHANGED =
  "omnicode:project-chat-background-changed";

export type ProjectChatBackgroundSettings = {
  path: string;
  opacity: number;
  effect: NewThreadBackgroundEffect;
};

type StoredProjectChatBackground = Partial<ProjectChatBackgroundSettings> & {
  emptyOpacity?: number;
  sessionOpacity?: number;
};

const initialRevision = Date.now();
const revisions = createStore(() => ({ revision: initialRevision, imageRevision: initialRevision }));
let subscriptions = 0;

function clampOpacity(value: number): number {
  return Math.min(
    CHAT_BACKGROUND_OPACITY_MAX,
    Math.max(CHAT_BACKGROUND_OPACITY_MIN, value),
  );
}

function read(): Record<string, StoredProjectChatBackground> {
  try {
    const raw = preferenceStorage.getItem(activePreferenceStore() ? SHARED_KEY : KEY);
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
    preferenceStorage.setItem(activePreferenceStore() ? SHARED_KEY : KEY, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
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
  return {
    path,
    opacity: storedOpacity(
      stored.sessionOpacity,
      storedOpacity(
        stored.emptyOpacity,
        storedOpacity(stored.opacity, loadChatBackgroundOpacity()),
      ),
    ),
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
    opacity: clampOpacity(value.opacity),
    effect: validEffect(value.effect)
      ? value.effect
      : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  };
  write(next);
  notifyProjectChatBackgroundChanged(imageChanged);
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
  revisions.setState(state => ({ revision: state.revision + 1, imageRevision: state.imageRevision + Number(imageChanged) }));
  window.dispatchEvent(new CustomEvent(PROJECT_CHAT_BACKGROUND_CHANGED));
}

export function projectChatBackgroundRevision(): number {
  return revisions.getState().revision;
}

export function projectChatBackgroundImageRevision(): number {
  return revisions.getState().imageRevision;
}

function shared(event: Event) {
  const keys = (event as CustomEvent<string[]>).detail;
  if (keys && !keys.includes(SHARED_KEY)) return;
  revisions.setState(state => ({ revision: state.revision + 1, imageRevision: state.imageRevision + 1 }));
}

export function subscribeProjectChatBackground(listener: () => void) {
  if (subscriptions++ === 0) window.addEventListener(SHARED_PREFERENCES_CHANGED, shared);
  const stop = revisions.subscribe(listener);
  return () => {
    stop();
    if (--subscriptions === 0) window.removeEventListener(SHARED_PREFERENCES_CHANGED, shared);
  };
}
