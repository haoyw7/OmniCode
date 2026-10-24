import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from "react";
import { MobileAssistant, type MobileAssistantHandle } from "./MobileAssistant";
import { BotAvatar } from "../features/bots/ui/BotAvatar";
import { botCacheKey, type BotsSnapshot, type BotThread } from "../features/bots/model/bots";
import { readBotPins, writeBotPins } from "../features/bots/model/botPins";
import { useBotUnread } from "../features/bots/model/useBotUnread";
import { scopedBotRpc } from "../features/bots/model/botClient";
import type { BotConfiguration } from "../features/bots/model/botView";
import { botErrorMessage } from "../features/bots/model/botErrors";
import type { HostDescriptor } from "../contracts/protocol";
import { NavigationItem } from "../shared/ui/messaging/NavigationItem";
import { IconButton } from "../shared/ui/forms/IconButton";
import { Button } from "../shared/ui/forms/Button";
import { Input } from "../shared/ui/forms/Input";
import { ArrowLeft, Pin, Plus, Search, X } from "../shared/ui/icons";
import { AnimatedCollapse } from "../shared/ui/AnimatedCollapse";
import { useListReorderMotion } from "../shared/hooks/useListReorderMotion";
import { useLongPress } from "../shared/hooks/useLongPress";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSpinner } from "./MobileSpinner";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobilePageTransition } from "./MobilePageTransition";
import { MobileBotCreate } from "./MobileBotCreate";
import { MobileSheet } from "./MobileSheet";
import { formatRelativeTime } from "../shared/lib/relativeTime";

export type MobileBotSelection = { id: string; name: string; avatar?: string; threadId?: string; defaultScope: boolean };
type Props = Omit<ComponentProps<typeof MobileAssistant>, "onOpen"> & {
  initialSelection?: MobileBotSelection;
  onOpen: (...args: [...Parameters<ComponentProps<typeof MobileAssistant>["onOpen"]>, MobileBotSelection]) => Promise<void> | void;
};
type Entry = MobileBotSelection;
const EMPTY_THREADS: BotThread[] = [];

