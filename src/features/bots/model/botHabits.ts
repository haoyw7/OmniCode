/**
 * Recurring tasks the assistant runs on a calendar, in its own time zone:
 * hourly at a minute, daily, on weekdays or weekly at a local time. Adapted
 * from upstream Mono habits; the Host schedules them, so they run whether or
 * not a client is open.
 */
export type BotHabitKind = "hourly" | "daily" | "weekdays" | "weekly";
export type BotHabitSchedule = {
  scheduleKind: BotHabitKind;
  /** Minute past the hour, for hourly habits. */
  minute: number;
  /** "HH:MM", local to the assistant's time zone. */
  time: string;
  /** 0 is Sunday, for weekly habits. */
  dayOfWeek: number;
};
export type BotHabitOutcome = "posted" | "quiet" | "failed";
export type BotHabit = {
  id: string;
  name: string;
  /** What to do, and when it is worth telling the user. */
  prompt: string;
  schedule: BotHabitSchedule;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  /** "posted" told the user something; "quiet" found nothing worth saying. */
  lastOutcome?: BotHabitOutcome;
};

export const HABITS_MAX = 20;
/** A run that was due longer ago than this is skipped, not caught up. */
export const MISSED_RUN_GRACE_MS = 2 * 60 * 60 * 1000;
const KINDS: readonly string[] = ["hourly", "daily", "weekdays", "weekly"];

/** Validates a schedule from a client or the assistant; times are local. */
export function habitSchedule(value: unknown): BotHabitSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      'schedule must be an object like {"scheduleKind":"weekdays","time":"09:00"}',
    );
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["scheduleKind", "minute", "time", "dayOfWeek"].includes(key),
    )
  )
    throw new Error("Unknown schedule field");
  const kind = input.scheduleKind;
  if (typeof kind !== "string" || !KINDS.includes(kind))
    throw new Error("scheduleKind must be hourly, daily, weekdays or weekly");
  const time = input.time ?? "09:00";
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('time must be 24-hour "HH:MM"');
  const minute = input.minute ?? 0;
  if (!Number.isInteger(minute) || Number(minute) < 0 || Number(minute) > 59)
    throw new Error("minute must be 0-59");
  const dayOfWeek = input.dayOfWeek ?? 1;
  if (
    !Number.isInteger(dayOfWeek) ||
    Number(dayOfWeek) < 0 ||
    Number(dayOfWeek) > 6
  )
    throw new Error("dayOfWeek must be 0 (Sunday) to 6");
  return {
    scheduleKind: kind as BotHabitKind,
    minute: Number(minute),
    time,
    dayOfWeek: Number(dayOfWeek),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Wall-clock fields of an instant in a time zone. */
function wallClock(at: number, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(at).map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/** Milliseconds the zone's wall clock is ahead of UTC at an instant. */
function offset(at: number, timeZone: string): number {
  const wall = wallClock(at, timeZone);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) -
    Math.floor(at / 60000) * 60000
  );
}

/**
 * The instant a wall-clock time occurs in a zone. Out-of-range fields roll
 * over like Date.UTC; a time skipped by a DST jump lands just after it.
 */
function zoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offset(guess, timeZone);
  const second = guess - offset(first, timeZone);
  const wanted = new Date(guess);
  const matches = [first, second].filter((at) => {
    const wall = wallClock(at, timeZone);
    return (
      wall.hour === wanted.getUTCHours() &&
      wall.minute === wanted.getUTCMinutes() &&
      wall.day === wanted.getUTCDate()
    );
  });
  // Repeated wall times take the first occurrence; skipped ones the later reading.
  return matches.length ? Math.min(...matches) : Math.max(first, second);
}

/** The first run strictly after `after`, in the habit's time zone. */
export function nextHabitRunAt(
  schedule: BotHabitSchedule,
  after: number,
  timeZone: string,
): number {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    timeZone = "UTC";
  }
  const now = wallClock(after, timeZone);
  if (schedule.scheduleKind === "hourly") {
    for (let hours = 0; hours < 4; hours++) {
      const at = zoned(
        now.year,
        now.month,
        now.day,
        now.hour + hours,
        schedule.minute,
        timeZone,
      );
      if (at > after) return at;
    }
  }
  const [hour, minute] = schedule.time.split(":").map(Number);
  for (let days = 0; days < 9; days++) {
    const weekday = new Date(
      Date.UTC(now.year, now.month - 1, now.day + days),
    ).getUTCDay();
    if (schedule.scheduleKind === "weekdays" && (weekday === 0 || weekday === 6))
      continue;
    if (schedule.scheduleKind === "weekly" && weekday !== schedule.dayOfWeek)
      continue;
    const at = zoned(now.year, now.month, now.day + days, hour, minute, timeZone);
    if (at > after) return at;
  }
  throw new Error("No upcoming run for this schedule");
}
