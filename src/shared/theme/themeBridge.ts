import { createStore } from "zustand/vanilla";
import type { ColorScheme, ThemePreference } from "./themeConfig";

type ThemeRequest = { preference: ThemePreference; forcedTheme?: ColorScheme };
export const themeBridge = createStore<{
  request: ThemeRequest | undefined;
  setTheme: ((request: ThemeRequest) => void) | undefined;
}>(() => ({ request: undefined, setTheme: undefined }));

/** Non-React preference/Host callers enter next-themes through this bridge. */
export function setTheme(preference: ThemePreference, forcedTheme?: ColorScheme) {
  const request = { preference, forcedTheme };
  const setter = themeBridge.getState().setTheme;
  if (setter) setter(request);
  else themeBridge.setState({ request });
}

export function bindThemeSetter(setter: (request: ThemeRequest) => void) {
  themeBridge.setState({ setTheme: setter });
  const pending = themeBridge.getState().request;
  if (pending) {
    themeBridge.setState({ request: undefined });
    setter(pending);
  }
  return () => {
    if (themeBridge.getState().setTheme === setter)
      themeBridge.setState({ setTheme: undefined });
  };
}
