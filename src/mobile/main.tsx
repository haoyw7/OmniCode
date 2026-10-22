import "./browserCrypto";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react";
import { AppearanceThemeProvider } from "../features/settings/model/AppearanceThemeProvider";
import { MOBILE_THEME_STORAGE_KEY, type ColorScheme } from "../shared/theme/themeConfig";
import { queryClient } from "../shared/lib/queryClient";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { defaultTransition } from "../shared/motion/tokens";
import { MobileApp } from "./MobileApp";
import { installKeyboardMotion } from "./keyboardMotion";
import { applyGlassSettings, readGlassSettings } from "./glassSettings";
import { refreshUiLanguage } from "../shared/i18n/language";
import {
  applyAccentColor,
  loadAccentColor,
  loadThemePreference,
  applyThemeTint,
  loadThemeHue,
  loadThemeSaturation,
  applyThemeDarkLightness,
  loadThemeDarkLightness,
  applyChatBackground,
  loadChatBackgroundPath,
  applyChatBackgroundOpacity,
  loadChatBackgroundOpacity,
} from "../features/settings/model/appearance";
import { initSounds } from "../features/settings/model/sounds";
import { initTypography } from "../features/settings/model/typography";
import { applyMobileTextSize, subscribeMobileTextSize } from "./textSize";
import { subscribeSharedPreferences } from "../features/settings/model/sharedPreferences";
import { parsePreferenceAsset } from "../features/settings/model/preferenceAssets";
import { applyMobileSkin, loadMobileSkin, paintMobileSkin, resolveMobileSkin, MOBILE_SKIN_KEY } from "./theme/skin";
import "./theme/index.css";
import "./styles/index.css";
import "./motion.css";

refreshUiLanguage();
installKeyboardMotion();
applyGlassSettings(readGlassSettings());
applyAccentColor(loadAccentColor());
const syncMobileTheme = () => { applyMobileSkin(loadMobileSkin(), loadThemePreference()); };
const applyMobilePalette = (scheme: ColorScheme) => paintMobileSkin(resolveMobileSkin(loadMobileSkin(), scheme));
syncMobileTheme();
initSounds();
initTypography();
applyMobileTextSize();
const stopTextSizeSubscription = subscribeMobileTextSize(applyMobileTextSize);
if (import.meta.hot) import.meta.hot.dispose(stopTextSizeSubscription);
const applyBackground = () => {
  const path = loadChatBackgroundPath();
  applyChatBackground(path && parsePreferenceAsset(path) ? path : null);
  applyChatBackgroundOpacity(loadChatBackgroundOpacity());
};
applyBackground();
subscribeSharedPreferences(() => {
  syncMobileTheme();
  refreshUiLanguage();
  initTypography();
  applyMobileTextSize();
  initSounds();
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyBackground();
});

createRoot(document.getElementById("root")!, {
  onRecoverableError(error) {
    console.error(
      "[omnicode mobile] render recovery",
      error instanceof Error && "cause" in error ? error.cause : error,
    );
  },
}).render(
  <QueryClientProvider client={queryClient}>
    <NuqsAdapter>
      <AppearanceThemeProvider storageKey={MOBILE_THEME_STORAGE_KEY} skinStorageKey={MOBILE_SKIN_KEY} syncPreference={syncMobileTheme} applySkin={applyMobilePalette}>
        <MotionConfig reducedMotion="user" transition={defaultTransition}><MobileApp /></MotionConfig>
      </AppearanceThemeProvider>
    </NuqsAdapter>
  </QueryClientProvider>,
);

