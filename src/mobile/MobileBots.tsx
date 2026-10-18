import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps } from "react";
import { MobileAssistant, type MobileAssistantHandle } from "./MobileAssistant";
import { BotAvatar } from "../features/bots/ui/BotAvatar";
import { botCacheKey, type BotsSnapshot } from "../features/bots/model/bots";
import { scopedBotRpc } from "../features/bots/model/botClient";
import type { BotConfiguration } from "../features/bots/model/botView";
import { botErrorMessage } from "../features/bots/model/botErrors";
import type { HostDescriptor } from "../features/connections/model/protocol";
import { NavigationItem } from "../shared/ui/messaging/NavigationItem";
import { IconButton } from "../shared/ui/forms/IconButton";
import { Button } from "../shared/ui/forms/Button";
import { ArrowLeft, ChevronRight } from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { MobileSpinner } from "./MobileSpinner";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobilePageTransition } from "./MobilePageTransition";

type Props = ComponentProps<typeof MobileAssistant>;
type Entry = { id: string; name: string; avatar?: string; threadId?: string; defaultScope: boolean };

/** Selection is local navigation, never restored from the desktop Bot selection. */
export function MobileBots({ ref, ...props }: Props) {
  const { t } = useTranslation();
  const surfaceVisible = useSurfaceVisibility();
  const visible = surfaceVisible && props.foreground !== false;
  const [entries, setEntries] = useState<Entry[]>();
  const [selected, setSelected] = useState<Entry>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const chat = useRef<MobileAssistantHandle>(null);
  useEffect(() => { if (!surfaceVisible) setSelected(undefined); }, [surfaceVisible]);
  useEffect(() => {
    if (!visible || selected) return;
    let disposed = false;
    setEntries(undefined);
    setError(undefined);
    void (async () => {
      const descriptor = await props.rpc<HostDescriptor>("environment.describe");
      if (descriptor.capabilities?.includes("bots.v1")) {
        const snapshot = await props.rpc<BotsSnapshot>("bots.list");
        return snapshot.bots.filter(bot => !bot.archivedAt).map(bot => ({
          id: bot.id, name: bot.name, avatar: bot.avatar, threadId: bot.defaultThreadId,
          defaultScope: bot.id === snapshot.defaultBotId && bot.defaultThreadId === snapshot.defaultThreadId,
        }));
      }
      const bot = await props.rpc<BotConfiguration | null>("assistant.get");
      return bot ? [{ id: bot.id, name: bot.name, avatar: bot.avatar, defaultScope: true }] : [];
    })().then(value => { if (!disposed) setEntries(value); }, cause => {
      if (!disposed) setError(botErrorMessage(cause));
    });
    return () => { disposed = true; };
  }, [visible, selected, attempt, props.rpc]);
  const back = () => {
    if (selected) chat.current?.back();
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
  return <MobilePageTransition route={{ key: selected ? `bot:${selected.id}` : "bots:list", section: "bots", depth: selected ? 1 : 0 }}>
  {selected ? <MobileAssistant {...props} ref={chat} rpc={rpc}
    cacheKey={selected.defaultScope || !selected.threadId ? props.hostKey : botCacheKey(props.hostKey, { botId: selected.id, threadId: selected.threadId })}
    onClose={() => setSelected(undefined)} /> :
  <main className="mobile-bots" inert={!visible} aria-hidden={!visible || undefined}
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); back(); } }}>
    <header className="mobile-header">
      <IconButton label={t("Back")} onClick={props.onClose}><ArrowLeft size={22} /></IconButton>
      <div className="mobile-header-title"><strong role="heading" aria-level={1}>{t("Bots")}</strong></div>
    </header>
    <nav className="mobile-bots-list" data-mobile-page-scroll aria-label={t("Bots")}>
      {error ? <div className="assistant-availability" role="alert"><p>{t(error)}</p><Button onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</Button></div>
        : !entries ? <div className="assistant-availability" role="status"><MobileSpinner size={20} className="animate-spin motion-reduce:animate-none" /><span>{t("Loading…")}</span></div>
        : entries.length === 0 ? <p className="assistant-availability">{t("No bots yet")}</p>
        : entries.map(bot => <NavigationItem key={bot.id} icon={<BotAvatar bot={bot} size={36} />}
          trailing={<ChevronRight size={18} />} onClick={() => setSelected(bot)}>{bot.name}</NavigationItem>)}
    </nav>
  </main>}
  </MobilePageTransition>;
}
