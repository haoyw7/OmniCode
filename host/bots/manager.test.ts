import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import type { HostProvider } from "../providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { BotRuns, BotScope, BotThread, BotView, BotsSnapshot } from "../../src/features/bots/model/bots";
import { BotThreadStore } from "./thread/store";
import { BotStore } from "./store";
import type { BotMemoryChange, BotMemoryDocument } from "../../src/features/bots/model/botMemory";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup({ serial = true }: { serial?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bot-manager-"));
  const store = new HostStore(join(directory, "host.db"));
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn(input => new Promise<void>(finish => turns.push({ input, finish }))),
    stop: vi.fn(async sessionId => { turns.filter(turn => turn.input.sessionId === sessionId).forEach(turn => turn.finish()); }),
    cancel: vi.fn(async sessionId => { turns.filter(turn => turn.input.sessionId === sessionId).forEach(turn => turn.finish()); }),
    bind: vi.fn(), approve: vi.fn(), answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  cleanups.push(async () => { await engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  await Promise.all([engine.ready, engine.workflows.ready]);
  engine.bots.setCatalog(async () => ["codex"], async () => ({ models: { codex: [{ id: "test", name: "Test" }, { id: "next", name: "Next" }] }, errors: {} }));
  const createBot = async (name: string) => {
    const created = await engine.bots.rpc("bots.create", {
      commandId: `create-${name}`, patch: { name, harness: "codex", model: "test", ...(serial ? { maxConcurrentRuns: 1 } : {}), triggers: { user: true, event: false, schedule: false } },
    }) as { bot: BotView; thread: BotThread };
    return { botId: created.bot.id, threadId: created.thread.id };
  };
  const createThread = async (botId: string, title: string) => {
    const thread = await engine.bots.rpc("botThreads.create", { commandId: `thread-${title}`, botId, title }) as BotThread;
    return { botId, threadId: thread.id };
  };
  const send = (scope: BotScope, text: string, commandId = "send") => engine.bots.rpc("botThreads.send", { ...scope, text, commandId });
  return { directory, store, engine, provider, turns, createBot, createThread, send };
}

it("scopes memory CAS, command retries and undo to their Bot without requiring a thread", async () => {
  const { engine, createBot } = await setup();
  const first = await createBot("Memory first"), second = await createBot("Memory second");
  const read = (botId: string) => engine.bots.rpc("botMemory.read", { botId, path: "MEMORY.md" }) as Promise<BotMemoryDocument>;
  const original = await read(first.botId);
  const request = { botId: first.botId, commandId: "save", path: "MEMORY.md", text: "shared deployment notes",
    expectedRevision: original.revision, expectedHash: original.hash };
  const saved = await engine.bots.rpc("botMemory.save", request) as BotMemoryDocument;
  expect(await engine.bots.rpc("botMemory.save", request)).toEqual(saved);
  expect((await read(second.botId)).text).toBe("");
  await expect(engine.bots.rpc("botMemory.save", { ...request, commandId: "stale", text: "overwrite" })).rejects.toMatchObject({ code: "MEMORY_CONFLICT" });
  const changes = await engine.bots.rpc("botMemory.log", { botId: first.botId, path: "MEMORY.md" }) as BotMemoryChange[];
  const change = changes.find(change => change.afterHash === saved.hash)!;
  await expect(engine.bots.rpc("botMemory.undo", { botId: second.botId, commandId: "undo", changeId: change.id,
    expectedRevision: 0, expectedHash: original.hash })).rejects.toThrow(/does not belong/);
  const undo = { botId: first.botId, commandId: "undo", changeId: change.id, expectedRevision: saved.revision, expectedHash: saved.hash };
  const restored = await engine.bots.rpc("botMemory.undo", undo) as BotMemoryDocument;
  expect(restored.text).toBe(original.text);
  expect(await engine.bots.rpc("botMemory.undo", undo)).toEqual(restored);
  await expect(engine.bots.rpc("botMemory.read", { botId: first.botId, path: "../outside.md" })).rejects.toThrow();
  expect(await engine.bots.rpc("botMemory.rebuild", { botId: first.botId, commandId: "rebuild" })).toMatchObject({ files: expect.any(Array) });
});

it("reloads Soul and bounded memory at turn boundaries without automatically loading logs", async () => {
  const { engine, store, turns, createBot, createThread, send } = await setup();
  const scope = await createBot("Context"), sibling = await createThread(scope.botId, "Other direct chat");
  const runtime = engine.bots.assistant(scope), memory = runtime.store.memory;
  const save = (path: string, text: string) => {
    const document = memory.read(path);
    return memory.save(path, text, { expectedRevision: document.revision, expectedHash: document.hash });
  };
  save("SOUL.md", "Respond with careful evidence.");
  save("MEMORY.md", `Resident preference\n${"ordinary note\n".repeat(199)}OUTSIDE_RESIDENT_BUDGET`);
  save("memory/deploy.md", "Deployment procedures require staging.");
  save("memory/log/2026-10-01.md", "LOG_MUST_STAY_ON_DEMAND deployment procedures");
  engine.bots.assistant(sibling).store.message({ id: "earlier", kind: "assistant", text: "Deployment procedures need two checks." });
  await send(scope, "Explain deployment procedures", "first");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.botContext?.systemInstructions).toContain("User-authored Bot identity (SOUL.md):\nRespond with careful evidence.");
  expect(turns[0].input.botContext?.systemInstructions).not.toContain("Resident preference");
  expect(turns[0].input.text).toContain("Memory truncated:");
  expect(turns[0].input.text).not.toMatch(/OUTSIDE_RESIDENT_BUDGET|LOG_MUST_STAY_ON_DEMAND/);
  const currentInput = turns[0].input.text.split("Current input (user):")[1];
  expect(currentInput).toContain('"kind":"topic"');
  expect(currentInput).toContain(`"threadId":"${sibling.threadId}"`);
  writeFileSync(join(memory.workspace, "SOUL.md"), "Respond with concise evidence.");
  expect(runtime.store.get()!.brainSessionId).toBe(turns[0].input.sessionId);
  turns[0].finish();
  await vi.waitFor(() => expect(store.session(turns[0].input.sessionId).status).toBe("idle"));
  await send(scope, "Explain deployment procedures again", "second");
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.sessionId).not.toBe(turns[0].input.sessionId);
  expect(turns[1].input.botContext?.systemInstructions).toContain("Respond with concise evidence.");
  expect(turns[1].input.botContext?.systemInstructions).not.toContain("Respond with careful evidence.");
  expect(turns[1].input.text).toContain("<previous_conversation>");
  expect(turns[1].input.text).not.toContain("LOG_MUST_STAY_ON_DEMAND");
});

it("serializes sibling threads while another Bot runs, preserving scopes and callback ownership", async () => {
  const { engine, turns, createBot, createThread, send } = await setup();
  const callback = engine.store.onSessionSave;
  const first = await createBot("First"), sibling = await createThread(first.botId, "Sibling"), second = await createBot("Second");
  expect(await engine.bots.rpc("assistant.get", {})).toMatchObject({ id: first.botId });
  expect(engine.store.onSessionSave).toBe(callback);
  await send(first, "First private message");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await send(sibling, "Sibling private message");
  await send(second, "Second private message");
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(engine.bots.assistant(sibling).store.pending()).toHaveLength(1);
  expect(engine.bots.assistant(first).store.latestMessages().filter(message => message.kind === "user").map(message => message.text)).toEqual(["First private message"]);
  expect(engine.bots.environment(turns[0].input.sessionId)).not.toEqual(engine.bots.environment(turns[1].input.sessionId));
  await expect(send({ botId: second.botId, threadId: first.threadId }, "Forged")).rejects.toThrow(/belong/);
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toContain("Sibling private message");
  expect(turns[2].input.sessionId).not.toBe(turns[0].input.sessionId);
  expect(turns[2].input.cwd).not.toBe(turns[0].input.cwd);
  const snapshot = await engine.bots.rpc("bots.list", {}) as BotsSnapshot;
  expect(snapshot.bots.find(bot => bot.id === first.botId)?.lifecycle).toBe("running");
});

it("defaults to three slots, persists the fourth queue and retains approval leases until a scoped cancellation", async () => {
  const { engine, turns, createBot, createThread, send } = await setup({ serial: false });
  const first = await createBot("Concurrent");
  const scopes = [first];
  for (let index = 1; index < 4; index++) scopes.push(await createThread(first.botId, `Slot ${index}`));
  for (const [index, scope] of scopes.entries()) await send(scope, `Unique concurrent task ${index}`);
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  const runtime = engine.bots.assistant(first), active = runtime.currentRun!;
  const firstTurn = turns.find(turn => turn.input.sessionId === active.brainSessionId)!;
  firstTurn.input.onEvent({ type: "session.providerBound", providerSessionId: "native-concurrent" });
  firstTurn.input.onEvent({ type: "approval.requested", requestId: 19, title: "Allow?" });
  const approved = (await engine.bots.rpc("botThreads.runs", first) as BotRuns).runs[0];
  expect(approved).toMatchObject({ id: active.id, status: "waiting_approval", brainSessionId: firstTurn.input.sessionId, providerSessionId: "native-concurrent" });
  expect(approved.hostRunId).toBeTruthy();
  expect((await engine.bots.rpc("botThreads.runs", scopes[3]) as BotRuns).runs[0]).toMatchObject({ status: "queued" });
  await engine.bots.assistant(scopes[3]).managedTick();
  expect(turns).toHaveLength(3);
  await engine.bots.rpc("botThreads.cancel", { ...scopes[1], commandId: "cancel-second" });
  await vi.waitFor(() => expect(turns).toHaveLength(4));
  expect(runtime.currentRun?.id).toBe(active.id);
  expect(runtime.currentRun?.status).toBe("waiting_approval");
  expect((await engine.bots.rpc("botThreads.runs", scopes[1]) as BotRuns).runs[0].status).toBe("cancelled");
  expect(engine.bots.assistant(scopes[2]).currentRun?.status).toBe("running");
});

it("snapshots tools and execution directory for each run and applies changes to the next one", async () => {
  const { directory, engine, turns, createBot, send } = await setup();
  const scope = await createBot("Run config"), runtime = engine.bots.assistant(scope);
  await send(scope, "First run settings", "first");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const firstRun = runtime.currentRun!, destination = join(directory, "execution");
  mkdirSync(destination);
  await engine.bots.rpc("bots.configure", { botId: scope.botId, commandId: "configuration", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision,
    patch: { workingDirectory: destination, tools: { enabledActions: ["memory.read"], computer: false }, maxConcurrentRuns: 3 } });
  expect(runtime.currentRun?.config?.tools).toBeUndefined();
  expect(() => runtime.assertActionEnabled("projects.list")).not.toThrow();
  await send(scope, "Next run settings", "next");
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.cwd).toBe(destination);
  expect(turns[1].input.sessionId).not.toBe(turns[0].input.sessionId);
  expect(runtime.currentRun?.config).toMatchObject({ workingDirectory: destination, tools: { enabledActions: ["memory.read"] } });
  expect(() => runtime.assertActionEnabled("projects.list")).toThrow(/not enabled/);
  expect(() => runtime.assertActionEnabled("memory.read")).not.toThrow();
  expect(runtime.currentRun?.capabilities).toMatchObject({ systemInstructions: "native", toolBridge: "control-cli" });
  expect(engine.bots.store.run(scope, firstRun.id)).toMatchObject({ status: "completed", config: { workingDirectory: turns[0].input.cwd } });
  await engine.bots.rpc("bots.configure", { botId: scope.botId, commandId: "reset-directory", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision, patch: { workingDirectory: null } });
  expect(engine.bots.store.getBot(scope.botId)?.workingDirectory).toBeUndefined();
});

