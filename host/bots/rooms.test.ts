import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { executeBotAction } from "./thread/control";
import type { HostProvider } from "../providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { BotScope, BotThread, BotView } from "../../src/features/bots/model/bots";
import type { BotRoom, BotRoomMessages, BotRoomRound, BotRoomState } from "../../src/features/bots/model/botRooms";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bot-room-"));
  let store: HostStore, engine: HostEngine;
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn(input => new Promise<void>(finish => turns.push({ input, finish }))),
    stop: vi.fn(async sessionId => { turns.filter(turn => turn.input.sessionId === sessionId).forEach(turn => turn.finish()); }),
    cancel: vi.fn(async sessionId => { turns.filter(turn => turn.input.sessionId === sessionId).forEach(turn => turn.finish()); }),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(),
  };
  const start = async () => {
    store = new HostStore(join(directory, "host.db")); engine = new HostEngine(store, { codex: provider });
    await Promise.all([engine.ready, engine.workflows.ready]);
    engine.bots.setCatalog(async () => ["codex"], async () => ({ models: { codex: [{ id: "test", name: "Test" }] }, errors: {} }));
  };
  await start();
  cleanup.push(async () => { await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  let command = 0;
  const rpc = <T>(method: string, raw: Record<string, unknown>): Promise<T> => engine.bots.rpc(method, raw) as Promise<T>;
  const bot = async (name: string, maxConcurrentRuns = 3): Promise<BotScope> => {
    const result = await rpc<{ bot: BotView; thread: BotThread }>("bots.create", { commandId: `bot-${name}`, patch: { name, harness: "codex", model: "test", maxConcurrentRuns,
      triggers: { user: true, event: false, schedule: false } } });
    return { botId: result.bot.id, threadId: result.thread.id };
  };
  const room = (memberIds: string[], memberTimeoutMs = 240000) => rpc<BotRoom>("botRooms.create", { commandId: `room-${++command}`, name: "Shared Room", memberIds, memberTimeoutMs });
  const send = (roomId: string, text: string, memberIds?: string[], commandId = `send-${++command}`) => rpc<BotRoomRound>("botRooms.send", { roomId, commandId, text, ...(memberIds ? { memberIds } : {}) });
  const state = (roomId: string) => rpc<BotRoomState>("botRooms.get", { roomId });
  const round = async (value: BotRoomRound) => (await state(value.roomId)).rounds.find(round => round.id === value.id)!;
  const speaker = async (value: BotRoomRound, index: number) => {
    await vi.waitFor(async () => expect((await round(value)).speakers[index]?.runId).toBeTruthy());
    const current = (await round(value)).speakers[index];
    await vi.waitFor(() => expect(turns.some(turn => turn.input.botContext?.scope.runId === current.runId)).toBe(true));
    return { current, turn: turns.find(turn => turn.input.botContext?.scope.runId === current.runId)! };
  };
  const complete = (turn: (typeof turns)[number], text: string) => { turn.input.onEvent({ type: "message.delta", text }); turn.input.onEvent({ type: "message.completed" }); turn.finish(); };
  return { directory, get engine() { return engine; }, get store() { return store; }, turns, provider, bot, room, send, state, round, speaker, complete, rpc,
    async restart() { await engine.close(); store.close(); await start(); } };
}

it("runs each member once in order, shares only Room history and topics, and reuses isolated member threads", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  for (const scope of [a, b]) s.engine.bots.assistant(scope).store.message({ id: "private", kind: "user", text: "Deploy PRIVATE_DIRECT_HISTORY" });
  s.engine.bots.assistant(a).store.writeMemoryDoc("topic:deployment", "Deployment topic reference");
  const room = await s.room([a.botId, b.botId]), first = await s.send(room.id, "Discuss deployment");
  const firstA = await s.speaker(first, 0);
  expect(s.turns).toHaveLength(1);
  expect(firstA.turn.input.text).not.toContain("PRIVATE_DIRECT_HISTORY");
  expect(firstA.turn.input.text).toContain("Deployment topic reference");
  expect(s.engine.bots.store.getThread(a.botId, firstA.current.threadId!)?.kind).toBe("room");
  await expect(s.rpc("botThreads.send", { botId: a.botId, threadId: firstA.current.threadId, commandId: "forged", text: "private message" })).rejects.toThrow(/only their assigned task/);
  s.complete(firstA.turn, "A's shared result");
  const firstB = await s.speaker(first, 1);
  expect(firstB.turn.input.text).toContain("A's shared result");
  expect(firstB.turn.input.text).not.toContain("PRIVATE_DIRECT_HISTORY");
  s.complete(firstB.turn, "B's shared result");
  await vi.waitFor(async () => expect((await s.round(first)).status).toBe("completed"));
  const next = await s.send(room.id, "Discuss the next step", [b.botId, a.botId]);
  const nextB = await s.speaker(next, 0);
  expect(nextB.current.threadId).toBe(firstB.current.threadId);
  s.complete(nextB.turn, "B first this time");
  const nextA = await s.speaker(next, 1);
  expect(nextA.current.threadId).toBe(firstA.current.threadId);
  expect(nextA.turn.input.text).toContain("B first this time");
  s.complete(nextA.turn, "A second");
  await vi.waitFor(async () => expect((await s.round(next)).status).toBe("completed"));
});

