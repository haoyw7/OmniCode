import { devicePreferences } from "../lib/persistedPreferences";

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
  return migrateDesktopTheme(devicePreferences, fallback, LEGACY_SKIN_SCHEMES);
}

/** Also serialized into the pre-paint script; keep this function self-contained. */
export function migrateDesktopTheme(
  storage: Pick<Storage, "getItem" | "setItem">,
  fallback: DesktopThemePreference,
  skinSchemes: Record<string, "light" | "dark">,
): DesktopThemePreference {
  const schemeKey = "omnicode.desktopColorScheme";
  const backupKey = "omnicode.desktopAppearanceBackup.v1";
  let next = fallback;
  try {
    const saved = storage.getItem(schemeKey);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    // A corrupt new value must not replay an old skin migration.
    if (saved !== null) return "dark";
    const skin = storage.getItem("omnicode.desktopSkin");
    next = skin && Object.hasOwn(skinSchemes, skin)
      ? skinSchemes[skin]
      : skin && skin !== "auto" && skin !== "classic" ? "dark" : fallback;
    if (!storage.getItem(backupKey)) {
      const keys = ["desktopSkin", "colorScheme", "themeHue", "themeSaturation", "themeDarkLightness", "accentColor", "typographyProfile", "appearanceProfile.light", "appearanceProfile.dark"];
      storage.setItem(backupKey, JSON.stringify(Object.fromEntries(
        keys.map(key => [key, storage.getItem(`omnicode.${key}`)]),
      )));
    }
    storage.setItem(schemeKey, next);
  } catch {
    // A blocked/quota-limited store still gets the resolved appearance this run.
  }
  return next;
}
