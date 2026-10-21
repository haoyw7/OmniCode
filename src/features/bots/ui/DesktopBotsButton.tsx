import { useQueries } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botPanelKey } from "../model/botPanelQueries";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NOTIFICATION_CLICK_EVENT, notifyApp } from "../../notifications/model/notifications";
import { sharedHostMachineId } from "../../connections/model/remoteProjects";
import { translate } from "../../../shared/i18n/language";
import {
  botNotificationActivity,
  parseBotLegacyNotificationTarget,
  botLegacyNotificationTarget,
  takeBotNotification,
} from "../model/botNotifications";
import { remoteRequest } from "../../connections/model/connections";
import {
  REMOTE_PROVIDERS,
  type HostDescriptor,
} from "../../connections/model/protocol";
import { BotClient } from "../model/botRpc";
import type { BotMessage } from "../model/botView";
import {
  botReadRevision,
  subscribeBotRead,
  unreadBotMessages,
} from "../model/botUnread";
import { useDesktopBotsHosts } from "../model/useDesktopBotsHosts";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { botCacheKey, type BotScope, type BotsSnapshot } from "../model/bots";
import { scopedBotRpc, migrateDefaultBotCache } from "../model/botClient";
import { botNotificationTarget, parseBotNotificationTarget, readBotSelection, selectBotThread } from "../model/botSelection";
import { Bot } from "../../../shared/ui/icons";

