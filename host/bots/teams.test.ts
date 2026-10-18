import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import type { HostProvider } from "../providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { BotPatch } from "../../src/features/bots/model/botView";
import type { BotDelegation, BotScope, BotThread, BotView } from "../../src/features/bots/model/bots";
import { executeBotAction } from "./thread/control";
import type { BotTeam, BotTeamPatch } from "../../src/features/bots/model/botTeams";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0)) await close(); });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bot-teams-"));
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
  return { get engine() { return engine; }, get store() { return store; }, bot, configure, send, get, turns, provider,
    async restart(beforeOpen?: () => void) { await engine.close(); beforeOpen?.(); store.close(); await start(); } };
}

async function team(s: Awaited<ReturnType<typeof setup>>, members: BotScope[], chief = members[0]): Promise<BotTeam> {
  return s.engine.bots.rpc("botTeams.create", { commandId: "team", patch: { name: "Delivery", memberBotIds: members.map(value => value.botId), chiefBotId: chief.botId } }) as Promise<BotTeam>;
}
async function patchTeam(s: Awaited<ReturnType<typeof setup>>, value: BotTeam, patch: BotTeamPatch): Promise<BotTeam> {
  return s.engine.bots.rpc("botTeams.configure", { teamId: value.id, commandId: String(Math.random()), expectedRevision: value.revision, patch }) as Promise<BotTeam>;
}
function complete(s: Awaited<ReturnType<typeof setup>>, scope: BotScope, text = "Done") {
  const runtime = s.engine.bots.assistant(scope), turn = s.turns.find(turn => turn.input.sessionId === runtime.currentRun?.brainSessionId)!;
  turn.input.onEvent({ type: "message.delta", text }); turn.input.onEvent({ type: "message.completed" }); turn.finish();
}

it("keeps one member Chief with revision conflicts, durable command receipts and archive filters", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), outside = await s.bot("Outside");
  const value = await team(s, [a, b]);
  const request = { teamId: value.id, commandId: "elect", expectedRevision: value.revision, patch: { chiefBotId: b.botId } };
  const elected = await s.engine.bots.rpc("botTeams.configure", request) as BotTeam;
  expect(elected.chiefBotId).toBe(b.botId);
  expect(await s.engine.bots.rpc("botTeams.configure", request)).toEqual(elected);
  await expect(s.engine.bots.rpc("botTeams.configure", { ...request, commandId: "competing", patch: { chiefBotId: a.botId } })).rejects.toThrow("Settings changed elsewhere");
  await expect(patchTeam(s, elected, { chiefBotId: outside.botId })).rejects.toThrow("Chief must be a member");
  for (const memberBotIds of [[a.botId, a.botId], ["unknown"], null])
    await expect(s.engine.bots.rpc("botTeams.configure", { ...request, commandId: "invalid", expectedRevision: elected.revision, patch: { memberBotIds } })).rejects.toThrow("unique existing Bots");
  const cleared = await patchTeam(s, elected, { chiefBotId: null }); expect(cleared.chiefBotId).toBeUndefined();
  const archived = await s.engine.bots.rpc("botTeams.archive", { teamId: value.id, commandId: "archive", expectedRevision: cleared.revision }) as BotTeam;
  expect(await s.engine.bots.rpc("botTeams.list", {})).toMatchObject({ teams: [] });
  expect(await s.engine.bots.rpc("botTeams.list", { includeArchived: true })).toMatchObject({ teams: [{ id: value.id }] });
  await s.engine.bots.rpc("botTeams.restore", { teamId: value.id, commandId: "restore", expectedRevision: archived.revision });
  await s.restart();
  expect(await s.engine.bots.rpc("botTeams.configure", request)).toEqual(elected);
  expect(await s.engine.bots.rpc("botTeams.list", {})).toMatchObject({ revision: 5, teams: [{ id: value.id }] });
});

it("discovers team IDs and rejects non-Chief, foreign members, forged identity and second-hop Chief calls", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), c = await s.bot("C");
  await s.configure(a, { callableBotIds: [b.botId] }); await s.configure(b, { callableBotIds: [c.botId] });
  const value = await team(s, [a, b]), source = await s.send(a), nonChief = await s.send(b);
  expect(source.agentBots()).toMatchObject({ teams: [{ id: value.id, chiefBotId: a.botId, memberBotIds: [a.botId, b.botId] }] });
  const input = { teamId: value.id, botId: b.botId, prompt: "Work" };
  await expect(s.engine.bots.teams.delegate(nonChief, "nonchief", input)).rejects.toThrow("current Chief");
  await expect(s.engine.bots.teams.delegate(source, "outside", { ...input, botId: c.botId })).rejects.toThrow("team members");
  await expect(s.engine.bots.teams.delegate(source, "self", { ...input, botId: a.botId })).rejects.toThrow("team members");
  await expect(executeBotAction(source, "forged", "agents.delegate_bot", { ...input, sourceRunId: "forged" }, () => true)).rejects.toThrow("Unknown input field");
  const delegated = await executeBotAction(source, "onehop", "agents.delegate_bot", input, () => true) as BotDelegation;
  expect(delegated).toMatchObject({ status: "running", mode: "background", teamId: value.id });
  const target = s.engine.bots.assistant({ botId: b.botId, threadId: delegated.target.threadId! });
  await vi.waitFor(() => expect(target.currentRun?.status).toBe("running"));
  await s.engine.bots.rpc("botTeams.create", { commandId: "second-team", patch: { name: "Other", memberBotIds: [b.botId, c.botId], chiefBotId: b.botId } });
  expect(target.agentBots()).toEqual({ bots: [] });
  await expect(s.engine.bots.teams.delegate(target, "secondhop", { ...input, botId: c.botId })).rejects.toThrow("non-delegated");
});

