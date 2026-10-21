import { cn } from "../../../../../shared/lib/cn";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { AnimatedCollapse } from "../../../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { useImperativeHandle, type Ref } from "react";
import { ImagePlus } from "../../../../../shared/ui/icons";
import { Button } from "../../../../../shared/ui/forms/Button";
import { GradientBlurBackground } from "../../GradientBlurBackground";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import {
  applyChatBackgroundOpacity,
  applyWindowOpacity,
  applyPanelOpacity,
  applyPopoverOpacity,
  applySidebarBlur,
  applySidebarOpacity,
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  PANEL_OPACITY_MAX,
  PANEL_OPACITY_MIN,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_MIN,
  POPOVER_OPACITY_MAX,
  POPOVER_OPACITY_MIN,
  NEW_THREAD_BACKGROUND_EFFECTS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
} from "../../../model/appearance";
import { UI_SCALE_PERCENTS } from "../../../model/uiScale";
import { IS_LINUX } from "../../../../../platform/tauri/platform";
import { useAppearanceSettings, type AppearanceSettings } from "./useAppearanceSettings";
import { Group, LiveSlider, Row, Segmented, Toggle } from "../../settingsLayout";
import { AccentRow } from "./AccentRow";
import { TypographyCards } from "./TypographyCards";
import { DesktopSkinPicker } from "./DesktopSkinPicker";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner";



export type AppearancePageHandle = { restoreDefaults: () => void };