it("continues after member failure and freezes active members while applying edits to the next round", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), c = await s.bot("C");
  const room = await s.room([a.botId, b.botId]), first = await s.send(room.id, "First round"), queued = await s.send(room.id, "Next round");
  const firstA = await s.speaker(first, 0);
  await s.rpc("botRooms.configure", { roomId: room.id, commandId: "members", expectedRevision: 1, patch: { memberIds: [c.botId] } });
  firstA.turn.input.onEvent({ type: "session.error", message: "Provider failed" }); firstA.turn.finish();
  const firstB = await s.speaker(first, 1);
  expect(firstB.current.botId).toBe(b.botId);
  expect((await s.round(first)).speakers[0].status).toBe("interrupted");
  s.complete(firstB.turn, "Continue despite first failure");
  const next = await s.speaker(queued, 0);
  expect(next.current.botId).toBe(c.botId);
  expect((await s.round(queued)).speakers).toHaveLength(1);
});

it("queues behind shared Bot slots, exposes approval state and times out a queued member before advancing", async () => {
  const s = await setup(), a = await s.bot("A", 1), b = await s.bot("B");
  await s.rpc("botThreads.send", { ...a, commandId: "direct", text: "Direct work needs approval" });
  await vi.waitFor(() => expect(s.turns).toHaveLength(1));
  s.turns[0].input.onEvent({ type: "approval.requested", requestId: 41, title: "Allow direct action?" });
  const room = await s.room([a.botId, b.botId], 250), round = await s.send(room.id, "Room queued behind direct approval");
  expect((await s.round(round)).speakers[0].status).toBe("queued");
  expect(s.engine.bots.assistant(a).currentRun?.status).toBe("waiting_approval");
  const next = await s.speaker(round, 1);
  expect((await s.round(round)).speakers[0].status).toBe("timed_out");
  expect(s.engine.bots.assistant(a).currentRun?.status).toBe("waiting_approval");
  next.turn.input.onEvent({ type: "approval.requested", requestId: 9, title: "Room member approval" });
  s.engine.bots.rooms.reconcile();
  expect((await s.round(round)).speakers[1].status).toBe("waiting_approval");
  const runtime = s.engine.bots.assistant({ botId: b.botId, threadId: next.current.threadId! });
  const input = runtime.store.latestMessages().find(message => message.kind === "input" && !message.resolved)!;
  if (input.kind !== "input") throw new Error("Missing approval");
  await s.rpc("botThreads.respond", { botId: b.botId, threadId: next.current.threadId, commandId: "approve", messageId: input.id, brainGeneration: input.brainGeneration, runId: input.runId, requestId: input.requestId, decision: "allow" });
  expect(s.provider.approve).toHaveBeenCalled();
});