it("lets background delegation finish after normal parent completion and revokes removed membership", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), c = await s.bot("C");
  await s.configure(a, { callableBotIds: [b.botId, c.botId] }); const value = await team(s, [a, b, c]), source = await s.send(a);
  const first = await s.engine.bots.teams.delegate(source, "background-one", { teamId: value.id, botId: b.botId, prompt: "Work" });
  const second = await s.engine.bots.teams.delegate(source, "background-two", { teamId: value.id, botId: c.botId, prompt: "Work" });
  const oneScope = { botId: b.botId, threadId: first.target.threadId! }, twoScope = { botId: c.botId, threadId: second.target.threadId! };
  await vi.waitFor(() => expect(s.engine.bots.assistant(oneScope).currentRun?.status).toBe("running"));
  await vi.waitFor(() => expect(s.engine.bots.assistant(twoScope).currentRun?.status).toBe("running"));
  complete(s, a); await vi.waitFor(() => expect(source.currentRun).toBeUndefined());
  expect(await s.get(a, first)).toMatchObject({ status: "running" });
  expect(s.engine.bots.delegations.authorizeRun(s.engine.bots.assistant(oneScope).currentRun!)).toBe(true);
  complete(s, oneScope, "Background result");
  await vi.waitFor(async () => expect(await s.get(a, first)).toMatchObject({ status: "completed", result: "Background result" }));
  const targetRun = s.engine.bots.assistant(twoScope).currentRun!;
  await patchTeam(s, value, { memberBotIds: [a.botId, b.botId] });
  expect(s.engine.bots.delegations.authorizeRun(targetRun)).toBe(false);
  expect(await s.get(a, second)).toMatchObject({ status: "cancelled" });
});

it("cancels background children on explicit parent cancellation and Chief replacement", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"); await s.configure(a, { callableBotIds: [b.botId] });
  const value = await team(s, [a, b]), source = await s.send(a);
  const first = await s.engine.bots.teams.delegate(source, "cancel-child", { teamId: value.id, botId: b.botId, prompt: "Work" });
  await s.engine.bots.rpc("botThreads.cancel", { ...a, commandId: "cancel-parent" });
  expect(await s.get(a, first)).toMatchObject({ status: "cancelled" });
  const thread = await s.engine.bots.rpc("botThreads.create", { botId: a.botId, commandId: "new-source" }) as BotThread;
  const sibling = await s.send({ botId: a.botId, threadId: thread.id });
  const second = await s.engine.bots.teams.delegate(sibling, "revoke-chief", { teamId: value.id, botId: b.botId, prompt: "Work" });
  await patchTeam(s, value, { chiefBotId: b.botId });
  expect(await s.get(sibling.store.scope, second)).toMatchObject({ status: "cancelled" });
});

it("coordinates only selected members, aggregates partial outcomes, and retries without redispatch", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B"), busy = await s.bot("Busy", { maxConcurrentRuns: 1 }), denied = await s.bot("Denied"), unselected = await s.bot("Unselected");
  await s.configure(a, { callableBotIds: [b.botId, busy.botId, unselected.botId] });
  const value = await team(s, [a, b, busy, denied, unselected]), source = await s.send(a); await s.send(busy);
  const input = { teamId: value.id, botIds: [b.botId, busy.botId, denied.botId], prompt: "Coordinate this task" };
  const pending = executeBotAction(source, "aggregate", "agents.coordinate_bots", input, () => true);
  await vi.waitFor(() => expect(s.engine.bots.store.listThreads(b.botId).filter(thread => thread.kind === "delegation")).toHaveLength(1));
  const target = s.engine.bots.store.listThreads(b.botId).find(thread => thread.kind === "delegation")!, scope = { botId: b.botId, threadId: target.id };
  await vi.waitFor(() => expect(s.engine.bots.assistant(scope).currentRun?.status).toBe("running")); complete(s, scope, "Useful answer");
  const result = await pending;
  expect(result).toMatchObject({ status: "completed", results: [
    { botId: b.botId, status: "completed", result: "Useful answer" }, { botId: busy.botId, status: "busy" }, { botId: denied.botId, status: "failed" },
  ] });
  expect(s.engine.bots.store.listThreads(unselected.botId)).toHaveLength(1);
  const before = s.turns.length;
  expect(await executeBotAction(source, "aggregate", "agents.coordinate_bots", input, () => true)).toEqual(result);
  expect(s.turns).toHaveLength(before);
  await expect(s.engine.bots.teams.coordinate(source, "aggregate", { ...input, botIds: [b.botId] })).rejects.toThrow("different input");
  await expect(s.engine.bots.teams.coordinate(source, "empty", { ...input, botIds: [] })).rejects.toThrow("1 and 10");
});