export function AppearancePage({ ref }: { ref?: Ref<AppearancePageHandle> }) {
  const appearance = useAppearanceSettings();
  useImperativeHandle(ref, () => ({ restoreDefaults: appearance.restoreDefaults }), [appearance.restoreDefaults]);
  const { t: uiT } = useTranslation();
  const percent = Math.round(appearance.opacity * 100);
  const popoverPercent = Math.round(appearance.popoverOpacity * 100);
  const windowPercent = Math.round(appearance.windowOpacity * 100);
  const panelPercent = Math.round(appearance.panelOpacity * 100);
  const glassDisabled = useColorScheme() === "light";
  // Linux keeps the window opaque until Main pane glass or a lowered Window
  // opacity opts into transparency.
  const windowOpaque =
    glassDisabled ||
    (IS_LINUX && !appearance.bodyGlass && windowPercent >= 100);

  return (
    <>
      <Group
        title={uiT("Theme")}
        description={
          appearance.separateSchemes
            ? uiT(
                "Dark and light keep their own colors, fonts and contrast; edit each mode below.",
              )
            : uiT(
                "Dark and light share the same typography and accent settings.",
              )
        }
      >
        <Row
          id="desktop-skin"
          label={uiT("Skin")}
          description={uiT("Choose a palette, or follow color mode with Automatic.")}
          stacked
        >
          <DesktopSkinPicker
            value={appearance.desktopSkin}
            onChange={appearance.onDesktopSkin}
          />
        </Row>
        <AnimatedCollapse
          expanded={appearance.desktopSkin === "auto" || appearance.desktopSkin === "classic"}
        >
          <Row
            id="theme"
            label={uiT("Theme")}
            description={uiT("System follows the OS appearance.")}
          >
            <Segmented
              label={uiT("Theme")}
              value={appearance.themePreference}
              options={[
                { value: "system", label: uiT("System") },
                { value: "dark", label: uiT("Dark") },
                { value: "light", label: uiT("Light") },
              ]}
              onChange={appearance.onThemePreference}
            />
          </Row>
        </AnimatedCollapse>
          <Row
            id="compact-sidebar"
            label={uiT("Compact sidebar")}
            description={uiT(
              "Show projects and conversations in short rows with small icons, so more fit on screen.",
            )}
          >
            <Toggle
              label={uiT("Compact sidebar")}
              on={appearance.compactSidebar}
              onChange={appearance.onCompactSidebar}
            />
          </Row>
          <Row
            id="indent-sidebar-sessions"
            label={uiT("Indent conversations")}
            description={uiT(
              "Show conversations one step in from their project in the sidebar.",
            )}
          >
            <Toggle
              label={uiT("Indent conversations")}
              on={appearance.indentSidebarSessions}
              onChange={appearance.onIndentSidebarSessions}
            />
          </Row>
        {appearance.separateSchemes ? null : (
          <AccentRow appearance={appearance} />
        )}
      </Group>

      <TypographyCards appearance={appearance} />

      <Group
        title={uiT("Translucency")}
        description={
          glassDisabled
            ? uiT(
                "Sidebar, panel and popover transparency work within the app. Light mode keeps the desktop behind the window opaque.",
              )
            : windowOpaque
              ? uiT(
                  "Sidebar, panel and popover transparency work within the app. On Linux, enable Main pane glass or increase Desktop transparency to reveal the desktop.",
                )
              : uiT(
                "How much of the desktop shows through OmniCode. Blur costs more to composite the higher it goes.",
              )
        }
      >
        <Row
          id="window-opacity"
          label={uiT("Desktop transparency")}
          description={uiT(
            "How much of the desktop shows through the whole window. A full-window background keeps its strength.",
          )}
        >
          <TransparencySlider
            label={uiT("Desktop transparency")}
            opacity={windowPercent}
            minOpacity={Math.round(WINDOW_OPACITY_MIN * 100)}
            maxOpacity={Math.round(WINDOW_OPACITY_MAX * 100)}
            preview={(value) => applyWindowOpacity(value / 100)}
            onChange={appearance.onWindowOpacity}
            disabled={glassDisabled}
          />
        </Row>
        <Row
          id="sidebar-opacity"
          label={uiT("Sidebar transparency")}
          description={uiT(
            "Applies to the activity bar, sidebar and other glass panes.",
          )}
        >
          <TransparencySlider
            label={uiT("Sidebar transparency")}
            opacity={percent}
            minOpacity={Math.round(SIDEBAR_OPACITY_MIN * 100)}
            maxOpacity={Math.round(SIDEBAR_OPACITY_MAX * 100)}
            preview={(value) => applySidebarOpacity(value / 100)}
            onChange={appearance.onOpacity}
          />
        </Row>
        <Row
          id="popover-opacity"
          label={uiT("Popover transparency")}
          description={uiT(
            "How much background shows through menus, pickers, dialogs, and other popovers.",
          )}
        >
          <TransparencySlider
            label={uiT("Popover transparency")}
            opacity={popoverPercent}
            minOpacity={Math.round(POPOVER_OPACITY_MIN * 100)}
            maxOpacity={Math.round(POPOVER_OPACITY_MAX * 100)}
            preview={(value) => applyPopoverOpacity(value / 100)}
            onChange={appearance.onPopoverOpacity}
          />
        </Row>
        <Row
          id="panel-opacity"
          label={uiT("Panel transparency")}
          description={uiT(
            "Workspace panels, editors, diffs, composer, settings, dialogs and menus. Higher values show more of what is behind them.",
          )}
        >
          <TransparencySlider
            label={uiT("Panel transparency")}
            opacity={panelPercent}
            minOpacity={Math.round(PANEL_OPACITY_MIN * 100)}
            maxOpacity={Math.round(PANEL_OPACITY_MAX * 100)}
            preview={(value) => applyPanelOpacity(value / 100)}
            onChange={appearance.onPanelOpacity}
          />
        </Row>
        <Row
          id="blur"
          label={uiT("Blur radius")}
          description={uiT("Background blur behind the window.")}
        >
          <LiveSlider
            label={uiT("Blur radius")}
            value={appearance.blur}
            format={String}
            min={SIDEBAR_BLUR_MIN}
            max={SIDEBAR_BLUR_MAX}
            preview={applySidebarBlur}
            onChange={appearance.onBlur}
            disabled={windowOpaque}
          />
        </Row>
        <Row
          id="main-pane-glass"
          label={uiT("Main pane glass")}
          description={uiT(
            "Extend the translucent treatment to the main pane behind sessions and editors.",
          )}
        >
          <Toggle
            label={uiT("Main pane glass")}
            on={appearance.bodyGlass}
            onChange={appearance.onBodyGlass}
            disabled={glassDisabled}
          />
        </Row>
      </Group>

      <ChatBackgroundCard appearance={appearance} />

      <Group title={uiT("Layout")}>
        <Row
          id="interface-scale"
          label={uiT("Interface scale")}
          description={uiT(
            "Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS).",
          )}
        >
          <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
            label={uiT("Interface scale")}
            value={String(Math.round(appearance.uiScale * 100))}
            options={UI_SCALE_PERCENTS.map((percent) => ({
              value: String(percent),
              label: `${percent}%`,
            }))}
            onChange={(value) => appearance.onUiScale(Number(value))}
          />
        </Row>
        <Row
          id="show-excluded-files"
          label={uiT("Show excluded files")}
          description={uiT(
            "Show files and folders Git excludes, such as build output and dependencies, in the explorer.",
          )}
        >
          <Toggle
            label={uiT("Show excluded files")}
            on={appearance.showExcludedFiles}
            onChange={appearance.onShowExcludedFiles}
          />
        </Row>
      </Group>
    </>
  );
}

