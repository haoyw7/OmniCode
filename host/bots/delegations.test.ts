import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import type { HostProvider } from "../providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { BotPatch } from "../../src/features/bots/model/botView";
import type { BotDelegation, BotDelegations, BotScope, BotThread, BotView } from "../../src/features/bots/model/bots";
import { executeBotAction } from "./thread/control";
import { BotThreadStore } from "./thread/store";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bot-delegation-"));
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
  const bot = async (name: string, patch: BotPatch = {}): Promise<BotScope> => {
    const result = await engine.bots.rpc("bots.create", { commandId: `bot-${name}`, patch: { name, harness: "codex", model: "test",
      triggers: { user: true, event: false, schedule: false }, ...patch } }) as { bot: BotView; thread: BotThread };
    return { botId: result.bot.id, threadId: result.thread.id };
  };
  const configure = (scope: BotScope, patch: BotPatch, commandId = String(Math.random())) => engine.bots.rpc("bots.configure", {
    botId: scope.botId, commandId, expectedRevision: engine.bots.store.getBot(scope.botId)!.revision, patch,
  });
  const send = async (scope: BotScope) => {
    await engine.bots.rpc("botThreads.send", { ...scope, commandId: "send", text: "Carry out my task" });
    await vi.waitFor(() => expect(engine.bots.assistant(scope).currentRun?.status).toBe("running"));
    return engine.bots.assistant(scope);
  };
  const get = (scope: BotScope, value: BotDelegation) => engine.bots.rpc("botDelegations.get", { ...scope, delegationId: value.id }) as Promise<BotDelegation>;
  return { get engine() { return engine; }, get store() { return store; }, directory, bot, configure, send, get, turns, provider,
    async restart(beforeOpen?: () => void) { await engine.close(); beforeOpen?.(); store.close(); await start(); } };
}

it("admits once from trusted source identity, uses target permissions, and publishes both result revisions", async () => {
  const s = await setup(), sourceScope = await s.bot("Source"), targetScope = await s.bot("Target");
  const source = await s.send(sourceScope);
  expect(source.agentBots()).toEqual({ bots: [] });
  for (const callableBotIds of [[sourceScope.botId], ["unknown"]])
    await expect(s.configure(sourceScope, { callableBotIds })).rejects.toThrow(/Callable Bots/);
  await s.configure(sourceScope, { callableBotIds: [targetScope.botId] });
  const policy = s.engine.bots.store.getBot(targetScope.botId)!.policy;
  await s.configure(targetScope, { policy: { ...policy, permissions: { ...policy.permissions, "projects.read": false } } });
  expect(source.agentBots().bots.map(bot => bot.id)).toEqual([targetScope.botId]);
  await expect(s.engine.bots.delegations.submit(source, "forged", { botId: targetScope.botId, prompt: "Task", sourceRunId: "fake" })).rejects.toThrow(/Unknown input field/);
  s.engine.bots.assistant(targetScope).store.message({ id: "private-target-history", kind: "assistant", text: "Deployment PRIVATE_DIRECT_HISTORY" });
  const input = { botId: targetScope.botId, prompt: "Investigate deployment carefully" };
  const value = await s.engine.bots.delegations.submit(source, "stable", input);
  expect(value.status).toBe("running");
  expect(new BotThreadStore(s.store, value.source).scope).toEqual(sourceScope);
  expect(await s.engine.bots.delegations.submit(source, "stable", input)).toEqual(value);
  await expect(s.engine.bots.delegations.submit(source, "stable", { ...input, prompt: "Changed" })).rejects.toThrow(/different input/);
  const target = s.engine.bots.assistant({ botId: targetScope.botId, threadId: value.target.threadId! });
  await vi.waitFor(() => expect(target.currentRun?.status).toBe("running"));
  expect(s.engine.bots.store.getThread(target.store.botId, target.store.threadId)?.kind).toBe("delegation");
  await expect(executeBotAction(target, "target-policy", "projects.list", {}, () => true)).rejects.toThrow(/Permission denied/);
  const firstSourceRevision = source.store.get()!.chatRevision, firstTargetRevision = target.store.get()!.chatRevision;
  const turn = s.turns.find(turn => turn.input.sessionId === target.currentRun?.brainSessionId)!;
  expect(turn.input.text).not.toContain("PRIVATE_DIRECT_HISTORY");
  await expect(s.engine.bots.rpc("botThreads.send", { ...target.store.scope, commandId: "unrelated-input", text: "Another task" })).rejects.toThrow(/only their assigned task/);
  turn.input.onEvent({ type: "message.delta", text: "Deployment needs a staging check." });
  turn.input.onEvent({ type: "message.completed" }); turn.finish();
  await vi.waitFor(async () => expect((await s.get(sourceScope, value)).status).toBe("completed"));
  expect(await s.engine.bots.delegations.submit(source, "stable", input)).toMatchObject({ id: value.id, status: "completed", result: "Deployment needs a staging check." });
  expect(source.store.get()!.chatRevision).toBeGreaterThan(firstSourceRevision);
  expect(target.store.get()!.chatRevision).toBeGreaterThan(firstTargetRevision);
  for (const runtime of [source, target]) {
    const messages = runtime.store.latestMessages().filter(message => message.kind === "status" && message.delegationId === value.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "status", code: "delegation-completed", delegationId: value.id });
  }
  await expect(s.get(targetScope, value)).rejects.toThrow(/does not belong/);
  expect(await s.get(target.store.scope, value)).toMatchObject({ id: value.id });
});

