import { useEffect, useState } from "react";
import {
  loadThemePreference,
  resolveColorScheme,
  SCHEME_CHANGE_EVENT,
  type ColorScheme,
} from "../../features/settings/model/appearance";

function currentColorScheme(): ColorScheme {
  // Desktop and mobile skins override the stored light/dark preference. A viewer
  // mounted after the scheme event must start with that already-applied skin.
  if (
    typeof document !== "undefined" &&
    (document.documentElement.dataset.skin || document.documentElement.dataset.mobileSkin)
  ) {
    return document.documentElement.classList.contains("theme-light") ? "light" : "dark";
  }
  return resolveColorScheme(loadThemePreference());
}

/** Subscribes to color scheme changes triggered by applyThemePreference(). */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(currentColorScheme);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ColorScheme>).detail;
      setScheme(detail === "light" ? "light" : "dark");
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onChange);
    setScheme(currentColorScheme());
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, onChange);
  }, []);
  return scheme;
}
