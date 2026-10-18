import { expect, it } from "vitest";
import { habitSchedule, nextHabitRunAt } from "./botHabits";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const schedule = (value: object) => habitSchedule(value);

it("schedules in the assistant's time zone, not the machine's", () => {
  // 2026-10-05 is a Monday. 09:00 in Shanghai is 01:00 UTC.
  const daily = schedule({ scheduleKind: "daily", time: "09:00" });
  expect(iso(nextHabitRunAt(daily, at("2026-10-05T00:30:00Z"), "Asia/Shanghai"))).toBe("2026-10-05T01:00:00.000Z");
  expect(iso(nextHabitRunAt(daily, at("2026-10-05T01:00:00Z"), "Asia/Shanghai"))).toBe("2026-10-06T01:00:00.000Z");
  expect(iso(nextHabitRunAt(daily, at("2026-10-05T01:00:00Z"), "Bad/Zone"))).toBe("2026-10-05T09:00:00.000Z");
});

it("skips weekends for weekday habits and finds the weekday for weekly ones", () => {
  const weekdays = schedule({ scheduleKind: "weekdays", time: "09:00" });
  // Friday after 09:00 local → Monday.
  expect(iso(nextHabitRunAt(weekdays, at("2026-10-09T02:00:00Z"), "Asia/Shanghai"))).toBe("2026-10-12T01:00:00.000Z");
  const sunday = schedule({ scheduleKind: "weekly", time: "20:30", dayOfWeek: 0 });
  expect(iso(nextHabitRunAt(sunday, at("2026-10-05T00:00:00Z"), "UTC"))).toBe("2026-10-11T20:30:00.000Z");
  // On the day, after the time → next week.
  expect(iso(nextHabitRunAt(sunday, at("2026-10-11T21:00:00Z"), "UTC"))).toBe("2026-10-18T20:30:00.000Z");
});

it("runs hourly at the minute, also in zones with half-hour offsets", () => {
  const hourly = schedule({ scheduleKind: "hourly", minute: 15 });
  expect(iso(nextHabitRunAt(hourly, at("2026-10-05T10:20:00Z"), "UTC"))).toBe("2026-10-05T11:15:00.000Z");
  // India is UTC+5:30: :15 local is :45 UTC.
  expect(iso(nextHabitRunAt(hourly, at("2026-10-05T10:20:00Z"), "Asia/Kolkata"))).toBe("2026-10-05T10:45:00.000Z");
});

it("keeps local time across daylight saving changes", () => {
  const daily = schedule({ scheduleKind: "daily", time: "09:00" });
  // New York leaves DST on 2026-11-01: 09:00 is 13:00 UTC before, 14:00 after.
  expect(iso(nextHabitRunAt(daily, at("2026-10-31T14:00:00Z"), "America/New_York"))).toBe("2026-11-01T14:00:00.000Z");
  expect(iso(nextHabitRunAt(daily, at("2026-10-30T12:00:00Z"), "America/New_York"))).toBe("2026-10-30T13:00:00.000Z");
  // 02:30 does not exist on 2026-03-08 in New York; it runs just after the jump.
  const early = schedule({ scheduleKind: "daily", time: "02:30" });
  expect(iso(nextHabitRunAt(early, at("2026-03-08T05:00:00Z"), "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
  // 01:30 happens twice on 2026-11-01; it runs at the first, and once.
  const repeated = schedule({ scheduleKind: "daily", time: "01:30" });
  const first = nextHabitRunAt(repeated, at("2026-11-01T04:00:00Z"), "America/New_York");
  expect(iso(first)).toBe("2026-11-01T05:30:00.000Z");
  expect(iso(nextHabitRunAt(repeated, first, "America/New_York"))).toBe("2026-11-02T06:30:00.000Z");
});

it("rejects malformed schedules", () => {
  expect(() => schedule({ scheduleKind: "monthly" })).toThrow("scheduleKind");
  expect(() => schedule({ scheduleKind: "daily", time: "9:00" })).toThrow("time");
  expect(() => schedule({ scheduleKind: "weekly", dayOfWeek: 7 })).toThrow("dayOfWeek");
  expect(() => schedule({ scheduleKind: "daily", extra: 1 })).toThrow("Unknown");
  expect(schedule({ scheduleKind: "daily" })).toEqual({ scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 });
});