it("runs shared execution directories concurrently within each Bot slot limit", async () => {
  const { directory, engine, turns, createBot, createThread, send } = await setup({ serial: false });
  const one = await createBot("Shared first"), two = await createBot("Shared second"), independent = await createBot("Separate");
  const shared = join(directory, "shared-project");
  mkdirSync(shared);
  for (const scope of [one, two]) await engine.bots.rpc("bots.configure", {
    botId: scope.botId, commandId: "working-directory", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision, patch: { workingDirectory: shared },
  });
  const sibling = await createThread(one.botId, "Same shared project");
  await send(one, "Own the shared directory");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await send(two, "Wait for the directory");
  await send(sibling, "Also wait for the directory");
  await send(independent, "Use an independent directory");
  await vi.waitFor(() => expect(turns).toHaveLength(4));
  expect(engine.bots.store.runs(two).runs[0].status).toBe("running");
  expect(engine.bots.store.runs(sibling).runs[0].status).toBe("running");
  expect(turns.filter(turn => turn.input.cwd === shared)).toHaveLength(3);
  expect(engine.bots.assistant(independent).currentRun?.status).toBe("running");
});

it("recovers queued inputs after restart while interrupting prior runs and preserving unknown side effects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bot-restart-")), store = new HostStore(join(directory, "host.db"));
  const bots = new BotStore(store), scope = bots.createBot({ harness: "codex", model: "test", triggers: { user: true, event: false, schedule: false } });
  const assistant = new BotThreadStore(store, scope);
  const old = assistant.receive("old", "Previously running task", []);
  const oldWakeup = assistant.wakeup(old.wakeupId!)!, run = bots.queuedRun(scope, oldWakeup);
  assistant.claim(oldWakeup.id);
  bots.updateRun(scope, run.id, { status: "running", startedAt: Date.now() });
  assistant.putAction({ id: "unknown-action", requestId: "unknown-request", action: "workspace.run", state: "executing",
    origin: { kind: "assistant", assistantId: scope.botId, wakeupId: oldWakeup.id, actionId: "unknown-action", rootCauseId: oldWakeup.rootCauseId } } as never);
  const queued = assistant.receive("queued", "Independent queued request", []);
  store.close();
  const reopened = new HostStore(join(directory, "host.db"));
  const turns: SendTurnInput[] = [];
  const provider: HostProvider = { send: vi.fn(async input => { turns.push(input); }), stop: vi.fn(), cancel: vi.fn(), bind: vi.fn(), approve: vi.fn(), answer: vi.fn() };
  const engine = new HostEngine(reopened, { codex: provider });
  cleanups.push(async () => { await engine.close(); reopened.close(); rmSync(directory, { recursive: true, force: true }); });
  await Promise.all([engine.ready, engine.workflows.ready]);
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await vi.waitFor(() => expect(engine.bots.store.runs(scope).runs.find(value => value.wakeupId === queued.wakeupId)?.status).toBe("completed"));
  expect(engine.bots.store.run(scope, run.id)?.status).toBe("interrupted");
  expect(engine.bots.assistant(scope).store.wakeup(oldWakeup.id)?.state).toBe("interrupted");
  expect(engine.bots.assistant(scope).store.action("unknown-request")?.state).toBe("unknown");
  expect(turns[0].text.split("Current input (user):")[1]).toContain("Independent queued request");
  expect(turns[0].text.split("Current input (user):")[1]).not.toContain("Previously running task");
});

