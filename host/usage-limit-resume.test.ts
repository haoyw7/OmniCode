import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../src/contracts/session";
import { idleRateLimits } from "../src/domain/rateLimits";
import { HostUsageLimitResumer } from "./usage-limit-resume";

const runners: HostUsageLimitResumer[] = [];
afterEach(() => { runners.splice(0).forEach(runner => runner.close()); vi.useRealTimers(); });
function setup(initial: Session["usageLimit"]) {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  let session: Session = { id: "s", cwd: "/project", harness: "codex", model: "codex:test", runtimeMode: "supervised", title: "Test", blocks: [], usageLimit: initial };
  const lookup = vi.fn(async () => ({ ...idleRateLimits("codex"), status: "ok" as const,
    session: { usedPercent: 100, resetsAt: 20_000, windowMinutes: 300 } }));
  const resume = vi.fn(async () => { session = { ...session, usageLimit: undefined }; runner.observe(session); });
  const runner = new HostUsageLimitResumer({ read: () => session, lookup, resume,
    setReset: (_id, expected, resetsAt) => { if (session.usageLimit !== expected) return;
      session = { ...session, usageLimit: { ...session.usageLimit, resetsAt } }; runner.observe(session); },
  });
  runners.push(runner); runner.observe(session);
  return { runner, lookup, resume, current: () => session,
    change: (change: Partial<Session>) => { session = { ...session, ...change }; runner.observe(session); } };
}

it("recovers an armed persisted deadline, applies the grace period and resumes once", async () => {
  const f = setup({ resetsAt: 20_000, resumeAtReset: true });
  f.runner.start();
  await vi.advanceTimersByTimeAsync(39_999);
  expect(f.resume).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.resume).toHaveBeenCalledExactlyOnceWith("s", 20_000);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.resume).toHaveBeenCalledOnce();
});

it("fills missing reset information through Host usage and waits while the conversation runs", async () => {
  const f = setup({ resumeAtReset: true }); f.runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.lookup).toHaveBeenCalledOnce();
  expect(f.current().usageLimit?.resetsAt).toBe(20_000);
  f.change({ busy: true });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(f.resume).not.toHaveBeenCalled();
  f.change({ busy: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.resume).toHaveBeenCalledOnce();
});

it("dismissal and shutdown cancel a scheduled continuation", async () => {
  const f = setup({ resetsAt: 20_000, resumeAtReset: true }); f.runner.start();
  f.change({ usageLimit: undefined });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.resume).not.toHaveBeenCalled();
  f.change({ usageLimit: { resetsAt: 100_000, resumeAtReset: true } });
  f.runner.close();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.resume).not.toHaveBeenCalled();
});