it("cancels only the chosen round, preserves later queued work and denies cross-Room identities", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  const room = await s.room([a.botId, b.botId]), other = await s.room([a.botId]);
  const first = await s.send(room.id, "Cancel this"), queued = await s.send(room.id, "Keep this", [a.botId]);
  await s.speaker(first, 0);
  await expect(s.rpc("botRooms.cancel", { roomId: other.id, roundId: first.id, commandId: "wrong" })).rejects.toThrow(/does not belong/);
  await s.rpc("botRooms.cancel", { roomId: room.id, roundId: first.id, commandId: "cancel" });
  expect((await s.round(first)).speakers.map(speaker => speaker.status)).toEqual(["cancelled", "cancelled"]);
  const later = await s.speaker(queued, 0);
  expect(later.turn.input.text).toContain("Keep this");
  expect(s.turns.every(turn => turn.input.botContext?.scope.botId === a.botId)).toBe(true);
  const member = s.engine.bots.store.run({ botId: a.botId, threadId: later.current.threadId! }, later.current.runId!)!;
  expect(s.engine.bots.rooms.authorizeRun({ ...member, botId: b.botId })).toBe(false);
});

it("keeps send receipts and config CAS independent from activity, validates membership and pages by Room", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), room = await s.room([a.botId]), other = await s.room([b.botId]);
  const first = await s.send(room.id, "Exactly once", undefined, "same");
  expect(await s.send(room.id, "Exactly once", undefined, "same")).toEqual(first);
  await expect(s.send(room.id, "Changed", undefined, "same")).rejects.toThrow(/already used/);
  await expect(s.send(room.id, "Wrong member", [b.botId])).rejects.toThrow(/not a Room member/);
  await expect(s.room([a.botId, a.botId])).rejects.toThrow(/unique/);
  await expect(s.room(["another-host"])).rejects.toThrow(/does not belong/);
  await s.send(room.id, "Second"); await s.send(room.id, "Third");
  const page = await s.rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id, limit: 1 });
  expect(page.messages.map(message => message.text)).toEqual(["Third"]);
  expect(page.hasMore).toBe(true);
  const older = await s.rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id, limit: 2, before: page.next });
  expect(older.messages.map(message => message.text)).toEqual(["Exactly once", "Second"]);
  await expect(s.rpc("botRooms.messages", { roomId: other.id, before: page.next })).rejects.toThrow(/does not belong/);
  expect((await s.state(room.id)).room.revision).toBe(1);
  await s.rpc("botRooms.configure", { roomId: room.id, commandId: "rename", expectedRevision: 1, patch: { name: "Renamed" } });
  await expect(s.rpc("botRooms.configure", { roomId: room.id, commandId: "conflict", expectedRevision: 1, patch: { name: "Stale" } })).rejects.toThrow(/Settings changed/);
});

it("retains old active rounds in state after more than fifty later cancelled rounds", async () => {
  const s = await setup(), a = await s.bot("A"), room = await s.room([a.botId]), first = await s.send(room.id, "Long running round");
  await s.speaker(first, 0);
  for (let i = 0; i < 52; i++) {
    const queued = await s.send(room.id, `Cancelled queued ${i}`);
    await s.rpc("botRooms.cancel", { roomId: room.id, roundId: queued.id, commandId: `cancel-${i}` });
  }
  const state = await s.state(room.id);
  expect(state.rounds).toHaveLength(50);
  expect(state.rounds.find(round => round.id === first.id)?.status).toBe("running");
});

it("recovers a confirmed response before interruption and never replays remaining or queued speakers on restart/resume", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), room = await s.room([a.botId, b.botId]);
  const first = await s.send(room.id, "Original request"), queued = await s.send(room.id, "Queued request");
  const firstA = await s.speaker(first, 0);
  const reconcile = vi.spyOn(s.engine.bots.rooms, "reconcile").mockImplementation(() => {});
  s.complete(firstA.turn, "Confirmed before the crash");
  await vi.waitFor(() => expect(s.engine.bots.store.run({ botId: a.botId, threadId: firstA.current.threadId! }, firstA.current.runId!)?.status).toBe("completed"));
  const recover = vi.spyOn(s.engine.bots.rooms, "recover").mockImplementation(() => {});
  await s.restart(); reconcile.mockRestore(); recover.mockRestore();
  const current = await s.round(first);
  expect(current.status).toBe("interrupted");
  expect(current.speakers.map(speaker => speaker.status)).toEqual(["completed", "interrupted"]);
  expect(current.speakers[0].result).toBe("Confirmed before the crash");
  expect((await s.round(queued)).status).toBe("interrupted");
  expect(s.turns).toHaveLength(1);
  await s.rpc("bots.control", { botId: a.botId, commandId: "resume", action: "resume" });
  await s.engine.bots.assistant({ botId: a.botId, threadId: firstA.current.threadId! }).managedTick();
  expect(s.turns).toHaveLength(1);
});