it("returns durable busy without queueing behind approvals or changing a repeated request", async () => {
  const s = await setup(), sourceScope = await s.bot("Source"), targetScope = await s.bot("Target", { maxConcurrentRuns: 1 });
  await s.configure(sourceScope, { callableBotIds: [targetScope.botId] });
  const source = await s.send(sourceScope), target = await s.send(targetScope);
  s.turns.find(turn => turn.input.sessionId === target.currentRun?.brainSessionId)!.input.onEvent({ type: "approval.requested", requestId: 7, title: "Approve target task" });
  const threadsBefore = s.engine.bots.store.listThreads(targetScope.botId).length;
  const input = { botId: targetScope.botId, prompt: "Can you help?" };
  const busy = await s.engine.bots.delegations.submit(source, "busy", input);
  expect(busy).toMatchObject({ status: "busy", target: { botId: targetScope.botId } });
  expect(busy.target.threadId).toBeUndefined();
  expect(s.engine.bots.store.listThreads(targetScope.botId)).toHaveLength(threadsBefore);
  await s.engine.bots.rpc("botThreads.cancel", { ...targetScope, commandId: "release" });
  expect(await s.engine.bots.delegations.submit(source, "busy", input)).toEqual(busy);
  const first = await s.engine.bots.delegations.submit(source, "admitted", input);
  const second = await s.engine.bots.delegations.submit(source, "competing", input);
  expect(first.status).toBe("running"); expect(second.status).toBe("busy");
});

it("rejects self and second-hop delegation, and immediately revokes an admitted target's authorization", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), c = await s.bot("C");
  await s.configure(a, { callableBotIds: [b.botId] }); await s.configure(b, { callableBotIds: [c.botId] });
  const source = await s.send(a);
  expect(await s.engine.bots.delegations.submit(source, "self", { botId: a.botId, prompt: "Self" })).toMatchObject({ status: "failed", error: expect.stringMatching(/itself/) });
  const value = await s.engine.bots.delegations.submit(source, "one-hop", { botId: b.botId, prompt: "Do this task" });
  const target = s.engine.bots.assistant({ botId: b.botId, threadId: value.target.threadId! });
  await vi.waitFor(() => expect(target.currentRun?.status).toBe("running"));
  expect(target.agentBots()).toEqual({ bots: [] });
  const blocked = await s.engine.bots.delegations.submit(target, "two-hop", { botId: c.botId, prompt: "Delegate again" });
  expect(blocked).toMatchObject({ status: "failed", error: expect.stringMatching(/again/) });
  expect(await s.engine.bots.delegations.submit(target, "two-hop", { botId: c.botId, prompt: "Delegate again" })).toEqual(blocked);
  const run = target.currentRun!;
  await s.configure(a, { callableBotIds: [] });
  expect(s.engine.bots.delegations.authorizeRun(run)).toBe(false);
  expect(await s.get(a, value)).toMatchObject({ status: "cancelled" });
  expect(source.currentRun?.status).toBe("running");
});

