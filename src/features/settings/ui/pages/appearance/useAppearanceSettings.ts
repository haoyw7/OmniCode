import { activePreferenceStore } from "../../../model/sharedPreferences";
import { uploadPreferenceBackground } from "../../../model/preferenceAssets";
import { usePreferenceState } from "../../../model/usePreferenceState";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeScheme,
  activeScope,
  applyFontSize,
  applyProfile,
  applyReducedMotion,
  defaultAppearanceProfile,
  enableSeparateSchemes,
  FONT_SIZE_LIMITS,
  loadFontSize,
  loadProfile,
  loadReducedMotion,
  loadSeparateSchemes,
  REDUCED_MOTION_DEFAULT,
  saveFontSize,
  saveProfile,
  saveReducedMotion,
  saveSeparateSchemes,
  type AppearanceProfile,
  type FontSizeKind,
  type ReducedMotionPreference,
} from "../../../model/typography";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import {
  applyChatBackground,
  applyChatBackgroundEmptyOpacity,
  applyChatBackgroundSessionOpacity,
  applyChatBackgroundScope,
  applyChatBackgroundArea,
  applyWindowOpacity,
  applyPanelOpacity,
  applyAccentColor,
  applyBodyGlass,
  applyCompactSidebar,
  applyPopoverOpacity,
  applySidebarBlur,
  applySidebarOpacity,
  applyThemeDarkLightness,
  applyThemePreference,
  applyThemeTint,
  BODY_GLASS_DEFAULT,
  COMPACT_SIDEBAR_DEFAULT,
  ACCENT_COLOR_DEFAULT,
  CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  CHAT_BACKGROUND_AREA_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  loadBodyGlass,
  loadCompactSidebar,
  loadPopoverOpacity,
  loadWindowOpacity,
  loadPanelOpacity,
  loadAccentColor,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
  loadChatBackgroundArea,
  loadNewThreadBackgroundEffect,
  loadThemeDarkLightness,
  loadThemePreference,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadThemeHue,
  loadThemeSaturation,
  saveBodyGlass,
  saveCompactSidebar,
  savePopoverOpacity,
  saveWindowOpacity,
  savePanelOpacity,
  saveAccentColor,
  saveChatBackgroundEmptyOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundSessionOpacity,
  saveChatBackgroundScope,
  saveChatBackgroundArea,
  setNewThreadBackgroundEffect,
  saveThemeDarkLightness,
  saveThemePreference,
  saveSidebarBlur,
  saveSidebarOpacity,
  saveThemeHue,
  saveThemeSaturation,
  isLightScheme,
  syncNativeGlass,
  loadShowExcludedFiles,
  saveShowExcludedFiles,
  SHOW_EXCLUDED_FILES_DEFAULT,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_OPACITY_DEFAULT,
  POPOVER_OPACITY_DEFAULT,
  WINDOW_OPACITY_DEFAULT,
  PANEL_OPACITY_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  type ThemePreference,
  type ChatBackgroundScope,
  type ChatBackgroundArea,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  type NewThreadBackgroundEffect,
  type ColorScheme,
} from "../../../model/appearance";
import {
  pickAndSaveChatBackground,
  removeChatBackground,
} from "../../../../projects/model/chatBackground";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  subscribeUiScale,
  UI_SCALE_DEFAULT,
} from "../../../model/uiScale";
import { IS_LINUX } from "../../../../../platform/tauri/platform";
import {
  DESKTOP_SKIN_DEFAULT,
  loadDesktopSkin,
  normalizeDesktopSkin,
  saveDesktopSkin,
} from "../../../../../shared/theme/desktopSkin";



export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