it("replaces an invalid native session on a new input without replaying its failed turn", async () => {
  const { engine, turns, createBot, send } = await setup();
  const scope = await createBot("Native cache"), runtime = engine.bots.assistant(scope);
  await send(scope, "The original request", "original");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const runId = runtime.currentRun!.id, brainId = turns[0].input.sessionId;
  turns[0].input.onEvent({ type: "session.error", message: "Native session no longer exists" });
  turns[0].finish();
  await vi.waitFor(() => expect(engine.bots.store.run(scope, runId)?.status).toBe("interrupted"));
  await runtime.managedTick();
  expect(turns).toHaveLength(1);
  await send(scope, "Inspect the prior failure before continuing", "new-input");
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.sessionId).not.toBe(brainId);
  expect(turns[1].input.text).toContain("<previous_conversation>");
  expect(turns[1].input.text.split("Current input (user):")[1]).toBe("\nInspect the prior failure before continuing");
  expect(engine.bots.store.run(scope, runId)?.status).toBe("interrupted");
});

it("keeps approval and cancellation scoped, with pending approval occupying its Bot slot", async () => {
  const { engine, turns, provider, createBot, createThread, send } = await setup();
  const first = await createBot("First"), sibling = await createThread(first.botId, "Sibling"), second = await createBot("Second");
  await send(first, "Needs approval");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await send(second, "Independent work");
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[0].input.onEvent({ type: "approval.requested", requestId: 7, title: "Approve this work?" });
  const input = engine.bots.assistant(first).store.latestMessages().find(message => message.kind === "input")!;
  if (input.kind !== "input") throw new Error("Missing approval");
  await send(sibling, "Wait behind approval");
  expect(turns).toHaveLength(2);
  await expect(engine.bots.rpc("botThreads.respond", {
    ...second, commandId: "respond", messageId: input.id, brainGeneration: input.brainGeneration,
    runId: input.runId, requestId: input.requestId, decision: "allow",
  })).rejects.toThrow(/no longer pending/);
  expect(provider.approve).not.toHaveBeenCalled();
  turns[1].input.onEvent({ type: "approval.requested", requestId: 7, title: "Independent approval" });
  const secondInput = engine.bots.assistant(second).store.latestMessages().find(message => message.kind === "input")!;
  if (secondInput.kind !== "input") throw new Error("Missing second approval");
  for (const [scope, message] of [[first, input], [second, secondInput]] as const)
    await engine.bots.rpc("botThreads.respond", {
      ...scope, commandId: "respond", messageId: message.id, brainGeneration: message.brainGeneration,
      runId: message.runId, requestId: message.requestId, decision: "allow",
    });
  await vi.waitFor(() => expect(provider.approve).toHaveBeenCalledTimes(2));
  vi.mocked(provider.stop).mockClear();
  await engine.bots.rpc("botThreads.cancel", { ...sibling, commandId: "cancel-sibling" });
  expect(engine.bots.assistant(first).store.get()?.lifecycle).toBe("running");
  await engine.bots.rpc("assistant.control", { commandId: "cancel-first", action: "cancelTurn" });
  expect(engine.bots.assistant(second).store.get()?.lifecycle).toBe("running");
  expect(provider.stop).not.toHaveBeenCalledWith(turns[1].input.sessionId);
});

