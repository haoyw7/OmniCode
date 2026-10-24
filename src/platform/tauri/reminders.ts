import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ReminderTarget } from "../../contracts/reminders";
import { showNativeNotification } from "./notifications";

/** Emitted by the shell after a reminder banner chose this window. */
const REMINDER_OPEN = "omnicode:reminder-open";

/** Reminder data lives in Host; the shell only shows banners and picks a window. */
export function showReminderNotification(reminder: ReminderTarget & { title: string; body: string; sound: boolean }): Promise<void> {
  return showNativeNotification({
    // The shell routes `reminder:<session>:<due>` clicks back to `takeReminderOpen`.
    sessionId: `reminder:${reminder.sessionId}:${reminder.dueAt}`,
    title: "OmniCode",
    subtitle: reminder.title,
    body: reminder.body,
    sound: reminder.sound,
  });
}

export function listenReminderOpen(handler: () => void): Promise<() => void> {
  return listen(REMINDER_OPEN, handler);
}

export function takeReminderOpen(): Promise<ReminderTarget | null> {
  return invoke<ReminderTarget | null>("reminder_take_open");
}

export function registerReminderWindow(sessionIds: readonly string[]): Promise<void> {
  return invoke("reminder_register_window", { sessionIds });
}

export function openReminderWindow(reminder: ReminderTarget): Promise<void> {
  return invoke("reminder_open", { sessionId: reminder.sessionId, dueAt: reminder.dueAt });
}
