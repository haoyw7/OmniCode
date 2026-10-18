import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import {
  applyThemePreference,
  type ThemePreference,
} from "../../features/settings/model/appearance";

/** Order matches the Settings picker: dark skins, then light ones. */
export const MOBILE_SKINS = [
  "midnight",
  "foundry",
  "graphite",
  "dusk",
  "daylight",
  "atelier",
  "lagoon",
  "linen",
  "meadow",
] as const;

export type MobileSkin = (typeof MOBILE_SKINS)[number];
/**
 * `auto` follows Settings → Color mode: Dark → Midnight, Light → Daylight,
 * System → whichever of the two matches the device. It is the default, so a
 * stored theme preference carries over without rewriting it.
 */
export type MobileSkinPreference = MobileSkin | "auto";

export const MOBILE_SKIN_KEY = "monocode.mobile.skin";
export const MOBILE_SKIN_DEFAULT: MobileSkinPreference = "auto";

type SkinInfo = {
  /** Application-owned name; translated through the i18n catalog. */
  label: string;
  scheme: "dark" | "light";
  /** The skin's app ground, for the browser chrome and launch background. */
  app: string;
};

export const MOBILE_SKIN_INFO: Record<MobileSkin, SkinInfo> = {
  midnight: { label: "Midnight", scheme: "dark", app: "#262624" },
  foundry: { label: "Foundry", scheme: "dark", app: "#100e0b" },
  graphite: { label: "Graphite", scheme: "dark", app: "#111214" },
  dusk: { label: "Dusk", scheme: "dark", app: "#121014" },
  daylight: { label: "Daylight", scheme: "light", app: "#f9f9f7" },
  atelier: { label: "Atelier", scheme: "light", app: "#f5f1eb" },
  lagoon: { label: "Lagoon", scheme: "light", app: "#dfeceb" },
  linen: { label: "Linen", scheme: "light", app: "#eceff3" },
  meadow: { label: "Meadow", scheme: "light", app: "#ffffff" },
};

export function isMobileSkin(value: unknown): value is MobileSkin {
  return (MOBILE_SKINS as readonly unknown[]).includes(value);
}

export function normalizeMobileSkin(value: unknown): MobileSkinPreference {
  return value === "auto" || isMobileSkin(value) ? value : MOBILE_SKIN_DEFAULT;
}

export function loadMobileSkin(): MobileSkinPreference {
  try {
    return normalizeMobileSkin(localStorage.getItem(MOBILE_SKIN_KEY));
  } catch {
    return MOBILE_SKIN_DEFAULT;
  }
}

export function saveMobileSkin(value: MobileSkinPreference) {
  try {
    localStorage.setItem(MOBILE_SKIN_KEY, normalizeMobileSkin(value));
  } catch {
    // Storage can be unavailable; the skin still applies for this run.
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  } catch {
    return false;
  }
}

export function resolveMobileSkin(
  preference: MobileSkinPreference,
  theme: ThemePreference,
  systemLight = systemPrefersLight(),
): MobileSkin {
  if (preference !== "auto") return preference;
  const light = theme === "light" || (theme === "system" && systemLight);
  return light ? "daylight" : "midnight";
}

/**
 * Applies a skin to the whole document: tokens (skins.css), the desktop
 * theme class shared renderers read, the browser theme color and the native
 * status bar icons. Returns the resolved skin.
 */
export function applyMobileSkin(
  preference: MobileSkinPreference,
  theme: ThemePreference,
  systemLight?: boolean,
): MobileSkin {
  const skin = resolveMobileSkin(preference, theme, systemLight);
  const info = MOBILE_SKIN_INFO[skin];
  const root = document.documentElement;
  root.dataset.mobileSkin = skin;
  applyThemePreference(info.scheme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", info.app);
  if (Capacitor.isNativePlatform())
    void StatusBar.setStyle({
      style: info.scheme === "light" ? Style.Light : Style.Dark,
    }).catch(() => {});
  return skin;
}
