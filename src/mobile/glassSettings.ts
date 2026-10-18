import { activePreferenceStore, preferenceStorage } from "../features/settings/model/sharedPreferences";

/** Material for floating controls, sheets, drawers and popovers. */
export type GlassEffect = "frosted" | "solid";

export interface GlassSettings {
  effect: GlassEffect;
  /** 0–100: blur and saturation of the backdrop. */
  intensity: number;
  /** 0–100: how much of the background shows through. */
  transparency: number;
}

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  effect: "frosted",
  intensity: 50,
  transparency: 22,
};

export const GLASS_SETTINGS_KEY = "monocode.mobileGlass";

const EFFECTS: readonly GlassEffect[] = ["frosted", "solid"];

function percent(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : fallback;
}

export function normalizeGlassSettings(value: unknown): GlassSettings {
  const input =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof GlassSettings, unknown>>)
      : {};
  return {
    // Liquid glass was retired with the skins; its users keep a frosted material.
    effect: EFFECTS.includes(input.effect as GlassEffect)
      ? (input.effect as GlassEffect)
      : input.effect === "liquid" ? "frosted" : DEFAULT_GLASS_SETTINGS.effect,
    intensity: percent(input.intensity, DEFAULT_GLASS_SETTINGS.intensity),
    transparency: percent(
      input.transparency,
      DEFAULT_GLASS_SETTINGS.transparency,
    ),
  };
}

export function readGlassSettings(): GlassSettings {
  try {
    return normalizeGlassSettings(
      JSON.parse(preferenceStorage.getItem(GLASS_SETTINGS_KEY)
        ?? (activePreferenceStore() ? null : localStorage.getItem("monocode-mobile-glass")) ?? "null"),
    );
  } catch {
    return DEFAULT_GLASS_SETTINGS;
  }
}

export function saveGlassSettings(settings: GlassSettings) {
  try {
    preferenceStorage.setItem(GLASS_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable; the material still applies for this run.
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * CSS variables for a setting. Floating controls use the chosen fill; panels
 * full of text (sheets, drawer, popovers) close part of the remaining fill so
 * lists stay readable at the same setting.
 */
export function glassVariables(settings: GlassSettings) {
  const k = settings.intensity / 100;
  const solid = settings.effect === "solid";
  const fill = solid ? 100 : 100 - settings.transparency;
  const panelFill = solid ? 100 : fill + (100 - fill) * 0.45;
  return {
    "--m-material-fill": `${round(fill)}%`,
    "--m-material-panel-fill": `${round(panelFill)}%`,
    "--m-material-blur": `${round(solid ? 0 : 4 + 32 * k)}px`,
    "--m-material-saturate": `${round(solid ? 100 : 100 + 80 * k)}%`,
  };
}

export function applyGlassSettings(
  settings: GlassSettings,
  root: HTMLElement = document.documentElement,
) {
  root.dataset.mobileGlass = settings.effect;
  for (const [name, value] of Object.entries(glassVariables(settings)))
    root.style.setProperty(name, value);
}
