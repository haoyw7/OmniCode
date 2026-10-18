import { preferenceStorage } from "./sharedPreferences";
import {
  applyReducedMotion,
  type ReducedMotionPreference,
} from "../../../shared/lib/reducedMotion";
import {
  applyAccentColor,
  applyThemeTint,
  isLightScheme,
  loadAccentColor,
  loadThemeHue,
  loadThemeSaturation,
  saveAccentColor,
  saveThemeHue,
  saveThemeSaturation,
  SCHEME_CHANGE_EVENT,
  THEME_HUE_DEFAULT,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_DEFAULT,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  ACCENT_COLOR_DEFAULT,
  type ColorScheme,
} from "./appearance";
import { readFlag, writeFlag } from "./storageFlags";
import { isHexColor } from "../../../shared/lib/colorUtils";

export type { ReducedMotionPreference };

export type FontSizeKind = "ui" | "content" | "code";
export type FontWeight = 400 | 500 | 600 | 700;
/** `shared` applies to both modes; `light`/`dark` once they are separate. */
export type AppearanceScope = "shared" | ColorScheme;

/** Per-mode look. Font sizes and reduced motion are always shared. */
export interface AppearanceProfile {
  accentColor: string | null;
  hue: number;
  saturation: number;
  contrast: number;
  /** Font family name; empty uses the shared interface font. */
  uiFont: string;
  uiWeight: FontWeight;
  /** Font family name; empty follows the interface font. */
  contentFont: string;
  contentWeight: FontWeight;
  /** Empty uses the bundled JetBrains Mono code font. */
  codeFont: string;
  codeWeight: FontWeight;
}

export const FONT_SIZE_LIMITS: Record<
  FontSizeKind,
  { min: number; max: number; default: number; base: number }
> = {
  ui: { min: 12, max: 20, default: 14, base: 14 },
  content: { min: 12, max: 20, default: 14, base: 14 },
  code: { min: 10, max: 20, default: 12, base: 12 },
};

export const FONT_WEIGHTS: readonly FontWeight[] = [400, 500, 600, 700];
export const FONT_WEIGHT_LABELS: Record<FontWeight, string> = {
  400: "Regular",
  500: "Medium weight",
  600: "Semibold",
  700: "Bold",
};

export interface SystemFonts {
  all: string[];
  /** Fixed-pitch families, offered for the code font. */
  monospace: string[];
}

let systemFontsRequest: Promise<SystemFonts> | null = null;

/** Installed font families from the desktop backend; presets elsewhere. */
export function loadSystemFonts(): Promise<SystemFonts> {
  systemFontsRequest ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<SystemFonts>("list_system_fonts"))
    .then((fonts) => ({
      all: Array.isArray(fonts?.all) ? fonts.all : [],
      monospace: Array.isArray(fonts?.monospace) ? fonts.monospace : [],
    }))
    .catch(() => {
      systemFontsRequest = null;
      return { all: [], monospace: [] };
    });
  return systemFontsRequest;
}

export const CONTENT_FONT_PRESETS = [
  "Inter",
  "PingFang SC",
  "Microsoft YaHei UI",
  "Noto Sans SC",
  "Segoe UI",
  "Helvetica Neue",
] as const;

export const CODE_FONT_PRESETS = [
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Cascadia Code",
  "Consolas",
  "Menlo",
] as const;

export const CONTRAST_MIN = 0;
export const CONTRAST_MAX = 100;
/** Matches the stock theme tokens exactly. */
export const CONTRAST_DEFAULT = 50;
export const REDUCED_MOTION_DEFAULT: ReducedMotionPreference = "system";
export const SEPARATE_SCHEMES_DEFAULT = false;

export const DEFAULT_PROFILE: AppearanceProfile = {
  accentColor: ACCENT_COLOR_DEFAULT,
  hue: THEME_HUE_DEFAULT,
  saturation: THEME_SATURATION_DEFAULT,
  contrast: CONTRAST_DEFAULT,
  uiFont: "",
  uiWeight: 400,
  contentFont: "",
  contentWeight: 400,
  codeFont: "",
  codeWeight: 400,
};

