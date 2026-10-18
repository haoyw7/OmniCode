import { useEffect, useReducer, useRef, useState } from "react";
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
  const [messages, setMessages] = useState<Record<string, BotMessage[]>>(
    {},
  );
  const [botTargets, setBotTargets] = useState<Record<string, { machineId: string; environmentId: string; scope: BotScope }>>({});
  const [, refreshRead] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeBotRead(refreshRead), []);
  useEffect(() => {
    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const machines: { id: string; environmentId: string }[] =
      JSON.parse(targets);
    for (const machine of machines) {
      const client = new BotClient(
        machine.environmentId,
        (method, params) => remoteRequest(machine.id, method, params),
      );
      let supported: boolean | undefined;
      let botsSupported = false;
      const botClients = new Map<string, BotClient>();
      const refresh = async () => {
        let delay = 2000;
        try {
          if (supported === undefined) {
            const descriptor = await remoteRequest<HostDescriptor>(
              machine.id,
              "environment.describe",
              {
                supportedProviders: REMOTE_PROVIDERS,
              },
            );
            botsSupported = descriptor.capabilities?.includes("bots.v1") ?? false;
            supported = botsSupported || (descriptor.capabilities?.includes("assistant.v1") ?? false);
          }
          if (disposed || !supported) return;
          if (botsSupported) {
            const snapshot = await remoteRequest<BotsSnapshot>(machine.id, "bots.list");
            if (disposed) return;
            const targets: typeof botTargets = {};
            for (const thread of snapshot.threads.filter((thread) => !thread.archivedAt && snapshot.bots.some((bot) => bot.id === thread.botId && !bot.archivedAt))) {
              const scope = { botId: thread.botId, threadId: thread.id };
              const key = botCacheKey(machine.environmentId, scope);
              const isDefault = scope.botId === snapshot.defaultBotId && scope.threadId === snapshot.defaultThreadId;
              if (isDefault) migrateDefaultBotCache(machine.environmentId, key);
              targets[key] = { machineId: machine.id, environmentId: machine.environmentId, scope };
              let scoped = botClients.get(key);
              if (!scoped) {
                scoped = new BotClient(key, scopedBotRpc((method, params) => remoteRequest(machine.id, method, params), scope, isDefault), undefined, botReadRevision(key));
                botClients.set(key, scoped);
              }
              const next = await scoped.sync();
              if (disposed) return;
              const activity = botNotificationActivity(next.assistant, next.messages);
              const notice = takeBotNotification(key, activity);
              const selected = readBotSelection(machine.environmentId);
              if (notice && activity) void notifyApp(botNotificationTarget(machine.environmentId, getCurrentWindow().label, scope), {
                title: "OmniCode", subtitle: activity.name || translate("Bots"),
                body: notice.text || translate(notice.kind === "input" ? "This conversation needs your input." : "A new reply is ready."),
              }, current.current.visibleHost === machine.environmentId && selected?.botId === scope.botId && selected.threadId === scope.threadId);
              setMessages((current) => ({ ...current, [key]: next.messages }));
            }
            setBotTargets((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([, target]) => target.environmentId !== machine.environmentId)), ...targets }));
            return;
          }
          const next = await client.sync();
          if (!disposed) {
            const activity = botNotificationActivity(next.assistant, next.messages);
            const notice = takeBotNotification(machine.environmentId, activity);
            if (notice && activity)
              void notifyApp(botLegacyNotificationTarget(machine.environmentId, getCurrentWindow().label), {
                title: "OmniCode",
                subtitle: activity.name || translate("Assistant"),
                body: notice.text || translate(notice.kind === "input"
                  ? "This conversation needs your input." : "A new reply is ready."),
              }, current.current.visibleHost === machine.environmentId);
            setMessages((current) => ({
              ...current,
              [machine.environmentId]: next.messages,
            }));
          }
        } catch {
          // Keep unread messages through a disconnect and back off before retrying.
          delay = 30000;
        } finally {
          if (!disposed && supported !== false) {
            const timer = setTimeout(() => {
              timers.delete(timer);
              void refresh();
            }, delay);
            timers.add(timer);
          }
        }
      };
      void refresh();
    }
    return () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [targets]);
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
