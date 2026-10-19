import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Button } from "../../../shared/ui/forms/Button";
import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useEffect, useRef, useState } from "react";
import type { BotMessage, BotConfiguration } from "../model/botView";
import type { BotChatChrome, BotHeaderProps, BotSettingsPanelProps } from "./BotChatChrome";
import { desktopBotsLegacyChrome, DesktopBotsComposer } from "./DesktopBotsLegacyChrome";
import { AnimatedCollapse, useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Bot, ChevronRight, MoreHorizontal, Pause, Play, Search, Square, X } from "../../../shared/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../shared/ui/primitives/DropdownMenu";
import { BotNavigationToggle } from "./BotNavigationLayout";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { sessionDisplayTitle } from "../../sessions/model/session";

import { BotAvatar } from "./BotAvatar";

/** The first shell shows only the Host's existing assistant and its real chat. */
export function DesktopBotsNavigation({ hostName, assistant, messages, onSelect }: {
  hostName: string;
  assistant?: BotConfiguration | null;
  messages: BotMessage[];
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(true);
  const name = assistant?.name ?? t("Assistant");
  const latest = [...messages].reverse().find((message) =>
    (message.kind === "user" || message.kind === "assistant") &&
    (message.text.trim() || message.attachments?.length));
  const preview = latest && "text" in latest
    ? latest.text.replace(/\s+/g, " ").trim() || t("Attachments")
    : t(assistant ? "Main thread" : "Set up assistant");
  const matches = `${name} ${preview}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  return (
    <nav className="desktop-bots-navigation" aria-label={t("Bots")}>
      <header className="desktop-bots-navigation-header">
        <strong>{t("Bots")}</strong>
        <span className="desktop-bots-host-name" title={hostName}>{hostName}</span>
      </header>
      <label className="desktop-bots-search">
        <Search size={15} aria-hidden="true" />
        <input data-ui="input" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search bots")} aria-label={t("Search bots")} />
      </label>
      <div className="desktop-bots-contacts">
        {matches ? <>
          <div className="desktop-bots-contact" data-selected="true">
            <button type="button" className="desktop-bots-contact-main" onClick={onSelect}
              aria-label={name} aria-current="true" title={`${name}: ${preview}`}>
              <span className="desktop-bots-avatar" aria-hidden="true">
                <Bot size={20} />
                <span className="desktop-bots-presence" data-lifecycle={assistant?.lifecycle ?? "idle"} />
              </span>
              <span className="desktop-bots-contact-copy">
                <span className="desktop-bots-contact-title">
                  <strong>{name}</strong>
                  {latest && <time dateTime={new Date(latest.createdAt).toISOString()}>
                    {new Date(latest.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </time>}
                </span>
                <span className="desktop-bots-preview">{preview}</span>
              </span>
            </button>
            {assistant && <button type="button" className="desktop-bots-thread-toggle"
              aria-label={t(expanded ? "Hide threads" : "Show threads")}
              aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>}
          </div>
          <AnimatedCollapse expanded={expanded && !!assistant}>
            <button type="button" className="desktop-bots-thread" aria-current="page" aria-label={t("Main thread")} title={t("Main thread")} onClick={onSelect}>
              {assistant?.harness && <HarnessIcon harness={assistant.harness} className="size-3.5 shrink-0" />}
              <span>{assistant?.harness ? sessionDisplayTitle(t("Main thread"), assistant.harness) : t("Main thread")}</span>
            </button>
          </AnimatedCollapse>
        </> : <div className="desktop-bots-no-results">
          <p>{t("No matching bots")}</p>
          <button type="button" onClick={() => setQuery("")}>{t("Clear")}</button>
        </div>}
      </div>
    </nav>
  );
}

function DesktopBotsHeader({ name, botIdentity, status, lifecycle, busy, settingsOpen, onSettings, controls }: BotHeaderProps) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (!visible) setMenuOpen(false); }, [visible]);
  return <header className="assistant-header desktop-bots-header">
    <div className="desktop-bots-header-navigation"><BotNavigationToggle /></div>
    <Button variant="ghost" size="xl" className="desktop-bots-bot-capsule" aria-label={t("Bot details")}
      aria-expanded={settingsOpen} onClick={onSettings} disabled={!onSettings} title={name}>
      <BotAvatar bot={botIdentity ?? { id: name }} size={24} />
      <span className="desktop-bots-header-title"><strong>{name}</strong></span>
      {lifecycle && lifecycle !== "idle" && <span className="desktop-bots-capsule-status" data-lifecycle={lifecycle} role="status" aria-label={status} title={status} />}
      <ChevronRight size={15} aria-hidden="true" />
    </Button>
    <div className="assistant-header-actions">
      {controls && <DropdownMenu open={menuOpen && visible} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild><IconButton size="sm" label={t("Bot actions")} active={menuOpen}><MoreHorizontal size={18} /></IconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={t("Bot actions")}>
          <DropdownMenuItem disabled={busy} onSelect={controls.onToggle}>
            {controls.continuable ? <Play size={15} /> : <Pause size={15} />}{t(controls.continuable ? "Continue" : "Pause")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy || !controls.enabled} onSelect={controls.onDisable}>
            <Square size={14} />{t("Disable assistant")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  </header>;
}

function DesktopBotsSettingsPanel({ open, initialSetup, onClose, children }: BotSettingsPanelProps) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const { foldState, finish } = useCollapseMotion(open);
  const panel = useRef<HTMLElement>(null);
  const opened = useRef(open);
  if (open) opened.current = true;
  useEffect(() => {
    if (!open || !visible) return;
    const previous = document.activeElement as HTMLElement | null;
    // The shared motion hook first removes the closed panel's visibility.
    // Focus on the next frame, once that layout update has been committed.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === previous || document.activeElement === document.body)
        panel.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      // Restore the trigger only if focus still belongs to the closing panel.
      // Sending a message while details are open must not steal composer focus.
      if (panel.current?.contains(document.activeElement) && previous?.isConnected && !previous.closest("[inert]"))
        previous.focus({ preventScroll: true });
    };
  }, [open, visible]);
  return <motionElement.aside
      initial={false} animate={{ opacity: open ? 1 : 0 }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={finish} ref={panel} className="desktop-bots-inspector" tabIndex={-1}
    aria-label={t(initialSetup ? "Set up assistant" : "Bot details")}
    aria-hidden={!open || undefined} inert={!open || !visible} data-fold-state={foldState}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !initialSetup && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    <SurfaceVisibilityContext.Provider value={visible && open}>
      {opened.current && <>
        <header className="desktop-bots-inspector-header">
          {initialSetup && <strong>{t("Set up assistant")}</strong>}
          {!initialSetup && <IconButton type="button" className="assistant-icon-button" onClick={onClose}
            label={t("Hide bot details")}><X size={18} /></IconButton>}
        </header>
        <div className="assistant-settings-content">{children}</div>
      </>}
    </SurfaceVisibilityContext.Provider>
  </motionElement.aside>;
}

export const desktopBotsChrome: BotChatChrome = {
  ...desktopBotsLegacyChrome,
  Header: DesktopBotsHeader,
  Composer: (props) => <DesktopBotsComposer {...props} compact />,
  SettingsPanel: DesktopBotsSettingsPanel,
};
