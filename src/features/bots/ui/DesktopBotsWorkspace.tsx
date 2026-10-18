import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { BotChat } from "./BotChat";
import { BotSettings } from "./BotSettings";
import { type BotRpc } from "../model/botRpc";
import type { BotPatch } from "../model/botView";
import { botCacheKey, type BotScope, type BotsSnapshot, type BotThread, type BotView } from "../model/bots";
import { migrateDefaultBotCache, scopedBotRpc } from "../model/botClient";
import { BOT_SELECTION_EVENT, readBotSelection, selectBotThread } from "../model/botSelection";
import { useBotUnread } from "../model/useBotUnread";
import { readBotPins, writeBotPins } from "../model/botPins";
import { BotRecipientPicker } from "./BotRecipientPicker";
import { ExplorerMenu } from "../../connections/files/ui/ExplorerMenu";
import { BotAvatar } from "./BotAvatar";
import { BotThreadSwitcher } from "./DesktopBotsChrome";
import { BotMemoryDrafts } from "../model/botMemoryDrafts";
import { DesktopBotMemory } from "./DesktopBotMemory";
import { DesktopBotThreadSettings } from "./DesktopBotThreadSettings";
import { DesktopBotRuntimeSettings } from "./DesktopBotRuntimeSettings";
import { DesktopBotActivity } from "./DesktopBotActivity";
import { DesktopBotAutomation } from "./DesktopBotAutomation";
import { DesktopBotDelegations, DesktopBotDelegationCard } from "./DesktopBotDelegations";
import { DesktopBotTeams } from "./DesktopBotTeams";
import { DesktopBotRooms } from "./DesktopBotRooms";
import { DesktopBotRoomChat } from "./DesktopBotRoomChat";
import type { BotTeam, BotTeams } from "../model/botTeams";
import type { BotRoom, BotRooms } from "../model/botRooms";
import { botErrorMessage } from "../model/botErrors";
import { REMOTE_PROVIDERS, type HostDescriptor, type HostModelCatalog, type HostProject } from "../../connections/model/protocol";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { AnimatedCollapse, useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { Archive, Bot, ChevronRight, Loader2, Pin, Plus, Search, MessageSquare, X } from "../../../shared/ui/icons";

type Props = ComponentProps<typeof BotChat>;
const EMPTY_THREADS: BotThread[] = [];

/** Capability boundary: old Hosts keep the unchanged assistant controller. */
export function DesktopBotsWorkspace(props: Props) {
  const visible = useSurfaceVisibility();
  const [descriptor, setDescriptor] = useState<HostDescriptor>();
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible || descriptor) return;
    let disposed = false;
    void props.rpc<HostDescriptor>("environment.describe", { supportedProviders: REMOTE_PROVIDERS }).then((value) => {
      if (!disposed) { setDescriptor(value); setFailure(undefined); }
    }, (error) => { if (!disposed) setFailure(botErrorMessage(error)); });
    return () => { disposed = true; };
  }, [props.rpc, visible, attempt]);
  const rpc = useMemo<BotRpc>(() => (method, params) => method === "environment.describe" && descriptor
    ? Promise.resolve(descriptor as never) : props.rpc(method, params), [props.rpc, descriptor]);
  const { t } = useTranslation();
  if (failure && !descriptor) return <div className="assistant-availability" role="alert">
    <p>{t(failure)}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("Retry")}</button>
  </div>;
  if (!descriptor) return <div className="assistant-availability assistant-loading" role="status">
    <Loader2 size={20} className="animate-spin motion-reduce:animate-none" /><span>{t("Connecting…")}</span>
  </div>;
  if (!descriptor.capabilities?.includes("bots.v1")) return <BotChat {...props} rpc={rpc} />;
  return <MultiBotWorkspace {...props} rpc={rpc} memorySupported={descriptor.capabilities.includes("botMemory.v1")} runtimeSupported={descriptor.capabilities.includes("bots.runtime.v1")} managementSupported={descriptor.capabilities.includes("bots.management.v1")} delegationSupported={descriptor.capabilities.includes("bots.delegation.v1")} teamsSupported={descriptor.capabilities.includes("bots.teams.v1")} roomsSupported={descriptor.capabilities.includes("bots.rooms.v1")} />;
}

