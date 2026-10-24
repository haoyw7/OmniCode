import type { SessionReminder } from "../../../contracts/reminders";
import { remoteRequest } from "../../connections/model/connections";
import { sharedHostEnvironment, sharedHostMachineId } from "../../connections/model/remoteProjects";
import { loadRemoteHostDescriptor } from "../../connections/model/remoteHostMetadata";
import { translate } from "../../../shared/i18n/language";

/** Same-window change signal; other windows and devices catch up by polling Host. */
export const REMINDERS_CHANGED = "omnicode:reminders-changed";

export function reminderTime(preset: string, now = new Date()): number | null {
  if (preset === "reminder:1h") return now.getTime() + 60 * 60 * 1000;
  if (preset === "reminder:3h") return now.getTime() + 3 * 60 * 60 * 1000;
  const date = new Date(now);
  if (preset === "reminder:evening") {
    date.setHours(18, 0, 0, 0);
  } else if (preset === "reminder:tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  } else if (preset === "reminder:next-week") {
    date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
    date.setHours(9, 0, 0, 0);
  } else {
    return null;
  }
  return date.getTime() > now.getTime() ? date.getTime() : null;
}

export function formatReminderTime(dueAt: number): string {
  return new Date(dueAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function reminderHostRequest<T>(method: "reminders.list" | "reminders.set" | "reminders.clear" | "reminders.claimDue", params?: Record<string, unknown>): Promise<T> {
  const machineId = sharedHostMachineId();
  if (!machineId) throw new Error(translate("Shared conversation service is not connected"));
  const descriptor = await loadRemoteHostDescriptor(machineId, sharedHostEnvironment() ?? "");
  if (!descriptor.capabilities.includes("reminders.v1")) throw new Error(translate("Update Host to use reminders."));
  return remoteRequest<T>(machineId, method, params);
}

function changed() {
  window.dispatchEvent(new Event(REMINDERS_CHANGED));
}

export function listReminders(): Promise<{ reminders: SessionReminder[]; nextDueAt: number | null }> {
  return reminderHostRequest("reminders.list");
}

export async function setReminders(
  sessionIds: readonly string[],
  dueAt: number,
): Promise<void> {
  await reminderHostRequest("reminders.set", { sessionIds, dueAt });
  changed();
}

export async function clearReminders(
  sessionIds: readonly string[],
  expectedDueAt?: number,
): Promise<void> {
  await reminderHostRequest("reminders.clear", { sessionIds, expectedDueAt: expectedDueAt ?? null });
  changed();
}

/** Durable Host claim: only one window or device announces each due reminder. */
export function claimDueReminders(sessionIds: readonly string[]): Promise<SessionReminder[]> {
  return reminderHostRequest("reminders.claimDue", { sessionIds });
}