it("records cancellation failures and rejects results completed after the member deadline", async () => {
  const s = await setup(), a = await s.bot("A"), room = await s.room([a.botId]), first = await s.send(room.id, "Cancellation may fail");
  const turn = await s.speaker(first, 0), runtime = s.engine.bots.assistant({ botId: a.botId, threadId: turn.current.threadId! });
  const original = runtime.rpc.bind(runtime);
  const rpc = vi.spyOn(runtime, "rpc").mockImplementation((method, raw) => method === "assistant.control" && raw.action === "cancelTurn" ? Promise.reject(new Error("Fixture stop failure")) : original(method, raw));
  await s.rpc("botRooms.cancel", { roomId: room.id, roundId: first.id, commandId: "failed-stop" });
  await vi.waitFor(async () => expect((await s.round(first)).speakers[0].error).toContain("Fixture stop failure"));
  expect((await s.rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id })).messages.some(message => message.text.includes("cancellation failed"))).toBe(true);
  rpc.mockRestore(); await original("assistant.control", { commandId: "cleanup-stop", action: "cancelTurn" });
  const late = await s.send(room.id, "Late result"), next = await s.speaker(late, 0);
  const frozen = vi.spyOn(s.engine.bots.rooms, "reconcile").mockImplementation(() => {});
  s.complete(next.turn, "Too late");
  await vi.waitFor(() => expect(runtime.currentRun).toBeUndefined());
  s.engine.bots.store.updateRun({ botId: a.botId, threadId: next.current.threadId! }, next.current.runId!, { endedAt: next.current.deadlineAt! + 1 });
  frozen.mockRestore(); s.engine.bots.rooms.reconcile();
  expect((await s.round(late)).speakers[0].status).toBe("timed_out");
  expect((await s.round(late)).speakers[0].result).toBeUndefined();
});

it("recovers an entirely settled round as completed when an earlier member failed", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), room = await s.room([a.botId, b.botId]);
  await s.rpc("bots.control", { botId: a.botId, commandId: "unavailable", action: "pause" });
  const first = await s.send(room.id, "One unavailable member, one confirmed reply"), final = await s.speaker(first, 1);
  expect((await s.round(first)).speakers[0].status).toBe("failed");
  const reconcile = vi.spyOn(s.engine.bots.rooms, "reconcile").mockImplementation(() => {});
  s.complete(final.turn, "Confirmed final reply");
  await vi.waitFor(() => expect(s.engine.bots.store.run({ botId: b.botId, threadId: final.current.threadId! }, final.current.runId!)?.status).toBe("completed"));
  const recover = vi.spyOn(s.engine.bots.rooms, "recover").mockImplementation(() => {});
  await s.restart(); reconcile.mockRestore(); recover.mockRestore();
  const restored = await s.round(first);
  expect(restored.status).toBe("completed");
  expect(restored.speakers.map(speaker => speaker.status)).toEqual(["failed", "completed"]);
  expect(restored.speakers[1].result).toBe("Confirmed final reply");
  expect(s.turns).toHaveLength(1);
  expect((await s.rpc<BotRoomMessages>("botRooms.messages", { roomId: room.id })).messages.filter(message => message.kind === "assistant").map(message => message.text)).toEqual(["Confirmed final reply"]);
});

