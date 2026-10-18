import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { BotScope, BotView } from "../model/bots";
import type { BotRoom, BotRoomMessage, BotRoomMessages, BotRoomRound, BotRoomState, BotRoomSpeakerStatus } from "../model/botRooms";
import { botErrorMessage } from "../model/botErrors";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { BotDateSeparator } from "./BotDateSeparator";
import { DesktopBotMembers } from "./DesktopBotMembers";
import { DesktopRoomEditor } from "./DesktopBotRooms";
import { Bot, Settings, ArrowUp } from "../../../shared/ui/icons";
import "./desktop-bot-collaboration.css";

type Props = { environmentId: string; room: BotRoom; bots: BotView[]; rpc: BotRpc; onSaved: () => Promise<unknown>; onOpenThread: (scope: BotScope) => void };
const statuses: Record<BotRoomSpeakerStatus, string> = { pending: "Pending", queued: "Queued", running: "Running", waiting_approval: "Approval needed", completed: "Completed", failed: "Failed", timed_out: "Timed out", cancelled: "Cancelled", interrupted: "Interrupted" };
const merge = (left: BotRoomMessage[], right: BotRoomMessage[]) => [...new Map([...left, ...right].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
const draftKey = (environmentId: string, roomId: string) => `monocode.bot-room-draft:${JSON.stringify([environmentId, roomId])}`;
export function DesktopBotRoomChat(props: Props) { return <RoomChat key={JSON.stringify([props.environmentId, props.room.id])} {...props} />; }
function RoomChat({ environmentId, room, bots, rpc, onSaved, onOpenThread }: Props) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const [state, setState] = useState<BotRoomState>({ room, rounds: [] }), [messages, setMessages] = useState<BotRoomMessage[]>([]), [page, setPage] = useState<BotRoomMessages>();
  const [error, setError] = useState<string>(), [pollError, setPollError] = useState<string>(), [sending, setSending] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [roundsOpen, setRoundsOpen] = useState(true), [orderOpen, setOrderOpen] = useState(false);
  const [customOrder, setCustomOrder] = useState(false), [members, setMembers] = useState(room.memberIds);
  const storageKey = draftKey(environmentId, room.id);
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; } });
  const rows = useRef<BotRoomMessage[]>([]), revision = useRef(-1), inFlight = useRef(false), request = useRef(0), alive = useRef(true);
  const log = useRef<HTMLDivElement>(null), follow = useRef(true), prepend = useRef<{ height: number; top: number } | undefined>(undefined);
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const cancellations = useRef(new Map<string, string>()), [cancelling, setCancelling] = useState(new Set<string>());
  useEffect(() => { try { localStorage.setItem(storageKey, draft); } catch { /* Draft remains in this retained surface. */ } }, [storageKey, draft]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  useEffect(() => { if (!customOrder) setMembers(room.memberIds); }, [room.memberIds, customOrder]);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sequence = request.current;
    try {
      const next = await rpc<BotRoomState>("botRooms.get", { roomId: room.id });
      if (!alive.current || sequence !== request.current || next.room.id !== room.id) return;
      setState(next);
      if (next.room.chatRevision > revision.current) {
        const known = rows.current.at(-1)?.sequence;
        let before: BotRoomMessages["next"], result: BotRoomMessages, incoming: BotRoomMessage[] = [];
        do {
          result = await rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id, limit: 30, ...(before ? { before } : {}) });
          if (!alive.current || sequence !== request.current) return;
          incoming = merge(result.messages.filter(message => message.roomId === room.id), incoming);
          before = result.next;
        } while (known !== undefined && result.hasMore && before && (incoming[0]?.sequence ?? 0) > known);
        rows.current = merge(rows.current, incoming); setMessages(rows.current); revision.current = result.revision;
        setPage(current => current && known !== undefined ? current : result);
      }
      setPollError(undefined);
    } catch (cause) { if (alive.current && sequence === request.current) setPollError(botErrorMessage(cause)); }
    finally { inFlight.current = false; }
  }, [rpc, room.id]);
  useEffect(() => {
    if (!visible) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 2000); };
    void poll();
    return () => { stopped = true; request.current++; clearTimeout(timer); };
  }, [visible, refresh]);
  useLayoutEffect(() => {
    const element = log.current;
    if (!element || !visible) return;
    if (prepend.current) { element.scrollTop = prepend.current.top + element.scrollHeight - prepend.current.height; prepend.current = undefined; }
    else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [messages, visible]);
  const older = async () => {
    if (loadingOlder || inFlight.current || !page?.hasMore || !page.next) return;
    const sequence = request.current;
    setLoadingOlder(true); inFlight.current = true;
    try {
      const result = await rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id, limit: 30, before: page.next });
      if (!alive.current || sequence !== request.current) return;
      if (log.current) prepend.current = { height: log.current.scrollHeight, top: log.current.scrollTop };
      rows.current = merge(result.messages.filter(message => message.roomId === room.id), rows.current); setMessages(rows.current); setPage(result); setError(undefined);
    } catch (cause) { if (alive.current && sequence === request.current) setError(botErrorMessage(cause)); }
    finally { inFlight.current = false; if (alive.current) setLoadingOlder(false); }
  };
  const send = async () => {
    if (!visible || sending || !draft.trim() || state.room.archivedAt || (customOrder && !members.length)) return;
    const params = { roomId: room.id, text: draft, ...(customOrder ? { memberIds: members } : {}) };
    const signature = JSON.stringify(params);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    setSending(true); setError(undefined);
    try { await rpc("botRooms.send", { ...params, commandId: command.current.id }); command.current = undefined; setDraft(""); follow.current = true; await refresh(); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setSending(false); }
  };
  const cancel = async (round: BotRoomRound) => {
    if (!visible || cancelling.has(round.id) || round.roomId !== room.id) return;
    const commandId = cancellations.current.get(round.id) ?? crypto.randomUUID(); cancellations.current.set(round.id, commandId);
    setCancelling(current => new Set([...current, round.id])); setError(undefined);
    try { await rpc("botRooms.cancel", { roomId: room.id, roundId: round.id, commandId }); cancellations.current.delete(round.id); await refresh(); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setCancelling(current => { const next = new Set(current); next.delete(round.id); return next; }); }
  };
  const saved = async () => { await onSaved(); await refresh(); };
  const name = (id: string) => bots.find(bot => bot.id === id)?.name ?? t("Unavailable Bot");
  return <section className="desktop-bot-room-chat" aria-label={state.room.name}>
    <header className="desktop-bot-room-header"><div><h2>{state.room.name}</h2><small>{state.room.archivedAt ? t("Archived") : t("Room")}</small></div><button type="button" aria-label={t("Room settings")} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings size={16} /></button></header>
    <p className="desktop-bot-room-privacy">{t("Private threads are not automatically included in rooms.")}</p>
    <AnimatedCollapse expanded={settingsOpen} keepMounted className="desktop-bot-room-settings"><DesktopRoomEditor room={state.room} bots={bots} rpc={rpc} onSaved={saved} /></AnimatedCollapse>
    {!!state.rounds.length && <div className="desktop-bot-room-rounds"><button type="button" aria-expanded={roundsOpen} onClick={() => setRoundsOpen(value => !value)}>{t("Room rounds")}</button>
      <AnimatedCollapse expanded={roundsOpen}><div className="desktop-bot-room-round-list">{state.rounds.filter(round => round.roomId === room.id).map(round => <article key={round.id} data-round-id={round.id}>
        <header><strong>{t(statuses[round.status])}</strong><time dateTime={new Date(round.createdAt).toISOString()}>{new Date(round.createdAt).toLocaleTimeString()}</time>{["queued", "running"].includes(round.status) && <button type="button" disabled={cancelling.has(round.id)} onClick={() => void cancel(round)}>{t("Stop round")}</button>}</header>
        <ol>{round.speakers.map(speaker => <li key={speaker.botId}><span>{name(speaker.botId)}</span><small>{t(statuses[speaker.status])}</small>{speaker.threadId && <button type="button" aria-label={`${t("Open member thread")}: ${name(speaker.botId)}`} onClick={() => onOpenThread({ botId: speaker.botId, threadId: speaker.threadId! })}>{t("Open member thread")}</button>}{speaker.error && <p role="alert">{t(speaker.error)}</p>}</li>)}</ol>
      </article>)}</div></AnimatedCollapse>
    </div>}
    <div ref={log} className="desktop-bot-room-messages" role="log" aria-label={t("Room messages")} onScroll={() => { const element = log.current!; follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 30; }}>
      {page?.hasMore && <button type="button" disabled={loadingOlder} onClick={() => void older()}>{t(loadingOlder ? "Loading…" : "Load older messages")}</button>}
      {messages.map((message, index) => {
        const bot = bots.find(bot => bot.id === message.botId);
        return <Fragment key={message.id}><BotDateSeparator createdAt={message.createdAt} previousCreatedAt={messages[index - 1]?.createdAt} />
          <article className="desktop-bot-room-message" data-kind={message.kind}>
            <header>{message.botId && <span className="desktop-bots-avatar" aria-hidden="true">{bot?.avatar || <Bot size={16} />}</span>}<strong>{message.botId ? name(message.botId) : t("You")}</strong>{bot && <HarnessIcon harness={bot.harness} className="size-3.5" />}{message.status && <small>{t(statuses[message.status])}</small>}</header>
            {message.kind === "assistant" ? <AgentMarkdown text={message.text} className="assistant-markdown" hardBreaks /> : <p>{message.kind === "status" ? t(message.text) : message.text}</p>}
            {message.botId && message.threadId && <button type="button" onClick={() => onOpenThread({ botId: message.botId!, threadId: message.threadId! })}>{t("Open member thread")}</button>}
          </article>
        </Fragment>;
      })}
      {!messages.length && <p>{t(page ? "Start a room conversation" : "Loading…")}</p>}
    </div>
    <div className="desktop-bot-room-composer">
      {(error || pollError) && <p role="alert">{t(error ?? pollError!)} <button type="button" onClick={() => void refresh()}>{t("Refresh")}</button></p>}
      <button type="button" aria-expanded={orderOpen} onClick={() => setOrderOpen(value => !value)}>{t("This round's speakers")}</button>
      <AnimatedCollapse expanded={orderOpen} keepMounted><div className="desktop-bot-room-order"><label><input data-ui="checkbox" type="checkbox" checked={!customOrder} onChange={event => setCustomOrder(!event.target.checked)} />{t("Use room member order")}</label><AnimatedCollapse expanded={customOrder}><DesktopBotMembers bots={bots.filter(bot => state.room.memberIds.includes(bot.id))} ids={members} ordered onChange={setMembers} disabled={sending} /></AnimatedCollapse></div></AnimatedCollapse>
      <form onSubmit={event => { event.preventDefault(); void send(); }}><textarea data-ui="textarea" aria-label={t("Message room")} placeholder={t("Message room")} value={draft} disabled={sending || !!state.room.archivedAt} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><button type="submit" aria-label={t("Send")} disabled={sending || !!state.room.archivedAt || !draft.trim() || (customOrder && !members.length)}><ArrowUp size={17} /></button></form>
    </div>
  </section>;
}
