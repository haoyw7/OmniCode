import { invoke } from "@tauri-apps/api/core";

export type NativeNotificationPermission = "prompt" | "granted" | "denied" | "unsupported";

export function readNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  return invoke("notification_permission");
}

export function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  return invoke("request_notification_permission");
}

export function openNativeNotificationSettings(): Promise<void> {
  return invoke("open_notification_settings");
}

export function showNativeNotification(notification: {
  sessionId: string;
  title: string;
  subtitle?: string;
  body: string;
  sound: boolean;
}): Promise<void> {
  return invoke("show_notification", notification);
}

export function setNativeDockBadge(count: number): Promise<void> {
  return invoke("set_dock_badge", { count });
}
