import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import type { Connection } from "./client";
import { translate } from "../shared/i18n/language";
import type { BotNotificationActivity as AssistantNotificationActivity } from "../features/bots/model/botNotifications";
import { sessionDisplayTitle } from "../features/sessions/model/session";
import { HARNESS_ICONS } from "../features/sessions/ui/HarnessIcon";
import { notificationText } from "./notificationText";
import type { NativeActivityRow } from "./nativeActivitySync";

export type MobileNotificationPermission =
  "prompt" | "granted" | "denied" | "unsupported";
export type MobileNotificationTarget = { environmentId: string; kind: "assistant" } | {
  kind?: "session";
  environmentId: string;
  projectId: string;
  sessionId: string;
};
type ActivityResult = { environmentId: string; unreadIds: string[] };
export interface MobileNotificationsPlugin {
  checkPermissions(): Promise<{ display: MobileNotificationPermission }>;
  requestPermissions(): Promise<{ display: MobileNotificationPermission }>;
  openSettings(): Promise<void>;
  start(options: Connection & {
    enabled?: boolean;
    texts: Record<string, string>;
  }): Promise<void>;
  stop(): Promise<void>;
  observe(options: {
    environmentId: string;
    sessions: readonly NativeActivityRow[];
    assistant?: AssistantNotificationActivity | null;
    enabled: boolean;
  }): Promise<ActivityResult>;
  /** Only rows changed since the last full observe, and ids that are gone. */
  observeChanges(options: {
    environmentId: string;
    sessions: readonly NativeActivityRow[];
    removed: readonly string[];
    assistant?: AssistantNotificationActivity | null;
    enabled: boolean;
  }): Promise<ActivityResult>;
  setVisible(options: {
    environmentId: string;
    sessionId?: string;
    revision?: number;
    foreground: boolean;
    assistantVisible?: boolean;
    lastCompletedRunId?: string | null;
    pendingInputKey?: string | null;
  }): Promise<ActivityResult>;
  state(options: { environmentId: string }): Promise<ActivityResult>;
  consumeOpen(): Promise<{ target?: MobileNotificationTarget }>;
  addListener(
    event: "unread",
    callback: (result: ActivityResult) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "open",
    callback: (target: MobileNotificationTarget) => void,
  ): Promise<PluginListenerHandle>;
}
export const MobileNotifications = registerPlugin<MobileNotificationsPlugin>(
  "MonoCodeNotifications",
);
export const nativeActivityNotifications = () =>
  Capacitor.getPlatform() === "android";

export function mobileNotificationTexts(host = ""): Record<string, string> {
  return {
    channel: translate("Conversation notifications"),
    reply: translate("A new reply is ready."),
    input: translate("This conversation needs your input."),
    assistant: translate("Assistant"),
    newSession: translate("New session"),
    remoteChannel: translate("Remote connection"),
    remote: translate("Remote"),
    connected: translate("Connected to {host}", { host }),
    reconnecting: translate("Reconnecting to {host}", { host }),
  };
}
export async function mobileNotificationPermission(
  request = false,
): Promise<MobileNotificationPermission> {
  try {
    if (nativeActivityNotifications())
      return (
        await (request
          ? MobileNotifications.requestPermissions()
          : MobileNotifications.checkPermissions())
      ).display;
    if (Capacitor.isNativePlatform() || typeof Notification === "undefined")
      return "unsupported";
    const permission = request
      ? await Notification.requestPermission()
      : Notification.permission;
    return permission === "default" ? "prompt" : permission;
  } catch {
    return "unsupported";
  }
}
export function showBrowserActivityNotification(
  session: HostSessionSummary,
  kind: "reply" | "input",
  environmentId: string,
  onOpen: (target: MobileNotificationTarget) => void,
): void {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const notification = new Notification(sessionDisplayTitle(session.title, session.harness) || "OmniCode", {
      icon: HARNESS_ICONS[session.harness],
      body:
        notificationText(session.notificationPreview?.[kind]) ||
        mobileNotificationTexts()[kind],
      tag: `${environmentId}:${session.id}`,
    });
    notification.onclick = () => {
      onOpen({
        environmentId,
        projectId: session.projectId,
        sessionId: session.id,
      });
      notification.close();
    };
  } catch {
    /* A denied or unavailable banner never loses unread state. */
  }
}

export function showBrowserAssistantNotification(
  activity: AssistantNotificationActivity,
  environmentId: string,
  onOpen: (target: MobileNotificationTarget) => void,
): void {
  if (!activity.latest || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(activity.name || translate("Assistant"), {
      body: notificationText(activity.latest.text) || mobileNotificationTexts()[activity.latest.kind],
      tag: `${environmentId}:assistant`,
    });
    notification.onclick = () => {
      onOpen({ environmentId, kind: "assistant" });
      notification.close();
    };
  } catch { /* Unread assistant messages remain available in the app. */ }
}
