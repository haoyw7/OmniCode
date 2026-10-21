import { Textarea } from "../../../shared/ui/forms/Textarea";
import { Checkbox } from "../../../shared/ui/forms/Checkbox";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FieldError } from "../../../shared/ui/primitives/Field";
import { Button } from "../../../shared/ui/forms/Button";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import { botRoomConversationQuery, loadOlderRoomMessages } from "../model/botRoomQueries";
import type { BotRpc } from "../model/botRpc";
import type { BotScope, BotView } from "../model/bots";
import type { BotRoom, BotRoomRound, BotRoomSpeakerStatus } from "../model/botRooms";
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
const draftKey = (environmentId: string, roomId: string) => `omnicode.bot-room-draft:${JSON.stringify([environmentId, roomId])}`;
export function DesktopBotRoomChat(props: Props) { return <RoomChat key={JSON.stringify([props.environmentId, props.room.id])} {...props} />; }
function RoomChat({ environmentId, room, bots, rpc, onSaved, onOpenThread }: Props) {
  const { t } = useTranslation(), visible = useSurfaceVisibility();
  const options = botRoomConversationQuery(rpc, room.id);
  const conversation = useQuery({ ...options, enabled: visible, refetchInterval: visible ? 2000 : false }, queryClient);
  const state = conversation.data?.state ?? { room, rounds: [] }, messages = conversation.data?.messages ?? [], page = conversation.data?.page;
  const refresh = () => invalidateAfterChange(options.queryKey);
  const [settingsOpen, setSettingsOpen] = useState(false), [roundsOpen, setRoundsOpen] = useState(true), [orderOpen, setOrderOpen] = useState(false);
  const storageKey = draftKey(environmentId, room.id);
  const form = useForm({
    resolver: zodResolver(z.object({
      draft: z.string().refine(value => !!value.trim(), t("This field is required")),
      customOrder: z.boolean(), members: z.array(z.string()),
    }).refine(value => !value.customOrder || value.members.length > 0, { path: ["members"], message: t("Choose 1–10 members. Each speaks once in the listed order.") })),
    defaultValues: { draft: (() => { try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; } })(), customOrder: false, members: room.memberIds },
  });
  const [draft, customOrder, members] = useWatch({ control: form.control, name: ["draft", "customOrder", "members"] });
  const setMembers = (value: string[]) => form.setValue("members", value);
  const setCustomOrder = (value: boolean) => form.setValue("customOrder", value);
  const log = useRef<HTMLDivElement>(null), follow = useRef(true), prepend = useRef<{ height: number; top: number } | undefined>(undefined);
  const command = useRef<{ signature: string; id: string } | undefined>(undefined);
  const cancellations = useRef(new Map<string, string>());
  useEffect(() => { try { localStorage.setItem(storageKey, draft); } catch { /* Draft remains in this retained surface. */ } }, [storageKey, draft]);
  useEffect(() => { if (!customOrder) setMembers(room.memberIds); }, [room.memberIds, customOrder]);
  useLayoutEffect(() => {
    const element = log.current;
    if (!element || !visible) return;
    if (prepend.current) { element.scrollTop = prepend.current.top + element.scrollHeight - prepend.current.height; prepend.current = undefined; }
    else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [messages, visible]);
  const loadingOlder = conversation.isFetching;
  const older = () => loadOlderRoomMessages(rpc, room.id, () => {
    if (log.current) prepend.current = { height: log.current.scrollHeight, top: log.current.scrollTop };
  }).catch(() => undefined);
  const sendMutation = useMutation({ mutationFn: (params: { roomId: string; text: string; memberIds?: string[]; commandId: string }) => withToast(async () => {
    await rpc("botRooms.send", params); command.current = undefined; form.resetField("draft", { defaultValue: "" }); follow.current = true; await refresh();
  }, { loading: t("Sending..."), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const cancelMutation = useMutation({ mutationKey: [...options.queryKey, "cancel"], mutationFn: (roundId: string) => withToast(async () => {
    const commandId = cancellations.current.get(roundId) ?? crypto.randomUUID(); cancellations.current.set(roundId, commandId);
    await rpc("botRooms.cancel", { roomId: room.id, roundId, commandId }); cancellations.current.delete(roundId); await refresh();
  }, { loading: t("Saving…"), success: false, error: cause => t(botErrorMessage(cause)) }) }, queryClient);
  const cancelling = new Set(useMutationState({ filters: { mutationKey: [...options.queryKey, "cancel"], status: "pending" }, select: mutation => mutation.state.variables as string }, queryClient));
  const sending = sendMutation.isPending;
  const cause = sendMutation.error ?? cancelMutation.error;
  const error = cause ? botErrorMessage(cause) : undefined, pollError = conversation.error ? botErrorMessage(conversation.error) : undefined;
  const send = form.handleSubmit(({ draft, customOrder, members }) => {
    if (!visible || sending || !draft.trim() || state.room.archivedAt || (customOrder && !members.length)) return;
    const params = { roomId: room.id, text: draft, ...(customOrder ? { memberIds: members } : {}) };
    const signature = JSON.stringify(params);
    if (command.current?.signature !== signature) command.current = { signature, id: crypto.randomUUID() };
    sendMutation.mutate({ ...params, commandId: command.current.id });
  });
  const cancel = async (round: BotRoomRound) => {
    if (!visible || cancelling.has(round.id) || round.roomId !== room.id) return;
    cancelMutation.mutate(round.id);
  };
  const saved = async () => { await onSaved(); await refresh(); };
  const name = (id: string) => bots.find(bot => bot.id === id)?.name ?? t("Unavailable Bot");
  return <section className="desktop-bot-room-chat" aria-label={state.room.name}>
    <header className="desktop-bot-room-header"><div><h2>{state.room.name}</h2><small>{state.room.archivedAt ? t("Archived") : t("Room")}</small></div><Button variant="ghost" type="button" aria-label={t("Room settings")} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings size={16} /></Button></header>
    <p className="desktop-bot-room-privacy">{t("Private threads are not automatically included in rooms.")}</p>
    <AnimatedCollapse expanded={settingsOpen} keepMounted className="desktop-bot-room-settings"><DesktopRoomEditor room={state.room} bots={bots} rpc={rpc} onSaved={saved} /></AnimatedCollapse>
    {!!state.rounds.length && <div className="desktop-bot-room-rounds"><Button variant="ghost" type="button" aria-expanded={roundsOpen} onClick={() => setRoundsOpen(value => !value)}>{t("Room rounds")}</Button>
      <AnimatedCollapse expanded={roundsOpen}><div className="desktop-bot-room-round-list">{state.rounds.filter(round => round.roomId === room.id).map(round => <article key={round.id} data-round-id={round.id}>
        <header><strong>{t(statuses[round.status])}</strong><time dateTime={new Date(round.createdAt).toISOString()}>{new Date(round.createdAt).toLocaleTimeString()}</time>{["queued", "running"].includes(round.status) && <Button variant="secondary" type="button" disabled={cancelling.has(round.id)} onClick={() => void cancel(round)}>{t("Stop round")}</Button>}</header>
        <ol>{round.speakers.map(speaker => <li key={speaker.botId}><span>{name(speaker.botId)}</span><small>{t(statuses[speaker.status])}</small>{speaker.threadId && <Button variant="secondary" type="button" aria-label={`${t("Open member thread")}: ${name(speaker.botId)}`} onClick={() => onOpenThread({ botId: speaker.botId, threadId: speaker.threadId! })}>{t("Open member thread")}</Button>}{speaker.error && <p role="alert">{t(speaker.error)}</p>}</li>)}</ol>
      </article>)}</div></AnimatedCollapse>
    </div>}
    <div ref={log} className="desktop-bot-room-messages" role="log" aria-label={t("Room messages")} onScroll={() => { const element = log.current!; follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 30; }}>
      {page?.hasMore && <Button variant="secondary" type="button" disabled={loadingOlder} onClick={() => void older()}>{t(loadingOlder ? "Loading…" : "Load older messages")}</Button>}
      {messages.map((message, index) => {
        const bot = bots.find(bot => bot.id === message.botId);
        return <Fragment key={message.id}><BotDateSeparator createdAt={message.createdAt} previousCreatedAt={messages[index - 1]?.createdAt} />
          <article className="desktop-bot-room-message" data-kind={message.kind}>
            <header>{message.botId && <span className="desktop-bots-avatar" aria-hidden="true">{bot?.avatar || <Bot size={16} />}</span>}<strong>{message.botId ? name(message.botId) : t("You")}</strong>{bot && <HarnessIcon harness={bot.harness} className="size-3.5" />}{message.status && <small>{t(statuses[message.status])}</small>}</header>
            {message.kind === "assistant" ? <AgentMarkdown text={message.text} className="assistant-markdown" hardBreaks /> : <p>{message.kind === "status" ? t(message.text) : message.text}</p>}
            {message.botId && message.threadId && <Button variant="secondary" type="button" onClick={() => onOpenThread({ botId: message.botId!, threadId: message.threadId! })}>{t("Open member thread")}</Button>}
          </article>
        </Fragment>;
      })}
      {!messages.length && <p>{t(page ? "Start a room conversation" : "Loading…")}</p>}
    </div>
    <div className="desktop-bot-room-composer">
      {(error || pollError) && <p role="alert">{t(error ?? pollError!)} <Button variant="secondary" type="button" onClick={() => void refresh()}>{t("Refresh")}</Button></p>}
      <Button variant="ghost" type="button" aria-expanded={orderOpen} onClick={() => setOrderOpen(value => !value)}>{t("This round's speakers")}</Button>
      <AnimatedCollapse expanded={orderOpen} keepMounted><div className="desktop-bot-room-order"><label><Checkbox data-ui="checkbox"  checked={!customOrder} onCheckedChange={(checked) => setCustomOrder(!(checked === true))} />{t("Use room member order")}</label><AnimatedCollapse expanded={customOrder}><DesktopBotMembers bots={bots.filter(bot => state.room.memberIds.includes(bot.id))} ids={members} ordered onChange={setMembers} disabled={sending} /></AnimatedCollapse></div></AnimatedCollapse>
      <form noValidate onSubmit={send}><Textarea variant="editor" aria-label={t("Message room")} placeholder={t("Message room")} {...form.register("draft")} aria-invalid={!!form.formState.errors.draft} disabled={sending || !!state.room.archivedAt} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><Button variant="primary" size="icon" type="submit" aria-label={t("Send")} disabled={sending || !!state.room.archivedAt || !draft.trim() || (customOrder && !members.length)}><ArrowUp size={17} /></Button><FieldError errors={[form.formState.errors.draft, form.formState.errors.members]} /></form>
    </div>
  </section>;
}