it("enforces the absolute 240 second deadline including approval without cancelling unrelated runs", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] });
  const source = await s.send(a), unrelated = await s.send(b);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const started = Date.now(), value = await s.engine.bots.delegations.submit(source, "deadline", { botId: b.botId, prompt: "Requires approval" });
  expect(value.deadlineAt).toBe(started + 240_000);
  const target = s.engine.bots.assistant({ botId: b.botId, threadId: value.target.threadId! });
  // Start filesystem/CLI preparation with real timers, then advance only the
  // already-persisted deadline timer after the provider asks for approval.
  await target.managedTick();
  for (let attempt = 0; attempt < 100 && target.currentRun?.status !== "running"; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
  expect(target.currentRun?.status).toBe("running");
  s.turns.find(turn => turn.input.sessionId === target.currentRun?.brainSessionId)!.input.onEvent({ type: "approval.requested", requestId: 8, title: "Approve delegated task" });
  expect(target.currentRun?.status).toBe("waiting_approval");
  const waiting = s.engine.bots.delegations.wait(source, value.id);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await waiting).toMatchObject({ status: "running", deadlineAt: started + 240_000 });
  expect(await s.engine.bots.delegations.submit(source, "deadline", { botId: b.botId, prompt: "Requires approval" }))
    .toMatchObject({ id: value.id, deadlineAt: started + 240_000 });
  await vi.advanceTimersByTimeAsync(214_999);
  expect((await s.get(a, value)).status).toBe("running");
  await vi.advanceTimersByTimeAsync(1);
  expect(await s.get(a, value)).toMatchObject({ status: "timed_out", deadlineAt: started + 240_000 });
  expect(source.currentRun?.status).toBe("running"); expect(unrelated.currentRun?.status).toBe("running");
});

it("cancels only child delegations when the originating run stops and enforces scoped cancel retries", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), c = await s.bot("C");
  await s.configure(a, { callableBotIds: [b.botId] }); await s.configure(c, { callableBotIds: [b.botId] });
  const source = await s.send(a), other = await s.send(c);
  const one = await s.engine.bots.delegations.submit(source, "one", { botId: b.botId, prompt: "First caller" });
  const two = await s.engine.bots.delegations.submit(other, "two", { botId: b.botId, prompt: "Second caller" });
  await s.engine.bots.rpc("botThreads.cancel", { ...a, commandId: "stop-parent" });
  expect(await s.get(a, one)).toMatchObject({ status: "cancelled" });
  expect(await s.get(c, two)).toMatchObject({ status: "running" });
  await expect(s.engine.bots.rpc("botDelegations.cancel", { ...a, delegationId: two.id, commandId: "forged" })).rejects.toThrow(/does not belong/);
  const command = { ...c, delegationId: two.id, commandId: "cancel" };
  const cancelled = await s.engine.bots.rpc("botDelegations.cancel", command);
  expect(await s.engine.bots.rpc("botDelegations.cancel", command)).toEqual(cancelled);
  expect(other.currentRun?.status).toBe("running");
  const list = await s.engine.bots.rpc("botDelegations.list", { ...c, limit: 1 }) as BotDelegations;
  expect(list.delegations.map(entry => entry.id)).toEqual([two.id]);
});

