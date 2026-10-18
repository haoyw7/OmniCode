import { MotionConfig } from "motion/react";
import { observeNativeScrollbarEdges } from "../../shared/ui/nativeScrollbarEdges";
import { defaultTransition } from "../../shared/motion/tokens";
import { DESKTOP_SCHEME_KEY } from "../../shared/theme/desktopAppearance";
import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../platform/tauri/platform";
import {
  applyAccentColor,
  applyThemeDarkLightness,
  applyThemePreference,
  applyThemeTint,
  loadAccentColor,
  loadThemeDarkLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
} from "../settings/model/appearance";
import { initTypography } from "../settings/model/typography";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import "../../styles/index.css";
import { initUiLanguage } from "../../shared/i18n/languageSync";
import { refreshUiLanguage, translate } from "../../shared/i18n/language";
import { initializeSharedHost } from "../connections/model/sharedHost";
import { initializeHostPreferences } from "../settings/model/hostPreferences";
import { subscribeSharedPreferences } from "../settings/model/sharedPreferences";
import { initProviderAccountPublishing } from "../providers/model/providerAccountCredentials";
import { initSounds } from "../settings/model/sounds";
import { configureDefaultIconArtwork } from "../../shared/ui/icons";
import { desktopIconArtwork } from "../../app/desktopIconArtwork";

configureDefaultIconArtwork(desktopIconArtwork);

/**
 * Only the theme, not the workspace's glass, backgrounds, or scale: the panel
 * draws its own card on a clear window. Re-applied on every show because the
 * theme may have changed in a workspace window since.
 */
function applyAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  const scheme = applyThemePreference(loadThemePreference());
  // Fonts, motion and the per-mode profile, after the scheme is known.
  initTypography();
  // The native blur follows the window's appearance, not the page's, so
  // match it to the app theme rather than the system one.
  void getCurrentWindow()
    .setTheme(scheme)
    .catch(() => undefined);
}

initUiLanguage();
applyAppearance();
window.addEventListener("storage", (event) => {
  if (event.key === DESKTOP_SCHEME_KEY || event.key === null) applyAppearance();
});
subscribeSharedPreferences(() => {
  applyAppearance();
  refreshUiLanguage();
  initSounds();
});

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
function QuickWindow() {
  React.useLayoutEffect(() => observeNativeScrollbarEdges(document), []);
  return new URLSearchParams(window.location.search).get("popup") === "git"
    ? <QuickGitPopup onShown={applyAppearance} />
    : <QuickComposer onShown={applyAppearance} />;
}
async function boot() {
  try {
    // This is an independent webview: it must bind its own verified settings
    // service before its controls can read defaults or save a model selection.
    await initializeSharedHost();
    await initializeHostPreferences();
    await initProviderAccountPublishing();
    applyAppearance();
    root.render(
      <React.StrictMode>
        <MotionConfig reducedMotion="user" transition={defaultTransition}>
        <QuickWindow />
      </MotionConfig>
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-content">
        <p>{translate("Could not connect to shared conversations.")}</p>
        <pre className="max-w-full whitespace-pre-wrap text-ui-sm">{String(error)}</pre>
        <button onClick={() => void boot()}>{translate("Retry")}</button>
      </div>,
    );
  }
}
void boot();
