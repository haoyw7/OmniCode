import { animate, type AnimationPlaybackControlsWithThen } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { prefersReducedMotion } from "../../../shared/lib/reducedMotion";
import { DESKTOP_SCHEME_KEY, isDesktopDocument, loadDesktopTheme } from "../../../shared/theme/desktopAppearance";
import { activePreferenceStore, SHARED_PREFERENCES_CHANGED } from "./sharedPreferences";
import { parsePreferenceAsset, preferenceAssetUrl, PREFERENCE_ASSET_READY } from "./preferenceAssets";
import { preferenceStorage } from "./sharedPreferences";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { hslToRgb, isHexColor, type Rgb } from "../../../shared/lib/colorUtils";
import { IS_LINUX, IS_MAC } from "../../../platform/tauri/platform";
import { readFlag, writeFlag } from "./storageFlags";
import { applyUiScale, loadUiScale } from "./uiScale";
import {
  applyPreparedNewThreadBackground,
  clearPreparedNewThreadBackground,
} from "./newThreadBackgroundEffects";
import {
  applyDesktopSkin,
  DESKTOP_SKIN_INFO,
  DESKTOP_SKIN_KEY,
  isDesktopSkinId,
  loadDesktopSkin,
  type DesktopSkinPreference,
} from "../../../shared/theme/desktopSkin";

const ACCENT_COLOR_KEY = "omnicode.accentColor";
const THEME_HUE_KEY = "omnicode.themeHue";
const THEME_SATURATION_KEY = "omnicode.themeSaturation";
const THEME_DARK_LIGHTNESS_KEY = "omnicode.themeDarkLightness";
const OPACITY_KEY = "omnicode.sidebarOpacity";
const POPOVER_OPACITY_KEY = "omnicode.popoverOpacity";
const WINDOW_OPACITY_KEY = "omnicode.windowOpacity";
const PANEL_OPACITY_KEY = "omnicode.panelOpacity";
const BLUR_KEY = "omnicode.sidebarBlur";
const PROJECT_RAIL_OPEN_KEY = "omnicode.projectRailOpen";
const SESSION_SIDEBAR_OPEN_KEY = "omnicode.sessionSidebarOpen";
const BODY_KEY = "omnicode.bodyGlass";
const COMPACT_SIDEBAR_KEY = "omnicode.compactSidebar";
const INDENT_SIDEBAR_SESSIONS_KEY = "omnicode.indentSidebarSessions";
const SCHEME_KEY = "omnicode.colorScheme";
const SIDEBAR_TAB_ORDER_KEY = "omnicode.sidebarTabOrder";
const SIDEBAR_WIDTH_KEY = "omnicode.sidebarWidth";
const TRANSCRIPT_LAYOUT_KEY = "omnicode.transcriptLayout";
const TRANSCRIPT_ANCHOR_KEY = "omnicode.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "omnicode.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "omnicode.chatBackgroundOpacity";
const LEGACY_CHAT_BACKGROUND_EMPTY_OPACITY_KEY =
  "omnicode.chatBackgroundEmptyOpacity";
const LEGACY_CHAT_BACKGROUND_SESSION_OPACITY_KEY =
  "omnicode.chatBackgroundSessionOpacity";
const CHAT_BACKGROUND_AREA_KEY = "omnicode.chatBackgroundArea";
const NEW_THREAD_BACKGROUND_EFFECT_KEY = "omnicode.newThreadBackgroundEffect";
const CHANGES_VIEW_KEY = "omnicode.changesView";
const SHOW_EXCLUDED_FILES_KEY = "omnicode.showExcludedFiles";
let chatBackgroundRevision = Date.now();
let nativeGlassReady = false;
let glassFadeMotion: AnimationPlaybackControlsWithThen | undefined;
let glassSyncGeneration = 0;
/** The native window state last requested; replays of it must not repaint. */
let appliedGlassRequest: string | undefined;
let appliedSidebarBlur: number | undefined;
let appliedWindowOpacity = 1;

export const CHAT_BACKGROUND_PATH_CHANGE_EVENT =
  "omnicode:chat-background-path-change";

export type ColorScheme = "dark" | "light";
export type ThemePreference = ColorScheme | "system";
export type TranscriptLayout = "full" | "chat";
/** Where the global background is painted: each chat pane, or the whole window. */
export type ChatBackgroundArea = "chat" | "window";
export type NewThreadBackgroundEffect =
  "none" | "dither" | "ascii" | "halftone" | "scanlines" | "gradient-blur";