function ChatBackgroundCard({
  appearance,
}: {
  appearance: AppearanceSettings;
}) {
  const { t: uiT } = useTranslation();
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const visibility = Math.round(appearance.chatBackgroundOpacity * 100);
  const busy = appearance.chatBackgroundBusy;

  return (
    <Group
      id="chat-background"
      title={uiT("Chat background")}
      description={uiT(
        "An image behind your chat panes. It stays on this device.",
      )}
    >
      <div className="border-b border-content/5 p-4 last:border-b-0">
        <div className="overflow-hidden rounded-lg border border-content/10">
          {hasImage ? (
            <div
              className={cn("relative h-36", appearance.newThreadBackgroundEffect === "gradient-blur" ? "bg-background-base" : "")}
            >
              {appearance.newThreadBackgroundEffect === "gradient-blur" ? (
                <GradientBlurBackground
                  className="gradient-blur-preview absolute inset-0"
                  style={{ opacity: appearance.chatBackgroundOpacity }}
                />
              ) : (
                <div
                  aria-hidden
                  className="size-full bg-cover bg-center bg-no-repeat"
                  style={{
                    backgroundImage: "var(--chat-background-image)",
                    opacity: appearance.chatBackgroundOpacity,
                  }}
                />
              )}
              <span className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-content/40">
                {uiT("Background image strength")}: {visibility}%
              </span>
            </div>
          ) : (
            <Button variant="ghost" size="content"
              type="button"
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
              className="flex h-36 w-full flex-col items-center justify-center gap-2 text-content/40 hover:bg-content/3 hover:text-content/70 disabled:cursor-default disabled:opacity-40"
            >
              {busy ? (
                <Spinner className="size-5" aria-hidden />
              ) : (
                <ImagePlus className="size-5" aria-hidden />
              )}
              <span className="text-[12px]">{uiT("Choose an image")}</span>
            </Button>
          )}
        </div>
        {hasImage ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="secondary"
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
            >
              {busy ? (
                <Spinner className="size-3.5" aria-hidden />
              ) : null}
              {uiT("Change")}
            </Button>
            <Button
              onClick={() => void appearance.onClearChatBackground()}
              disabled={busy}
              variant="danger"
            >
              {uiT("Remove")}
            </Button>
          </div>
        ) : null}
        {appearance.chatBackgroundError ? (
          <p className="mt-2 text-[12px] text-danger">
            {appearance.chatBackgroundError}
          </p>
        ) : null}
      </div>
      {hasImage ? (
        <>
          <Row
            label={uiT("Background effect")}
            description={uiT(
              NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[
                appearance.newThreadBackgroundEffect
              ],
            )}
          >
            <Segmented
              label={uiT("Background effect")}
              value={appearance.newThreadBackgroundEffect}
              options={NEW_THREAD_BACKGROUND_EFFECTS.map((effect) => ({
                value: effect,
                label: uiT(NEW_THREAD_BACKGROUND_EFFECT_LABELS[effect]),
              }))}
              onChange={appearance.onNewThreadBackgroundEffect}
              optionIdPrefix="new-thread-background-effect"
            />
          </Row>
          <Row
            label={uiT("Background area")}
            description={uiT(
              "Behind chat panes only, or across the whole window.",
            )}
          >
            <Segmented
              label={uiT("Background area")}
              value={appearance.chatBackgroundArea}
              options={[
                { value: "chat", label: uiT("Chat area") },
                { value: "window", label: uiT("Full window") },
              ]}
              onChange={appearance.onChatBackgroundArea}
            />
          </Row>
          <Row
            label={uiT("Background image strength")}
            description={uiT("Use the same background strength in new and existing conversations.")}
          >
            <LiveSlider
              label={uiT("Background image strength")}
              value={visibility}
              format={(value) => `${value}%`}
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              preview={(value) => applyChatBackgroundOpacity(value / 100)}
              onChange={appearance.onChatBackgroundOpacity}
            />
          </Row>
        </>
      ) : null}
    </Group>
  );
}

/**
 * Presents a stored opacity percentage as transparency (100 - opacity), so
 * higher values show more of what is behind; callbacks still take opacity.
 */
function TransparencySlider({
  label,
  opacity,
  minOpacity,
  maxOpacity,
  preview,
  onChange,
  disabled,
}: {
  label: string;
  opacity: number;
  minOpacity: number;
  maxOpacity: number;
  preview: (opacity: number) => void;
  onChange: (opacity: number) => void;
  disabled?: boolean;
}) {
  return (
    <LiveSlider
      label={label}
      value={100 - opacity}
      format={(value) => `${value}%`}
      min={100 - maxOpacity}
      max={100 - minOpacity}
      preview={(value) => preview(100 - value)}
      onChange={(value) => onChange(100 - value)}
      disabled={disabled}
    />
  );
}
