/** Wire allowlist. Caches, bearer credentials, native paths and command logs are never preferences. */
export type PreferenceKind = "flag" | "number" | "string" | "object" | "array";
const groups: Record<PreferenceKind, readonly string[]> = {
  flag: ["composerEffortVisible", "tabAnimationsEnabled", "notesEnabled", "quickComposerEnabled", "liveAgentsEnabled", "formatOnSave", "autosave", "claudeHooks", "transcriptAnchor", "showExcludedFiles", "separateSchemeAppearance", "showRemainingUsage", "maskEmails", "projectRailOrderVersion", "useLastSelection"],
  number: ["themeHue", "themeSaturation", "themeDarkLightness", "sidebarOpacity", "popoverOpacity", "panelOpacity", "chatBackgroundOpacity", "chatBackgroundEmptyOpacity", "chatBackgroundSessionOpacity", "uiFontSize", "contentFontSize", "codeFontSize"],
  string: ["followUpBehavior", "modelControls", "fileTabMode", "quickComposerShortcut", "diffViewer", "accentColor", "colorScheme", "codeTheme.light", "codeTheme.dark", "transcriptLayout", "chatBackgroundScope", "chatBackgroundArea", "newThreadBackgroundEffect", "changesView", "reducedMotion", "uiLanguage", "chatBackgroundAsset"],
  object: ["editorPreferences", "keybindingOverrides", "typographyProfile", "appearanceProfile.light", "appearanceProfile.dark", "lastModel", "lastModelSettings", "defaultModels", "lastSelectedModels", "lastSelectedModelChoice", "projectProviderSettings.v1", "providerAccountSelections.v1", "sessionFolders", "sessionSidebarOrder.v1", "projectGroupAssignments", "projectNotifications.v1", "agentDefaults", "projectBackgroundAssets", "mobileGlass"],
  array: ["sidebarPinnedOrder.v1", "recentModels", "sidebarTabOrder", "favoriteModels", "hiddenPickerProviders", "recentProjects", "projectRailOrder", "projectRailPinned", "archivedProjects", "projectGroups"],
};
/**
 * Per-window view state and platform/device behavior: expansion, panel sizes,
 * filters, window effects and local alerts. Each device keeps its own copy.
 */
const deviceLocalGroups: Record<PreferenceKind, readonly string[]> = {
  flag: ["closeToTray", "menuBarVisible", "projectRailOpen", "sessionSidebarOpen", "bodyGlass", "sounds", "notifications", "sessionsShowArchived"],
  number: ["windowOpacity", "sidebarBlur", "sidebarWidth", "uiScale", "soundsEnabledAt"],
  // next-themes writes only device keys. The Host's colorScheme wire value is
  // applied through the theme bridge and mirrored locally on mobile.
  string: ["modelPickerTab", "desktopSkin", "desktopColorScheme", "mobile.colorScheme", "desktopAppearanceBackup.v1", "desktopMode"],
  object: ["projectSidebarTabs.v1", "pinnedSessionsCollapsed", "reminderSessionsCollapsed", "sessionSidebarFilters", "desktopLocations.v1"],
  array: ["sidebarSectionsCollapsed.v1", "projectTreeExpanded.v1"],
};
const kinds = (source: Record<PreferenceKind, readonly string[]>, extra: [string, PreferenceKind][]): Readonly<Record<string, PreferenceKind>> =>
  Object.freeze(Object.fromEntries([
    ...Object.entries(source).flatMap(([kind, names]) => names.map(name => [`omnicode.${name}`, kind as PreferenceKind])),
    ...extra,
  ]));
export const SHARED_PREFERENCE_KINDS = kinds(groups,
  ["colors", "custom-colors", "labels", "mascots"].map(name => [`omnicode:tab-group:${name}`, "object"]));
/**
 * Formerly shared. Clients keep these in localStorage; the Host still accepts
 * them so journals queued by older clients never block later edits.
 */
export const DEVICE_LOCAL_PREFERENCE_KINDS = kinds(deviceLocalGroups, [["omnicode:tab-groups:collapsed", "array"]]);
const KNOWN_PREFERENCE_KINDS: Readonly<Record<string, PreferenceKind>> = { ...SHARED_PREFERENCE_KINDS, ...DEVICE_LOCAL_PREFERENCE_KINDS };
export const preferenceKind = (key: string): PreferenceKind | undefined =>
  Object.hasOwn(KNOWN_PREFERENCE_KINDS, key) ? KNOWN_PREFERENCE_KINDS[key] : undefined;
export const PROJECT_MAP_PREFERENCES = new Set([
  "omnicode:tab-group:colors", "omnicode:tab-group:custom-colors", "omnicode:tab-group:labels", "omnicode:tab-group:mascots",
  "omnicode.projectProviderSettings.v1", "omnicode.providerAccountSelections.v1", "omnicode.sessionFolders", "omnicode.sessionSidebarOrder.v1", "omnicode.projectGroupAssignments", "omnicode.projectNotifications.v1", "omnicode.projectBackgroundAssets",
]);
export const PROJECT_LIST_PREFERENCES = new Set([
  "omnicode.sidebarPinnedOrder.v1",
  "omnicode.recentProjects", "omnicode.projectRailOrder", "omnicode.projectRailPinned", "omnicode.archivedProjects",
]);
/** Project-keyed device-local values still decode from Host copies during migration. */
export const DEVICE_LOCAL_PROJECT_MAP_PREFERENCES = new Set([
  "omnicode.projectSidebarTabs.v1", "omnicode.pinnedSessionsCollapsed", "omnicode.reminderSessionsCollapsed",
]);
export const DEVICE_LOCAL_PROJECT_LIST_PREFERENCES = new Set(["omnicode:tab-groups:collapsed", "omnicode.projectTreeExpanded.v1"]);
export function preferenceField(key: string): { base: string; path: string[] } | undefined {
  const split = key.indexOf("::");
  const base = split < 0 ? key : key.slice(0, split);
  const kind = preferenceKind(base);
  if (!kind) return;
  if (split < 0) return { base, path: [] };
  if (kind !== "object") return;
  try {
    const path: unknown = JSON.parse(key.slice(split + 2));
    if (Array.isArray(path) && path.length > 0 && path.length <= 12 && path.every(p => typeof p === "string" && p.length <= 1024 && !["__proto__", "prototype", "constructor"].includes(p))) return { base, path };
  } catch { /* Invalid field paths must not reach object assignment. */ }
}
export const isSharedPreferenceKey = (key: string) => !!preferenceField(key);
export function validateSharedPreferenceValue(key: string, value: unknown): boolean {
  const field = preferenceField(key);
  if (!field) return false;
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 512_000) return false;
  if (field.path.length) {
    try { JSON.parse(value); return true; } catch { return false; }
  }
  const kind = preferenceKind(field.base)!;
  switch (kind) {
    case "flag": return value === "0" || value === "1";
    case "number": return value.trim() !== "" && Number.isFinite(Number(value));
    case "string": return value.length <= 4096 && !value.includes("\0");
    case "array": case "object":
      try { const parsed: unknown = JSON.parse(value); return kind === "array" ? Array.isArray(parsed) : !!parsed && typeof parsed === "object" && !Array.isArray(parsed); } catch { return false; }
  }
}