export function useAppearanceSettings() {
  const [desktopSkin, setDesktopSkin] = usePreferenceState(loadDesktopSkin);
  const [themePreference, setThemePreference] =
    usePreferenceState<ThemePreference>(loadThemePreference);
  const [accentColor, setAccentColor] = usePreferenceState(loadAccentColor);
  const [opacity, setOpacity] = usePreferenceState(loadSidebarOpacity);
  const [popoverOpacity, setPopoverOpacity] = usePreferenceState(loadPopoverOpacity);
  const [windowOpacity, setWindowOpacity] = usePreferenceState(loadWindowOpacity);
  const [panelOpacity, setPanelOpacity] = usePreferenceState(loadPanelOpacity);
  const [blur, setBlur] = usePreferenceState(loadSidebarBlur);
  const [themeHue, setThemeHue] = usePreferenceState(loadThemeHue);
  const [themeSaturation, setThemeSaturation] = usePreferenceState(loadThemeSaturation);
  const [themeDarkLightness, setThemeDarkLightness] = usePreferenceState(
    loadThemeDarkLightness,
  );
  const [bodyGlass, setBodyGlass] = usePreferenceState(loadBodyGlass);
  const [compactSidebar, setCompactSidebar] = usePreferenceState(loadCompactSidebar);
  const [showExcludedFiles, setShowExcludedFiles] = usePreferenceState(
    loadShowExcludedFiles,
  );
  const [chatBackgroundPath, setChatBackgroundPath] = usePreferenceState(
    loadChatBackgroundPath,
  );
  const [chatBackgroundEmptyOpacity, setChatBackgroundEmptyOpacity] = usePreferenceState(
    loadChatBackgroundEmptyOpacity,
  );
  const [chatBackgroundSessionOpacity, setChatBackgroundSessionOpacity] =
    usePreferenceState(loadChatBackgroundSessionOpacity);
  const [chatBackgroundScope, setChatBackgroundScope] =
    usePreferenceState<ChatBackgroundScope>(loadChatBackgroundScope);
  const [chatBackgroundArea, setChatBackgroundArea] =
    usePreferenceState<ChatBackgroundArea>(loadChatBackgroundArea);
  const [newThreadBackgroundEffect, setBackgroundEffect] =
    usePreferenceState<NewThreadBackgroundEffect>(loadNewThreadBackgroundEffect);
  const [chatBackgroundBusy, setChatBackgroundBusy] = useState(false);
  const [chatBackgroundError, setChatBackgroundError] = useState<string | null>(
    null,
  );
  const [uiScale, setUiScale] = usePreferenceState(loadUiScale);
  const [fontSizes, setFontSizes] = usePreferenceState<Record<FontSizeKind, number>>(
    () => ({
      ui: loadFontSize("ui"),
      content: loadFontSize("content"),
      code: loadFontSize("code"),
    }),
  );
  const [reducedMotion, setReducedMotion] =
    usePreferenceState<ReducedMotionPreference>(loadReducedMotion);
  const [separateSchemes, setSeparateSchemes] = usePreferenceState(loadSeparateSchemes);
  const colorScheme = useColorScheme();
  const [editingScheme, setEditingScheme] = useState<ColorScheme>(activeScheme);
  const profileScope = separateSchemes ? editingScheme : "shared";
  const [profile, setProfile] = usePreferenceState<AppearanceProfile>(() =>
    loadProfile(profileScope),
  );

  useEffect(() => subscribeUiScale(() => setUiScale(loadUiScale())), []);
  // Follow the theme so the editor opens on the mode that is on screen.
  useEffect(() => setEditingScheme(colorScheme), [colorScheme]);
  useEffect(() => setProfile(loadProfile(profileScope)), [profileScope]);

  const profileRef = useRef(profile);
  profileRef.current = profile;

  /** Saves into the mode being edited; applies it when that mode is showing. */
  const updateProfile = useCallback(
    (patch: Partial<AppearanceProfile>) => {
      const next = saveProfile(profileScope, {
        ...profileRef.current,
        // Shared colour is edited by the accent/tint handlers; keep theirs.
        ...(profileScope === "shared"
          ? {
              accentColor: loadAccentColor(),
              hue: loadThemeHue(),
              saturation: loadThemeSaturation(),
            }
          : null),
        ...patch,
      });
      profileRef.current = next;
      if (profileScope === activeScope()) applyProfile(next);
      setProfile(next);
    },
    [profileScope],
  );

  /** Shows an unsaved edit while a slider is dragged; `updateProfile` saves it. */
  const previewProfile = useCallback(
    (patch: Partial<AppearanceProfile>) => {
      if (profileScope === activeScope())
        applyProfile({ ...profileRef.current, ...patch });
    },
    [profileScope],
  );

  const previewTint = useCallback(
    (hue: number, saturation: number) => {
      if (loadSeparateSchemes()) previewProfile({ hue, saturation });
      else applyThemeTint(hue, saturation);
    },
    [previewProfile],
  );

  const onThemePreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next);
    saveThemePreference(next);
    setThemePreference(next);
  }, []);

  const onDesktopSkin = useCallback((value: string) => {
    const next = normalizeDesktopSkin(value);
    applyThemePreference(loadThemePreference(), next);
    saveDesktopSkin(next);
    setDesktopSkin(next);
  }, []);

  const onAccentColor = useCallback((value: string | null) => {
    if (loadSeparateSchemes()) {
      updateProfile({ accentColor: value });
      return;
    }
    const next = applyAccentColor(value);
    saveAccentColor(next);
    setAccentColor(next);
  }, [updateProfile]);

  const onOpacity = useCallback((percent: number) => {
    const next = applySidebarOpacity(percent / 100);
    saveSidebarOpacity(next);
    setOpacity(next);
  }, []);

  const onPopoverOpacity = useCallback((percent: number) => {
    const next = applyPopoverOpacity(percent / 100);
    savePopoverOpacity(next);
    setPopoverOpacity(next);
  }, []);

  const onWindowOpacity = useCallback((percent: number) => {
    const next = applyWindowOpacity(percent / 100);
    saveWindowOpacity(next);
    setWindowOpacity(next);
  }, []);

  const onPanelOpacity = useCallback((percent: number) => {
    const next = applyPanelOpacity(percent / 100);
    savePanelOpacity(next);
    setPanelOpacity(next);
  }, []);

  const onBlur = useCallback((radius: number) => {
    const next = applySidebarBlur(radius);
    saveSidebarBlur(next);
    setBlur(next);
  }, []);

  const onTint = useCallback((hue: number, saturation: number) => {
    if (loadSeparateSchemes()) {
      updateProfile({ hue, saturation });
      return;
    }
    const next = applyThemeTint(hue, saturation);
    saveThemeHue(next.hue);
    saveThemeSaturation(next.saturation);
    setThemeHue(next.hue);
    setThemeSaturation(next.saturation);
  }, [updateProfile]);

  const onDarkLightness = useCallback((value: number) => {
    const next = applyThemeDarkLightness(value);
    saveThemeDarkLightness(next);
    setThemeDarkLightness(next);
  }, []);

  const onCompactSidebar = useCallback((next: boolean) => {
    applyCompactSidebar(next);
    saveCompactSidebar(next);
    setCompactSidebar(next);
  }, []);

  const onBodyGlass = useCallback((next: boolean) => {
    applyBodyGlass(next);
    saveBodyGlass(next);
    setBodyGlass(next);
    if (IS_LINUX) syncNativeGlass(isLightScheme() ? "light" : "dark");
  }, []);

  const onShowExcludedFiles = useCallback((next: boolean) => {
    saveShowExcludedFiles(next);
    setShowExcludedFiles(next);
  }, []);

  const onChooseChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      const picked = await pickAndSaveChatBackground();
      if (!picked) return;
      const path = activePreferenceStore() ? await uploadPreferenceBackground(picked) : picked;
      saveChatBackgroundPath(path);
      applyChatBackground(path, { reload: true });
      setChatBackgroundPath(path);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onClearChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      if (!activePreferenceStore()) await removeChatBackground();
      saveChatBackgroundPath(null);
      applyChatBackground(null);
      setChatBackgroundPath(null);
    } catch (error) {
      setChatBackgroundError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onChatBackgroundEmptyOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundEmptyOpacity(percent / 100);
    saveChatBackgroundEmptyOpacity(next);
    setChatBackgroundEmptyOpacity(next);
  }, []);

  const onChatBackgroundSessionOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundSessionOpacity(percent / 100);
    saveChatBackgroundSessionOpacity(next);
    setChatBackgroundSessionOpacity(next);
  }, []);

  const onChatBackgroundScope = useCallback((next: ChatBackgroundScope) => {
    applyChatBackgroundScope(next);
    saveChatBackgroundScope(next);
    setChatBackgroundScope(next);
  }, []);

  const onChatBackgroundArea = useCallback((next: ChatBackgroundArea) => {
    applyChatBackgroundArea(next);
    saveChatBackgroundArea(next);
    setChatBackgroundArea(next);
  }, []);

  const onNewThreadBackgroundEffect = useCallback(
    (next: NewThreadBackgroundEffect) => {
      setNewThreadBackgroundEffect(next);
      setBackgroundEffect(next);
    },
    [],
  );

  const onUiScale = useCallback((percent: number) => {
    const next = saveUiScale(percent / 100);
    setUiScale(next);
    void applyUiScale(next);
  }, []);

  const onFontSize = useCallback((kind: FontSizeKind, value: number) => {
    const next = applyFontSize(kind, saveFontSize(kind, value));
    setFontSizes((current) => ({ ...current, [kind]: next }));
  }, []);

  const onReducedMotion = useCallback((next: ReducedMotionPreference) => {
    saveReducedMotion(next);
    applyReducedMotion(next);
    setReducedMotion(next);
  }, []);

  const onSeparateSchemes = useCallback((next: boolean) => {
    if (next) enableSeparateSchemes();
    else saveSeparateSchemes(false);
    const scope = activeScope();
    const active = loadProfile(scope);
    applyProfile(active);
    setAccentColor(loadAccentColor());
    setThemeHue(loadThemeHue());
    setThemeSaturation(loadThemeSaturation());
    setEditingScheme(activeScheme());
    setProfile(active);
    setSeparateSchemes(next);
  }, []);

  const restoreDefaults = useCallback(() => {
    for (const kind of ["ui", "content", "code"] as const)
      onFontSize(kind, FONT_SIZE_LIMITS[kind].default);
    onReducedMotion(REDUCED_MOTION_DEFAULT);
    if (loadSeparateSchemes()) onSeparateSchemes(false);
    // Typography defaults; colour defaults follow through the calls below.
    const shared = saveProfile("shared", {
      ...loadProfile("shared"),
      ...defaultAppearanceProfile(),
      accentColor: loadAccentColor(),
      hue: loadThemeHue(),
      saturation: loadThemeSaturation(),
    });
    applyProfile(shared);
    setProfile(shared);
    onDesktopSkin(DESKTOP_SKIN_DEFAULT);
    onThemePreference(THEME_PREFERENCE_DEFAULT);
    onAccentColor(ACCENT_COLOR_DEFAULT);
    onOpacity(Math.round(SIDEBAR_OPACITY_DEFAULT * 100));
    onPopoverOpacity(Math.round(POPOVER_OPACITY_DEFAULT * 100));
    onWindowOpacity(Math.round(WINDOW_OPACITY_DEFAULT * 100));
    onPanelOpacity(Math.round(PANEL_OPACITY_DEFAULT * 100));
    onBlur(SIDEBAR_BLUR_DEFAULT);
    onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    onBodyGlass(BODY_GLASS_DEFAULT);
    onCompactSidebar(COMPACT_SIDEBAR_DEFAULT);
    onShowExcludedFiles(SHOW_EXCLUDED_FILES_DEFAULT);
    onChatBackgroundEmptyOpacity(
      Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100),
    );
    onChatBackgroundSessionOpacity(
      Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100),
    );
    onChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT);
    onChatBackgroundArea(CHAT_BACKGROUND_AREA_DEFAULT);
    onNewThreadBackgroundEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
    if (chatBackgroundPath) void onClearChatBackground();
    onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
  }, [
    chatBackgroundPath,
    onFontSize,
    onReducedMotion,
    onSeparateSchemes,
    onBlur,
    onBodyGlass,
    onCompactSidebar,
    onChatBackgroundEmptyOpacity,
    onChatBackgroundSessionOpacity,
    onChatBackgroundScope,
    onChatBackgroundArea,
    onNewThreadBackgroundEffect,
    onClearChatBackground,
    onAccentColor,
    onShowExcludedFiles,
    onThemePreference,
    onDesktopSkin,
    onOpacity,
    onPopoverOpacity,
    onWindowOpacity,
    onPanelOpacity,
    onTint,
    onDarkLightness,
    onUiScale,
  ]);

  return {
    desktopSkin,
    onDesktopSkin,
    themePreference,
    accentColor: separateSchemes ? profile.accentColor : accentColor,
    opacity,
    popoverOpacity,
    windowOpacity,
    panelOpacity,
    blur,
    themeHue: separateSchemes ? profile.hue : themeHue,
    themeSaturation: separateSchemes ? profile.saturation : themeSaturation,
    fontSizes,
    reducedMotion,
    separateSchemes,
    editingScheme,
    profile,
    onFontSize,
    onReducedMotion,
    onSeparateSchemes,
    onEditingScheme: setEditingScheme,
    updateProfile,
    previewProfile,
    previewTint,
    themeDarkLightness,
    bodyGlass,
    compactSidebar,
    showExcludedFiles,
    chatBackgroundPath,
    chatBackgroundEmptyOpacity,
    chatBackgroundSessionOpacity,
    chatBackgroundScope,
    chatBackgroundArea,
    newThreadBackgroundEffect,
    chatBackgroundBusy,
    chatBackgroundError,
    uiScale,
    onThemePreference,
    onAccentColor,
    onOpacity,
    onPopoverOpacity,
    onWindowOpacity,
    onPanelOpacity,
    onBlur,
    onTint,
    onDarkLightness,
    onBodyGlass,
    onCompactSidebar,
    onShowExcludedFiles,
    onChooseChatBackground,
    onClearChatBackground,
    onChatBackgroundEmptyOpacity,
    onChatBackgroundSessionOpacity,
    onChatBackgroundScope,
    onChatBackgroundArea,
    onNewThreadBackgroundEffect,
    onUiScale,
    restoreDefaults,
  };
}