export type ChangesView = "list" | "tree";

export const NEW_THREAD_BACKGROUND_EFFECTS: readonly NewThreadBackgroundEffect[] =
  ["none", "dither", "ascii", "halftone", "scanlines", "gradient-blur"];

export const NEW_THREAD_BACKGROUND_EFFECT_DEFAULT: NewThreadBackgroundEffect =
  "none";

export const NEW_THREAD_BACKGROUND_EFFECT_LABELS: Record<
  NewThreadBackgroundEffect,
  string
> = {
  none: "None",
  dither: "Dither",
  ascii: "ASCII",
  halftone: "Halftone",
  scanlines: "Scanlines",
  "gradient-blur": "Haze",
};

export const NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS: Record<
  NewThreadBackgroundEffect,
  string
> = {
  none: "Shows the original artwork.",
  dither: "Rebuilds the artwork with a dithered color palette.",
  ascii: "Recreates the artwork with colored characters on black.",
  halftone: "Recreates the artwork with colored print dots on black.",
  scanlines: "Adds a pronounced horizontal display-line texture.",
  "gradient-blur": "Blurs and fades the artwork into the background below.",
};

export const THEME_PREFERENCE_DEFAULT: ThemePreference = "dark";

export const ACCENT_COLOR_DEFAULT = null;

/** Accent swatches offered after "Default" on desktop and mobile. */
export const ACCENT_COLOR_PRESETS = [
  "#4da3f5",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#10b981",
] as const;
export const ACCENT_COLOR_PRESET_LABELS = [
  "Blue",
  "Violet",
  "Pink",
  "Red",
  "Orange",
  "Green",
] as const;

/** Fired on `window` whenever the color scheme flips (detail: ColorScheme). */
export const SCHEME_CHANGE_EVENT = "omnicode:schemechange";

export const TRANSCRIPT_LAYOUT_DEFAULT: TranscriptLayout = "chat";

export const CHANGES_VIEW_DEFAULT: ChangesView = "list";

export const TRANSCRIPT_ANCHOR_DEFAULT = true;

/** Fired on `window` whenever prompt-to-top anchoring flips (detail: boolean). */
export const TRANSCRIPT_ANCHOR_CHANGE_EVENT = "omnicode:transcriptanchorchange";

/** Fired on `window` whenever the transcript layout flips (detail: TranscriptLayout). */
export const TRANSCRIPT_LAYOUT_CHANGE_EVENT = "omnicode:transcriptlayoutchange";

export const SHOW_EXCLUDED_FILES_DEFAULT = false;

/** Fired on `window` whenever the explorer excluded-files setting flips (detail: boolean). */
export const SHOW_EXCLUDED_FILES_CHANGE_EVENT =
  "omnicode:showexcludedfileschange";

export type SidebarTabId = "files" | "sessions" | "changes";

const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTabId[] = [
  "sessions",
  "files",
  "changes",
];

export const THEME_HUE_MIN = 0;
export const THEME_HUE_MAX = 360;
export const THEME_HUE_DEFAULT = 240;

export const THEME_SATURATION_MIN = 0;
export const THEME_SATURATION_MAX = 100;
export const THEME_SATURATION_DEFAULT = 0;

export const THEME_DARK_LIGHTNESS_MIN = 0;
export const THEME_DARK_LIGHTNESS_MAX = 30;
export const THEME_DARK_LIGHTNESS_DEFAULT = 9;

export const SIDEBAR_OPACITY_MIN = 0.15;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_OPACITY_DEFAULT = 0.85;

/** Background opacity used to keep menus readable over the native glass backdrop. */
export const POPOVER_OPACITY_MIN = 0;
export const POPOVER_OPACITY_MAX = 1;
export const POPOVER_OPACITY_DEFAULT = 0.02;

/** Scales every window surface (chrome, sidebar, main pane) at once. */
export const WINDOW_OPACITY_MIN = 0.15;
export const WINDOW_OPACITY_MAX = 1;
export const WINDOW_OPACITY_DEFAULT = 1;

/** Fill of floating panels: composer, settings cards, dialogs, menus. */
export const PANEL_OPACITY_MIN = 0.1;
export const PANEL_OPACITY_MAX = 1;
export const PANEL_OPACITY_DEFAULT = 1;

export const SIDEBAR_BLUR_MIN = 1;
export const SIDEBAR_BLUR_MAX = 64;
export const SIDEBAR_BLUR_DEFAULT = 24;