it("interrupts persisted delegation work on restart instead of replaying it", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] });
  const source = await s.send(a);
  const value = await s.engine.bots.delegations.submit(source, "restart", { botId: b.botId, prompt: "Unknown external side effect" });
  const targetScope = { botId: b.botId, threadId: value.target.threadId! };
  await vi.waitFor(() => expect(s.engine.bots.assistant(targetScope).currentRun?.status).toBe("running"));
  const count = s.turns.length;
  const run = s.engine.bots.store.run(targetScope, value.target.runId!)!;
  const wakeup = s.engine.bots.assistant(targetScope).store.wakeup(run.wakeupId)!;
  await s.restart(() => {
    // Restore the pre-crash ledger and unclaimed input after orderly teardown
    // so startup, rather than close(), must retire unconfirmed durable work.
    s.store.db.prepare("UPDATE bot_delegations SET status='running',payload=? WHERE id=?").run(JSON.stringify(value), value.id);
    s.engine.bots.store.updateRun(targetScope, run.id, { status: "queued", endedAt: undefined });
    s.engine.bots.assistant(targetScope).store.saveWakeup({ ...wakeup, state: "pending" });
  });
  expect(await s.get(a, value)).toMatchObject({ status: "interrupted" });
  expect(s.engine.bots.store.run(targetScope, value.target.runId!)?.status).toBe("interrupted");
  expect(s.engine.bots.assistant(targetScope).store.pending()).toHaveLength(0);
  expect(s.engine.bots.store.queuedRuns(targetScope)).toHaveLength(0);
  await s.engine.bots.assistant(targetScope).managedTick();
  expect(s.turns).toHaveLength(count);
  await s.engine.bots.rpc("botThreads.control", { ...targetScope, commandId: "resume-from-delegation", action: "resume",
    expectedGeneration: s.engine.bots.assistant(targetScope).store.get()!.brainGeneration });
  expect(s.engine.bots.assistant(targetScope).store.pending()).toHaveLength(0);
  expect(s.turns).toHaveLength(count);
});

it("retires an admitted but unstarted delegation on normal shutdown without leaving a recoverable queue", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] });
  const source = await s.send(a);
  vi.spyOn(s.engine.bots, "startDelegation").mockImplementation(() => undefined);
  const value = await s.engine.bots.delegations.submit(source, "admission-only", { botId: b.botId, prompt: "Not yet dispatched" });
  const scope = { botId: b.botId, threadId: value.target.threadId! };
  const run = s.engine.bots.store.run(scope, value.target.runId!)!;
  expect(run.status).toBe("queued");
  const count = s.turns.length;
  await s.restart();
  expect(await s.get(a, value)).toMatchObject({ status: "interrupted" });
  expect(s.engine.bots.store.run(scope, run.id)?.status).toBe("interrupted");
  expect(s.engine.bots.assistant(scope).store.wakeup(run.wakeupId)?.state).toBe("interrupted");
  expect(s.engine.bots.assistant(scope).store.pending()).toHaveLength(0);
  await s.engine.bots.assistant(scope).managedTick();
  expect(s.turns).toHaveLength(count);
  expect(s.engine.bots.hasDelegationSlot(b.botId)).toBe(true);
});

