import { cn } from "../shared/lib/cn";
import { Switch } from "../shared/ui/forms/Switch";
import { MobileNotificationSettings } from "./MobileNotificationSettings";
import { MobileHapticSettings } from "./MobileHapticSettings";
import { MobileTextSizeSettings } from "./MobileTextSizeSettings";
import { MobileSettingsIcon as SettingsIcon, MobileSettingsGlyph } from "./MobileSettingsIcon";
import { useCallback, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  ChevronRight,
  Sparkles,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import type { HostConnectionStatus } from "./client";
import type { GlassEffect, GlassSettings } from "./glassSettings";
import { MobileAppUpdates, type useMobileAppUpdates } from "./MobileAppUpdates";
import { MobileConnections, type SettingsConnection } from "./MobileConnections";
import { hostStatusLabel } from "./MobileHostStatus";
import type { ConnectionAppearance } from "./connectionAppearance";
import { MobileSelect } from "./MobileSelect";
import type { useMobileActivity } from "./useMobileActivity";
import type { FollowUpBehavior } from "../features/settings/model/settings";
import {
  ACCENT_COLOR_PRESET_LABELS,
  ACCENT_COLOR_PRESETS,
  type TranscriptLayout,
} from "../features/settings/model/appearance";

import type { MobilePreferencePanel, MobileSettingsPage } from "./mobileSettingsRoutes";
import { MobileSkinPicker } from "./MobileSkinPicker";
import { MOBILE_SKIN_INFO, type MobileSkinPreference } from "./theme/skin";

function GlassPreview({ label }: { label: string }) {
  return (
    <div className="mobile-glass-preview" aria-hidden="true">
      <div className="mobile-glass-preview-scene">
        <span>Aa</span>
        <span>玻璃</span>
        <span>Glass</span>
      </div>
      <div className="mobile-glass-preview-chip">
        <Sparkles />
        {label}
      </div>
    </div>
  );
}

function GlassSlider({
  id,
  icon,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mobile-settings-row mobile-settings-slider">
      {icon}
      <label className="mobile-settings-label" htmlFor={id}>
        <span className="mobile-settings-slider-heading">
          <span>{label}</span>
          <output htmlFor={id}>{value}%</output>
        </span>
        <input
          id={id}
          type="range"
          className="mobile-range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled}
          style={{ "--mobile-range-value": `${value}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}

function AccentSelect({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const options: { color: string | null; label: string }[] = [
    { color: null, label: "Default" },
    ...ACCENT_COLOR_PRESETS.map((color, index) => ({
      color,
      label: ACCENT_COLOR_PRESET_LABELS[index],
    })),
  ];
  if (value && !options.some((option) => option.color === value)) {
    options.push({ color: value, label: value });
  }
  return (
    <MobileSelect
      id="mobile-accent"
      presentation="dialog"
      label={t("Accent color")}
      value={value ?? "default"}
      open={open}
      onOpenChange={onOpenChange}
      onChange={(color) => onChange(color === "default" ? null : color)}
      options={options.map(({ color, label }) => ({
        value: color ?? "default",
        label: t(label),
        icon: (
          <span
            className="mobile-accent-preview"
            aria-hidden="true"
            style={{ background: color ?? "var(--color-content)" }}
          />
        ),
      }))}
    />
  );
}

function Group({
  title,
  hideTitle = false,
  footer,
  children,
}: {
  title: string;
  /** Subpages already show their title in the header. */
  hideTitle?: boolean;
  footer?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="mobile-settings-group" aria-label={t(title)}>
      {hideTitle ? null : <h2>{t(title)}</h2>}
      <div className="mobile-settings-card">{children}</div>
      {footer ? <p className="mobile-settings-footer">{footer}</p> : null}
    </section>
  );
}

function useMobileSettingsController({
  page,
  onPageChange,
  connection,
  connections,
  sharedConnections,
  hostStatus,
  busy,
  loading,
  pairing,
  addingConnection,
  connectionTrigger,
  onAddConnection,
  onSwitchConnection,
  probeConnection,
  onReconnect,
  onDeleteConnection,
  connectionAppearance,
  onSaveConnectionAppearance,
  theme,
  onThemeChange,
  skin,
  onSkinChange,
  language,
  onLanguageChange,
  followUpBehavior,
  onFollowUpBehaviorChange,
  transcriptLayout,
  onTranscriptLayoutChange,
  transcriptAnchor,
  onTranscriptAnchorChange,
  accentColor,
  onAccentColorChange,
  soundsEnabled,
  onSoundsEnabledChange,
  archive,
  agentDefaults,
  providerAccounts,
  usage,
  glass,
  onGlassChange,
  preferencePanel,
  onPreferencePanelChange,
  activity,
  appUpdates,
}: {
  page: MobileSettingsPage;
  onPageChange: (page: MobileSettingsPage) => void;
  connection?: SettingsConnection;
  /** Every paired connection, the active one included. */
  connections: SettingsConnection[];
  sharedConnections?: ReactNode;
  hostStatus: HostConnectionStatus;
  busy: boolean;
  loading: boolean;
  /** Only an in-flight pairing blocks adding a connection. */
  pairing: boolean;
  addingConnection: boolean;
  connectionTrigger: RefObject<HTMLButtonElement | null>;
  onAddConnection: () => void;
  onSwitchConnection: (endpoint: string) => void;
  probeConnection: (connection: SettingsConnection) => Promise<HostConnectionStatus>;
  onReconnect: () => void;
  onDeleteConnection: (endpoint: string) => Promise<void>;
  connectionAppearance: ConnectionAppearance;
  onSaveConnectionAppearance: (endpoint: string, value: ConnectionAppearance) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  skin: MobileSkinPreference;
  onSkinChange: (skin: MobileSkinPreference) => void;
  language: string;
  onLanguageChange: (language: "en" | "zh-CN") => void;
  followUpBehavior: FollowUpBehavior;
  onFollowUpBehaviorChange: (behavior: FollowUpBehavior) => void;
  transcriptLayout: TranscriptLayout;
  onTranscriptLayoutChange: (layout: TranscriptLayout) => void;
  transcriptAnchor: boolean;
  onTranscriptAnchorChange: (anchor: boolean) => void;
  accentColor: string | null;
  onAccentColorChange: (color: string | null) => void;
  soundsEnabled: boolean;
  onSoundsEnabledChange: (enabled: boolean) => void;
  archive: ReactNode;
  agentDefaults?: ReactNode;
  providerAccounts?: ReactNode;
  usage?: ReactNode;
  glass: GlassSettings;
  onGlassChange: (glass: GlassSettings) => void;
  preferencePanel: MobilePreferencePanel;
  onPreferencePanelChange: (panel: MobilePreferencePanel) => void;
  activity: ReturnType<typeof useMobileActivity>;
  appUpdates: ReturnType<typeof useMobileAppUpdates>;
}) {
  const { t } = useTranslation();
  const connectionButton = useRef<HTMLButtonElement | null>(null);
  const setConnectionButton = useCallback((element: HTMLButtonElement | null) => {
    const previous = connectionButton.current;
    connectionButton.current = element;
    // An exiting settings page must not clear the new page's shared anchor.
    if (element || connectionTrigger.current === previous) connectionTrigger.current = element;
  }, [connectionTrigger]);
  const addConnectionRow = (className: string) => (
    <button
      className={cn("hover:opacity-80 active:opacity-70", className)}
      ref={setConnectionButton}
      type="button"
      aria-label={t("Add connection")}
      aria-haspopup="dialog"
      aria-expanded={addingConnection}
      disabled={pairing}
      onClick={onAddConnection}
    >
      {/* Root rows share the icon column; the Connections list keeps bare glyphs. */}
      {className === "mobile-settings-row" ? <SettingsIcon name="link" /> : <MobileSettingsGlyph name="link" />}
      <span className="mobile-settings-label">{t("Add connection")}</span>
    </button>
  );
  const connectionList = (
    <MobileConnections
      connections={connections}
      activeEndpoint={connection?.endpoint}
      hostStatus={hostStatus}
      disabled={busy || loading}
      panel={preferencePanel}
      onPanelChange={onPreferencePanelChange}
      probe={probeConnection}
      onSwitch={onSwitchConnection}
      onSave={onSaveConnectionAppearance}
      onReconnect={onReconnect}
      onDelete={onDeleteConnection}
      addConnection={addConnectionRow("mobile-settings-row mobile-connection-row mobile-connection-add")}
    />
  );
  return {
    accentColor,
    activity,
    addConnectionRow,
    agentDefaults,
    appUpdates,
    archive,
    connection,
    connectionAppearance,
    connectionList,
    followUpBehavior,
    glass,
    hostStatus,
    language,
    onAccentColorChange,
    onFollowUpBehaviorChange,
    onGlassChange,
    onLanguageChange,
    onPageChange,
    onPreferencePanelChange,
    onSoundsEnabledChange,
    onSkinChange,
    onThemeChange,
    onTranscriptAnchorChange,
    onTranscriptLayoutChange,
    page,
    preferencePanel,
    providerAccounts,
    usage,
    sharedConnections,
    skin,
    soundsEnabled,
    t,
    theme,
    transcriptAnchor,
    transcriptLayout,
  };
}

type MobileSettingsViewModel = ReturnType<typeof useMobileSettingsController>;

function MobileSettingsView({ vm }: { vm: MobileSettingsViewModel }) {
  const {
    accentColor,
    activity,
    addConnectionRow,
    agentDefaults,
    appUpdates,
    archive,
    connection,
    connectionAppearance,
    connectionList,
    followUpBehavior,
    glass,
    hostStatus,
    language,
    onAccentColorChange,
    onFollowUpBehaviorChange,
    onGlassChange,
    onLanguageChange,
    onPageChange,
    onPreferencePanelChange,
    onSoundsEnabledChange,
    onSkinChange,
    onThemeChange,
    onTranscriptAnchorChange,
    onTranscriptLayoutChange,
    page,
    preferencePanel,
    providerAccounts,
    usage,
    sharedConnections,
    skin,
    soundsEnabled,
    t,
    theme,
    transcriptAnchor,
    transcriptLayout,
  } = vm;

  if (page === "updates")
    return (
      <main className="mobile-content mobile-settings">
        <MobileAppUpdates state={appUpdates} />
      </main>
    );

  if (page === "archive")
    return (
      <main key="archive" className="mobile-content mobile-settings">
        {archive}
      </main>
    );

  if (page === "connections")
    return (
      <main className="mobile-content mobile-settings">
        {connectionList}
        {sharedConnections}
      </main>
    );

  if (page === "glass")
    return (
      <main key="glass" className="mobile-content mobile-settings">
        <Group title="Glass" hideTitle>
          <GlassPreview
            label={glass.effect === "frosted" ? t("Frosted glass") : t("Solid")}
          />
          <div className="mobile-settings-row">
            <SettingsIcon name="glass" />
            <label
              className="mobile-settings-label"
              htmlFor="mobile-glass-effect"
            >
              {t("Effect")}
            </label>
            <MobileSelect
              id="mobile-glass-effect"
              label={t("Effect")}
              value={glass.effect}
              open={preferencePanel === "glass"}
              onOpenChange={(open) =>
                onPreferencePanelChange(open ? "glass" : null)
              }
              onChange={(effect) =>
                onGlassChange({ ...glass, effect: effect as GlassEffect })
              }
              options={[
                { value: "frosted", label: t("Frosted glass") },
                { value: "solid", label: t("Solid") },
              ]}
            />
          </div>
          <GlassSlider
            id="mobile-glass-intensity"
            icon={
              <SettingsIcon name="intensity" />
            }
            label={t("Intensity")}
            value={glass.intensity}
            disabled={glass.effect === "solid"}
            onChange={(intensity) => onGlassChange({ ...glass, intensity })}
          />
          <GlassSlider
            id="mobile-glass-transparency"
            icon={
              <SettingsIcon name="transparency" />
            }
            label={t("Transparency")}
            value={glass.transparency}
            disabled={glass.effect === "solid"}
            onChange={(transparency) => onGlassChange({ ...glass, transparency })}
          />
        </Group>
      </main>
    );

  if (page === "text-size")
    return (
      <main key="text-size" className="mobile-content mobile-settings">
        <MobileTextSizeSettings />
      </main>
    );

  if (page === "skin")
    return (
      <main key="skin" className="mobile-content mobile-settings">
        <MobileSkinPicker value={skin} onChange={onSkinChange} />
      </main>
    );

  if (page === "accounts")
    return <main key="accounts" className="mobile-content mobile-settings mobile-settings-accounts">{providerAccounts}</main>;

  if (page === "usage")
    return <main key="usage" className="mobile-content mobile-settings mobile-settings-usage">{usage}</main>;

  if (page === "agents")
    return (
      <main key="agents" className="mobile-content mobile-settings">
        {agentDefaults}
      </main>
    );

  if (page === "notifications")
    return (
      <main key="notifications" className="mobile-content mobile-settings">
        <MobileNotificationSettings activity={activity} />
        <Group title="Sounds and haptics">
          <div className="mobile-settings-row mobile-settings-notifications">
            <SettingsIcon name="sounds" />
            <label className="mobile-settings-label">
              <span>{t("Sounds")}</span>
              <Switch checked={soundsEnabled} onCheckedChange={onSoundsEnabledChange} />
            </label>
          </div>
          <MobileHapticSettings />
        </Group>
      </main>
    );

  if (page === "chat")
    return (
      <main key="chat" className="mobile-content mobile-settings">
        <Group title="Message composer" hideTitle>
          <div className="mobile-settings-row">
            <SettingsIcon name="followUp" />
            <label className="mobile-settings-label" htmlFor="mobile-follow-up">
              {t("Follow-up behavior")}
            </label>
            <MobileSelect
              id="mobile-follow-up"
              label={t("Follow-up behavior")}
              value={followUpBehavior}
              open={preferencePanel === "follow-up"}
              onOpenChange={(open) =>
                onPreferencePanelChange(open ? "follow-up" : null)
              }
              onChange={onFollowUpBehaviorChange}
              options={[
                { value: "queue", label: t("Queue") },
                { value: "steer", label: t("Steer") },
              ]}
            />
          </div>
          <div className="mobile-settings-row">
            <SettingsIcon name="layout" />
            <label
              className="mobile-settings-label"
              htmlFor="mobile-transcript-layout"
            >
              {t("Transcript layout")}
            </label>
            <MobileSelect
              id="mobile-transcript-layout"
              label={t("Transcript layout")}
              value={transcriptLayout}
              open={preferencePanel === "transcript-layout"}
              onOpenChange={(open) =>
                onPreferencePanelChange(open ? "transcript-layout" : null)
              }
              onChange={onTranscriptLayoutChange}
              options={[
                { value: "full", label: t("Full width") },
                { value: "chat", label: t("Chat") },
              ]}
            />
          </div>
          <div className="mobile-settings-row mobile-settings-notifications">
            <SettingsIcon name="layout" />
            <label className="mobile-settings-label">
              <span>{t("Anchor prompts to top")}</span>
              <Switch
                id="mobile-transcript-anchor"
                aria-label={t("Anchor prompts to top")}
                checked={transcriptAnchor}
                onCheckedChange={(checked) =>
                  onTranscriptAnchorChange(checked)
                }
              />
            </label>
          </div>
        </Group>
      </main>
    );

  return (
    <main key="root" className="mobile-content mobile-settings">
      <section className="mobile-settings-group" aria-label={t("Settings")}>
        <div className="mobile-settings-card">
          <button
            type="button"
            className="hover:opacity-80 active:opacity-70 mobile-settings-row"
            aria-label={t("Connections")}
            onClick={() => onPageChange("connections")}
          >
            <SettingsIcon name={connection ? connectionAppearance.icon : "desktop"} />
            <span className="mobile-settings-label">{t("Connections")}</span>
            <small className="mobile-settings-value">
              {connection
                ? `${connectionAppearance.displayName || connection.name} · ${t(hostStatusLabel(hostStatus))}`
                : t("Not connected")}
            </small>
            <ChevronRight />
          </button>
          {/* Without a saved Host, keep pairing one tap away on first launch. */}
          {connection ? null : addConnectionRow("mobile-settings-row")}
          {agentDefaults ? (
            <button
              type="button"
              className="hover:opacity-80 active:opacity-70 mobile-settings-row"
              aria-label={t("New conversations")}
              onClick={() => onPageChange("agents")}
            >
              <SettingsIcon name="agent" />
              <span className="mobile-settings-label">{t("New conversations")}</span>
              <ChevronRight />
            </button>
          ) : null}
          {providerAccounts ? (
            <button type="button" className="hover:opacity-80 active:opacity-70 mobile-settings-row" aria-label={t("Accounts and usage")}
              onClick={() => onPageChange("accounts")}>
              <SettingsIcon name="account" />
              <span className="mobile-settings-label">{t("Accounts and usage")}</span>
              <ChevronRight />
            </button>
          ) : null}
          {usage ? <button type="button" className="hover:opacity-80 active:opacity-70 mobile-settings-row" aria-label={t("Usage")} onClick={() => onPageChange("usage")}>
            <SettingsIcon name="usage" /><span className="mobile-settings-label">{t("Usage")}</span><ChevronRight />
          </button> : null}
          <button
            type="button"
            className="hover:opacity-80 active:opacity-70 mobile-settings-row"
            aria-label={t("Notifications")}
            onClick={() => onPageChange("notifications")}
          >
            <SettingsIcon name="notifications" />
            <span className="mobile-settings-label">{t("Notifications")}</span>
            <small className="mobile-settings-value">
              {t(activity.permission !== "unsupported" && activity.enabled ? "On" : "Off")}
            </small>
            <ChevronRight />
          </button>
          <button
            type="button"
            className="hover:opacity-80 active:opacity-70 mobile-settings-row"
            aria-label={t("Message composer")}
            onClick={() => onPageChange("chat")}
          >
            <SettingsIcon name="followUp" />
            <span className="mobile-settings-label">{t("Message composer")}</span>
            <small className="mobile-settings-value">
              {t(followUpBehavior === "queue" ? "Queue" : "Steer")}
            </small>
            <ChevronRight />
          </button>
        </div>
      </section>
      <Group title="Appearance">
        <button
          type="button"
          className="hover:opacity-80 active:opacity-70 mobile-settings-row"
          onClick={() => onPageChange("text-size")}
        >
          <SettingsIcon name="textSize" />
          <span className="mobile-settings-label">{t("Text size")}</span>
          <ChevronRight aria-hidden="true" />
        </button>
        <button
          type="button"
          className="hover:opacity-80 active:opacity-70 mobile-settings-row"
          aria-label={t("Skin")}
          onClick={() => onPageChange("skin")}
        >
          <SettingsIcon name="appearance" />
          <span className="mobile-settings-label">{t("Skin")}</span>
          <small className="mobile-settings-value">
            {skin === "auto" ? t("Automatic") : t(MOBILE_SKIN_INFO[skin].label)}
          </small>
          <ChevronRight />
        </button>
        {/* Color mode chooses between Midnight and Daylight for the automatic skin. */}
        {skin === "auto" ? (
        <div className="mobile-settings-row">
          <SettingsIcon name="appearance" />
          <label className="mobile-settings-label" htmlFor="mobile-theme">
            {t("Color mode")}
          </label>
          <MobileSelect
            id="mobile-theme"
            presentation="dialog"
            label={t("Color mode")}
            value={theme}
            open={preferencePanel === "theme"}
            onOpenChange={(open) =>
              onPreferencePanelChange(open ? "theme" : null)
            }
            onChange={onThemeChange}
            options={[
              { value: "system", label: t("System") },
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
            ]}
          />
        </div>
        ) : null}
        <div className="mobile-settings-row">
          <SettingsIcon name="accent" />
          <label className="mobile-settings-label" htmlFor="mobile-accent">
            {t("Accent color")}
          </label>
          <AccentSelect
            value={accentColor}
            onChange={onAccentColorChange}
            open={preferencePanel === "accent"}
            onOpenChange={(open) =>
              onPreferencePanelChange(open ? "accent" : null)
            }
          />
        </div>
        <div className="mobile-settings-row">
          <SettingsIcon name="language" />
          <label className="mobile-settings-label" htmlFor="mobile-language">
            {t("Language")}
          </label>
          <MobileSelect
            id="mobile-language"
            presentation="dialog"
            label={t("Language")}
            value={language}
            open={preferencePanel === "language"}
            onOpenChange={(open) =>
              onPreferencePanelChange(open ? "language" : null)
            }
            onChange={(value) => onLanguageChange(value as "en" | "zh-CN")}
            options={[
              { value: "en", label: "English" },
              { value: "zh-CN", label: "简体中文" },
            ]}
          />
        </div>
        <button
          type="button"
          className="hover:opacity-80 active:opacity-70 mobile-settings-row"
          aria-label={t("Glass")}
          onClick={() => onPageChange("glass")}
        >
          <SettingsIcon name="glass" />
          <span className="mobile-settings-label">{t("Glass")}</span>
          <small className="mobile-settings-value">
            {t(glass.effect === "frosted" ? "Frosted glass" : "Solid")}
          </small>
          <ChevronRight />
        </button>
      </Group>
      <section
        className="mobile-settings-group"
        aria-label={t("More")}
      >
        <div className="mobile-settings-card">
          <button
            type="button"
            className="hover:opacity-80 active:opacity-70 mobile-settings-row"
            onClick={() => onPageChange("archive")}
          >
            <SettingsIcon name="archive" />
            <span className="mobile-settings-label">
              {t("Archived conversations")}
            </span>
            <ChevronRight />
          </button>
          <button
            type="button"
            className="hover:opacity-80 active:opacity-70 mobile-settings-row"
            aria-label={t("App updates")}
            onClick={() => onPageChange("updates")}
          >
            <SettingsIcon name="updates" />
            <span className="mobile-settings-label">{t("App updates")}</span>
            {appUpdates.installed ? (
              <small className="mobile-settings-value">
                {appUpdates.installed.version}
              </small>
            ) : null}
            {appUpdates.available ? (
              <span className="mobile-unread-dot" aria-hidden="true" />
            ) : null}
            <ChevronRight />
          </button>
        </div>
      </section>
    </main>
  );
}

export function MobileSettings(props: {
  page: MobileSettingsPage;
  onPageChange: (page: MobileSettingsPage) => void;
  connection?: SettingsConnection;
  /** Every paired connection, the active one included. */
  connections: SettingsConnection[];
  sharedConnections?: ReactNode;
  hostStatus: HostConnectionStatus;
  busy: boolean;
  loading: boolean;
  /** Only an in-flight pairing blocks adding a connection. */
  pairing: boolean;
  addingConnection: boolean;
  connectionTrigger: RefObject<HTMLButtonElement | null>;
  onAddConnection: () => void;
  onSwitchConnection: (endpoint: string) => void;
  probeConnection: (connection: SettingsConnection) => Promise<HostConnectionStatus>;
  onReconnect: () => void;
  onDeleteConnection: (endpoint: string) => Promise<void>;
  connectionAppearance: ConnectionAppearance;
  onSaveConnectionAppearance: (endpoint: string, value: ConnectionAppearance) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  skin: MobileSkinPreference;
  onSkinChange: (skin: MobileSkinPreference) => void;
  language: string;
  onLanguageChange: (language: "en" | "zh-CN") => void;
  followUpBehavior: FollowUpBehavior;
  onFollowUpBehaviorChange: (behavior: FollowUpBehavior) => void;
  transcriptLayout: TranscriptLayout;
  onTranscriptLayoutChange: (layout: TranscriptLayout) => void;
  transcriptAnchor: boolean;
  onTranscriptAnchorChange: (anchor: boolean) => void;
  accentColor: string | null;
  onAccentColorChange: (color: string | null) => void;
  soundsEnabled: boolean;
  onSoundsEnabledChange: (enabled: boolean) => void;
  archive: ReactNode;
  agentDefaults?: ReactNode;
  providerAccounts?: ReactNode;
  usage?: ReactNode;
  glass: GlassSettings;
  onGlassChange: (glass: GlassSettings) => void;
  preferencePanel: MobilePreferencePanel;
  onPreferencePanelChange: (panel: MobilePreferencePanel) => void;
  activity: ReturnType<typeof useMobileActivity>;
  appUpdates: ReturnType<typeof useMobileAppUpdates>;
}) {
  return <MobileSettingsView vm={useMobileSettingsController(props)} />;
}