export const SIDEBAR_WIDTH_MIN = 232;
export const SIDEBAR_WIDTH_MAX = 560;
export const SIDEBAR_WIDTH_DEFAULT = 256;

export const BODY_GLASS_DEFAULT = !IS_LINUX;
/** Skinned sidebars use the phone's 56px rows unless this is on. */
export const COMPACT_SIDEBAR_DEFAULT = false;
/** Conversations sit one step in from their project unless this is off. */
export const INDENT_SIDEBAR_SESSIONS_DEFAULT = true;

export const CHAT_BACKGROUND_OPACITY_MIN = 0.05;
export const CHAT_BACKGROUND_OPACITY_MAX = 1;
export const CHAT_BACKGROUND_OPACITY_DEFAULT = 0.24;
export const CHAT_BACKGROUND_AREA_DEFAULT: ChatBackgroundArea = "chat";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readNumber(key: string): number | null {
  try {
    const raw = preferenceStorage.getItem(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    preferenceStorage.setItem(key, String(value));
  } catch {
    // private mode / quota
  }
}

function normalizeAccentColor(value: unknown): string | null {
  return typeof value === "string" && isHexColor(value)
    ? value.toLowerCase()
    : ACCENT_COLOR_DEFAULT;
}

function accentForeground(color: string): "#000000" | "#ffffff" {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function loadAccentColor(): string | null {
  try {
    return normalizeAccentColor(preferenceStorage.getItem(ACCENT_COLOR_KEY));
  } catch {
    return ACCENT_COLOR_DEFAULT;
  }
}

export function saveAccentColor(value: string | null) {
  try {
    const next = normalizeAccentColor(value);
    if (next == null) preferenceStorage.removeItem(ACCENT_COLOR_KEY);
    else preferenceStorage.setItem(ACCENT_COLOR_KEY, next);
  } catch {
    // private mode / quota
  }
}

export function applyAccentColor(value: string | null) {
  const next = normalizeAccentColor(value);
  document.documentElement.classList.toggle("has-user-accent", next != null);
  if (next == null) {
    document.documentElement.style.removeProperty("--user-accent-color");
    document.documentElement.style.removeProperty("--user-accent-foreground");
    return next;
  }
  document.documentElement.style.setProperty("--user-accent-color", next);
  document.documentElement.style.setProperty(
    "--user-accent-foreground",
    accentForeground(next),
  );
  return next;
}

export function loadThemeHue(): number {
  return Math.round(
    clamp(
      readNumber(THEME_HUE_KEY) ?? THEME_HUE_DEFAULT,
      THEME_HUE_MIN,
      THEME_HUE_MAX,
    ),
  );
}

export function saveThemeHue(value: number) {
  writeNumber(
    THEME_HUE_KEY,
    Math.round(clamp(value, THEME_HUE_MIN, THEME_HUE_MAX)),
  );
}

export function loadThemeSaturation(): number {
  return Math.round(
    clamp(
      readNumber(THEME_SATURATION_KEY) ?? THEME_SATURATION_DEFAULT,
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
  );
}

export function saveThemeSaturation(value: number) {
  writeNumber(
    THEME_SATURATION_KEY,
    Math.round(clamp(value, THEME_SATURATION_MIN, THEME_SATURATION_MAX)),
  );
}

export function loadThemeDarkLightness(): number {
  return Math.round(
    clamp(
      readNumber(THEME_DARK_LIGHTNESS_KEY) ?? THEME_DARK_LIGHTNESS_DEFAULT,
      THEME_DARK_LIGHTNESS_MIN,
      THEME_DARK_LIGHTNESS_MAX,
    ),
  );
}

export function saveThemeDarkLightness(value: number) {
  writeNumber(
    THEME_DARK_LIGHTNESS_KEY,
    Math.round(
      clamp(value, THEME_DARK_LIGHTNESS_MIN, THEME_DARK_LIGHTNESS_MAX),
    ),
  );
}

export function applyThemeDarkLightness(value: number) {
  const next = Math.round(
    clamp(value, THEME_DARK_LIGHTNESS_MIN, THEME_DARK_LIGHTNESS_MAX),
  );
  document.documentElement.style.setProperty(
    "--theme-dark-lightness",
    `${next}%`,
  );
  return next;
}

export function applyThemeTint(hue: number, saturation: number) {
  const nextHue = Math.round(clamp(hue, THEME_HUE_MIN, THEME_HUE_MAX));
  const nextSaturation = Math.round(
    clamp(saturation, THEME_SATURATION_MIN, THEME_SATURATION_MAX),
  );
  document.documentElement.style.setProperty("--theme-hue", String(nextHue));
  document.documentElement.style.setProperty(
    "--theme-saturation",
    `${nextSaturation}%`,
  );
  return { hue: nextHue, saturation: nextSaturation };
}

export function initAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemePreference(loadThemePreference());
  watchSystemColorScheme();
  applySidebarOpacity(loadSidebarOpacity());
  applyPopoverOpacity(loadPopoverOpacity());
  applyWindowOpacity(loadWindowOpacity());
  applyPanelOpacity(loadPanelOpacity());
  applySidebarBlur(loadSidebarBlur());
  applyBodyGlass(loadBodyGlass());
  applyCompactSidebar(loadCompactSidebar());
  applyIndentSidebarSessions(loadIndentSidebarSessions());
  applyChatBackground(loadChatBackgroundPath());
  applyChatBackgroundOpacity(loadChatBackgroundOpacity());
  applyChatBackgroundArea(loadChatBackgroundArea());
  void applyUiScale(loadUiScale());
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = preferenceStorage.getItem(SCHEME_KEY);
    const fallback = isThemePreference(raw) ? raw : THEME_PREFERENCE_DEFAULT;
    return isDesktopDocument() ? loadDesktopTheme(fallback) : fallback;
  } catch {
    return THEME_PREFERENCE_DEFAULT;
  }
}

export function saveThemePreference(value: ThemePreference) {
  try {
    preferenceStorage.setItem(isDesktopDocument() ? DESKTOP_SCHEME_KEY : SCHEME_KEY, value);
  } catch {
    // private mode / quota
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: light)");
}

function systemColorScheme(): ColorScheme {
  return systemQuery()?.matches ? "light" : "dark";
}

export function resolveColorScheme(value: ThemePreference): ColorScheme {
  return value === "system" ? systemColorScheme() : value;
}

export function isLightScheme(): boolean {
  return document.documentElement.classList.contains("theme-light");
}

export function applyThemePreference(
  value: ThemePreference,
  skin: DesktopSkinPreference = loadDesktopSkin(),
): ColorScheme {
  const next = resolveColorScheme(value);
  document.documentElement.classList.toggle("theme-light", next === "light");
  // Named desktop palettes own their scheme; mobile owns its palette.
  const scheme = applyDesktopSkin(skin) ?? next;
  if (nativeGlassReady) syncNativeGlass(scheme);
  window.dispatchEvent(
    new CustomEvent<ColorScheme>(SCHEME_CHANGE_EVENT, { detail: scheme }),
  );
  const backgroundPath = loadChatBackgroundPath();
  if (
    backgroundPath &&
    document.documentElement.classList.contains("has-chat-background")
  ) {
    renderChatBackground(backgroundPath);
  }
  return scheme;
}

/** The page colour the native window sits behind while glass is off. */
function opaqueWindowBackground(): Rgb {
  const root = document.documentElement;
  // A skin paints `--color-app`; match it so resizing never flashes the tint.
  const skin = root.dataset.skin;
  if (isDesktopSkinId(skin)) {
    const hex = DESKTOP_SKIN_INFO[skin].app;
    return {
      r: Number.parseInt(hex.slice(1, 3), 16),
      g: Number.parseInt(hex.slice(3, 5), 16),
      b: Number.parseInt(hex.slice(5, 7), 16),
    };
  }
  const style = getComputedStyle(root);
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return hslToRgb(
    read("--theme-hue", THEME_HUE_DEFAULT),
    read("--theme-saturation", THEME_SATURATION_DEFAULT),
    read("--background-lightness", THEME_DARK_LIGHTNESS_DEFAULT),
  );
}

/**
 * `has-native-glass` follows the window, not the platform: Linux can turn glass
 * off in dark mode too. Whichever side moves second has to wait for the other,
 * or one of them shows through the gap - so entering glass settles the window
 * first, and leaving it fades the page first. A call that a newer one has
 * overtaken is dropped rather than left to settle last.
 */
/** Linux opts into a transparent window via Main pane glass or Window opacity. */
function nativeGlassEnabled(scheme: ColorScheme) {
  return (
    scheme === "dark" &&
    (!IS_LINUX || loadBodyGlass() || appliedWindowOpacity < WINDOW_OPACITY_MAX)
  );
}

export function syncNativeGlass(scheme: ColorScheme) {
  const enabled = nativeGlassEnabled(scheme);
  const background = opaqueWindowBackground();
  const request = JSON.stringify([enabled, background]);
  // Unrelated preference saves replay appearance; resetting the native window
  // background repaints the whole window even when nothing changed.
  const root = document.documentElement;
  if (
    request === appliedGlassRequest &&
    glassFadeMotion === undefined &&
    root.classList.contains("has-native-glass") === enabled
  )
    return;
  appliedGlassRequest = request;
  const generation = ++glassSyncGeneration;
  const setWindow = () =>
    invoke("set_window_glass_enabled", { enabled, background }).catch(() => {});

  if (glassFadeMotion !== undefined) {
    glassFadeMotion.stop();
    glassFadeMotion = undefined;
  }

  if (enabled) {
    void setWindow().finally(() => {
      if (generation === glassSyncGeneration) {
        root.classList.add("has-native-glass");
      }
    });
    return;
  }

  root.classList.remove("has-native-glass");
  glassFadeMotion = animate(0, 1, {
    ...(prefersReducedMotion() ? immediateTransition : panelTransition),
    onComplete: () => { glassFadeMotion = undefined; if (generation === glassSyncGeneration) void setWindow(); },
  });
}

/** Applies native transparency once the opaque launch cover can be removed. */
export function activateWindowAppearance() {
  nativeGlassReady = true;
  syncNativeGlass(isLightScheme() ? "light" : "dark");
}

/** Keeps the "system" preference in sync when the OS flips appearance. */
let watchingSystemScheme = false;
export function watchSystemColorScheme() {
  if (watchingSystemScheme) return;
  const query = systemQuery();
  if (!query) return;
  watchingSystemScheme = true;
  window.addEventListener("storage", (event) => {
    if (isDesktopDocument() && (event.key === DESKTOP_SCHEME_KEY || event.key === DESKTOP_SKIN_KEY || event.key === null))
      applyThemePreference(loadThemePreference());
  });
  query.addEventListener("change", () => {
    const preference = loadThemePreference();
    if (preference === "system") applyThemePreference(preference);
  });
}

export function loadSidebarOpacity(): number {
  return clamp(
    readNumber(OPACITY_KEY) ?? SIDEBAR_OPACITY_DEFAULT,
    SIDEBAR_OPACITY_MIN,
    SIDEBAR_OPACITY_MAX,
  );
}

export function saveSidebarOpacity(value: number) {
  writeNumber(
    OPACITY_KEY,
    clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX),
  );
}