/** Selection is local navigation, never restored from the desktop Bot selection. */
export function MobileBots({ ref, initialSelection, onOpen, ...props }: Props) {
  const { t, language } = useTranslation();
  const surfaceVisible = useSurfaceVisibility();
  const visible = surfaceVisible && props.foreground !== false;
  const [entries, setEntries] = useState<Entry[]>();
  const [selected, setSelected] = useState<Entry | undefined>(initialSelection);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [threads, setThreads] = useState(EMPTY_THREADS);
  const [canCreate, setCanCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [pinsByHost, setPinsByHost] = useState<Record<string, string[]>>({});
  const pins = useMemo(() => pinsByHost[props.hostKey] ?? readBotPins(props.hostKey), [pinsByHost, props.hostKey]);
  const [menu, setMenu] = useState<Entry>();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const pinnedList = useRef<HTMLDivElement>(null);
  const regularList = useRef<HTMLDivElement>(null);
  const chat = useRef<MobileAssistantHandle>(null);
  const createPage = useRef<MobileAssistantHandle>(null);
  const listVisible = visible && !selected && !creating;
  const longPress = useLongPress<HTMLElement>(target => {
    const bot = entries?.find(bot => bot.id === target.dataset.botId);
    if (bot) setMenu(bot);
  }, listVisible && !menu);
  const activity = useBotUnread(props.hostKey, threads, props.rpc, listVisible);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (bot: Entry) => bot.name.toLocaleLowerCase().includes(needle);
  const pinned = pins.flatMap(id => { const bot = entries?.find(item => item.id === id); return bot && matches(bot) ? [bot] : []; });
  const regular = (entries ?? []).filter(bot => !pins.includes(bot.id) && matches(bot));
  useListReorderMotion(pinnedList, pinned.map(bot => bot.id), "data-bot-id", listVisible, pinned.length > 0 ? "open" : "closed");
  useListReorderMotion(regularList, regular.map(bot => bot.id), "data-bot-id", listVisible);
  useEffect(() => { setSelected(surfaceVisible ? initialSelection : undefined); }, [surfaceVisible, initialSelection]);
  useEffect(() => {
    if (!surfaceVisible) { setCreating(false); setSearching(false); setQuery(""); setMenu(undefined); }
  }, [surfaceVisible]);
  useEffect(() => { if (!listVisible) setMenu(undefined); }, [listVisible]);
  useEffect(() => {
    if (!listVisible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    setEntries(undefined);
    setError(undefined);
    setCanCreate(false);
    setThreads(EMPTY_THREADS);
    const load = async () => {
      try {
        const descriptor = await props.rpc<HostDescriptor>("environment.describe");
        if (disposed) return;
        setCanCreate(!!descriptor.capabilities?.includes("bots.v1"));
        if (descriptor.capabilities?.includes("bots.v1")) {
          const snapshot = await props.rpc<BotsSnapshot>("bots.list");
          if (disposed) return;
          setThreads(snapshot.threads.filter(thread => !thread.archivedAt && snapshot.bots.some(bot => bot.id === thread.botId && !bot.archivedAt)));
          setEntries(snapshot.bots.filter(bot => !bot.archivedAt).map(bot => ({
            id: bot.id, name: bot.name, avatar: bot.avatar, threadId: bot.defaultThreadId,
            defaultScope: bot.id === snapshot.defaultBotId && bot.defaultThreadId === snapshot.defaultThreadId,
          })));
        } else {
          const bot = await props.rpc<BotConfiguration | null>("assistant.get");
          if (!disposed) setEntries(bot ? [{ id: bot.id, name: bot.name, avatar: bot.avatar, defaultScope: true }] : []);
        }
        if (!disposed) setError(undefined);
      } catch (cause) {
        if (!disposed) setError(botErrorMessage(cause));
      } finally {
        if (!disposed) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => { disposed = true; clearTimeout(timer); };
  }, [listVisible, attempt, props.rpc, props.hostKey]);
  const closeSearch = () => { setSearching(false); setQuery(""); searchButton.current?.focus(); };
  const back = () => {
    if (selected) chat.current?.back();
    else if (creating) createPage.current?.back();
    else if (menu) setMenu(undefined);
    else if (searching) closeSearch();
    else props.onClose?.();
  };
  useImperativeHandle(ref, () => ({ back }));
  const rpc = useMemo(() => {
    if (!selected?.threadId || selected.defaultScope) return props.rpc;
    const scoped = scopedBotRpc(props.rpc, { botId: selected.id, threadId: selected.threadId }, false);
    // The legacy task timeline is only exposed for the default assistant.
    return (async (method: string, params?: object) => {
      const value = await scoped(method, params);
      if (method !== "environment.describe") return value;
      const descriptor = value as HostDescriptor;
      return { ...descriptor, capabilities: descriptor.capabilities?.filter(item => item !== "assistant.timeline") };
    }) as typeof props.rpc;
  }, [props.rpc, selected]);
  const botActions = (bot: Entry) => ({
    "aria-label": bot.name,
    onClick: () => setSelected(bot),
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => { event.preventDefault(); setMenu(bot); },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setMenu(bot); }
    },
  });
  return <MobilePageTransition route={{ key: selected ? `bot:${selected.id}` : creating ? "bots:create" : "bots:list", section: "bots", depth: selected || creating ? 1 : 0 }}>
  {selected ? <MobileAssistant {...props} ref={chat} rpc={rpc}
    onOpen={(ref, target) => onOpen(ref, target, selected)}
    cacheKey={selected.defaultScope || !selected.threadId ? props.hostKey : botCacheKey(props.hostKey, { botId: selected.id, threadId: selected.threadId })}
    onClose={() => setSelected(undefined)} /> : creating ? <MobileBotCreate ref={createPage} rpc={props.rpc}
      onClose={() => setCreating(false)} onCreated={(bot, thread) => {
        setCreating(false); setSelected({ id: bot.id, name: bot.name, avatar: bot.avatar, threadId: thread.id, defaultScope: false });
      }} /> :
  <main className="mobile-bots" inert={!visible} aria-hidden={!visible || undefined}
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); back(); } }}>
    <header className="mobile-header mobile-bots-header">
      <IconButton label={t("Back")} onClick={props.onClose}><ArrowLeft size={24} /></IconButton>
      <h1 className="sr-only">{t("Bots")}</h1>
      <div className="mobile-bots-header-actions">
        <IconButton ref={searchButton} label={t("Search bots")} shape="round" aria-expanded={searching} aria-controls="mobile-bots-search"
          onClick={() => searching ? closeSearch() : setSearching(true)}>{searching ? <X size={24} /> : <Search size={24} />}</IconButton>
        <IconButton label={t("New bot")} shape="round" disabled={!canCreate} onClick={() => setCreating(true)}><Plus size={24} /></IconButton>
      </div>
    </header>
    <AnimatedCollapse expanded={searching} onEntered={() => searchInput.current?.focus()}>
      <div className="mobile-bots-search" id="mobile-bots-search">
        <Input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)}
          aria-label={t("Search bots")} placeholder={t("Search bots")} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </div>
    </AnimatedCollapse>
    <nav className="mobile-bots-list" data-mobile-page-scroll aria-label={t("Bots")} {...longPress}>
      {error && <div className="assistant-availability" role="alert"><p>{t(error)}</p><Button onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</Button></div>}
      {!entries && !error && <div className="assistant-availability" role="status"><MobileSpinner size={20} className="animate-spin motion-reduce:animate-none" /><span>{t("Loading…")}</span></div>}
      {entries?.length === 0 && <p className="assistant-availability">{t("No bots yet")}</p>}
      <AnimatedCollapse expanded={pinned.length > 0}>
        <div ref={pinnedList} className="mobile-bots-pinned" aria-label={t("Pinned bots")}>
          {pinned.map(bot => <button key={bot.id} type="button" data-bot-id={bot.id} {...botActions(bot)}>
            <BotAvatar bot={bot} size={96} /><span>{bot.name}</span>
          </button>)}
        </div>
      </AnimatedCollapse>
      <div ref={regularList} className="mobile-bots-rows">
        {regular.map(bot => {
          const feed = bot.threadId ? activity.get(botCacheKey(props.hostKey, { botId: bot.id, threadId: bot.threadId })) : undefined;
          const latest = feed?.latest && (feed.latest.kind === "user" || feed.latest.kind === "assistant") ? feed.latest : undefined;
          return <NavigationItem key={bot.id} data-bot-id={bot.id} icon={<BotAvatar bot={bot} size={40} />} {...botActions(bot)}>
            <span className="mobile-bots-row-heading"><strong>{bot.name}</strong>
              {latest && <time dateTime={new Date(latest.createdAt).toISOString()}>{formatRelativeTime(latest.createdAt, Date.now(), language)}</time>}
            </span>
            <span className="mobile-bots-row-preview"><span>{latest ? latest.text.trim() || t("Attachments") : t("No messages yet")}</span>
              {!!feed?.count && <span className="mobile-unread-dot" role="img" aria-label={t("Unread reply")} />}
            </span>
          </NavigationItem>;
        })}
      </div>
      {entries && entries.length > 0 && !pinned.length && !regular.length && <p className="assistant-availability" role="status">{t("No matching bots")}</p>}
    </nav>
    <MobileSheet open={!!menu && listVisible} title="Bot options" onClose={() => setMenu(undefined)}
      header={{ title: menu?.name }}>
      <button type="button" className="mobile-sheet-row" onClick={() => {
        if (!menu) return;
        const next = pins.includes(menu.id) ? pins.filter(id => id !== menu.id) : [...pins, menu.id];
        setPinsByHost(current => ({ ...current, [props.hostKey]: next })); writeBotPins(props.hostKey, next); setMenu(undefined);
      }}><Pin size={20} /><span>{t(menu && pins.includes(menu.id) ? "Unpin" : "Pin")}</span></button>
    </MobileSheet>
  </main>}
  </MobilePageTransition>;
}