it("revokes queued Room actions immediately while the member provider is still stopping", async () => {
  const s = await setup(), a = await s.bot("A"), room = await s.room([a.botId]), first = await s.send(room.id, "Queue project work");
  const member = await s.speaker(first, 0), runtime = s.engine.bots.assistant({ botId: a.botId, threadId: member.current.threadId! });
  const directory = join(s.directory, "project"); mkdirSync(directory);
  const project = s.store.addProject(directory, "Room project");
  const target = await executeBotAction(runtime, "create", "sessions.create", { projectId: project.id, harness: "codex", model: "test" }, () => true) as { sessionId: string };
  s.engine.command({ type: "send", commandId: "user-work", sessionId: target.sessionId, text: "Independent user work" });
  await vi.waitFor(() => expect(s.turns.some(turn => turn.input.sessionId === target.sessionId)).toBe(true));
  await executeBotAction(runtime, "queue", "sessions.send", { projectId: project.id, sessionId: target.sessionId, text: "Cancelled Room project work" }, () => true);
  const origin = s.store.session(target.sessionId).session.queuedMessages![0].origin!;
  expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(true);
  const original = s.engine.stopAssistantBrain.bind(s.engine);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = vi.spyOn(s.engine, "stopAssistantBrain").mockImplementation(async sessionId => { await barrier; await original(sessionId); });
  try {
    await s.rpc("botRooms.cancel", { roomId: room.id, roundId: first.id, commandId: "cancel-delayed" });
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(false);
    s.complete(s.turns.find(turn => turn.input.sessionId === target.sessionId)!, "User work done");
    await vi.waitFor(() => expect(s.store.session(target.sessionId).session.queuedMessages?.[0].blocked).toContain("revoked"));
    expect(s.turns.filter(turn => turn.input.sessionId === target.sessionId)).toHaveLength(1);
  } finally {
    stop.mockRestore(); release();
    await vi.waitFor(() => expect(runtime.currentRun).toBeUndefined());
  }
});

it("allows accepted project tasks to continue after a Room member finishes successfully", async () => {
  const s = await setup(), a = await s.bot("A"), room = await s.room([a.botId]), first = await s.send(room.id, "Queue accepted project work");
  const member = await s.speaker(first, 0), runtime = s.engine.bots.assistant({ botId: a.botId, threadId: member.current.threadId! });
  const directory = join(s.directory, "project"); mkdirSync(directory);
  const project = s.store.addProject(directory, "Room project");
  const target = await executeBotAction(runtime, "create", "sessions.create", { projectId: project.id, harness: "codex", model: "test" }, () => true) as { sessionId: string };
  s.engine.command({ type: "send", commandId: "user-work", sessionId: target.sessionId, text: "Independent user work" });
  await vi.waitFor(() => expect(s.turns.some(turn => turn.input.sessionId === target.sessionId)).toBe(true));
  await executeBotAction(runtime, "queue", "sessions.send", { projectId: project.id, sessionId: target.sessionId, text: "Accepted Room project work" }, () => true);
  const origin = s.store.session(target.sessionId).session.queuedMessages![0].origin!;
  s.complete(member.turn, "Project work accepted");
  await vi.waitFor(async () => expect((await s.round(first)).status).toBe("completed"));
  expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(true);
  s.complete(s.turns.find(turn => turn.input.sessionId === target.sessionId)!, "User work done");
  await vi.waitFor(() => expect(s.turns.filter(turn => turn.input.sessionId === target.sessionId)).toHaveLength(2));
  expect(s.turns.at(-1)!.input.text).toBe("Accepted Room project work");
});

it("denies queued authority after a member-thread stop before Room status reconciliation", async () => {
  const s = await setup(), a = await s.bot("A"), room = await s.room([a.botId]), first = await s.send(room.id, "Stop this member directly");
  const member = await s.speaker(first, 0), scope = { botId: a.botId, threadId: member.current.threadId! };
  const run = s.engine.bots.store.run(scope, member.current.runId!)!;
  expect(s.engine.bots.rooms.authorizeQueued(scope, run.wakeupId)).toBe(true);
  const reconcile = vi.spyOn(s.engine.bots.rooms, "reconcile").mockImplementation(() => {});
  const original = s.engine.stopAssistantBrain.bind(s.engine);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = vi.spyOn(s.engine, "stopAssistantBrain").mockImplementation(async sessionId => { await barrier; await original(sessionId); });
  const cancellation = s.rpc("botThreads.cancel", { ...scope, commandId: "stop-member" });
  try {
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(s.engine.bots.store.run(scope, run.id)?.status).toBe("running");
    expect(s.engine.bots.store.getThread(scope.botId, scope.threadId)?.lifecycle).toBe("paused");
    expect(s.engine.bots.rooms.authorizeQueued(scope, run.wakeupId)).toBe(false);
  } finally { stop.mockRestore(); release(); await cancellation; }
  expect((await s.round(first)).status).toBe("running");
  expect(s.engine.bots.store.run(scope, run.id)?.status).toBe("cancelled");
  expect(s.engine.bots.rooms.authorizeQueued(scope, run.wakeupId)).toBe(false);
  reconcile.mockRestore();
});