export function applySidebarOpacity(value: number) {
  const next = clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX);
  document.documentElement.style.setProperty("--sidebar-opacity", String(next));
  return next;
}

export function loadPopoverOpacity(): number {
  return clamp(
    readNumber(POPOVER_OPACITY_KEY) ?? POPOVER_OPACITY_DEFAULT,
    POPOVER_OPACITY_MIN,
    POPOVER_OPACITY_MAX,
  );
}

export function savePopoverOpacity(value: number) {
  writeNumber(
    POPOVER_OPACITY_KEY,
    clamp(value, POPOVER_OPACITY_MIN, POPOVER_OPACITY_MAX),
  );
}

export function applyPopoverOpacity(value: number) {
  const next = clamp(value, POPOVER_OPACITY_MIN, POPOVER_OPACITY_MAX);
  document.documentElement.style.setProperty(
    "--popover-opacity",
    String(next),
  );
  return next;
}

export function loadWindowOpacity(): number {
  return clamp(
    readNumber(WINDOW_OPACITY_KEY) ?? WINDOW_OPACITY_DEFAULT,
    WINDOW_OPACITY_MIN,
    WINDOW_OPACITY_MAX,
  );
}

export function saveWindowOpacity(value: number) {
  writeNumber(
    WINDOW_OPACITY_KEY,
    clamp(value, WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX),
  );
}

