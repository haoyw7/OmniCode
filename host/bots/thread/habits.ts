import { randomUUID } from "node:crypto";
import {
  HABITS_MAX,
  habitSchedule,
  nextHabitRunAt,
  type BotHabit,
} from "../../../src/features/bots/model/botHabits";
import { fields, id, object } from "./policy";
import { QUIET_MARKER } from "./prompt";

/** Name and prompt as a client or the assistant gave them. */
function text(value: unknown, label: string, max: number): string {
  return id(value, label, max).trim();
}

/** Adds a habit; its first run is the next scheduled time after `now`. */
export function createHabit(
  habits: readonly BotHabit[],
  raw: unknown,
  now: number,
  timeZone: string,
): { habits: BotHabit[]; habit: BotHabit } {
  const input = object(raw);
  fields(input, ["name", "prompt", "schedule", "enabled"]);
  if (habits.length >= HABITS_MAX) throw new Error("Too many habits");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw new Error("enabled must be true or false");
  const schedule = habitSchedule(input.schedule);
  const habit: BotHabit = {
    id: randomUUID(),
    name: text(input.name, "habit name", 80),
    prompt: text(input.prompt, "habit prompt", 4000),
    schedule,
    enabled: input.enabled !== false,
    createdAt: now,
    nextRunAt: nextHabitRunAt(schedule, now, timeZone),
  };
  return { habits: [...habits, habit], habit };
}

/** Changes the given fields; a new schedule or resuming restarts the clock. */
export function updateHabit(
  habits: readonly BotHabit[],
  habitId: string,
  raw: unknown,
  now: number,
  timeZone: string,
): BotHabit[] {
  const input = object(raw);
  fields(input, ["name", "prompt", "schedule", "enabled"]);
  const old = habits.find((habit) => habit.id === habitId);
  if (!old) throw new Error("Habit not found");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw new Error("enabled must be true or false");
  const schedule =
    input.schedule === undefined ? old.schedule : habitSchedule(input.schedule);
  const enabled = input.enabled === undefined ? old.enabled : input.enabled;
  const restart =
    input.schedule !== undefined || (enabled && !old.enabled);
  const next: BotHabit = {
    ...old,
    ...(input.name === undefined
      ? {}
      : { name: text(input.name, "habit name", 80) }),
    ...(input.prompt === undefined
      ? {}
      : { prompt: text(input.prompt, "habit prompt", 4000) }),
    schedule,
    enabled,
    nextRunAt: restart ? nextHabitRunAt(schedule, now, timeZone) : old.nextRunAt,
  };
  return habits.map((habit) => (habit.id === habitId ? next : habit));
}

export function deleteHabit(
  habits: readonly BotHabit[],
  habitId: string,
): BotHabit[] {
  if (!habits.some((habit) => habit.id === habitId))
    throw new Error("Habit not found");
  return habits.filter((habit) => habit.id !== habitId);
}

/** What the brain is asked to do when a habit comes due. */
export function habitWakeupText(habit: BotHabit): string {
  return `Your habit "${habit.name}" is due. ${habit.prompt}\nRe-read current state before acting. Tell the user only what is worth their attention; if nothing is, reply exactly ${QUIET_MARKER}.`;
}
