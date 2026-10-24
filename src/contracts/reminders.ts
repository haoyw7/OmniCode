import type { HarnessId } from "./session";

/** A reminder to come back to one saved Host conversation. */
export type SessionReminder = {
  sessionId: string;
  dueAt: number;
  firedAt: number | null;
  title: string;
  harness: HarnessId;
  cwd: string;
};

export type ReminderTarget = Pick<SessionReminder, "sessionId" | "dueAt">;

export type ReminderSet = { sessionIds: string[]; dueAt: number };

export type ReminderClear = { sessionIds: string[]; expectedDueAt?: number | null };

/**
 * A client claims due reminders it can deliver. `sessionIds` limits the claim
 * to reminders whose delivery policy the client has resolved; the claim is
 * durable, so another window, device or restart never announces it again.
 */
export type ReminderClaim = { sessionIds: string[] };