/**
 * The Linux glass decision follows the applied value, so a slider preview can
 * open the window before it is saved; the window is only touched when it flips.
 */
export function applyWindowOpacity(value: number) {
  const next = clamp(value, WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX);
  const wasTranslucent = appliedWindowOpacity < WINDOW_OPACITY_MAX;
  appliedWindowOpacity = next;
  document.documentElement.style.setProperty("--window-opacity", String(next));
  if (
    IS_LINUX &&
    nativeGlassReady &&
    wasTranslucent !== next < WINDOW_OPACITY_MAX
  ) {
    syncNativeGlass(isLightScheme() ? "light" : "dark");
  }
  return next;
}

export function loadPanelOpacity(): number {
  return clamp(
    readNumber(PANEL_OPACITY_KEY) ?? PANEL_OPACITY_DEFAULT,
    PANEL_OPACITY_MIN,
    PANEL_OPACITY_MAX,
  );
}

export function savePanelOpacity(value: number) {
  writeNumber(
    PANEL_OPACITY_KEY,
    clamp(value, PANEL_OPACITY_MIN, PANEL_OPACITY_MAX),
  );
}

/** Translucent panels also blur what is behind them so their text stays legible. */
export function applyPanelOpacity(value: number) {
  const next = clamp(value, PANEL_OPACITY_MIN, PANEL_OPACITY_MAX);
  const root = document.documentElement;
  root.style.setProperty("--panel-opacity", String(next));
  root.classList.toggle("translucent-panels", next < PANEL_OPACITY_MAX);
  return next;
}

