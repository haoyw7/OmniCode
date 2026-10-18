import { expect, it } from "vitest";
import { nextInterval, retryDelay } from "./scheduler";
it("coalesces missed intervals and schedules once in the future", () => {
  expect(nextInterval(60000, 1, 245000)).toBe(300000);
  expect(nextInterval(60000, 1, 60000)).toBe(120000);
});
it("backs off exponentially and bounds retry time", () => {
  expect(retryDelay(1)).toBe(30000);
  expect(retryDelay(3)).toBe(120000);
  expect(retryDelay(100)).toBe(900000);
});
it("claims a missed schedule once and does not run while paused", async () => {
  const { HostStore } = await import("../../store");
  const { BotThreadStore } = await import("./store");
  const { enqueueSchedules } = await import("./scheduler");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "schedule-"));
  const host = new HostStore(join(dir, "host.db"));
  const store = new BotThreadStore(host);
  try {
    store.initialize({
      harness: "codex",
      model: "test",
      schedules: [
        {
          id: "one",
          enabled: true,
          intervalMinutes: 1,
          prompt: "Check",
          timezone: "Asia/Shanghai",
          nextRunAt: 60000,
        },
      ],
    });
    enqueueSchedules(store, 245000);
    enqueueSchedules(store, 245000);
    expect(store.wakeups()).toHaveLength(1);
    expect(store.get()!.schedules[0].nextRunAt).toBe(300000);
    expect(store.wakeups()[0].rootCauseId).toBe("schedule:one");
    store.update({ lifecycle: "paused" });
    enqueueSchedules(store, 600000);
    expect(store.wakeups()).toHaveLength(1);
    expect(store.get()!.schedules[0].nextRunAt).toBe(300000);
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("runs a due habit once in its time zone and skips runs missed past the grace", async () => {
  const { HostStore } = await import("../../store");
  const { BotThreadStore } = await import("./store");
  const { enqueueSchedules } = await import("./scheduler");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "habit-"));
  const host = new HostStore(join(dir, "host.db"));
  const store = new BotThreadStore(host);
  try {
    store.initialize({ harness: "codex", model: "test", timezone: "Asia/Shanghai" });
    // Weekdays at 09:00 Shanghai; Monday 2026-10-05 09:00 is 01:00 UTC.
    const monday = Date.parse("2026-10-05T01:00:00Z");
    store.update({
      schedules: [],
      habits: [
        {
          id: "prs",
          name: "PR sweep",
          prompt: "Check open PRs",
          schedule: { scheduleKind: "weekdays", minute: 0, time: "09:00", dayOfWeek: 1 },
          enabled: true,
          createdAt: 0,
          nextRunAt: monday,
        },
      ],
    });
    enqueueSchedules(store, monday + 60000);
    enqueueSchedules(store, monday + 60000);
    expect(store.wakeups()).toEqual([
      expect.objectContaining({ kind: "schedule", habitId: "prs", rootCauseId: `habit:prs:${monday}` }),
    ]);
    expect(store.wakeups()[0].text).toContain("Check open PRs");
    expect(store.get()!.habits![0].nextRunAt).toBe(Date.parse("2026-10-06T01:00:00Z"));
    // The Host was off from Tuesday's run until three hours later: skip it.
    enqueueSchedules(store, Date.parse("2026-10-06T04:00:00Z"));
    expect(store.wakeups()).toHaveLength(1);
    expect(store.get()!.habits![0].nextRunAt).toBe(Date.parse("2026-10-07T01:00:00Z"));
  } finally {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
