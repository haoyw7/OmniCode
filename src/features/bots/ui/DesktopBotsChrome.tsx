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
import { Bot, ChevronRight, Plus, Pause, Play, Search, Settings, Square } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { sessionDisplayTitle } from "../../sessions/model/session";

import { BotAvatar } from "./BotAvatar";
import type { BotThread, BotView } from "../model/bots";

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

export function BotThreadSwitcher({ bot, threads, selected, onSelect, onNew }: {
  bot: BotView; threads: BotThread[]; selected: string; onSelect: (thread: BotThread) => void; onNew: () => void;
}) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const current = threads.find(thread => thread.id === selected);
  const harness = current?.modelOverride?.harness ?? bot.harness;
  const title = sessionDisplayTitle(current?.title ?? "", harness).trim() || t("Main thread");
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={container} className="desktop-bots-thread-picker" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...container.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="desktop-bots-thread-trigger" aria-label={t("Switch thread")} title={title} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}>
      <HarnessIcon harness={harness} className="size-3.5 shrink-0" /><span>{title}</span><ChevronRight size={12} />
    </button>
    <AnimatedCollapse expanded={open && visible} className="desktop-bots-thread-popover">
      <div role="menu" aria-label={t("Threads")}>
        {threads.map(thread => {
          const provider = thread.modelOverride?.harness ?? bot.harness;
          const label = sessionDisplayTitle(thread.title, provider).trim() || t("Main thread");
          return <button type="button" role="menuitem" key={thread.id} aria-label={label} aria-current={selected === thread.id ? "page" : undefined} onClick={() => { setOpen(false); onSelect(thread); }}>
            <HarnessIcon harness={provider} className="size-4 shrink-0" /><span>{label}</span>
          </button>;
        })}
        <button type="button" role="menuitem" aria-label={t("New thread")} onClick={() => { setOpen(false); onNew(); }}><Plus size={16} /><span>{t("New conversation")}</span></button>
      </div>
    </AnimatedCollapse>
  </div>;
}

function DesktopBotsHeader({ name, botIdentity, threadPicker, threadTitle, harness, status, lifecycle, busy, settingsOpen, onSettings, controls }: BotHeaderProps) {
  const { t } = useTranslation();
  const title = threadTitle && harness ? sessionDisplayTitle(threadTitle, harness) : threadTitle;
  return <header className="assistant-header desktop-bots-header">
    <BotAvatar bot={botIdentity ?? { id: name }} size={28} />
    <div className="desktop-bots-header-title"><strong>{name}</strong>{threadPicker ?? <span>{title?.trim() ? title : t("Main thread")}</span>}</div>
    {lifecycle && lifecycle !== "idle" && <span className="assistant-status desktop-bots-run-status" data-lifecycle={lifecycle}>{status}</span>}
    <div className="assistant-header-actions">
      {controls && <>
        <button data-ui="icon-button" type="button" className="assistant-icon-button" disabled={busy} title={t(controls.continuable ? "Continue" : "Pause")} aria-label={t(controls.continuable ? "Continue" : "Pause")} onClick={controls.onToggle}>{controls.continuable ? <Play size={15} /> : <Pause size={15} />}</button>
        <button data-ui="icon-button" type="button" className="assistant-icon-button assistant-danger" disabled={busy || !controls.enabled} title={t("Disable assistant")} aria-label={t("Disable assistant")} onClick={controls.onDisable}><Square size={14} /></button>
      </>}
      {onSettings && <button data-ui="icon-button" type="button" className="assistant-icon-button" title={t("Bot details")} aria-label={t("Bot details")} aria-expanded={settingsOpen} onClick={onSettings}><Settings size={17} /></button>}
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
          {!initialSetup && <button data-ui="icon-button" type="button" className="assistant-icon-button" onClick={onClose}
            aria-label={t("Hide bot details")} title={t("Hide bot details")}><span aria-hidden="true">»</span></button>}
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
