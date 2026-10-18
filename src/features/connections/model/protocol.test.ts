import { expect, it } from "vitest";
import { applySessionSync, sessionClockOffset, type HostSession } from "./protocol";

const known: HostSession = {
  projectId: "project",
  revision: 4,
  status: "running",
  updatedAt: 0,
  session: {
    id: "session",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/host/repo",
    title: "Work",
    busy: true,
    blocks: [
      { id: "user", role: "user", text: "Do it" },
      { id: "reply", role: "assistant", text: "Work", streaming: true },
    ],
  },
};

it("applies changed blocks and keeps unchanged ones", () => {
  const next = applySessionSync(known, {
    kind: "delta",
    base: 4,
    value: { ...known, revision: 6, session: { ...known.session, busy: false } },
    blockIds: ["user", "reply", "done"],
    blocks: [
      { id: "reply", role: "assistant", text: "Work done" },
      { id: "done", role: "system", text: "Finished" },
    ],
  });
  expect(next.revision).toBe(6);
  expect(next.session.busy).toBe(false);
  expect(next.session.blocks.map((block) => block.text)).toEqual([
    "Do it",
    "Work done",
    "Finished",
  ]);
  expect(next.session.blocks[0]).toBe(known.session.blocks[0]);
});

it("returns the known value when nothing changed", () => {
  expect(applySessionSync(known, { kind: "unchanged", revision: 4 })).toBe(
    known,
  );
});

it("rejects deltas that do not apply, so the caller loads a snapshot", () => {
  expect(() =>
    applySessionSync(known, { kind: "unchanged", revision: 3 }),
  ).toThrow();
  expect(() =>
    applySessionSync(known, {
      kind: "delta",
      base: 4,
      value: { ...known, revision: 5 },
      blockIds: ["user", "unknown"],
      blocks: [],
    }),
  ).toThrow();
  expect(() =>
    applySessionSync(undefined, { kind: "unchanged", revision: 4 }),
  ).toThrow();
});

it("calibrates sync clocks without rewriting timestamps or losing the offset on a delta", () => {
  const offset = sessionClockOffset({ kind: "unchanged", revision: 4, serverTime: 35_100 }, 100_000, 100_200);
  expect(offset).toBe(-65_000);
  const first = applySessionSync(undefined, { kind: "snapshot", value: known, clockOffsetMs: offset });
  expect(first.clockOffsetMs).toBe(-65_000);
  expect(first.session).toBe(known.session);
  const next = applySessionSync(first, {
    kind: "delta", base: 4, value: { ...known, revision: 5 },
    blockIds: ["user", "reply"], blocks: [],
  });
  expect(next.clockOffsetMs).toBe(-65_000);
  expect(next.session.blocks[0]).toBe(known.session.blocks[0]);
  const refreshed = applySessionSync(next, { kind: "unchanged", revision: 5, clockOffsetMs: 65_000 });
  expect(refreshed.clockOffsetMs).toBe(65_000);
  expect(refreshed.session).toBe(next.session);
  // Latency jitter must not produce a new snapshot on every unchanged poll.
  expect(applySessionSync(refreshed, { kind: "unchanged", revision: 5, clockOffsetMs: 65_040 })).toBe(refreshed);
  expect(sessionClockOffset({ kind: "unchanged", revision: 5 }, 100, 200)).toBeUndefined();
  expect(sessionClockOffset({ kind: "unchanged", revision: 5, serverTime: 36_100, serverWaitMs: 1_000 }, 100_000, 101_200)).toBe(-65_000);
});
