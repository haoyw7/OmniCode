import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { bindThemeSetter } from "../../../shared/theme/themeBridge";
import { themeConfig, type ColorScheme } from "../../../shared/theme/themeConfig";
import { applyThemePreference, loadThemePreference, onColorSchemeApplied } from "./appearance";
import { devicePreferences } from "../../../shared/lib/persistedPreferences";
import { DESKTOP_SKIN_KEY } from "../../../shared/theme/desktopSkin";

const syncDesktopTheme = () => applyThemePreference(loadThemePreference());

/** The caller owns skin selection; next-themes owns classes, storage and OS changes. */
export function AppearanceThemeProvider({ children, storageKey, syncPreference = syncDesktopTheme, applySkin, skinStorageKey = DESKTOP_SKIN_KEY }: {
  children: ReactNode;
  storageKey: string;
  syncPreference?: () => void;
  applySkin?: (scheme: ColorScheme) => void;
  skinStorageKey?: string;
}) {
  const [initial] = useState(loadThemePreference);
  const [forcedTheme, setForcedTheme] = useState<ColorScheme>();
  return (
    <ThemeProvider {...themeConfig} storageKey={storageKey} defaultTheme={initial} forcedTheme={forcedTheme}>
      <ThemeEffects setForcedTheme={setForcedTheme} syncPreference={syncPreference} applySkin={applySkin} skinStorageKey={skinStorageKey} />
      {children}
    </ThemeProvider>
  );
}

function ThemeEffects({ setForcedTheme, syncPreference, applySkin, skinStorageKey }: {
  setForcedTheme: (scheme: ColorScheme | undefined) => void;
  syncPreference: () => void;
  applySkin?: (scheme: ColorScheme) => void;
  skinStorageKey: string;
}) {
  const { setTheme, resolvedTheme, forcedTheme } = useTheme();
  const [revision, setRevision] = useState(0);
  const setter = useCallback((request: { preference: "light" | "dark" | "system"; forcedTheme?: ColorScheme }) => {
    setForcedTheme(request.forcedTheme);
    setTheme(request.preference);
    setRevision(value => value + 1);
  }, [setTheme, setForcedTheme]);
  useLayoutEffect(() => bindThemeSetter(setter), [setter]);
  useLayoutEffect(() => {
    syncPreference();
    return devicePreferences.subscribe([skinStorageKey], syncPreference);
  }, [syncPreference, skinStorageKey]);
  const scheme = forcedTheme ?? resolvedTheme;
  useEffect(() => {
    if (scheme !== "light" && scheme !== "dark") return;
    // next-themes applies its DOM class in its parent effect. Run palette/native
    // consumers after that effect, including when the OS or another window changes.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      applySkin?.(scheme);
      onColorSchemeApplied(scheme);
    });
    return () => { active = false; };
  }, [scheme, revision, applySkin]);
  return null;
}