/** Unset preferences use regular weight on both platforms; saved choices win. */
export function defaultAppearanceProfile(): AppearanceProfile {
  return { ...DEFAULT_PROFILE };
}

const FONT_SIZE_KEYS: Record<FontSizeKind, string> = {
  ui: "monocode.uiFontSize",
  content: "monocode.contentFontSize",
  code: "monocode.codeFontSize",
};
const REDUCED_MOTION_KEY = "monocode.reducedMotion";
const SEPARATE_SCHEMES_KEY = "monocode.separateSchemeAppearance";
const PROFILE_KEYS: Record<AppearanceScope, string> = {
  shared: "monocode.typographyProfile",
  light: "monocode.appearanceProfile.light",
  dark: "monocode.appearanceProfile.dark",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readJson(key: string): unknown {
  try {
    const raw = preferenceStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    preferenceStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
}

export function normalizeFontSize(kind: FontSizeKind, value: unknown): number {
  const limits = FONT_SIZE_LIMITS[kind];
  const parsed = typeof value === "number" ? value : Number(value);
  if (value == null || value === "" || !Number.isFinite(parsed))
    return limits.default;
  return Math.round(clamp(parsed, limits.min, limits.max));
}

function normalizeWeight(
  value: unknown,
  fallback: FontWeight = 400,
): FontWeight {
  return FONT_WEIGHTS.includes(value as FontWeight)
    ? (value as FontWeight)
    : fallback;
}

/** Keeps a family name usable inside a quoted CSS string. */
export function normalizeFontFamily(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/["\\;{}<>]/g, "")
        .trim()
        .slice(0, 80)
    : "";
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(clamp(value, min, max))
    : fallback;
}

export function normalizeProfile(value: unknown): AppearanceProfile {
  const defaults = defaultAppearanceProfile();
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    accentColor:
      typeof raw.accentColor === "string" && isHexColor(raw.accentColor)
        ? raw.accentColor.toLowerCase()
        : ACCENT_COLOR_DEFAULT,
    hue: normalizeNumber(
      raw.hue,
      THEME_HUE_DEFAULT,
      THEME_HUE_MIN,
      THEME_HUE_MAX,
    ),
    saturation: normalizeNumber(
      raw.saturation,
      THEME_SATURATION_DEFAULT,
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
    contrast: normalizeNumber(
      raw.contrast,
      CONTRAST_DEFAULT,
      CONTRAST_MIN,
      CONTRAST_MAX,
    ),
    uiFont: normalizeFontFamily(raw.uiFont),
    uiWeight: normalizeWeight(raw.uiWeight, defaults.uiWeight),
    contentFont: normalizeFontFamily(raw.contentFont),
    contentWeight: normalizeWeight(
      raw.contentWeight,
      defaults.contentWeight,
    ),
    codeFont: normalizeFontFamily(raw.codeFont),
    codeWeight: normalizeWeight(raw.codeWeight, defaults.codeWeight),
  };
}

export function loadFontSize(kind: FontSizeKind): number {
  try {
    return normalizeFontSize(kind, preferenceStorage.getItem(FONT_SIZE_KEYS[kind]));
  } catch {
    return FONT_SIZE_LIMITS[kind].default;
  }
}

export function saveFontSize(kind: FontSizeKind, value: number): number {
  const next = normalizeFontSize(kind, value);
  try {
    preferenceStorage.setItem(FONT_SIZE_KEYS[kind], String(next));
  } catch {
    // private mode / quota
  }
  return next;
}

export function applyFontSize(kind: FontSizeKind, value: number) {
  const next = normalizeFontSize(kind, value);
  const scale = next / FONT_SIZE_LIMITS[kind].base;
  document.documentElement.style.setProperty(
    `--${kind}-font-scale`,
    String(Number(scale.toFixed(4))),
  );
  return next;
}

function isReducedMotionPreference(
  value: unknown,
): value is ReducedMotionPreference {
  return value === "system" || value === "on" || value === "off";
}

export function loadReducedMotion(): ReducedMotionPreference {
  try {
    const raw = preferenceStorage.getItem(REDUCED_MOTION_KEY);
    return isReducedMotionPreference(raw) ? raw : REDUCED_MOTION_DEFAULT;
  } catch {
    return REDUCED_MOTION_DEFAULT;
  }
}

export function saveReducedMotion(value: ReducedMotionPreference) {
  try {
    preferenceStorage.setItem(REDUCED_MOTION_KEY, value);
  } catch {
    // private mode / quota
  }
}

export { applyReducedMotion };

export function loadSeparateSchemes(): boolean {
  return readFlag(SEPARATE_SCHEMES_KEY) ?? SEPARATE_SCHEMES_DEFAULT;
}

export function saveSeparateSchemes(value: boolean) {
  writeFlag(SEPARATE_SCHEMES_KEY, value);
}

/**
 * The shared profile keeps accent, hue and saturation in their original keys
 * so existing preferences and the Quick Composer keep working unchanged.
 */
export function loadProfile(scope: AppearanceScope): AppearanceProfile {
  if (scope !== "shared") {
    const stored = readJson(PROFILE_KEYS[scope]);
    return stored == null ? loadProfile("shared") : normalizeProfile(stored);
  }
  return normalizeProfile({
    ...(readJson(PROFILE_KEYS.shared) as object | null),
    accentColor: loadAccentColor(),
    hue: loadThemeHue(),
    saturation: loadThemeSaturation(),
  });
}

export function saveProfile(
  scope: AppearanceScope,
  profile: AppearanceProfile,
) {
  const next = normalizeProfile(profile);
  if (scope === "shared") {
    saveAccentColor(next.accentColor);
    saveThemeHue(next.hue);
    saveThemeSaturation(next.saturation);
    const { accentColor: _a, hue: _h, saturation: _s, ...typography } = next;
    writeJson(PROFILE_KEYS.shared, typography);
  } else {
    writeJson(PROFILE_KEYS[scope], next);
  }
  return next;
}

export function activeScheme(): ColorScheme {
  return isLightScheme() ? "light" : "dark";
}

/** The scope whose profile is on screen right now. */
export function activeScope(): AppearanceScope {
  return loadSeparateSchemes() ? activeScheme() : "shared";
}

/** Copies the shared look into both modes so turning this on changes nothing. */
export function enableSeparateSchemes() {
  const shared = loadProfile("shared");
  for (const scheme of ["light", "dark"] as const) {
    if (readJson(PROFILE_KEYS[scheme]) == null) saveProfile(scheme, shared);
  }
  saveSeparateSchemes(true);
}

function fontStackPrefix(family: string) {
  return family ? `"${family}",` : "";
}

/** Fonts, weights and contrast; colour goes through the appearance helpers. */
export function applyTypographyProfile(profile: AppearanceProfile) {
  const style = document.documentElement.style;
  style.setProperty("--user-ui-font", fontStackPrefix(profile.uiFont));
  style.setProperty(
    "--user-content-font",
    fontStackPrefix(profile.contentFont),
  );
  style.setProperty("--user-code-font", fontStackPrefix(profile.codeFont));
  style.setProperty("--ui-font-weight", String(profile.uiWeight));
  style.setProperty("--content-font-weight", String(profile.contentWeight));
  style.setProperty("--code-font-weight", String(profile.codeWeight));
  style.setProperty(
    "--contrast-offset",
    String(
      (profile.contrast - CONTRAST_DEFAULT) / (CONTRAST_MAX - CONTRAST_DEFAULT),
    ),
  );
}

export function applyProfile(profile: AppearanceProfile) {
  applyAccentColor(profile.accentColor);
  applyThemeTint(profile.hue, profile.saturation);
  applyTypographyProfile(profile);
}

let schemeListener: (() => void) | null = null;

/** Applies stored sizes, motion and the active profile; follows mode changes. */
export function initTypography() {
  for (const kind of Object.keys(FONT_SIZE_KEYS) as FontSizeKind[])
    applyFontSize(kind, loadFontSize(kind));
  applyReducedMotion(loadReducedMotion());
  applyProfile(loadProfile(activeScope()));
  if (schemeListener) return;
  schemeListener = () => {
    if (loadSeparateSchemes()) applyProfile(loadProfile(activeScheme()));
  };
  window.addEventListener(SCHEME_CHANGE_EVENT, schemeListener);
}