it("keeps one 240 second coordination deadline across short waits and retry, including approval", async () => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] }); const value = await team(s, [a, b]), source = await s.send(a);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const started = Date.now(), input = { teamId: value.id, botIds: [b.botId], prompt: "Needs approval", timeoutMs: 240000 };
  const pending = s.engine.bots.teams.coordinate(source, "deadline", input);
  for (let attempt = 0; attempt < 100; attempt++) {
    const thread = s.engine.bots.store.listThreads(b.botId).find(thread => thread.kind === "delegation");
    if (thread && s.engine.bots.assistant({ botId: b.botId, threadId: thread.id }).currentRun?.status === "running") break;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  const thread = s.engine.bots.store.listThreads(b.botId).find(thread => thread.kind === "delegation")!;
  const target = s.engine.bots.assistant({ botId: b.botId, threadId: thread.id });
  expect(target.currentRun?.status).toBe("running");
  s.turns.find(turn => turn.input.sessionId === target.currentRun?.brainSessionId)!.input.onEvent({ type: "approval.requested", requestId: 8, title: "Approve" });
  await vi.advanceTimersByTimeAsync(25000);
  const first = await pending;
  expect(first).toMatchObject({ status: "running", deadlineAt: started + 240000 });
  const count = s.turns.length;
  await vi.advanceTimersByTimeAsync(214999);
  const retry = s.engine.bots.teams.coordinate(source, "deadline", input);
  await vi.advanceTimersByTimeAsync(1);
  expect(await retry).toMatchObject({ id: first.id, status: "completed", deadlineAt: first.deadlineAt, results: [{ status: "timed_out" }] });
  expect(s.turns).toHaveLength(count);
  expect(source.currentRun?.status).toBe("running");
});

it.each([false, true])("recovers durable background completion on shutdown and crash without replay (late=%s)", async late => {
  const s = await setup(), a = await s.bot("A"), b = await s.bot("B");
  await s.configure(a, { callableBotIds: [b.botId] }); const value = await team(s, [a, b]), source = await s.send(a);
  const delegated = await s.engine.bots.teams.delegate(source, "completion-before-reconcile", { teamId: value.id, botId: b.botId, prompt: "Work" });
  const targetScope = { botId: b.botId, threadId: delegated.target.threadId! };
  await vi.waitFor(() => expect(s.engine.bots.assistant(targetScope).currentRun?.status).toBe("running"));
  complete(s, a); await vi.waitFor(() => expect(source.currentRun).toBeUndefined());
  expect(await s.get(a, delegated)).toMatchObject({ status: "running" });
  // Stop the background projection at the crash boundary: provider completion
  // and its messages are durable, but release's setImmediate has not projected
  // that result into the delegation ledger yet.
  vi.spyOn(s.engine.bots.delegations, "reconcile").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(delegated.deadlineAt + (late ? 1 : -1000));
  complete(s, targetScope, "Already confirmed answer");
  await vi.waitFor(() => expect(s.engine.bots.store.run(targetScope, delegated.target.runId!)?.status).toBe("completed"));
  expect(s.engine.bots.delegations.get(delegated.id)?.status).toBe("running");
  expect(s.engine.bots.store.run(targetScope, delegated.target.runId!)!.endedAt! > delegated.deadlineAt).toBe(late);
  vi.setSystemTime(delegated.deadlineAt + 1000);
  const expected = late ? { status: "timed_out", result: undefined } : { status: "completed", result: "Already confirmed answer" };
  const count = s.turns.length;
  await s.restart(() => {
    const closed = s.engine.bots.delegations.get(delegated.id)!;
    expect(closed.status).toBe(expected.status); expect(closed.result).toBe(expected.result);
    // Also exercise a crash restart from that same pre-reconciliation ledger.
    s.store.db.prepare("UPDATE bot_delegations SET status='running',payload=? WHERE id=?").run(JSON.stringify(delegated), delegated.id);
  });
  const restored = await s.get(a, delegated);
  expect(restored.status).toBe(expected.status); expect(restored.result).toBe(expected.result);
  expect(s.engine.bots.store.run(targetScope, delegated.target.runId!)?.status).toBe("completed");
  await s.engine.bots.assistant(targetScope).managedTick();
  expect(s.turns).toHaveLength(count);
});