export function loadSidebarBlur(): number {
  return Math.round(
    clamp(
      readNumber(BLUR_KEY) ?? SIDEBAR_BLUR_DEFAULT,
      SIDEBAR_BLUR_MIN,
      SIDEBAR_BLUR_MAX,
    ),
  );
}

export function saveSidebarBlur(value: number) {
  writeNumber(
    BLUR_KEY,
    Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX)),
  );
}

export function applySidebarBlur(value: number) {
  const next = Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX));
  if (next === appliedSidebarBlur) return next;
  appliedSidebarBlur = next;
  void invoke("set_window_background_blur", { radius: next });
  return next;
}

export function loadBodyGlass(): boolean {
  return readFlag(BODY_KEY) ?? BODY_GLASS_DEFAULT;
}

export function saveBodyGlass(value: boolean) {
  writeFlag(BODY_KEY, value);
}

export function applyBodyGlass(value: boolean) {
  document.documentElement.classList.toggle("glass-body", value);
  return value;
}

export function loadCompactSidebar(): boolean {
  return readFlag(COMPACT_SIDEBAR_KEY) ?? COMPACT_SIDEBAR_DEFAULT;
}

export function saveCompactSidebar(value: boolean) {
  writeFlag(COMPACT_SIDEBAR_KEY, value);
}

export function applyCompactSidebar(value: boolean) {
  document.documentElement.classList.toggle("compact-sidebar", value);
  return value;
}

export function loadIndentSidebarSessions(): boolean {
  return readFlag(INDENT_SIDEBAR_SESSIONS_KEY) ?? INDENT_SIDEBAR_SESSIONS_DEFAULT;
}

export function saveIndentSidebarSessions(value: boolean) {
  writeFlag(INDENT_SIDEBAR_SESSIONS_KEY, value);
}

export function applyIndentSidebarSessions(value: boolean) {
  document.documentElement.classList.toggle("flat-sidebar-sessions", !value);
  return value;
}

