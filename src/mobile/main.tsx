import "./browserCrypto";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { defaultTransition } from "../shared/motion/tokens";
import { MobileApp } from "./MobileApp";
import { installKeyboardMotion } from "./keyboardMotion";
import { applyGlassSettings, readGlassSettings } from "./glassSettings";
import { refreshUiLanguage } from "../shared/i18n/language";
import { disableStatusToasts } from "../shared/ui/StatusToast";
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
  applyChatBackgroundEmptyOpacity,
  loadChatBackgroundEmptyOpacity,
  applyChatBackgroundSessionOpacity,
  loadChatBackgroundSessionOpacity,
  applyChatBackgroundScope,
  loadChatBackgroundScope,
} from "../features/settings/model/appearance";
import { initSounds } from "../features/settings/model/sounds";
import { initTypography } from "../features/settings/model/typography";
import { subscribeSharedPreferences } from "../features/settings/model/sharedPreferences";
import { parsePreferenceAsset } from "../features/settings/model/preferenceAssets";
import { applyMobileSkin, loadMobileSkin } from "./theme/skin";
import "./theme/index.css";
import "./styles/index.css";
import "./motion.css";

refreshUiLanguage();
disableStatusToasts();
installKeyboardMotion();
applyGlassSettings(readGlassSettings());
applyAccentColor(loadAccentColor());
applyMobileSkin(loadMobileSkin(), loadThemePreference());
initSounds();
initTypography();
const applyBackground = () => {
  const path = loadChatBackgroundPath();
  applyChatBackground(path && parsePreferenceAsset(path) ? path : null);
  applyChatBackgroundEmptyOpacity(loadChatBackgroundEmptyOpacity());
  applyChatBackgroundSessionOpacity(loadChatBackgroundSessionOpacity());
  applyChatBackgroundScope(loadChatBackgroundScope());
};
applyBackground();
subscribeSharedPreferences(() => {
  refreshUiLanguage();
  initTypography();
  initSounds();
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyBackground();
});

createRoot(document.getElementById("root")!, {
  onRecoverableError(error) {
    console.error(
      "[monocode mobile] render recovery",
      error instanceof Error && "cause" in error ? error.cause : error,
    );
  },
}).render(<MotionConfig reducedMotion="user" transition={defaultTransition}><MobileApp /></MotionConfig>);

