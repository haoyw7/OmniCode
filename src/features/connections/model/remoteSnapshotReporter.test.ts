import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canCoalesceRemoteSnapshot, RemoteSnapshotReporter } from "./remoteSnapshotReporter";
import type { HostSession } from "./protocol";
const initial: HostSession = {
  projectId: "project", revision: 1, status: "running", updatedAt: 1,
  session: { id: "session", cwd: "/repo", title: "Stream", harness: "pi", model: "pi:deepseek/deepseek-flash",
    runtimeMode: "supervised", modelSettings: {}, busy: true,
    blocks: [{ id: "u", role: "user", text: "Write" }, { id: "a", role: "assistant", text: "A", streaming: true }] },
};
const delta = (revision: number): HostSession => ({ ...initial, revision, updatedAt: revision, lastReplyRevision: revision,
  session: { ...initial.session, context: { used: revision, window: 10000 }, blocks: [
    { ...initial.session.blocks[0], turnMetrics: { outputTokens: revision } },
    { ...initial.session.blocks[1], text: "A".repeat(revision), sentAt: revision },
  ] },
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("keeps workspace updates bounded during sustained output and flushes completion immediately", () => {
  const report = vi.fn();
  const reporter = new RemoteSnapshotReporter(report);
  reporter.update(initial);
  for (let i = 2; i <= 5; i++) { reporter.update(delta(i)); vi.advanceTimersByTime(100); }
  expect(report).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  expect(report).toHaveBeenCalledTimes(2);
  expect(report.mock.calls.at(-1)![0].revision).toBe(5);
  reporter.update(delta(6));
  const done = { ...delta(7), status: "idle" as const, session: { ...delta(7).session, busy: false } };
  reporter.update(done);
  expect(report).toHaveBeenLastCalledWith(done);
  expect(vi.getTimerCount()).toBe(0);
});

it("never delays approvals, questions, provider settings, queues or block boundaries", () => {
  for (const patch of [
    { model: "pi:other", providerAccountId: "other" },
    { queueStatus: "paused" as const },
    { blocks: [...initial.session.blocks, { id: "question", role: "assistant" as const, text: "Question" }] },
    { blocks: [initial.session.blocks[0], { ...initial.session.blocks[1], approval: { requestId: 1 } }] },
    { blocks: [initial.session.blocks[0], { ...initial.session.blocks[1], streaming: false }] },
  ]) expect(canCoalesceRemoteSnapshot(initial, { ...delta(2), session: { ...delta(2).session, ...patch } })).toBe(false);
  const tool = { ...initial, session: { ...initial.session, blocks: [{ id: "t", role: "tool" as const, text: "Running" }] } };
  expect(canCoalesceRemoteSnapshot(tool, { ...tool, session: { ...tool.session, blocks: [{ ...tool.session.blocks[0], text: "Done" }] } })).toBe(false);
});

it("cancels a pending workspace copy on removal and disposal, and accepts a remount", () => {
  const report = vi.fn();
  const reporter = new RemoteSnapshotReporter(report);
  reporter.update(initial); reporter.update(delta(2)); reporter.update(undefined);
  vi.advanceTimersByTime(1_000);
  expect(report).toHaveBeenCalledTimes(1);
  reporter.update(delta(3));
  expect(report).toHaveBeenCalledTimes(2);
  reporter.update(delta(4)); reporter.dispose();
  vi.advanceTimersByTime(1_000);
  expect(report).toHaveBeenCalledTimes(2);
});
