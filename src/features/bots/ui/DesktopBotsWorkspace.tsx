import { Button } from "../../../shared/ui/forms/Button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { botKeys, botDescriptorQuery, botsQuery, botTeamsQuery, botRoomsQuery, botCatalogQuery } from "../model/botQueries";
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
import { ActionMenu } from "../../../shared/ui/primitives/ActionMenu";
import { BotAvatar } from "./BotAvatar";
import { BotNavigationProvider, BotNavigationToggle, useBotNavigationExpanded, useBotNavigationLayout } from "./BotNavigationLayout";
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
import type { BotTeam } from "../model/botTeams";
import type { BotRoom } from "../model/botRooms";
import { botErrorMessage } from "../model/botErrors";

import { useTranslation } from "../../../shared/i18n/useTranslation";
import { SurfaceVisibilityContext, useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { ResizableRegion } from "../../../shared/ui/primitives/Resizable";
import { AnimatedCollapse, useCollapseMotion } from "../../../shared/ui/AnimatedCollapse";
import { IconButton } from "../../../shared/ui/forms/IconButton";
import { Modal } from "../../../shared/ui/Modal";
import { PresenceBoundary } from "../../../shared/ui/PresenceBoundary";
import { SurfaceAppearance } from "../../../shared/ui/SurfaceAppearance";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../shared/ui/forms/InputGroup";
import { HarnessIcon } from "../../../shared/ui/branding/HarnessIcon";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { Archive, Bot, ChevronRight, Pin, Plus, Search, MessageSquare, X } from "../../../shared/ui/icons";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type Props = ComponentProps<typeof BotChat>;
const EMPTY_THREADS: BotThread[] = [];

/** Capability boundary: old Hosts keep the unchanged assistant controller. */
export function DesktopBotsWorkspace(props: Props) {
  const visible = useSurfaceVisibility();
  const descriptorQuery = useQuery({ ...botDescriptorQuery(props.hostKey, props.rpc), enabled: visible }, queryClient);
  const descriptor = descriptorQuery.data;
  const failure = descriptorQuery.error ? botErrorMessage(descriptorQuery.error) : undefined;
  const rpc = useMemo<BotRpc>(() => (method, params) => method === "environment.describe" && descriptor
    ? Promise.resolve(descriptor as never) : props.rpc(method, params), [props.rpc, descriptor]);
  const { t } = useTranslation();
  if (failure && !descriptor) return <div className="assistant-availability" role="alert">
    <p>{t(failure)}</p><Button variant="ghost" size="content" type="button" onClick={() => void descriptorQuery.refetch()}>{t("Retry")}</Button>
  </div>;
  if (!descriptor) return <div className="assistant-availability assistant-loading" role="status">
    <Spinner className="size-5" /><span>{t("Connecting…")}</span>
  </div>;
  return <BotNavigationProvider>{!descriptor.capabilities?.includes("bots.v1") ? <BotChat {...props} rpc={rpc} /> : <MultiBotWorkspace {...props} rpc={rpc} memorySupported={descriptor.capabilities.includes("botMemory.v1")} runtimeSupported={descriptor.capabilities.includes("bots.runtime.v1")} managementSupported={descriptor.capabilities.includes("bots.management.v1")} delegationSupported={descriptor.capabilities.includes("bots.delegation.v1")} teamsSupported={descriptor.capabilities.includes("bots.teams.v1")} roomsSupported={descriptor.capabilities.includes("bots.rooms.v1")} />}</BotNavigationProvider>;
}

function MultiBotWorkspace(props: Props & { memorySupported: boolean; runtimeSupported: boolean; managementSupported: boolean; delegationSupported: boolean; teamsSupported: boolean; roomsSupported: boolean }) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const navigationLayout = useBotNavigationLayout();
  const [navigationWidth, setNavigationWidth] = useState(() => {
    try { const value = Number(localStorage.getItem("omnicode.bots-sidebar-width")); return value >= 240 && value <= 400 ? value : 280; } catch { return 280; }
  });
  const commitNavigationWidth = (width: number) => {
    setNavigationWidth(width);
    try { localStorage.setItem("omnicode.bots-sidebar-width", String(width)); } catch { /* Storage is optional. */ }
  };
  const listQuery = useQuery({ ...botsQuery(props.hostKey, props.rpc), enabled: visible, refetchInterval: visible ? 2000 : false }, queryClient);
  const snapshot = listQuery.data;
  const setSnapshot = (update: (current: BotsSnapshot | undefined) => BotsSnapshot) =>
    queryClient.setQueryData(botKeys.list(props.hostKey), update);
  const teamsQuery = useQuery({ ...botTeamsQuery(props.hostKey, props.rpc), enabled: visible && props.teamsSupported, refetchInterval: visible && props.teamsSupported ? 2000 : false }, queryClient);
  const roomsQuery = useQuery({ ...botRoomsQuery(props.hostKey, props.rpc), enabled: visible && props.roomsSupported, refetchInterval: visible && props.roomsSupported ? 2000 : false }, queryClient);
  const teams = teamsQuery.data?.teams ?? [];
  const rooms = roomsQuery.data?.rooms ?? [];
  const [managementPanel, setManagementPanel] = useState<"teams" | "rooms">(), [roomSelection, setRoomSelection] = useState<string>(), [visitedRooms, setVisitedRooms] = useState<string[]>([]);
  const [dismissedAt, setDismissedAt] = useState(0);
  const collaborationFailure = teamsQuery.errorUpdatedAt > dismissedAt && teamsQuery.error || roomsQuery.errorUpdatedAt > dismissedAt && roomsQuery.error;
  const collaborationError = collaborationFailure ? botErrorMessage(collaborationFailure) : undefined;
  const botNamesKey = JSON.stringify((snapshot?.bots ?? []).map(bot => [bot.id, bot.name]));
  const botNames = useMemo<Record<string, string>>(() => Object.fromEntries(JSON.parse(botNamesKey) as [string, string][]), [botNamesKey]);
  const connectionError = listQuery.error && listQuery.errorUpdatedAt > dismissedAt ? botErrorMessage(listQuery.error) : undefined;
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

  const catalogQuery = useQuery({ ...botCatalogQuery(props.hostKey, props.rpc), enabled: creatingBot && visible }, queryClient);
  const catalog = catalogQuery.data?.catalog ?? { models: {}, errors: {} };
  const projects = catalogQuery.data?.projects ?? [];
  const catalogState = catalogQuery.isError ? "failed" : catalogQuery.data ? "ready" : "loading";
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
    await invalidateAfterChange(botKeys.list(props.hostKey));
    return queryClient.fetchQuery({ ...botsQuery(props.hostKey, props.rpc), staleTime: Infinity });
  }, [props.hostKey, props.rpc]);
  const refreshCollaboration = useCallback(async () => {
    await Promise.all([
      props.teamsSupported ? invalidateAfterChange(botKeys.teams(props.hostKey)) : undefined,
      props.roomsSupported ? invalidateAfterChange(botKeys.rooms(props.hostKey)) : undefined,
    ]);
  }, [props.hostKey, props.teamsSupported, props.roomsSupported]);
  const openRoom = useCallback((id: string) => {
    setRoomSelection(id); setVisitedRooms(current => current.includes(id) ? current : [...current, id]);
    setManagementPanel(undefined); setCreatingBot(false); setRecipientOpen(false); setShowArchive(false);
  }, []);
  const openManagement = (panel: "teams" | "rooms") => { setManagementPanel(panel); setRoomSelection(undefined); setCreatingBot(false); setRecipientOpen(false); setShowArchive(false); };
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
  const loadCatalog = () => catalogQuery.refetch();
  const operation = useMutation({
    mutationFn: (task: () => Promise<void>) => task(),
    onSuccess: () => toast.success(t("Saved")),
    onError: (cause) => { setError(botErrorMessage(cause)); toast.error(t(botErrorMessage(cause))); },
  }, queryClient);
  const archiveOperation = useMutation({
    mutationFn: async ({ method, bot, thread }: { method: "bots.archive" | "bots.restore" | "botThreads.archive" | "botThreads.restore"; bot: BotView; thread?: BotThread }) => {
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
    },
    onSuccess: () => toast.success(t("Saved")),
    onError: (cause) => { setError(botErrorMessage(cause)); toast.error(t(botErrorMessage(cause))); },
  }, queryClient);
  const busy = operation.isPending || archiveOperation.isPending;
  const createBot = async (patch: BotPatch) => {
    if (busy) return;
    setError(undefined);
    const text = JSON.stringify(patch);
    if (createCommand.current?.text !== text) createCommand.current = { text, id: crypto.randomUUID() };
    const command = createCommand.current;
    try { await operation.mutateAsync(async () => {
      const result = await props.rpc<{ bot: BotView; thread: BotThread }>("bots.create", { commandId: command.id, patch });
      setSnapshot((current) => ({
        revision: (current?.revision ?? 0) + 1,
        ...current,
        bots: [...(current?.bots ?? []).filter((bot) => bot.id !== result.bot.id), result.bot],
        threads: [...(current?.threads ?? []).filter((thread) => thread.id !== result.thread.id), result.thread],
      }));
      createCommand.current = undefined;
      select({ botId: result.bot.id, threadId: result.thread.id });
      await refresh();
    }); } catch (cause) { setError(botErrorMessage(cause)); }
  };
  const archiveCommands = useRef(new Map<string, string>());
  const changeArchive = (method: "bots.archive" | "bots.restore" | "botThreads.archive" | "botThreads.restore", bot: BotView, thread?: BotThread) =>
    archiveOperation.mutateAsync({ method, bot, thread });
  const restore = async (bot: BotView, thread?: BotThread) => {
    if (busy) return;
    setError(undefined);
    try { await changeArchive(thread ? "botThreads.restore" : "bots.restore", bot, thread); }
    catch (cause) { setError(botErrorMessage(cause)); }
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
  const roomDraft = useRef<{ signature: string; createId: string; sendId: string; room?: BotRoom } | undefined>(undefined);
  const sendToRecipients = (members: BotView[], text: string) => operation.mutateAsync(async () => {
    if (!props.roomsSupported || members.length < 2) return;
    const memberIds = members.map(bot => bot.id), signature = JSON.stringify([memberIds, text]);
    if (roomDraft.current?.signature !== signature) roomDraft.current = { signature, createId: crypto.randomUUID(), sendId: crypto.randomUUID() };
    const request = roomDraft.current;
    request.room ??= await props.rpc<BotRoom>("botRooms.create", { commandId: request.createId, name: members.map(bot => bot.name).join(", ").slice(0, 100), memberIds });
    const room = request.room;
    await props.rpc("botRooms.send", { commandId: request.sendId, roomId: room.id, text });
    queryClient.setQueryData(botRoomsQuery(props.hostKey, props.rpc).queryKey, current =>
      ({ revision: current?.revision ?? 0, rooms: [...(current?.rooms ?? []).filter(item => item.id !== room.id), room] }));
    roomDraft.current = undefined; openRoom(room.id);
    await refreshCollaboration();
  });
  const navigation = <BotNavigation navigationWidth={navigationWidth} onNavigationWidth={commitNavigationWidth} pins={pins} onTogglePin={togglePin} draftOpen={recipientOpen} hostName={props.hostName}
    teams={teams} rooms={rooms} teamsSupported={props.teamsSupported} roomsSupported={props.roomsSupported} roomSelection={roomSelection} onOpenRoom={openRoom} onManage={openManagement}
    snapshot={snapshot} selection={showArchive || managementPanel || roomSelection ? undefined : selection} activity={activity} environmentId={props.hostKey}
    archiveOpen={showArchive} onArchive={() => { setManagementPanel(undefined); setRoomSelection(undefined); setShowArchive(true); setCreatingBot(false); setRecipientOpen(false); }}
    onNewBot={() => { setManagementPanel(undefined); setRoomSelection(undefined); setShowArchive(false); setCreatingBot(false); setRecipientOpen(true); setError(undefined); }}
    onSelectBot={selectBot} />;
  const draftShown = !roomSelection && (recipientShown || !selection || showArchive || !!managementPanel);
  const cancelCreate = () => {
    if (busy) return;
    setCreatingBot(false); createCommand.current = undefined;
    requestAnimationFrame(() => workspace.current?.querySelector<HTMLButtonElement>(':is(.desktop-bots-thread-surface, .desktop-bots-create):not([aria-hidden]) .desktop-bots-navigation-header button:last-child')?.focus());
  };
  const closeArchive = () => {
    setShowArchive(false);
    requestAnimationFrame(() => workspace.current?.querySelector<HTMLButtonElement>('.desktop-bots-thread-surface:not([aria-hidden]) .desktop-bots-archive-entry')?.focus());
  };
  return <div ref={workspace} className="desktop-bots-host">
    {(error || connectionError || collaborationError) && <div className="desktop-bots-error" role="alert">{t(error ?? connectionError ?? collaborationError!)}<Button variant="ghost" size="content" type="button" onClick={() => { setError(undefined); setDismissedAt(Date.now()); }} aria-label={t("Dismiss")}><X /></Button></div>}
    {visited.map((scope) => {
      const thread = snapshot?.threads.find((thread) => thread.id === scope.threadId && thread.botId === scope.botId);
      const bot = snapshot?.bots.find((bot) => bot.id === scope.botId);
      const selected = !draftShown && !roomSelection && selection?.botId === scope.botId && selection.threadId === scope.threadId;
      return <div key={botCacheKey(props.hostKey, scope)} className="desktop-bots-thread-surface" style={{ display: selected ? "flex" : "none" }} inert={!selected} aria-hidden={!selected || undefined}>
        <SurfaceVisibilityContext.Provider value={visible && selected}>
          <ScopedBotChat {...props} scope={scope} delegationSupported={props.delegationSupported} botNames={botNames} onOpenBotThread={openDelegationThread} botNavigation={navigation}
            botMemory={props.memorySupported ? <DesktopBotMemory botId={scope.botId} rpc={props.rpc} drafts={memoryDrafts} /> : undefined}
            botAvatarSupported={props.managementSupported}
            botSettings={bot}
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
      return room ? <div key={id} className="assistant-chat desktop-bots-workspace desktop-bots-create desktop-bots-room-surface animated-collapse-size" {...navigationLayout} style={{ display: active ? "grid" : "none" }} inert={!active} aria-hidden={!active || undefined}><SurfaceVisibilityContext.Provider value={visible && active}>
        {navigation}<div className="desktop-bots-create-content"><DesktopBotRoomChat environmentId={props.hostKey} room={room} bots={snapshot?.bots ?? []} rpc={props.rpc} onSaved={refreshCollaboration} onOpenThread={openDelegationThread} /></div>
      </SurfaceVisibilityContext.Provider></div> : null;
    })}
    <div className="assistant-chat desktop-bots-workspace desktop-bots-create animated-collapse-size" {...navigationLayout} style={{ display: draftShown ? "grid" : "none" }} inert={!draftShown} aria-hidden={!draftShown || undefined}>
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
          {managementPanel ? null : showArchive ? <BotArchive snapshot={snapshot} busy={busy} onRestore={restore} onClose={closeArchive} /> : recipientShown ? null : <div className="desktop-bots-empty">
            <Bot aria-hidden="true" />
            <h2>{t(snapshot ? "No bots yet" : "Loading…")}</h2>
            {snapshot && <Button variant="ghost" size="content" type="button" onClick={() => setRecipientOpen(true)}>{t("Create bot")}</Button>}
          </div>}
        </section>
      </SurfaceVisibilityContext.Provider>
    </div>
    <SurfaceAppearance.Provider value="settings">
      <PresenceBoundary>{creatingBot && visible ? <Modal title={t("New bot")} size="md" fitViewport className="desktop-bot-settings-dialog" onClose={cancelCreate}>
        <BotSettings value={null} submitLabel="Create bot" catalog={catalog} catalogState={catalogState}
          projects={projects} busy={busy} onSave={createBot} onCancel={cancelCreate} onRetryCatalog={() => void loadCatalog()} />
      </Modal> : null}</PresenceBoundary>
    </SurfaceAppearance.Provider>
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
  const searchRef = useRef<HTMLInputElement>(null);
  const expanded = useBotNavigationExpanded();
  const search = expanded ? query.trim().toLocaleLowerCase() : "";
  const clearSearch = () => { setQuery(""); searchRef.current?.focus(); };
  const visible = useSurfaceVisibility();
  const resizePane = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<{ botId: string; x: number; y: number; open: boolean }>();
  useEffect(() => { if (!visible) setMenu(current => current && { ...current, open: false }); }, [visible]);
  const menuBot = snapshot?.bots.find(bot => bot.id === menu?.botId && !bot.archivedAt);
  const threadsByBot = useMemo(() => {
    const index = new Map<string, BotThread[]>();
    for (const thread of snapshot?.threads ?? []) {
      if (thread.archivedAt) continue;
      const threads = index.get(thread.botId) ?? [];
      threads.push(thread);
      index.set(thread.botId, threads);
    }
    return index;
  }, [snapshot?.threads]);
  const activeTeams = teams.filter(team => !team.archivedAt);
  const matchingTeamMembers = new Set(activeTeams.filter(team => team.name.toLocaleLowerCase().includes(search)).flatMap(team => team.memberBotIds));
  const matchesQuery = (bot: BotView) => matchingTeamMembers.has(bot.id) || `${bot.name} ${(threadsByBot.get(bot.id) ?? []).map(thread => thread.title).join(" ")}`.toLocaleLowerCase().includes(search);
  const pinnedBots = pins.flatMap(id => { const bot = snapshot?.bots.find(bot => bot.id === id && !bot.archivedAt); return bot && matchesQuery(bot) ? [bot] : []; });
  const retainedPinned = useRef(pinnedBots);
  if (pinnedBots.length) retainedPinned.current = pinnedBots;
  const bots = snapshot?.bots.filter(bot => !bot.archivedAt && !pins.includes(bot.id) && matchesQuery(bot)) ?? [];
  const [foldedTeams, setFoldedTeams] = useState(new Set<string>());
  const groups: { id: string; team?: BotTeam; bots: BotView[] }[] = activeTeams.map(team => ({ id: team.id, team, bots: bots.filter(bot => team.memberBotIds.includes(bot.id)) }));
  const ungrouped = bots.filter(bot => !activeTeams.some(team => team.memberBotIds.includes(bot.id)));
  if (ungrouped.length || !groups.length) groups.push({ id: "ungrouped", bots: ungrouped });
  const matchingRooms = roomsSupported ? rooms.filter(room => !room.archivedAt && room.name.toLocaleLowerCase().includes(search)) : [];
  const isSelected = (bot: BotView) => !draftOpen && !roomSelection && !archiveOpen && selection?.botId === bot.id;
  const unreadFor = (bot: BotView) => (threadsByBot.get(bot.id) ?? []).reduce((total, thread) => total + (activity.get(botCacheKey(environmentId, { botId: bot.id, threadId: thread.id }))?.count ?? 0), 0);
  const renderBot = (bot: BotView, chief = false) => {
        const threads = threadsByBot.get(bot.id) ?? EMPTY_THREADS;
        const unread = unreadFor(bot);
        const newest = threads.map((thread) => activity.get(botCacheKey(environmentId, { botId: bot.id, threadId: thread.id }))?.latest).filter((message) => !!message).sort((a, b) => b.createdAt - a.createdAt)[0];
        const at = newest?.createdAt ?? Math.max(bot.updatedAt, ...threads.map(thread => thread.updatedAt));
        return <div key={bot.id} className="desktop-bots-bot-group">
          <div className="desktop-bots-contact" data-selected={isSelected(bot)} onContextMenu={event => {
            event.preventDefault(); if (visible) setMenu({ botId: bot.id, x: event.clientX, y: event.clientY, open: true });
          }} onKeyDown={event => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ botId: bot.id, x: rect.left + 20, y: rect.bottom, open: true });
            }
          }}>
            <Button variant="ghost" size="content" type="button" className="desktop-bots-contact-main" onClick={() => onSelectBot(bot)} aria-label={unread ? t("{bot}, {count} unread messages", { bot: bot.name, count: unread }) : bot.name} title={bot.name} aria-current={isSelected(bot) || undefined}>
              <BotAvatar bot={bot} size={36} />
              <span className="desktop-bots-contact-copy"><span className="desktop-bots-contact-title"><strong>{bot.name}</strong>{chief && <small className="desktop-bots-chief" title={t("Chief of Staff")}>{t("Chief")}</small>}<time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time></span><span className="desktop-bots-preview">{newest && "text" in newest ? newest.text.replace(/\s+/g, " ").trim() || t("Attachments") : threads[0]?.title || t("Main thread")}</span></span>
              {unread > 0 && <span className="desktop-bots-unread" aria-hidden="true" />}
            </Button>
          </div>
        </div>;
  };
  const setNavigationRef = useCallback((node: HTMLElement | null) => { resizePane.current = node?.parentElement ?? null; }, []);
  return <nav ref={setNavigationRef} className="desktop-bots-navigation" aria-label={t("Bots")}>
    <header className="desktop-bots-navigation-header">
      <div className="desktop-bots-navigation-title"><h2>{t("Bots")}</h2><span className="desktop-bots-host-name" title={hostName}>{hostName}</span></div>
      <BotNavigationToggle />
      <IconButton size="sm" onClick={onNewBot} label={t("New bot")}><Plus /></IconButton>
    </header>
    <AnimatedCollapse expanded={expanded} keepMounted><div className="desktop-bots-search">
      <InputGroup>
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); clearSearch(); } }} placeholder={t(roomsSupported ? "Search bots and rooms" : "Search bots")} aria-label={t("Search bots")} />
        {query && <InputGroupAddon align="inline-end"><IconButton size="xs" label={t("Clear search")} onClick={clearSearch}><X /></IconButton></InputGroupAddon>}
      </InputGroup>
    </div>
    </AnimatedCollapse>
    <AnimatedCollapse expanded={pinnedBots.length > 0} className="desktop-bots-pinned-collapse">
      <div className="desktop-bots-section-label"><Pin aria-hidden="true" /><span>{t("Pinned bots")}</span><small>{pinnedBots.length || retainedPinned.current.length}</small></div>
      <div className="desktop-bots-pinned" aria-label={t("Pinned bots")}>{(pinnedBots.length ? pinnedBots : retainedPinned.current).map(bot => { const unread = unreadFor(bot); return <Button variant="ghost" size="content" type="button" key={bot.id} onClick={() => onSelectBot(bot)} aria-label={unread ? t("{bot}, {count} unread messages", { bot: bot.name, count: unread }) : bot.name} title={bot.name} aria-current={isSelected(bot) || undefined}
        onContextMenu={event => { event.preventDefault(); if (visible) setMenu({ botId: bot.id, x: event.clientX, y: event.clientY, open: true }); }}
        onKeyDown={event => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ botId: bot.id, x: rect.left + 20, y: rect.bottom, open: true });
          }
        }}><BotAvatar bot={bot} size={expanded ? 40 : 36} />{unread > 0 && <span className="desktop-bots-unread" aria-hidden="true" />}<span>{bot.name}</span></Button>; })}</div>
    </AnimatedCollapse>
    <div className="desktop-bots-contacts">
      <AnimatedCollapse expanded={draftOpen}><Button variant="ghost" size="content" type="button" className="desktop-bots-draft-row" aria-current="page" onClick={onNewBot}><Plus /><span>{t("New")}</span></Button></AnimatedCollapse>
      {matchingRooms.length > 0 && <div className="desktop-bots-room-nav"><div className="desktop-bots-section-label"><span>{t("Rooms")}</span><small>{matchingRooms.length}</small></div>{matchingRooms.map(room => <Button variant="ghost" size="content" type="button" key={room.id} aria-label={room.name} title={room.name} aria-current={roomSelection === room.id ? "page" : undefined} onClick={() => onOpenRoom(room.id)}><MessageSquare /><span>{room.name}</span></Button>)}</div>}
      {groups.filter(group => !search || group.bots.length > 0).map(group => <div className="desktop-bots-team-group" key={group.id}>
        {group.team ? <Button variant="ghost" size="content" type="button" className="desktop-bots-team-heading" aria-label={group.team.name} title={group.team.name} aria-expanded={!!search || !foldedTeams.has(group.id)} disabled={!!search} onClick={() => setFoldedTeams(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><ChevronRight /><span>{group.team.name}</span><small>{group.bots.length}</small></Button>
          : group.bots.length > 0 && <div className="desktop-bots-section-label"><span>{t(activeTeams.length ? "Other bots" : "Bots")}</span><small>{group.bots.length}</small></div>}
        <AnimatedCollapse expanded={!expanded || !!search || !foldedTeams.has(group.id)}>{group.bots.map(bot => renderBot(bot, group.team?.chiefBotId === bot.id))}</AnimatedCollapse>
      </div>)}
      {search && !bots.length && !pinnedBots.length && !matchingRooms.length && <div className="desktop-bots-no-results" role="status"><Search aria-hidden="true" /><p>{t(roomsSupported ? "No matching conversations" : "No matching bots")}</p><Button variant="ghost" size="content" type="button" onClick={clearSearch}>{t("Clear")}</Button></div>}
    </div>
    {(teamsSupported || roomsSupported) && <div className="desktop-bots-collaboration-nav">
      {teamsSupported && <Button variant="ghost" size="content" type="button" aria-label={t("Manage teams")} title={t("Manage teams")} onClick={() => onManage("teams")}><Bot /><span>{t("Teams")}</span></Button>}
      {roomsSupported && <Button variant="ghost" size="content" type="button" aria-label={t("Manage rooms")} title={t("Manage rooms")} onClick={() => onManage("rooms")}><MessageSquare /><span>{t("Rooms")}</span></Button>}
    </div>}
    <Button variant="ghost" size="content" type="button" className="desktop-bots-archive-entry" onClick={onArchive} aria-label={t("Archived bots and threads")} title={t("Archived bots and threads")} aria-current={archiveOpen ? "page" : undefined}><Archive /><span>{t("Archived bots and threads")}</span></Button>
    <ResizableRegion targetRef={resizePane} property="--bots-sidebar-preference" size={navigationWidth} min={240} max={400} defaultSize={280}
      disabled={!visible || !expanded} label={t("Resize sidebar")} onCommit={onNavigationWidth} />
    <ActionMenu ownerId="bots-navigation" open={!!menu?.open && !!menuBot && visible} x={menu?.x ?? 0} y={menu?.y ?? 0} ariaLabel={t("Bot actions")}
      items={[{ kind: "item", id: "pin", label: t(menuBot && pins.includes(menuBot.id) ? "Unpin Bot" : "Pin Bot"), icon: <Pin /> }]}
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
    <header><h2 ref={heading} tabIndex={-1}>{t("Archived bots and threads")}</h2><Button variant="ghost" size="content" type="button" onClick={onClose} aria-label={t("Close")}><X /></Button></header>
    <div className="desktop-bots-archive-list">
      {!groups.length && <p>{t("No archived bots or threads")}</p>}
      {groups.map((bot) => <section key={bot.id} className="desktop-bots-archive-group">
        <header><BotAvatar bot={bot} size={36} /><strong>{bot.name}</strong>
          {bot.archivedAt && <Button variant="ghost" size="content" type="button" disabled={busy} onClick={() => void onRestore(bot)} aria-label={`${t("Restore bot")}: ${bot.name}`}>{t("Restore bot")}</Button>}
        </header>
        {snapshot!.threads.filter((thread) => thread.botId === bot.id && (bot.archivedAt || thread.archivedAt)).map((thread) => {
          const harness = thread.modelOverride?.harness ?? bot.harness;
          const title = sessionDisplayTitle(thread.title, harness).trim() || t("Main thread");
          return <div key={thread.id} className="desktop-bots-archive-thread"><HarnessIcon harness={harness} className="size-4 shrink-0" /><span title={title}>{title}</span>
            {thread.archivedAt && <Button variant="ghost" size="content" type="button" disabled={busy || !!bot.archivedAt} title={bot.archivedAt ? t("Restore the bot before restoring its threads") : undefined} aria-label={`${t("Restore thread")}: ${title}`} onClick={() => void onRestore(bot, thread)}>{t("Restore thread")}</Button>}
          </div>;
        })}
      </section>)}
    </div>
  </section>;
}