export function DesktopBotsButton({
  active,
  selectedMachineId,
  onOpen,
}: {
  active: boolean;
  selectedMachineId?: string;
  onOpen: (machineId?: string) => void;
}) {
  const { t } = useTranslation();
  const hosts = useDesktopBotsHosts();
  const selectedHost = hosts.find((host) => host.id === (selectedMachineId ?? sharedHostMachineId())) ?? hosts[0];
  const visibleHost = active ? selectedHost?.environmentId : undefined;
  const current = useRef({ hosts, visibleHost, onOpen });
  current.current = { hosts, visibleHost, onOpen };
  useEffect(() => {
    const unlisten = listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload }) => {
      const botTarget = parseBotNotificationTarget(payload);
      const target = botTarget ?? parseBotLegacyNotificationTarget(payload);
      if (!target || target.windowLabel !== getCurrentWindow().label) return;
      const host = current.current.hosts.find((host) => host.environmentId === target.environmentId);
      if (!host) return;
      const win = getCurrentWindow();
      void win.unminimize().then(() => win.setFocus()).catch(() => {});
      if (botTarget) selectBotThread(host.environmentId, botTarget);
      current.current.onOpen(host.id);
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => {}); };
  }, []);
  const targets = JSON.stringify(
    hosts.map(({ id, environmentId }) => ({ id, environmentId })),
  );
  const machines = useMemo(() => (JSON.parse(targets) as { id: string; environmentId: string }[]).map(machine => ({
    ...machine, client: new BotClient(machine.environmentId, (method, params) => remoteRequest(machine.id, method, params)),
    clients: new Map<string, BotClient>(),
  })), [targets]);
  const [, refreshRead] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeBotRead(refreshRead), []);
  const feeds = useQueries({ queries: machines.map(machine => ({
    queryKey: [...botPanelKey(remoteRequest), "notificationFeed", machine.id, machine.environmentId],
    refetchInterval: (query: { state: { status: string; data?: { supported: boolean } } }) => query.state.data?.supported === false ? false : query.state.status === "error" ? 30000 : 2000,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const descriptor = await queryClient.fetchQuery({
        queryKey: [...botPanelKey(remoteRequest), "notificationDescriptor", machine.id, machine.environmentId],
        staleTime: Infinity,
        queryFn: () => remoteRequest<HostDescriptor>(machine.id, "environment.describe", { supportedProviders: REMOTE_PROVIDERS }),
      });
      signal.throwIfAborted();
      const botsSupported = descriptor.capabilities?.includes("bots.v1") ?? false;
      const supported = botsSupported || (descriptor.capabilities?.includes("assistant.v1") ?? false);
      const messages: Record<string, BotMessage[]> = {};
      const targets: Record<string, { machineId: string; environmentId: string; scope: BotScope }> = {};
      if (!supported) return { messages, targets, supported };
      if (botsSupported) {
        const snapshot = await remoteRequest<BotsSnapshot>(machine.id, "bots.list");
        signal.throwIfAborted();
        for (const thread of snapshot.threads.filter(thread => !thread.archivedAt && snapshot.bots.some(bot => bot.id === thread.botId && !bot.archivedAt))) {
          const scope = { botId: thread.botId, threadId: thread.id };
          const key = botCacheKey(machine.environmentId, scope);
          const isDefault = scope.botId === snapshot.defaultBotId && scope.threadId === snapshot.defaultThreadId;
          if (isDefault) migrateDefaultBotCache(machine.environmentId, key);
          targets[key] = { machineId: machine.id, environmentId: machine.environmentId, scope };
          let client = machine.clients.get(key);
          if (!client) {
            client = new BotClient(key, scopedBotRpc((method, params) => remoteRequest(machine.id, method, params), scope, isDefault), undefined, botReadRevision(key));
            machine.clients.set(key, client);
          }
          const next = await client.sync();
          signal.throwIfAborted();
          const activity = botNotificationActivity(next.assistant, next.messages), notice = takeBotNotification(key, activity);
          const selected = readBotSelection(machine.environmentId);
          if (notice && activity) void notifyApp(botNotificationTarget(machine.environmentId, getCurrentWindow().label, scope), {
            title: "OmniCode", subtitle: activity.name || translate("Bots"),
            body: notice.text || translate(notice.kind === "input" ? "This conversation needs your input." : "A new reply is ready."),
          }, current.current.visibleHost === machine.environmentId && selected?.botId === scope.botId && selected.threadId === scope.threadId);
          messages[key] = next.messages;
        }
      } else {
        const next = await machine.client.sync();
        signal.throwIfAborted();
        const activity = botNotificationActivity(next.assistant, next.messages), notice = takeBotNotification(machine.environmentId, activity);
        if (notice && activity) void notifyApp(botLegacyNotificationTarget(machine.environmentId, getCurrentWindow().label), {
          title: "OmniCode", subtitle: activity.name || translate("Assistant"),
          body: notice.text || translate(notice.kind === "input" ? "This conversation needs your input." : "A new reply is ready."),
        }, current.current.visibleHost === machine.environmentId);
        messages[machine.environmentId] = next.messages;
      }
      return { messages, targets, supported };
    },
  })) }, queryClient);
  const messages = Object.assign({}, ...feeds.map(feed => feed.data?.messages)) as Record<string, BotMessage[]>;
  const botTargets = Object.assign({}, ...feeds.map(feed => feed.data?.targets)) as Record<string, { machineId: string; environmentId: string; scope: BotScope }>;
  const unread = [...hosts
    .flatMap((host) =>
      unreadBotMessages(
        host.environmentId,
        messages[host.environmentId] ?? [],
      ).map((message) => ({ machineId: host.id, message, environmentId: host.environmentId, scope: undefined as BotScope | undefined })),
    ), ...Object.entries(botTargets).flatMap(([key, target]) => unreadBotMessages(key, messages[key] ?? []).map((message) => ({ ...target, message }))) ]
    .sort(
      (a, b) =>
        a.message.createdAt - b.message.createdAt ||
        a.message.revision - b.message.revision,
    );
  const latest = unread[unread.length - 1];
  const preview =
    latest && "text" in latest.message
      ? latest.message.text.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
  const name = t("Bots");
  const label = unread.length
    ? t("{name}, {count} unread messages", { name, count: unread.length })
    : name;
  return (
    <button
      type="button"
      data-open-assistant
      data-tauri-drag-region="false"
      aria-label={label}
      aria-pressed={active}
      title={preview ? `${label}: ${preview}` : label}
      onClick={() => {
        if (latest?.scope) selectBotThread(latest.environmentId, latest.scope);
        onOpen(latest?.machineId);
      }}
      className={`mx-1 flex h-7 min-w-0 max-w-sm items-center gap-1.5 rounded-lg px-2 text-ui-sm transition-colors ${active ? "bg-selection text-content" : "text-foreground-subtle hover:bg-surface-hover hover:text-content"}`}
    >
      <Bot className="size-4 shrink-0" />
      <span className="shrink-0">{name}</span>
      {preview && <span className="min-w-0 truncate text-foreground-subtle">{preview}</span>}
      {latest ? (
        <span
          aria-hidden
          className="shrink-0 rounded-full bg-brand px-1.5 text-xs text-brand-foreground"
        >
          {unread.length > 99 ? "99+" : unread.length}
        </span>
      ) : null}
    </button>
  );
}
