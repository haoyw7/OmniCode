export type ThemePreference = "light" | "dark" | "system";
export type ColorScheme = "light" | "dark";

export const DESKTOP_THEME_STORAGE_KEY = "omnicode.desktopColorScheme";
// A local mirror of the Host preference; next-themes must never write the Host journal.
export const MOBILE_THEME_STORAGE_KEY = "omnicode.mobile.colorScheme";
export const themeConfig = {
  attribute: "class",
  value: { light: "theme-light", dark: "theme-dark" },
  enableSystem: true,
  defaultTheme: "dark",
} as const;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}
