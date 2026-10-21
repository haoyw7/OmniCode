import { preferenceStorage } from "../../features/settings/model/sharedPreferences";

export type DesktopThemePreference = "light" | "dark" | "system";
export const DESKTOP_SCHEME_KEY = "omnicode.desktopColorScheme";
export const DESKTOP_APPEARANCE_BACKUP_KEY = "omnicode.desktopAppearanceBackup.v1";

/** Scheme migration for stored named skins. Keep old values intact. */
export const LEGACY_SKIN_SCHEMES: Record<string, "light" | "dark"> = {
  ripple: "dark", midnight: "dark", atelier: "light", foundry: "dark", lagoon: "light",
  graphite: "dark", linen: "light", dusk: "dark", black: "dark", daylight: "light", meadow: "light",
};

export function isDesktopDocument() {
  return typeof document !== "undefined" && document.documentElement.dataset.mobileSkin === undefined;
}

export function isThemePreference(value: unknown): value is DesktopThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Local-only, idempotent migration. Never writes the shared/mobile colorScheme. */
export function loadDesktopTheme(fallback: DesktopThemePreference): DesktopThemePreference {
  let next = fallback;
  try {
    const saved = preferenceStorage.getItem(DESKTOP_SCHEME_KEY);
    if (isThemePreference(saved)) return saved;
    // A corrupt new value must not replay an old skin migration.
    if (saved !== null) return "dark";
    const skin = preferenceStorage.getItem("omnicode.desktopSkin");
    next = skin && Object.hasOwn(LEGACY_SKIN_SCHEMES, skin)
      ? LEGACY_SKIN_SCHEMES[skin]
      : skin && skin !== "auto" && skin !== "classic" ? "dark" : fallback;
    if (!preferenceStorage.getItem(DESKTOP_APPEARANCE_BACKUP_KEY)) {
      const keys = ["desktopSkin", "colorScheme", "themeHue", "themeSaturation", "themeDarkLightness", "accentColor", "typographyProfile", "appearanceProfile.light", "appearanceProfile.dark"];
      preferenceStorage.setItem(DESKTOP_APPEARANCE_BACKUP_KEY, JSON.stringify(Object.fromEntries(
        keys.map(key => [key, preferenceStorage.getItem(`omnicode.${key}`)]),
      )));
    }
    preferenceStorage.setItem(DESKTOP_SCHEME_KEY, next);
  } catch {
    // A blocked/quota-limited store still gets the resolved appearance this run.
  }
  return next;
}
