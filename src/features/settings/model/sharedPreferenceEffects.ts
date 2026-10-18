import { initAppearance, loadTranscriptAnchor, loadTranscriptLayout, loadShowExcludedFiles, TRANSCRIPT_ANCHOR_CHANGE_EVENT, TRANSCRIPT_LAYOUT_CHANGE_EVENT, SHOW_EXCLUDED_FILES_CHANGE_EVENT } from "./appearance";
import { initTypography } from "./typography";
import { initSounds, loadSoundsEnabled, SOUNDS_CHANGE_EVENT } from "./sounds";
import { refreshUiLanguage } from "../../../shared/i18n/language";
import * as settings from "./settings";
import { SHARED_PREFERENCES_CHANGED } from "./sharedPreferences";
import { PROJECT_LIST_PREFERENCES, preferenceField } from "./sharedPreferenceSchema";

/**
 * Sidebar layout and session bookkeeping, saved by ordinary navigation
 * (expanding a project, starting or archiving a session). None of them feeds
 * the presentation replayed below, and replaying it repaints the window.
 */
const NON_PRESENTATION_PREFERENCES = new Set([
  ...PROJECT_LIST_PREFERENCES,
  "monocode.sidebarTabOrder",
  "monocode.projectGroups",
  "monocode.projectGroupAssignments",
  "monocode.sessionFolders",
  "monocode.sessionSidebarOrder.v1",
  "monocode.lastModel",
  "monocode.lastModelSettings",
  "monocode.recentModels",
]);

function onlyNonPresentation(event: Event) {
  const keys = (event as CustomEvent<unknown>).detail;
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every(
      (key) =>
        typeof key === "string" &&
        NON_PRESENTATION_PREFERENCES.has(preferenceField(key)?.base ?? key),
    )
  );
}

/** Replays presentation side effects only: receiving a value must never save it again. */
export function installSharedPreferenceEffects() {
  const apply = (event: Event) => {
    if (onlyNonPresentation(event)) return;
    initAppearance();
    initTypography();
    initSounds();
    refreshUiLanguage();
    const events: [string, unknown][] = [
      [TRANSCRIPT_ANCHOR_CHANGE_EVENT, loadTranscriptAnchor()],
      [TRANSCRIPT_LAYOUT_CHANGE_EVENT, loadTranscriptLayout()],
      [SHOW_EXCLUDED_FILES_CHANGE_EVENT, loadShowExcludedFiles()],
      [SOUNDS_CHANGE_EVENT, loadSoundsEnabled()],
      [settings.MODEL_CONTROLS_CHANGE_EVENT, settings.loadModelControls()],
      [settings.NOTES_ENABLED_CHANGE_EVENT, settings.loadNotesEnabled()],
      [settings.LIVE_AGENTS_ENABLED_CHANGE_EVENT, settings.loadLiveAgentsEnabled()],
      [settings.DIFF_VIEWER_CHANGE_EVENT, settings.loadDiffViewer()],
    ];
    for (const [name, detail] of events) window.dispatchEvent(new CustomEvent(name, { detail }));
  };
  window.addEventListener(SHARED_PREFERENCES_CHANGED, apply);
  return () => window.removeEventListener(SHARED_PREFERENCES_CHANGED, apply);
}