export function loadChatBackgroundPath(): string | null {
  try {
    return preferenceStorage.getItem(activePreferenceStore() ? "omnicode.chatBackgroundAsset" : CHAT_BACKGROUND_PATH_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveChatBackgroundPath(value: string | null) {
  try {
    const key = activePreferenceStore() ? "omnicode.chatBackgroundAsset" : CHAT_BACKGROUND_PATH_KEY;
    if (value) {
      if (activePreferenceStore() && !parsePreferenceAsset(value)) throw new Error("Upload the background to its Host before saving.");
      preferenceStorage.setItem(key, value);
    } else preferenceStorage.removeItem(key);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
}

export function subscribeChatBackgroundPath(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHAT_BACKGROUND_PATH_CHANGE_EVENT, onStoreChange);
  window.addEventListener(SHARED_PREFERENCES_CHANGED, onStoreChange);
  return () => {
    window.removeEventListener(
      CHAT_BACKGROUND_PATH_CHANGE_EVENT,
      onStoreChange,
    );
    window.removeEventListener(SHARED_PREFERENCES_CHANGED, onStoreChange);
  };
}

let appliedBackgroundPath: string | null = null;
/**
 * Every shared-preference change replays this, so an unchanged path keeps its
 * revision and rendered image; only a new path or `reload` (the same file
 * replaced) fetches and re-renders it, which would otherwise flash the image.
 */
export function applyChatBackground(
  path: string | null,
  { reload = false }: { reload?: boolean } = {},
) {
  const root = document.documentElement;
  root.classList.toggle("has-chat-background", !!path);
  const changed = path !== appliedBackgroundPath;
  if (changed) clearPreparedNewThreadBackground();
  appliedBackgroundPath = path;
  if (!path) {
    clearPreparedNewThreadBackground();
    return null;
  }
  if (changed || reload) chatBackgroundRevision += 1;
  renderChatBackground(path);
  return path;
}

export function chatBackgroundSrc(path: string | null): string | null {
  if (!path) return null;
  if (parsePreferenceAsset(path)) return preferenceAssetUrl(path) ?? null;
  return `${convertFileSrc(path)}?v=${chatBackgroundRevision}`;
}

function isNewThreadBackgroundEffect(
  value: unknown,
): value is NewThreadBackgroundEffect {
  return NEW_THREAD_BACKGROUND_EFFECTS.includes(
    value as NewThreadBackgroundEffect,
  );
}

export function loadNewThreadBackgroundEffect(): NewThreadBackgroundEffect {
  try {
    const raw = preferenceStorage.getItem(NEW_THREAD_BACKGROUND_EFFECT_KEY);
    return isNewThreadBackgroundEffect(raw)
      ? raw
      : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;
  } catch {
    return NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;
  }
}

export function saveNewThreadBackgroundEffect(
  effect: NewThreadBackgroundEffect,
) {
  try {
    preferenceStorage.setItem(NEW_THREAD_BACKGROUND_EFFECT_KEY, effect);
  } catch {
    // private mode / quota
  }
}

function renderChatBackground(
  path: string,
  effect = loadNewThreadBackgroundEffect(),
) {
  const src = chatBackgroundSrc(path);
  if (!src) return;
  void applyPreparedNewThreadBackground(
    `${path}?v=${chatBackgroundRevision}`,
    src,
    effect,
    isLightScheme(),
  );
}

export function applyNewThreadBackgroundEffect(
  effect: NewThreadBackgroundEffect,
) {
  const path = loadChatBackgroundPath();
  if (path) renderChatBackground(path, effect);
  return effect;
}

export function setNewThreadBackgroundEffect(
  effect: NewThreadBackgroundEffect,
) {
  saveNewThreadBackgroundEffect(effect);
  applyNewThreadBackgroundEffect(effect);
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
}

export function loadChatBackgroundOpacity(): number {
  // Prefer the previous conversation setting when merging split visibility.
  // Saving the unified value removes those legacy keys.
  return clamp(
    readNumber(LEGACY_CHAT_BACKGROUND_SESSION_OPACITY_KEY) ??
      readNumber(LEGACY_CHAT_BACKGROUND_EMPTY_OPACITY_KEY) ??
      readNumber(CHAT_BACKGROUND_OPACITY_KEY) ??
      CHAT_BACKGROUND_OPACITY_DEFAULT,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
}

export function saveChatBackgroundOpacity(value: number) {
  const next = clamp(
    value,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
  writeNumber(CHAT_BACKGROUND_OPACITY_KEY, next);
  try {
    preferenceStorage.removeItem(LEGACY_CHAT_BACKGROUND_EMPTY_OPACITY_KEY);
    preferenceStorage.removeItem(LEGACY_CHAT_BACKGROUND_SESSION_OPACITY_KEY);
    preferenceStorage.removeItem("omnicode.chatBackgroundScope");
  } catch {
    // private mode / quota
  }
}

export function applyChatBackgroundOpacity(value: number) {
  const next = clamp(
    value,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
  document.documentElement.style.setProperty(
    "--chat-background-opacity",
    String(next),
  );
  return next;
}

function isChatBackgroundArea(value: unknown): value is ChatBackgroundArea {
  return value === "chat" || value === "window";
}

export function loadChatBackgroundArea(): ChatBackgroundArea {
  try {
    const raw = preferenceStorage.getItem(CHAT_BACKGROUND_AREA_KEY);
    return isChatBackgroundArea(raw) ? raw : CHAT_BACKGROUND_AREA_DEFAULT;
  } catch {
    return CHAT_BACKGROUND_AREA_DEFAULT;
  }
}

export function saveChatBackgroundArea(value: ChatBackgroundArea) {
  try {
    preferenceStorage.setItem(CHAT_BACKGROUND_AREA_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function applyChatBackgroundArea(value: ChatBackgroundArea) {
  document.documentElement.classList.toggle(
    "chat-background-window",
    value === "window",
  );
  return value;
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return (
    value === "files" ||
    value === "sessions" ||
    value === "changes"
  );
}

export function loadProjectRailOpen(): boolean {
  return readFlag(PROJECT_RAIL_OPEN_KEY) ?? true;
}

export function saveProjectRailOpen(value: boolean) {
  writeFlag(PROJECT_RAIL_OPEN_KEY, value);
}

export function loadSessionSidebarOpen(): boolean {
  return readFlag(SESSION_SIDEBAR_OPEN_KEY) ?? true;
}

export function saveSessionSidebarOpen(value: boolean) {
  writeFlag(SESSION_SIDEBAR_OPEN_KEY, value);
}

export function loadSidebarTabOrder(): SidebarTabId[] {
  try {
    const raw = preferenceStorage.getItem(SIDEBAR_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const next = parsed.filter(isSidebarTabId);
    for (const id of DEFAULT_SIDEBAR_TAB_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next.length === DEFAULT_SIDEBAR_TAB_ORDER.length
      ? next
      : [...DEFAULT_SIDEBAR_TAB_ORDER];
  } catch {
    return [...DEFAULT_SIDEBAR_TAB_ORDER];
  }
}

export function saveSidebarTabOrder(order: SidebarTabId[]) {
  try {
    preferenceStorage.setItem(SIDEBAR_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

export function loadSidebarWidth(): number {
  return Math.round(
    clamp(
      readNumber(SIDEBAR_WIDTH_KEY) ?? SIDEBAR_WIDTH_DEFAULT,
      SIDEBAR_WIDTH_MIN,
      SIDEBAR_WIDTH_MAX,
    ),
  );
}

export function saveSidebarWidth(value: number) {
  writeNumber(
    SIDEBAR_WIDTH_KEY,
    Math.round(clamp(value, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)),
  );
}

function isTranscriptLayout(value: unknown): value is TranscriptLayout {
  return value === "full" || value === "chat";
}

export function loadTranscriptLayout(): TranscriptLayout {
  try {
    const raw = preferenceStorage.getItem(TRANSCRIPT_LAYOUT_KEY);
    return isTranscriptLayout(raw) ? raw : TRANSCRIPT_LAYOUT_DEFAULT;
  } catch {
    return TRANSCRIPT_LAYOUT_DEFAULT;
  }
}

export function saveTranscriptLayout(value: TranscriptLayout) {
  const next = isTranscriptLayout(value) ? value : TRANSCRIPT_LAYOUT_DEFAULT;
  try {
    preferenceStorage.setItem(TRANSCRIPT_LAYOUT_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranscriptLayout>(TRANSCRIPT_LAYOUT_CHANGE_EVENT, {
      detail: next,
    }),
  );
}

function isChangesView(value: unknown): value is ChangesView {
  return value === "list" || value === "tree";
}

export function loadChangesView(): ChangesView {
  try {
    const raw = preferenceStorage.getItem(CHANGES_VIEW_KEY);
    return isChangesView(raw) ? raw : CHANGES_VIEW_DEFAULT;
  } catch {
    return CHANGES_VIEW_DEFAULT;
  }
}

export function saveChangesView(value: ChangesView) {
  try {
    preferenceStorage.setItem(CHANGES_VIEW_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function loadTranscriptAnchor(): boolean {
  return readFlag(TRANSCRIPT_ANCHOR_KEY) ?? TRANSCRIPT_ANCHOR_DEFAULT;
}

export function saveTranscriptAnchor(value: boolean) {
  writeFlag(TRANSCRIPT_ANCHOR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ANCHOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function loadShowExcludedFiles(): boolean {
  return readFlag(SHOW_EXCLUDED_FILES_KEY) ?? SHOW_EXCLUDED_FILES_DEFAULT;
}

export function saveShowExcludedFiles(value: boolean) {
  writeFlag(SHOW_EXCLUDED_FILES_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(SHOW_EXCLUDED_FILES_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeShowExcludedFiles(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SHOW_EXCLUDED_FILES_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(SHOW_EXCLUDED_FILES_CHANGE_EVENT, onStoreChange);
}

if (typeof window !== "undefined") window.addEventListener(PREFERENCE_ASSET_READY, () => {
  applyChatBackground(loadChatBackgroundPath());
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
});