function MultiBotWorkspace(props: Props & { memorySupported: boolean; runtimeSupported: boolean; managementSupported: boolean; delegationSupported: boolean; teamsSupported: boolean; roomsSupported: boolean }) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [navigationWidth, setNavigationWidth] = useState(() => {
    try { const value = Number(localStorage.getItem("monocode.bots-sidebar-width")); return value >= 240 && value <= 400 ? value : 280; } catch { return 280; }
  });
  const commitNavigationWidth = (width: number) => {
    setNavigationWidth(width);
    try { localStorage.setItem("monocode.bots-sidebar-width", String(width)); } catch { /* Storage is optional. */ }
  };
  const [snapshot, setSnapshot] = useState<BotsSnapshot>();
  const [teams, setTeams] = useState<BotTeam[]>([]), [rooms, setRooms] = useState<BotRoom[]>([]);
  const [managementPanel, setManagementPanel] = useState<"teams" | "rooms">(), [roomSelection, setRoomSelection] = useState<string>(), [visitedRooms, setVisitedRooms] = useState<string[]>([]);
  const [collaborationError, setCollaborationError] = useState<string>();
  const botNamesKey = JSON.stringify((snapshot?.bots ?? []).map(bot => [bot.id, bot.name]));
  const botNames = useMemo<Record<string, string>>(() => Object.fromEntries(JSON.parse(botNamesKey) as [string, string][]), [botNamesKey]);
  const [connectionError, setConnectionError] = useState<string>();
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState(() => readBotSelection(props.hostKey));
  const [visited, setVisited] = useState<BotScope[]>([]);
  const [creatingBot, setCreatingBot] = useState(false);
  const [recipientOpen, setRecipientOpen] = useState(false);
  const recipientMotion = useCollapseMotion(recipientOpen);
  const recipientShown = recipientOpen || recipientMotion.foldState !== "closed";
  const [pinsByHost, setPinsByHost] = useState<Record<string, string[]>>(() => ({ [props.hostKey]: readBotPins(props.hostKey) }));
  const pins = useMemo(() => pinsByHost[props.hostKey] ?? readBotPins(props.hostKey), [pinsByHost, props.hostKey]);
  const savePins = (ids: string[]) => {
    setPinsByHost(current => ({ ...current, [props.hostKey]: ids })); writeBotPins(props.hostKey, ids);
  };
  const togglePin = (id: string) => savePins(pins.includes(id) ? pins.filter(value => value !== id) : [...pins, id]);
  useEffect(() => {
    if (!snapshot) return;
    const active = pins.filter(id => snapshot.bots.some(bot => bot.id === id && !bot.archivedAt));
    if (active.length !== pins.length) savePins(active);
  }, [snapshot, pins, props.hostKey]);
  const [showArchive, setShowArchive] = useState(false);
  const [creatingThread, setCreatingThread] = useState<string>();
  const [threadName, setThreadName] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<HostModelCatalog>({ models: {}, errors: {} });
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "failed">("loading");
  const [draftVersion, setDraftVersion] = useState(0);
  const [memoryDrafts] = useState(() => new BotMemoryDrafts());
  const workspace = useRef<HTMLDivElement>(null);
  const restoreRecipientFocus = useRef(false);
  useEffect(() => {
    if (recipientMotion.foldState !== "closed" || !restoreRecipientFocus.current) return;
    restoreRecipientFocus.current = false;
    workspace.current?.querySelector<HTMLButtonElement>('.desktop-bots-thread-surface:not([aria-hidden]) .desktop-bots-navigation-header button:last-child')?.focus();
  }, [recipientMotion.foldState]);
  const createCommand = useRef<{ text: string; id: string } | undefined>(undefined);
  const lastThread = useRef(new Map<string, string>(selection ? [[selection.botId, selection.threadId]] : []));
  const choose = useCallback((incoming: BotScope) => {
    // Selection events also carry environmentId; only persist the owned scope.
    const scope = { botId: incoming.botId, threadId: incoming.threadId };
    setSelection(scope);
    lastThread.current.set(scope.botId, scope.threadId);
    setVisited((current) => current.some((item) => item.botId === scope.botId && item.threadId === scope.threadId) ? current : [...current, scope]);
    setCreatingBot(false); setRecipientOpen(false);
    setManagementPanel(undefined); setRoomSelection(undefined);
    setShowArchive(false);
    setCreatingThread(undefined);
  }, []);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<BotScope & { environmentId: string }>).detail;
      if (detail.environmentId === props.hostKey) choose(detail);
    };
    window.addEventListener(BOT_SELECTION_EVENT, changed);
    return () => window.removeEventListener(BOT_SELECTION_EVENT, changed);
  }, [props.hostKey, choose]);
  const select = useCallback((scope: BotScope) => selectBotThread(props.hostKey, scope), [props.hostKey]);
  const refresh = useCallback(async () => {
    const next = await props.rpc<BotsSnapshot>("bots.list", { includeArchived: true });
    setSnapshot(next);
    setError(undefined);
    return next;
  }, [props.rpc]);
  const refreshCollaboration = useCallback(async () => {
    const [nextTeams, nextRooms] = await Promise.all([
      props.teamsSupported ? props.rpc<BotTeams>("botTeams.list", { includeArchived: true }) : undefined,
      props.roomsSupported ? props.rpc<BotRooms>("botRooms.list", { includeArchived: true }) : undefined,
    ]);
    if (nextTeams) setTeams(nextTeams.teams);
    if (nextRooms) setRooms(nextRooms.rooms);
    setCollaborationError(undefined);
  }, [props.rpc, props.teamsSupported, props.roomsSupported]);
  useEffect(() => {
    if (!visible || (!props.teamsSupported && !props.roomsSupported)) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refreshCollaboration(); } catch (cause) { if (!disposed) setCollaborationError(botErrorMessage(cause)); } finally { if (!disposed) timer = setTimeout(poll, 2000); } };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [visible, refreshCollaboration]);
  const openRoom = useCallback((id: string) => {
    setRoomSelection(id); setVisitedRooms(current => current.includes(id) ? current : [...current, id]);
    setManagementPanel(undefined); setCreatingBot(false); setRecipientOpen(false); setCreatingThread(undefined); setShowArchive(false);
  }, []);
  const openManagement = (panel: "teams" | "rooms") => { setManagementPanel(panel); setRoomSelection(undefined); setCreatingBot(false); setRecipientOpen(false); setCreatingThread(undefined); setShowArchive(false); };
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await props.rpc<BotsSnapshot>("bots.list", { includeArchived: true });
        if (!disposed) { setSnapshot(next); setConnectionError(undefined); }
      } catch (error) { if (!disposed) setConnectionError(botErrorMessage(error)); }
      finally { if (!disposed) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [props.rpc, visible]);
  useEffect(() => {
    if (!snapshot) return;
    const usable = snapshot.threads.filter((thread) => !thread.archivedAt && snapshot.bots.some((bot) => bot.id === thread.botId && !bot.archivedAt));
    const selected = usable.find((thread) => thread.id === selection?.threadId && thread.botId === selection.botId)
      ?? usable.find((thread) => thread.id === snapshot.defaultThreadId && thread.botId === snapshot.defaultBotId)
      ?? usable[0];
    if (!selected) { setSelection(undefined); return; }
    const scope = { botId: selected.botId, threadId: selected.id };
    if (selected.id === snapshot.defaultThreadId && selected.botId === snapshot.defaultBotId)
      migrateDefaultBotCache(props.hostKey, botCacheKey(props.hostKey, scope));
    if (selection?.threadId !== selected.id || selection.botId !== selected.botId) select(scope);
    else setVisited((current) => current.some((item) => item.botId === scope.botId && item.threadId === scope.threadId) ? current : [...current, scope]);
  }, [snapshot, selection, props.hostKey, select]);
  const activeThreads = useMemo(() => snapshot?.threads.filter((thread) => !thread.archivedAt && snapshot.bots.some((bot) => bot.id === thread.botId && !bot.archivedAt)) ?? EMPTY_THREADS, [snapshot]);
  const activity = useBotUnread(props.hostKey, activeThreads, props.rpc, visible);
  const loadCatalog = useCallback(async () => {
    setCatalogState("loading");
    try {
      const [models, projects] = await Promise.all([props.rpc<HostModelCatalog>("models.list"), props.rpc<HostProject[]>("projects.list")]);
      setCatalog(models); setProjects(projects); setCatalogState("ready");
    } catch (cause) { setError(botErrorMessage(cause)); setCatalogState("failed"); }
  }, [props.rpc]);
  useEffect(() => { if (creatingBot && visible && catalogState === "loading") void loadCatalog(); }, [creatingBot, visible, loadCatalog]);
  const createBot = async (patch: BotPatch) => {
    if (busy) return;
    setBusy(true); setError(undefined);
    const text = JSON.stringify(patch);
    if (createCommand.current?.text !== text) createCommand.current = { text, id: crypto.randomUUID() };
    try {
      const result = await props.rpc<{ bot: BotView; thread: BotThread }>("bots.create", { commandId: createCommand.current.id, patch });
      setSnapshot((current) => ({
        revision: (current?.revision ?? 0) + 1,
        ...current,
        bots: [...(current?.bots ?? []).filter((bot) => bot.id !== result.bot.id), result.bot],
        threads: [...(current?.threads ?? []).filter((thread) => thread.id !== result.thread.id), result.thread],
      }));
      createCommand.current = undefined;
      setDraftVersion((value) => value + 1);
      select({ botId: result.bot.id, threadId: result.thread.id });
      void refresh().catch(() => {});
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const threadCommand = useRef<{ text: string; id: string } | undefined>(undefined);
  const createThread = async () => {
    if (!creatingThread || !threadName.trim() || busy) return;
    const botId = creatingThread;
    setBusy(true); setError(undefined);
    const text = JSON.stringify([botId, threadName.trim()]);
    if (threadCommand.current?.text !== text) threadCommand.current = { text, id: crypto.randomUUID() };
    try {
      const thread = await props.rpc<BotThread>("botThreads.create", { commandId: threadCommand.current.id, botId, title: threadName.trim() });
      setSnapshot((current) => current && { ...current, threads: [...current.threads.filter((item) => item.id !== thread.id), thread] });
      threadCommand.current = undefined;
      setThreadName("");
      select({ botId, threadId: thread.id });
      void refresh().catch(() => {});
    } catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const archiveCommands = useRef(new Map<string, string>());
  const changeArchive = async (method: "bots.archive" | "bots.restore" | "botThreads.archive" | "botThreads.restore", bot: BotView, thread?: BotThread) => {
    const expectedRevision = thread?.revision ?? bot.revision;
    const signature = JSON.stringify([method, bot.id, thread?.id, expectedRevision]);
    const commandId = archiveCommands.current.get(signature) ?? crypto.randomUUID();
    archiveCommands.current.set(signature, commandId);
    await props.rpc(method, { commandId, botId: bot.id, ...(thread ? { threadId: thread.id } : {}), expectedRevision });
    const next = await refresh();
    archiveCommands.current.delete(signature);
    if (method.endsWith(".restore")) {
      const target = thread ?? next.threads.find((item) => item.botId === bot.id && item.id === bot.defaultThreadId && !item.archivedAt);
      if (target) select({ botId: bot.id, threadId: target.id });
    }
  };
  const restore = async (bot: BotView, thread?: BotThread) => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await changeArchive(thread ? "botThreads.restore" : "bots.restore", bot, thread); }
    catch (cause) { setError(botErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const openDelegationThread = useCallback((scope: BotScope) => {
    void refresh().then(next => {
      if (next.threads.some(thread => thread.id === scope.threadId && thread.botId === scope.botId && !thread.archivedAt) && next.bots.some(bot => bot.id === scope.botId && !bot.archivedAt)) select(scope);
      else setError("Thread not available");
    }, cause => setError(botErrorMessage(cause)));
  }, [refresh, select]);
  const selectBot = (bot: BotView) => {
      const thread = snapshot?.threads.find((thread) => thread.botId === bot.id && thread.id === lastThread.current.get(bot.id) && !thread.archivedAt)
        ?? snapshot?.threads.find((thread) => thread.botId === bot.id && thread.id === bot.defaultThreadId && !thread.archivedAt)
        ?? snapshot?.threads.find((thread) => thread.botId === bot.id && !thread.archivedAt);
      if (thread) select({ botId: bot.id, threadId: thread.id });
  };
  const newThread = (botId: string) => { setManagementPanel(undefined); setRoomSelection(undefined); setShowArchive(false); setCreatingThread(botId); setThreadName(""); setError(undefined); };
  const roomDraft = useRef<{ signature: string; createId: string; sendId: string; room?: BotRoom } | undefined>(undefined);
  const sendToRecipients = async (members: BotView[], text: string) => {
    if (!props.roomsSupported || members.length < 2) return;
    const memberIds = members.map(bot => bot.id), signature = JSON.stringify([memberIds, text]);
    if (roomDraft.current?.signature !== signature) roomDraft.current = { signature, createId: crypto.randomUUID(), sendId: crypto.randomUUID() };
    const request = roomDraft.current;
    request.room ??= await props.rpc<BotRoom>("botRooms.create", { commandId: request.createId, name: members.map(bot => bot.name).join(", ").slice(0, 100), memberIds });
    const room = request.room;
    await props.rpc("botRooms.send", { commandId: request.sendId, roomId: room.id, text });
    setRooms(current => [...current.filter(item => item.id !== room.id), room]);
    roomDraft.current = undefined; openRoom(room.id);
    void refreshCollaboration().catch(cause => setCollaborationError(botErrorMessage(cause)));
  };
  const navigation = <BotNavigation navigationWidth={navigationWidth} onNavigationWidth={commitNavigationWidth} pins={pins} onTogglePin={togglePin} draftOpen={recipientOpen || creatingBot} hostName={props.hostName}
    teams={teams} rooms={rooms} teamsSupported={props.teamsSupported} roomsSupported={props.roomsSupported} roomSelection={roomSelection} onOpenRoom={openRoom} onManage={openManagement}
    snapshot={snapshot} selection={showArchive || managementPanel || roomSelection ? undefined : selection} activity={activity} environmentId={props.hostKey}
    archiveOpen={showArchive} onArchive={() => { setManagementPanel(undefined); setRoomSelection(undefined); setShowArchive(true); setCreatingBot(false); setRecipientOpen(false); setCreatingThread(undefined); }}
    onNewBot={() => { setManagementPanel(undefined); setRoomSelection(undefined); setShowArchive(false); setCreatingBot(false); setRecipientOpen(true); setCreatingThread(undefined); setError(undefined); }}
    onSelectBot={selectBot} />;
  const draftShown = !roomSelection && (recipientShown || creatingBot || !selection || showArchive || !!managementPanel);
  const closeArchive = () => {
    setShowArchive(false);
    requestAnimationFrame(() => workspace.current?.querySelector<HTMLButtonElement>('.desktop-bots-thread-surface:not([aria-hidden]) .desktop-bots-archive-entry')?.focus());
  };
  return <div ref={workspace} className="desktop-bots-host">
    {(error || connectionError || collaborationError) && <div className="desktop-bots-error" role="alert">{t(error ?? connectionError ?? collaborationError!)}<button type="button" onClick={() => { setError(undefined); setConnectionError(undefined); setCollaborationError(undefined); }} aria-label={t("Dismiss")}><X size={14} /></button></div>}
    {visited.map((scope) => {
      const thread = snapshot?.threads.find((thread) => thread.id === scope.threadId && thread.botId === scope.botId);
      const bot = snapshot?.bots.find((bot) => bot.id === scope.botId);
      const selected = !draftShown && !roomSelection && selection?.botId === scope.botId && selection.threadId === scope.threadId;
      return <div key={botCacheKey(props.hostKey, scope)} className="desktop-bots-thread-surface" style={{ display: selected ? "flex" : "none" }} inert={!selected} aria-hidden={!selected || undefined}>
        <SurfaceVisibilityContext.Provider value={visible && selected}>
          <ScopedBotChat {...props} scope={scope} delegationSupported={props.delegationSupported} botNames={botNames} onOpenBotThread={openDelegationThread} threadTitle={thread?.title} botNavigation={navigation}
            botMemory={props.memorySupported ? <DesktopBotMemory botId={scope.botId} rpc={props.rpc} drafts={memoryDrafts} /> : undefined}
            botPinControl={bot ? <button type="button" aria-pressed={pins.includes(bot.id)} onClick={() => togglePin(bot.id)}><Pin size={14} />{t(pins.includes(bot.id) ? "Unpin Bot" : "Pin Bot")}</button> : undefined}
            botAvatarSupported={props.managementSupported}
            botSettings={bot}
            botThreadPicker={bot ? <BotThreadSwitcher bot={bot} threads={activeThreads.filter(item => item.botId === bot.id)} selected={scope.threadId} onSelect={item => select({ botId: item.botId, threadId: item.id })} onNew={() => newThread(bot.id)} /> : undefined}
            botReadOnlyReason={thread?.kind === "delegation" ? "Delegation threads accept approvals and questions. Start a direct thread for a new message." : thread?.kind === "room" ? "Room member threads accept approvals and questions. Send new messages in the room." : undefined}
            botRuntime={bot && props.managementSupported ? <DesktopBotRuntimeSettings bot={bot} rpc={props.rpc} delegationSupported={props.delegationSupported} onSaved={() => void refresh().catch((cause) => setError(botErrorMessage(cause)))} /> : undefined}
            botDelegations={props.delegationSupported ? <DesktopBotDelegations scope={scope} rpc={props.rpc} botNames={botNames} onOpenThread={openDelegationThread} /> : undefined}
            botActivity={props.runtimeSupported ? <DesktopBotActivity scope={scope} rpc={props.rpc} /> : undefined}
            botAutomation={bot && props.managementSupported ? <DesktopBotAutomation bot={bot} rpc={props.rpc} onSaved={() => void refresh().catch((cause) => setError(botErrorMessage(cause)))} /> : undefined}
            botManagement={bot && thread ? <DesktopBotThreadSettings bot={bot} thread={thread} defaultBotId={snapshot?.defaultBotId} rpc={props.rpc} onSaved={refresh}
              onArchiveBot={() => changeArchive("bots.archive", bot)} onArchiveThread={() => changeArchive("botThreads.archive", bot, thread)} /> : undefined}
            defaultScope={scope.botId === snapshot?.defaultBotId && scope.threadId === snapshot.defaultThreadId} />
        </SurfaceVisibilityContext.Provider>
      </div>;
    })}
    {visitedRooms.map(id => {
      const room = rooms.find(room => room.id === id), active = roomSelection === id;
      return room ? <div key={id} className="assistant-chat desktop-bots-workspace desktop-bots-create desktop-bots-room-surface" style={{ display: active ? "grid" : "none" }} inert={!active} aria-hidden={!active || undefined}><SurfaceVisibilityContext.Provider value={visible && active}>
        {navigation}<div className="desktop-bots-create-content"><DesktopBotRoomChat environmentId={props.hostKey} room={room} bots={snapshot?.bots ?? []} rpc={props.rpc} onSaved={refreshCollaboration} onOpenThread={openDelegationThread} /></div>
      </SurfaceVisibilityContext.Provider></div> : null;
    })}
    <div className="assistant-chat desktop-bots-workspace desktop-bots-create" style={{ display: draftShown ? "grid" : "none" }} inert={!draftShown} aria-hidden={!draftShown || undefined}>
      <SurfaceVisibilityContext.Provider value={visible && draftShown}>
        {navigation}
        <section className="desktop-bots-create-content">
          <motionElement.div
      initial={false} animate={{ x: recipientOpen ? 0 : "100%", opacity: recipientOpen ? 1 : 0 }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={recipientMotion.finish} className="desktop-bots-recipient-surface" data-fold-state={recipientMotion.foldState} data-open={recipientOpen} inert={!recipientOpen} aria-hidden={!recipientOpen || undefined}
            >
            <SurfaceVisibilityContext.Provider value={visible && draftShown && recipientOpen}>
              <BotRecipientPicker open={recipientOpen} bots={snapshot?.bots ?? []} roomsSupported={props.roomsSupported} onChoose={selectBot}
                onCreate={() => { setRecipientOpen(false); setCreatingBot(true); }} onClose={() => { restoreRecipientFocus.current = true; setRecipientOpen(false); }} onSend={sendToRecipients} />
            </SurfaceVisibilityContext.Provider>
          </motionElement.div>
          {props.teamsSupported && <div className="desktop-bot-management-surface" hidden={managementPanel !== "teams"} inert={managementPanel !== "teams"}><SurfaceVisibilityContext.Provider value={visible && draftShown && managementPanel === "teams"}><DesktopBotTeams teams={teams} bots={snapshot?.bots ?? []} rpc={props.rpc} onSaved={refreshCollaboration} /></SurfaceVisibilityContext.Provider></div>}
          {props.roomsSupported && <div className="desktop-bot-management-surface" hidden={managementPanel !== "rooms"} inert={managementPanel !== "rooms"}><SurfaceVisibilityContext.Provider value={visible && draftShown && managementPanel === "rooms"}><DesktopBotRooms rooms={rooms} bots={snapshot?.bots ?? []} rpc={props.rpc} onSaved={refreshCollaboration} onOpenRoom={openRoom} /></SurfaceVisibilityContext.Provider></div>}
          {managementPanel ? null : showArchive ? <BotArchive snapshot={snapshot} busy={busy} onRestore={restore} onClose={closeArchive} /> : creatingBot ? <>
            <header><strong>{t("New bot")}</strong><button type="button" disabled={busy} onClick={() => { setCreatingBot(false); setDraftVersion((value) => value + 1); createCommand.current = undefined; }}>{t("Cancel")}</button></header>
            <BotSettings key={draftVersion} value={null} submitLabel="Create bot" catalog={catalog} catalogState={catalogState}
              projects={projects} busy={busy} onSave={createBot} onRetryCatalog={() => void loadCatalog()} />
          </> : recipientShown ? null : <div className="desktop-bots-empty">
            <Bot size={30} aria-hidden="true" />
            <h2>{t(snapshot ? "No bots yet" : "Loading…")}</h2>
            {snapshot && <button type="button" onClick={() => setRecipientOpen(true)}>{t("Create bot")}</button>}
          </div>}
        </section>
      </SurfaceVisibilityContext.Provider>
    </div>
    <AnimatedCollapse expanded={!!creatingThread} className="desktop-bots-create-thread">
      <form onSubmit={(event) => { event.preventDefault(); void createThread(); }}>
        <label>{t("Thread name")}<input data-ui="input" aria-label={t("Thread name")} value={threadName} autoFocus
          disabled={busy} onChange={(event) => setThreadName(event.target.value)} /></label>
        <button type="submit" disabled={busy || !threadName.trim()}>{t(busy ? "Creating…" : "Create thread")}</button>
        <button type="button" disabled={busy} onClick={() => setCreatingThread(undefined)}>{t("Cancel")}</button>
      </form>
    </AnimatedCollapse>
  </div>;
}

function ScopedBotChat({ scope, defaultScope, delegationSupported, botNames, onOpenBotThread, ...props }: Props & { scope: BotScope; defaultScope: boolean; delegationSupported: boolean; botNames: Record<string, string>; onOpenBotThread: (scope: BotScope) => void }) {
  const rpc = useMemo(() => scopedBotRpc(props.rpc, scope, defaultScope), [props.rpc, scope.botId, scope.threadId, defaultScope]);
  const renderBotDelegation = useCallback((delegationId: string, revision: number) => <DesktopBotDelegationCard scope={scope} rpc={props.rpc} delegationId={delegationId} revision={revision} botNames={botNames} onOpenThread={onOpenBotThread} />, [scope.botId, scope.threadId, props.rpc, botNames, onOpenBotThread]);
  return <BotChat {...props} rpc={rpc} cacheKey={botCacheKey(props.hostKey, scope)} renderBotDelegation={delegationSupported ? renderBotDelegation : undefined} desktopBots />;
}

type Activity = ReturnType<typeof useBotUnread>;
function BotNavigation({ navigationWidth, onNavigationWidth, pins, onTogglePin, draftOpen, hostName, snapshot, selection, activity, environmentId, archiveOpen, onArchive, onNewBot, onSelectBot, teams, rooms, teamsSupported, roomsSupported, roomSelection, onOpenRoom, onManage }: {
  pins: string[]; onTogglePin: (id: string) => void; draftOpen: boolean;
  teams: BotTeam[]; rooms: BotRoom[]; teamsSupported: boolean; roomsSupported: boolean; roomSelection?: string; onOpenRoom: (id: string) => void; onManage: (panel: "teams" | "rooms") => void;
  hostName: string; snapshot?: BotsSnapshot; selection?: BotScope;
  archiveOpen: boolean; onArchive: () => void;
  navigationWidth: number; onNavigationWidth: (width: number) => void;
  activity: Activity; environmentId: string; onNewBot: () => void;
  onSelectBot: (bot: BotView) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visible = useSurfaceVisibility();
  const resize = useDragResize({ cssProperty: "--bots-sidebar-preference", min: 240, max: () => 400, defaultWidth: 280, initial: navigationWidth, value: navigationWidth, onCommit: onNavigationWidth });
  useEffect(() => { if (!visible) resize.finishDrag(); }, [visible, resize.finishDrag]);
  const [menu, setMenu] = useState<{ botId: string; x: number; y: number; open: boolean }>();
  useEffect(() => { if (!visible) setMenu(current => current && { ...current, open: false }); }, [visible]);
  const menuBot = snapshot?.bots.find(bot => bot.id === menu?.botId && !bot.archivedAt);
  const matchesQuery = (bot: BotView) => `${bot.name} ${snapshot?.threads.filter(thread => thread.botId === bot.id && !thread.archivedAt).map(thread => thread.title).join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const pinnedBots = pins.flatMap(id => { const bot = snapshot?.bots.find(bot => bot.id === id && !bot.archivedAt); return bot && matchesQuery(bot) ? [bot] : []; });
  const retainedPinned = useRef(pinnedBots);
  if (pinnedBots.length) retainedPinned.current = pinnedBots;
  const bots = snapshot?.bots.filter(bot => !bot.archivedAt && !pins.includes(bot.id) && matchesQuery(bot)) ?? [];
  const [foldedTeams, setFoldedTeams] = useState(new Set<string>());
  const activeTeams = teams.filter(team => !team.archivedAt);
  const groups: { id: string; team?: BotTeam; bots: BotView[] }[] = activeTeams.map(team => ({ id: team.id, team, bots: bots.filter(bot => team.memberBotIds.includes(bot.id)) }));
  const ungrouped = bots.filter(bot => !activeTeams.some(team => team.memberBotIds.includes(bot.id)));
  if (ungrouped.length || !groups.length) groups.push({ id: "ungrouped", bots: ungrouped });
  const unreadFor = (bot: BotView) => snapshot?.threads.filter(thread => thread.botId === bot.id && !thread.archivedAt).reduce((total, thread) => total + (activity.get(botCacheKey(environmentId, { botId: bot.id, threadId: thread.id }))?.count ?? 0), 0) ?? 0;
  const renderBot = (bot: BotView, chief = false) => {
        const threads = snapshot!.threads.filter((thread) => thread.botId === bot.id && !thread.archivedAt);
        const unread = unreadFor(bot);
        const newest = threads.map((thread) => activity.get(botCacheKey(environmentId, { botId: bot.id, threadId: thread.id }))?.latest).filter((message) => !!message).sort((a, b) => b.createdAt - a.createdAt)[0];
        const at = newest?.createdAt ?? Math.max(bot.updatedAt, ...threads.map(thread => thread.updatedAt));
        return <div key={bot.id} className="desktop-bots-bot-group">
          <div className="desktop-bots-contact" data-selected={!draftOpen && selection?.botId === bot.id} onContextMenu={event => {
            event.preventDefault(); if (visible) setMenu({ botId: bot.id, x: event.clientX, y: event.clientY, open: true });
          }} onKeyDown={event => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ botId: bot.id, x: rect.left + 20, y: rect.bottom, open: true });
            }
          }}>
            <button type="button" className="desktop-bots-contact-main" onClick={() => onSelectBot(bot)} aria-label={unread ? t("{bot}, {count} unread messages", { bot: bot.name, count: unread }) : bot.name} title={bot.name} aria-current={(!draftOpen && selection?.botId === bot.id) || undefined}>
              <BotAvatar bot={bot} size={36} />
              <span className="desktop-bots-contact-copy"><span className="desktop-bots-contact-title"><strong>{bot.name}</strong>{chief && <small className="desktop-bots-chief" title={t("Chief of Staff")}>{t("Chief")}</small>}<time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time></span><span className="desktop-bots-preview">{newest && "text" in newest ? newest.text.replace(/\s+/g, " ").trim() || t("Attachments") : threads[0]?.title || t("Main thread")}</span></span>
              {unread > 0 && <span className="desktop-bots-unread" aria-hidden="true" />}
            </button>
          </div>
        </div>;
  };
  const setNavigationRef = useCallback((node: HTMLElement | null) => resize.setPaneRef(node?.parentElement ?? null), [resize.setPaneRef]);
  return <nav ref={setNavigationRef} className="desktop-bots-navigation" aria-label={t("Bots")}>
    <header className="desktop-bots-navigation-header"><span className="desktop-bots-host-name" title={hostName}>{hostName}</span><button data-ui="icon-button" type="button" className="assistant-icon-button" onClick={onNewBot} aria-label={t("New bot")} title={t("New conversation")}><Plus size={20} /></button></header>
    <label className="desktop-bots-search"><Search size={15} aria-hidden="true" /><input data-ui="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search bots")} aria-label={t("Search bots")} /></label>
    <AnimatedCollapse expanded={pinnedBots.length > 0} className="desktop-bots-pinned-collapse">
      <div className="desktop-bots-pinned" aria-label={t("Pinned bots")}>{(pinnedBots.length ? pinnedBots : retainedPinned.current).map(bot => { const unread = unreadFor(bot); return <button type="button" key={bot.id} onClick={() => onSelectBot(bot)} aria-label={unread ? t("{bot}, {count} unread messages", { bot: bot.name, count: unread }) : bot.name} title={bot.name} aria-current={(!draftOpen && selection?.botId === bot.id) || undefined}
        onContextMenu={event => { event.preventDefault(); if (visible) setMenu({ botId: bot.id, x: event.clientX, y: event.clientY, open: true }); }}
        onKeyDown={event => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ botId: bot.id, x: rect.left + 20, y: rect.bottom, open: true });
          }
        }}><BotAvatar bot={bot} size={72} />{unread > 0 && <span className="desktop-bots-unread" aria-hidden="true" />}<span>{bot.name}</span></button>; })}</div>
    </AnimatedCollapse>
    <div className="desktop-bots-contacts">
      <AnimatedCollapse expanded={draftOpen}><button type="button" className="desktop-bots-draft-row" aria-current="page" onClick={onNewBot}><Plus size={20} /><span>{t("New")}</span></button></AnimatedCollapse>
      {roomsSupported && rooms.some(room => !room.archivedAt) && <div className="desktop-bots-room-nav">{rooms.filter(room => !room.archivedAt && room.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(room => <button type="button" key={room.id} aria-label={room.name} title={room.name} aria-current={roomSelection === room.id ? "page" : undefined} onClick={() => onOpenRoom(room.id)}><MessageSquare size={16} /><span>{room.name}</span></button>)}</div>}
      {groups.map(group => <div className="desktop-bots-team-group" key={group.id}>
        {group.team && <button type="button" className="desktop-bots-team-heading" aria-label={group.team.name} title={group.team.name} aria-expanded={!foldedTeams.has(group.id)} onClick={() => setFoldedTeams(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><ChevronRight size={13} /><span>{group.team.name}</span></button>}
        <AnimatedCollapse expanded={!foldedTeams.has(group.id)}>{group.bots.map(bot => renderBot(bot, group.team?.chiefBotId === bot.id))}</AnimatedCollapse>
      </div>)}
      {query && !bots.length && !pinnedBots.length && <div className="desktop-bots-no-results"><p>{t("No matching bots")}</p><button type="button" onClick={() => setQuery("")}>{t("Clear")}</button></div>}
    </div>
    {(teamsSupported || roomsSupported) && <div className="desktop-bots-collaboration-nav">
      {teamsSupported && <button type="button" aria-label={t("Manage teams")} title={t("Manage teams")} onClick={() => onManage("teams")}><Bot size={16} /><span>{t("Teams")}</span></button>}
      {roomsSupported && <button type="button" aria-label={t("Manage rooms")} title={t("Manage rooms")} onClick={() => onManage("rooms")}><MessageSquare size={16} /><span>{t("Rooms")}</span></button>}
    </div>}
    <button type="button" className="desktop-bots-archive-entry" onClick={onArchive} aria-label={t("Archived bots and threads")} title={t("Archived bots and threads")} aria-current={archiveOpen ? "page" : undefined}><Archive size={16} /><span>{t("Archived bots and threads")}</span></button>
    <ResizeHandle edge="right" dragging={resize.dragging} aria-label={t("Resize sidebar")} tabIndex={0}
      aria-valuemin={240} aria-valuemax={400} aria-valuenow={navigationWidth}
      onPointerDown={resize.onPointerDown} onDoubleClick={resize.onDoubleClick}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        onNavigationWidth(event.key === "Home" ? 240 : event.key === "End" ? 400 : Math.max(240, Math.min(400, navigationWidth + (event.key === "ArrowRight" ? 10 : -10))));
      }} />
    <ExplorerMenu ownerId="bots-navigation" open={!!menu?.open && !!menuBot && visible} x={menu?.x ?? 0} y={menu?.y ?? 0} ariaLabel={t("Bot actions")}
      items={[{ kind: "item", id: "pin", label: t(menuBot && pins.includes(menuBot.id) ? "Unpin Bot" : "Pin Bot"), icon: <Pin size={14} /> }]}
      onPick={() => { if (menuBot) onTogglePin(menuBot.id); setMenu(current => current && { ...current, open: false }); }} onClose={() => setMenu(current => current && { ...current, open: false })} />
  </nav>;
}

function BotArchive({ snapshot, busy, onRestore, onClose }: {
  snapshot?: BotsSnapshot; busy: boolean; onRestore: (bot: BotView, thread?: BotThread) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const groups = snapshot?.bots.filter((bot) => bot.archivedAt || snapshot.threads.some((thread) => thread.botId === bot.id && thread.archivedAt)) ?? [];
  return <section className="desktop-bots-archive" aria-label={t("Archived bots and threads")} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <header><h2 ref={heading} tabIndex={-1}>{t("Archived bots and threads")}</h2><button type="button" onClick={onClose} aria-label={t("Close")}><X size={16} /></button></header>
    <div className="desktop-bots-archive-list">
      {!groups.length && <p>{t("No archived bots or threads")}</p>}
      {groups.map((bot) => <section key={bot.id} className="desktop-bots-archive-group">
        <header><BotAvatar bot={bot} size={36} /><strong>{bot.name}</strong>
          {bot.archivedAt && <button type="button" disabled={busy} onClick={() => void onRestore(bot)} aria-label={`${t("Restore bot")}: ${bot.name}`}>{t("Restore bot")}</button>}
        </header>
        {snapshot!.threads.filter((thread) => thread.botId === bot.id && (bot.archivedAt || thread.archivedAt)).map((thread) => {
          const harness = thread.modelOverride?.harness ?? bot.harness;
          const title = sessionDisplayTitle(thread.title, harness).trim() || t("Main thread");
          return <div key={thread.id} className="desktop-bots-archive-thread"><HarnessIcon harness={harness} className="size-4 shrink-0" /><span title={title}>{title}</span>
            {thread.archivedAt && <button type="button" disabled={busy || !!bot.archivedAt} title={bot.archivedAt ? t("Restore the bot before restoring its threads") : undefined} aria-label={`${t("Restore thread")}: ${title}`} onClick={() => void onRestore(bot, thread)}>{t("Restore thread")}</button>}
          </div>;
        })}
      </section>)}
    </div>
  </section>;
}
