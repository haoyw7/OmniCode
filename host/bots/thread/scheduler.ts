import { randomUUID } from "node:crypto";
import type { BotThreadStore } from "./store";
import { localTime } from "./prompt";
import { habitWakeupText } from "./habits";
import {
  MISSED_RUN_GRACE_MS,
  nextHabitRunAt,
} from "../../../src/features/bots/model/botHabits";
export function nextInterval(
  previous: number,
  intervalMinutes: number,
  now: number,
): number {
  const period = intervalMinutes * 60000;
  return (
    previous + (Math.floor(Math.max(0, now - previous) / period) + 1) * period
  );
}
export function retryDelay(attempts: number): number {
  return Math.min(900000, 30000 * 2 ** Math.min(Math.max(0, attempts - 1), 5));
}
export function enqueueSchedules(
  store: BotThreadStore,
  now = Date.now(),
): void {
  store.host.transaction(() => {
    const config = store.get();
    if (
      !config?.enabled ||
      !config.triggers.schedule ||
      ["paused", "disabled", "interrupted", "failed"].includes(config.lifecycle)
    )
      return;
    const schedules = config.schedules.map((schedule) => {
      if (!schedule.enabled || schedule.nextRunAt > now) return schedule;
      const id = randomUUID();
      store.enqueue(
        {
          id,
          kind: "schedule",
          text: schedule.prompt,
          rootCauseId: `schedule:${schedule.id}`,
          state: "pending",
          createdAt: now,
          attempts: 0,
        },
        `schedule:${schedule.id}:${schedule.nextRunAt}`,
      );
      return {
        ...schedule,
        nextRunAt: nextInterval(
          schedule.nextRunAt,
          schedule.intervalMinutes,
          now,
        ),
      };
    });
    if (schedules.some((s, i) => s !== config.schedules[i]))
      store.update({ schedules });
    const reminders = (config.reminders ?? []).map((reminder) => {
      if (reminder.state !== "pending" || reminder.dueAt > now) return reminder;
      store.enqueue(
        {
          id: randomUUID(),
          kind: "schedule",
          text: `Follow-up you promised at ${localTime(reminder.createdAt, config.timezone ?? "UTC")}: ${reminder.prompt}\nRe-read current state before acting, then tell the user what you found.`,
          rootCauseId: reminder.rootCauseId,
          state: "pending",
          createdAt: now,
          attempts: 0,
        },
        `reminder:${reminder.id}`,
      );
      // A promised follow-up is a fresh step, not an automatic loop.
      store.writeChain(reminder.rootCauseId, {
        count: 0,
        paused: false,
        startedAt: now,
      });
      return { ...reminder, state: "fired" as const };
    });
    if (reminders.some((r, i) => r !== config.reminders?.[i]))
      store.update({ reminders });
    const timeZone = config.timezone ?? "UTC";
    const habits = (config.habits ?? []).map((habit) => {
      if (!habit.enabled || habit.nextRunAt > now) return habit;
      // A Host that was off past the grace skips the run instead of catching up.
      if (now - habit.nextRunAt <= MISSED_RUN_GRACE_MS) {
        const rootCauseId = `habit:${habit.id}:${habit.nextRunAt}`;
        store.enqueue(
          {
            id: randomUUID(),
            kind: "schedule",
            text: habitWakeupText(habit),
            rootCauseId,
            state: "pending",
            createdAt: now,
            attempts: 0,
            habitId: habit.id,
          },
          rootCauseId,
        );
        store.writeChain(rootCauseId, { count: 0, paused: false, startedAt: now });
      }
      return {
        ...habit,
        nextRunAt: nextHabitRunAt(habit.schedule, now, timeZone),
      };
    });
    if (habits.some((h, i) => h !== config.habits?.[i]))
      store.update({ habits });
  });
}