it.each(["cancelled", "timed_out", "revoked", "thread_cancelled"])("revokes queued delegated project actions before the provider finishes stopping (%s)", async reason => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] });
  const source = await s.send(a), delegated = await s.engine.bots.delegations.submit(source, "queue-child", { botId: b.botId, prompt: "Queue project work" });
  const runtime = s.engine.bots.assistant({ botId: b.botId, threadId: delegated.target.threadId! });
  await vi.waitFor(() => expect(runtime.currentRun?.status).toBe("running"));
  const directory = join(s.directory, "project"); mkdirSync(directory);
  const project = s.store.addProject(directory, "Delegated project");
  const target = await executeBotAction(runtime, "create", "sessions.create", { projectId: project.id, harness: "codex", model: "test" }, () => true) as { sessionId: string };
  s.engine.command({ type: "send", commandId: "user-work", sessionId: target.sessionId, text: "Independent user work" });
  await vi.waitFor(() => expect(s.turns.some(turn => turn.input.sessionId === target.sessionId)).toBe(true));
  await executeBotAction(runtime, "queue", "sessions.send", { projectId: project.id, sessionId: target.sessionId, text: "Revoked delegated project work" }, () => true);
  const origin = s.store.session(target.sessionId).session.queuedMessages![0].origin!;
  expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(true);
  const original = s.engine.stopAssistantBrain.bind(s.engine);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const stop = vi.spyOn(s.engine, "stopAssistantBrain").mockImplementation(async sessionId => { await barrier; await original(sessionId); });
  let threadStop: Promise<unknown> | undefined;
  const projection = reason === "thread_cancelled" ? vi.spyOn(s.engine.bots.delegations, "reconcile").mockImplementation(() => undefined) : undefined;
  try {
    if (reason === "thread_cancelled") threadStop = s.engine.bots.rpc("botThreads.cancel", { ...runtime.store.scope, commandId: "stop-thread" });
    else if (reason === "cancelled") await s.engine.bots.rpc("botDelegations.cancel", { ...a, delegationId: delegated.id, commandId: "cancel-delayed" });
    else if (reason === "revoked") await s.configure(a, { callableBotIds: [] });
    else { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(delegated.deadlineAt + 1); s.engine.bots.delegations.reconcile(); }
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(false);
    const turn = s.turns.find(turn => turn.input.sessionId === target.sessionId)!;
    turn.input.onEvent({ type: "message.delta", text: "User work done" }); turn.input.onEvent({ type: "message.completed" }); turn.finish();
    await vi.waitFor(() => expect(s.store.session(target.sessionId).session.queuedMessages?.[0].blocked).toContain("revoked"));
    expect(s.turns.filter(turn => turn.input.sessionId === target.sessionId)).toHaveLength(1);
  } finally {
    stop.mockRestore(); release();
    await threadStop;
    await vi.waitFor(() => expect(runtime.currentRun).toBeUndefined());
    if (projection) {
      expect(s.engine.bots.delegations.get(delegated.id)?.status).toBe("running");
      expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(false);
      projection.mockRestore();
    }
  }
});

it("keeps accepted project work authorized after both delegated and source turns complete normally", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] });
  const source = await s.send(a), delegated = await s.engine.bots.delegations.submit(source, "completed-child", { botId: b.botId, prompt: "Prepare project work" });
  const runtime = s.engine.bots.assistant({ botId: b.botId, threadId: delegated.target.threadId! });
  await vi.waitFor(() => expect(runtime.currentRun?.status).toBe("running"));
  const directory = join(s.directory, "project"); mkdirSync(directory);
  const project = s.store.addProject(directory, "Delegated project");
  const target = await executeBotAction(runtime, "create", "sessions.create", { projectId: project.id, harness: "codex", model: "test" }, () => true) as { sessionId: string };
  s.engine.command({ type: "send", commandId: "user-work", sessionId: target.sessionId, text: "Independent user work" });
  await vi.waitFor(() => expect(s.turns.some(turn => turn.input.sessionId === target.sessionId)).toBe(true));
  await executeBotAction(runtime, "queue", "sessions.send", { projectId: project.id, sessionId: target.sessionId, text: "Accepted project work" }, () => true);
  const origin = s.store.session(target.sessionId).session.queuedMessages![0].origin!;
  const complete = (sessionId: string) => {
    const turn = s.turns.find(turn => turn.input.sessionId === sessionId)!;
    turn.input.onEvent({ type: "message.delta", text: "Done" }); turn.input.onEvent({ type: "message.completed" }); turn.finish();
  };
  complete(runtime.currentRun!.brainSessionId!);
  await vi.waitFor(async () => expect(await s.get(a, delegated)).toMatchObject({ status: "completed" }));
  complete(source.currentRun!.brainSessionId!); await vi.waitFor(() => expect(source.currentRun).toBeUndefined());
  expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(true);
  expect(s.engine.authorizeAssistantQueued!({ ...origin, wakeupId: "forged-wakeup" }, project.id, target.sessionId)).toBe(false);
  complete(target.sessionId);
  await vi.waitFor(() => expect(s.turns.filter(turn => turn.input.sessionId === target.sessionId)).toHaveLength(2));
  expect(s.turns.filter(turn => turn.input.sessionId === target.sessionId)[1].input.text).toContain("Accepted project work");
  await s.configure(a, { callableBotIds: [] });
  expect(s.engine.authorizeAssistantQueued!(origin, project.id, target.sessionId)).toBe(false);
});