it("pauses a whole Bot including newly created threads without repeating an old control", async () => {
  const { engine, turns, createBot, createThread, send } = await setup();
  const scope = await createBot("Paused");
  await engine.bots.rpc("assistant.control", { commandId: "pause", action: "pause" });
  const sibling = await createThread(scope.botId, "After pause");
  await send(sibling, "Run after the Bot resumes");
  await engine.bots.assistant(sibling).managedTick();
  expect(turns).toHaveLength(0);
  expect(engine.bots.store.getBot(scope.botId)?.paused).toBe(true);
  expect(await engine.bots.rpc("botThreads.get", sibling)).toMatchObject({ lifecycle: "paused" });
  await engine.bots.rpc("botThreads.control", { ...sibling, commandId: "pause", action: "resume" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  await engine.bots.rpc("bots.control", { botId: scope.botId, commandId: "pause", action: "pause" });
  expect(engine.bots.store.getBot(scope.botId)?.paused).toBe(false);
  expect(engine.bots.assistant(sibling).store.get()?.lifecycle).toBe("running");
});

it("applies model changes on the next turn and preserves a running provider session", async () => {
  const { engine, turns, createBot, send } = await setup();
  const scope = await createBot("Models");
  await send(scope, "Use the original model");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const brain = turns[0].input.sessionId;
  await engine.bots.rpc("bots.configure", {
    botId: scope.botId, commandId: "model-change", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision,
    patch: { model: "next" },
  });
  expect(engine.bots.assistant(scope).store.get()?.brainSessionId).toBe(brain);
  expect(engine.bots.assistant(scope).store.get()?.lifecycle).toBe("running");
  await send(scope, "Use the next model", "next-turn");
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.model).toBe("next");
  expect(turns[1].input.sessionId).not.toBe(brain);
});

it("validates Bot model defaults independently of its default thread override", async () => {
  const { engine, createBot } = await setup();
  const scope = await createBot("Defaults");
  engine.bots.setCatalog(async () => ["codex", "claude"], async () => ({
    models: { codex: [{ id: "test", name: "Test" }, { id: "next", name: "Next" }], claude: [{ id: "claude-only", name: "Claude" }] }, errors: {},
  }));
  await engine.bots.rpc("botThreads.configure", {
    ...scope, commandId: "override", expectedRevision: engine.bots.store.getThread(scope.botId, scope.threadId)!.revision,
    patch: { modelOverride: { harness: "claude", model: "claude-only" } },
  });
  await engine.bots.rpc("bots.configure", {
    botId: scope.botId, commandId: "default-model", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision,
    patch: { model: "next" },
  });
  expect(engine.bots.store.getBot(scope.botId)).toMatchObject({ harness: "codex", model: "next" });
  expect(await engine.bots.rpc("botThreads.get", scope)).toMatchObject({ harness: "claude", model: "claude-only" });
});

it("archives a running sibling after checking its revision and retries without another cancellation", async () => {
  const { engine, turns, createBot, createThread, send } = await setup();
  const bot = await createBot("Archive"), scope = await createThread(bot.botId, "Archive me");
  await send(scope, "Running work");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  engine.bots.assistant(scope).store.enqueue({ id: "automatic", kind: "schedule", text: "Pending automatic work", rootCauseId: "automatic", state: "pending", createdAt: Date.now(), attempts: 0 }, "automatic");
  const command = { ...scope, commandId: "archive", expectedRevision: engine.bots.store.getThread(scope.botId, scope.threadId)!.revision };
  vi.spyOn(engine.bots.store, "updateThread").mockImplementationOnce(() => { throw new Error("archive persistence failed"); });
  await expect(engine.bots.rpc("botThreads.archive", command)).rejects.toThrow(/archive persistence failed/);
  const first = await engine.bots.rpc("botThreads.archive", command);
  const revision = engine.bots.assistant(scope).store.get()!.chatRevision;
  expect(await engine.bots.rpc("botThreads.archive", command)).toEqual(first);
  expect(engine.bots.assistant(scope).store.get()!.chatRevision).toBe(revision);
  await engine.bots.assistant(scope).managedTick();
  expect(turns).toHaveLength(1);
  await expect(send(scope, "Archived")).rejects.toThrow(/Restore/);
});

it("normalizes optional Unicode avatars without losing them on legacy configuration updates", async () => {
  const { engine, createBot } = await setup();
  const scope = await createBot("Avatar");
  const create = { commandId: "created-avatar", patch: { name: "Created", avatar: " 🤖 ", harness: "codex", model: "test" } };
  const created = await engine.bots.rpc("bots.create", structuredClone(create)) as { bot: BotView };
  expect(created.bot.avatar).toBe("🤖");
  expect(await engine.bots.rpc("bots.create", structuredClone(create))).toEqual(created);
  const configure = (patch: Record<string, unknown>, commandId: string) => engine.bots.rpc("bots.configure", {
    botId: scope.botId, commandId, expectedRevision: engine.bots.store.getBot(scope.botId)!.revision, patch,
  });
  await configure({ avatar: "  🤖🌱工作伙伴🧪🦉  " }, "avatar");
  expect(engine.bots.store.getBot(scope.botId)?.avatar).toBe("🤖🌱工作伙伴🧪🦉");
  await engine.bots.rpc("assistant.configure", {
    commandId: "legacy-update", expectedRevision: engine.bots.store.getBot(scope.botId)!.revision, patch: { name: "Renamed" },
  });
  expect(await engine.bots.rpc("assistant.get", {})).toMatchObject({ avatar: "🤖🌱工作伙伴🧪🦉", name: "Renamed" });
  for (const [index, avatar] of ["123456789", "\n🤖", "abc\u0085", 1].entries())
    await expect(configure({ avatar }, `invalid-${index}`)).rejects.toThrow(/Avatar must be/);
  await configure({ avatar: "   " }, "clear");
  expect(engine.bots.store.getBot(scope.botId)?.avatar).toBeUndefined();
});

it("restores archived threads for new work without replaying old queues or removing Bot gates", async () => {
  const { engine, turns, createBot, createThread, send } = await setup();
  const bot = await createBot("Restore"), scope = await createThread(bot.botId, "Old work");
  const runtime = engine.bots.assistant(scope);
  const change = (method: "archive" | "restore", commandId: string) => engine.bots.rpc(`botThreads.${method}`, {
    ...scope, commandId, expectedRevision: engine.bots.store.getThread(scope.botId, scope.threadId)!.revision,
  });
  await expect(engine.bots.rpc("botThreads.archive", { ...bot, commandId: "default-thread" })).rejects.toThrow(/default thread/);
  await expect(engine.bots.rpc("bots.archive", { botId: bot.botId, commandId: "default-bot" })).rejects.toThrow(/default Bot/);
  await change("archive", "archive");
  // Simulate pending/backoff records written by an older Host before archival.
  for (const [id, state] of [["old-queued", "pending"], ["old-backoff", "backoff"], ["old-interrupted", "interrupted"]] as const)
    runtime.store.enqueue({ id, state, kind: "schedule", text: "Do not replay", rootCauseId: id, attempts: 1, createdAt: Date.now() }, id);
  await engine.bots.rpc("assistant.control", { commandId: "pause", action: "pause" });
  await change("restore", "restore");
  expect(runtime.store.get()?.lifecycle).toBe("idle");
  expect((await engine.bots.rpc("botThreads.get", scope)) as BotView).toMatchObject({ lifecycle: "paused" });
  expect(runtime.store.wakeup("old-queued")?.state).toBe("completed");
  expect(runtime.store.wakeup("old-backoff")?.state).toBe("completed");
  expect(runtime.store.wakeup("old-interrupted")?.state).toBe("interrupted");
  await runtime.managedTick();
  expect(turns).toHaveLength(0);
  // Turning the Bot on is a separate user action. Remove only the fixture's
  // interrupted record so this test can isolate new messages after restoration.
  runtime.store.saveWakeup({ ...runtime.store.wakeup("old-interrupted")!, state: "completed" });
  await engine.bots.rpc("assistant.control", { commandId: "resume", action: "resume" });
  await send(scope, "New work after restoration", "fresh");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const run = runtime.currentRun!.id;
  await change("restore", "already-restored");
  expect(runtime.currentRun?.id).toBe(run);
  expect(runtime.store.get()?.lifecycle).toBe("running");
});

it("keeps legacy stop thread-scoped and legacy disable Bot-scoped for existing and new threads", async () => {
  const { engine, turns, createBot, createThread, send } = await setup({ serial: false });
  const bot = await createBot("Legacy default"), sibling = await createThread(bot.botId, "Parallel"), other = await createBot("Other Bot");
  await send(bot, "Default work");
  await send(sibling, "Sibling work");
  await send(other, "Other Bot work");
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  await engine.bots.rpc("assistant.control", { commandId: "legacy-stop", action: "cancelTurn" });
  expect(engine.assistant.currentRun).toBeUndefined();
  expect(engine.bots.assistant(sibling).currentRun?.status).toBe("running");
  expect(engine.bots.assistant(other).currentRun?.status).toBe("running");
  await engine.bots.rpc("assistant.control", { commandId: "legacy-disable", action: "disable" });
  expect(engine.bots.assistant(sibling).currentRun).toBeUndefined();
  await engine.bots.rpc("botThreads.archive", { ...sibling, commandId: "archive-disabled" });
  await engine.bots.rpc("botThreads.restore", { ...sibling, commandId: "restore-disabled" });
  expect(await engine.bots.rpc("botThreads.get", sibling)).toMatchObject({ lifecycle: "disabled", enabled: false });
  const after = await createThread(bot.botId, "Created after disable");
  expect(await engine.bots.rpc("botThreads.get", after)).toMatchObject({ lifecycle: "disabled", enabled: false });
  await expect(send(after, "Should not run")).rejects.toThrow(/messaging is disabled/);
  expect(engine.bots.assistant(other).currentRun?.status).toBe("running");
});

it("retires all archived Bot queues across threads while preserving interrupted history", async () => {
  const { engine, createBot, createThread } = await setup();
  await createBot("Default");
  const bot = await createBot("Archive Bot"), sibling = await createThread(bot.botId, "Queued automatic work");
  await engine.bots.rpc("bots.control", { botId: bot.botId, commandId: "pause", action: "pause" });
  for (const scope of [bot, sibling]) {
    const runtime = engine.bots.assistant(scope);
    for (const [id, state] of [["before-archive", "pending"], ["unknown-effects", "interrupted"]] as const)
      runtime.store.enqueue({ id, state, kind: "schedule", text: "Old automatic work", rootCauseId: id, attempts: 1, createdAt: Date.now() }, id);
  }
  await engine.bots.rpc("bots.archive", { botId: bot.botId, commandId: "archive", expectedRevision: engine.bots.store.getBot(bot.botId)!.revision });
  for (const scope of [bot, sibling]) {
    const runtime = engine.bots.assistant(scope);
    expect(runtime.store.wakeup("before-archive")?.state).toBe("completed");
    expect(runtime.store.wakeup("unknown-effects")?.state).toBe("interrupted");
    runtime.store.enqueue({ id: "legacy-backoff", state: "backoff", retryAt: Date.now() + 60_000, kind: "schedule",
      text: "Older Host archived work", rootCauseId: "legacy-backoff", attempts: 1, createdAt: Date.now() }, "legacy-backoff");
  }
  await engine.bots.rpc("bots.restore", { botId: bot.botId, commandId: "restore", expectedRevision: engine.bots.store.getBot(bot.botId)!.revision });
  expect(engine.bots.store.getBot(bot.botId)).toMatchObject({ paused: true, lifecycle: "paused" });
  for (const scope of [bot, sibling]) {
    const runtime = engine.bots.assistant(scope);
    expect(runtime.store.wakeup("legacy-backoff")?.state).toBe("completed");
    expect(runtime.store.wakeup("unknown-effects")?.state).toBe("interrupted");
    expect(runtime.currentRun).toBeUndefined();
  }
});
