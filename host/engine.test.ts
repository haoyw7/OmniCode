import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { hostProviders, type HostProvider } from "./providers";
import { HostEngine, parseCommand } from "./engine";
import { HostStore } from "./store";
import { HostClientState } from "./client-state";
import { readAttachmentChunk, writeAttachmentChunk } from "./attachments";
import type { HarnessBotContext } from "../src/integrations/harness/core/botContext";
import { providerBotCapabilities } from "../src/integrations/harness/providers/botCapabilities";
import { checkoutPath } from "./checkout-guards";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});

function setup(harness: "codex" | "claude" | "pi" | "omp" | "deepseek" = "codex") {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-engine-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          turns.push({ input, finish: resolve });
        }),
    ),
    cancel: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    stop: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  // Native sources resolve inside the fixture, never in the developer's home.
  const engine = new HostEngine(store, { codex: provider, claude: provider, pi: provider, omp: provider, deepseek: provider }, undefined, {
    native: { environment: { home: join(directory, "home"), env: {} } },
  });
  const created = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness,
    model: `${harness}:test`,
    runtimeMode: "supervised",
  });
  cleanups.push(async () => {
    // Workflow initialization writes asynchronously; let it finish before
    // removing the fixture's directory.
    await engine.workflows.ready;
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    provider,
    project,
    engine,
    turns,
    id: created.sessionId,
  };
}

describe("headless session ownership", () => {
  it.each(["claude", "deepseek"] as const)("stops a selected %s background task without cancelling its parent turn", async (harness) => {
    const { engine, provider, id, turns, store } = setup(harness);
    await engine.ready;
    provider.stopBackgroundTask = vi.fn(async () => {});
    engine.command({ type: "send", commandId: "background-send", sessionId: id, text: "Build" });
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 5000 });
    await engine.stopBackgroundTask(id, "task-1");
    expect(provider.stopBackgroundTask).toHaveBeenCalledWith(id, "task-1");
    expect(provider.cancel).not.toHaveBeenCalled();
    expect(store.session(id).status).toBe("running");
  });

  it.each([false, true])("persists thrown provider failures as one visible error (event already sent: %s)", async (emitted) => {
    const { engine, store, provider, id } = setup("deepseek");
    await engine.ready;
    provider.send = vi.fn(async (input) => {
      if (emitted) input.onEvent({ type: "session.error", message: "Connection reset" });
      throw new Error("Connection reset");
    });
    engine.command({ type: "send", commandId: "network-failure", sessionId: id, text: "Work" });
    await vi.waitFor(() => {
      expect(provider.send).toHaveBeenCalledOnce();
      expect(store.session(id).status).toBe("idle");
    }, { timeout: 5000 });
    expect(store.session(id).session.blocks.filter(block => block.text === "Connection reset"))
      .toEqual([expect.objectContaining({ role: "system", notice: "error" })]);
    provider.send = vi.fn(async (input) => input.onEvent({ type: "message.delta", text: "Recovered" }));
    engine.command({ type: "send", commandId: "network-recovered", sessionId: id, text: "Continue" });
    await vi.waitFor(() => expect(store.session(id).session.blocks.some(block => block.text === "Recovered")).toBe(true));
  });

  it.each(["", "high"])("forwards DeepSeek reasoning_effort through session configuration and sending (%s)", async (effort) => {
    const { engine, project, turns } = setup("deepseek");
    await engine.ready;
    const model = 'deepseek:["deepseek-account","deepseek-flash"]';
    const modelSettings = { reasoning_effort: effort };
    const created = engine.command({
      type: "create", commandId: "deepseek-create", projectId: project.id,
      harness: "deepseek", model, modelSettings, runtimeMode: "supervised",
    });
    engine.command({
      type: "configure", commandId: "deepseek-configure", sessionId: created.sessionId,
      harness: "deepseek", model, modelSettings, runtimeMode: "supervised",
    });
    engine.command({ type: "send", commandId: "deepseek-send", sessionId: created.sessionId, text: "Hello" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({ model, modelSettings });
    turns[0].finish();
  });

  it("keeps model-setting name, type and size restrictions", () => {
    for (const modelSettings of [
      { "reasoning effort": "high" },
      { reasoning_effort: 1 },
      { reasoning_effort: "high\0" },
      { reasoning_effort: "x".repeat(129) },
      { ["r".repeat(65)]: "high" },
    ]) {
      expect(() => parseCommand({
        type: "configure", commandId: "invalid-settings", sessionId: "session",
        model: "deepseek:test", modelSettings, runtimeMode: "supervised",
      })).toThrow("Invalid model settings");
    }
  });

  it("keeps a DeepSeek question open across devices and forwards its saved native late reply", async () => {
    const { engine, store, turns, provider, id } = setup("deepseek");
    provider.keepQuestionOpen = vi.fn();
    await engine.ready;
    engine.command({ type: "send", commandId: "send-question", sessionId: id, text: "Ask" });
    await vi.waitFor(() => expect(turns, JSON.stringify(store.session(id).session)).toHaveLength(1), { timeout: 10_000 });
    turns[0].input.onEvent({ type: "question.asked", requestId: 3, providerQuestionId: "native-q", allowLateReply: true,
      autoResolveAt: Date.now() + 1000,
      questions: [{ id: "q", prompt: "Choose", multiSelect: false, allowCustom: true, options: [{ id: "One", label: "One" }] }] });
    const keep = { type: "keepQuestionOpen", commandId: "keep", sessionId: id, runId: store.session(id).runId, requestId: 3 };
    expect(() => engine.command({ ...keep, runId: "old" })).toThrow("finished or replaced");
    engine.command(keep); engine.command(keep);
    expect(provider.keepQuestionOpen).toHaveBeenCalledTimes(1);
    expect(provider.keepQuestionOpen).toHaveBeenCalledWith(id, 3);
    expect(store.session(id).session.pendingQuestion?.autoResolveAt).toBeUndefined();
    turns[0].input.onEvent({ type: "question.resolved", requestId: 3, decision: "cancelled" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const blockId = store.session(id).session.blocks.find(block => block.question)?.id;
    engine.command({ type: "send", commandId: "late", sessionId: id, text: "One",
      questionAnswer: { blockId, reply: { kind: "answered", answers: { q: ["One"] } } } });
    await vi.waitFor(() => expect(turns).toHaveLength(2), { timeout: 10_000 });
    expect(turns[1].input.questionReply).toEqual({ requestId: "native-q", reply: { kind: "answered", answers: { q: ["One"] } } });
    turns[1].finish();
  });
  it("rejects public Bot context and snapshots trusted context separately from user references", async () => {
    const { engine, store, provider, turns, id } = setup();
    await engine.ready;
    const record = engine.assistant.store.initialize({ enabled: false, harness: "codex", model: "test" });
    engine.assistant.store.update({ brainSessionId: id });
    const current = store.session(id);
    store.save({ ...current, revision: current.revision + 1, session: { ...current.session, assistantOwnerId: record.id } }, { type: "test" });
    const scope = engine.assistant.store.scope;
    const run = engine.bots.store.queuedRun(scope, { id: "wake", attempts: 0, createdAt: Date.now() });
    engine.bots.store.updateRun(scope, run.id, { status: "running" });
    const context: HarnessBotContext = { scope: { ...scope, runId: run.id }, systemInstructions: "Identity and Soul", contextFingerprint: "v1", tools: { enabledActions: ["memory.read"] }, controlCli: { command: "omnicode-control" } };
    const command = { type: "send", commandId: "context-send", sessionId: id, text: "USER AND RECALL REFERENCE" };
    expect(() => engine.command({ ...command, botContext: context })).toThrow("reserved");
    expect(() => engine.assistantCommand(command, undefined, { ...context, scope: { ...context.scope, threadId: "forged" } })).toThrow("does not belong");
    provider.botCapabilities = providerBotCapabilities("codex");
    engine.assistantCommand(command, undefined, context);
    context.systemInstructions = "changed later";
    context.tools!.enabledActions!.push("sessions.send");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({ text: "USER AND RECALL REFERENCE", controlsAgents: true, botContext: { systemInstructions: "Identity and Soul", tools: { enabledActions: ["memory.read"] } } });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    provider.botCapabilities = providerBotCapabilities("cursor");
    engine.assistantCommand({ ...command, commandId: "fallback-send" }, undefined, context);
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toContain('delivery="user-message-fallback"');
    expect(turns[1].input.text).toContain("USER AND RECALL REFERENCE");
    expect(engine.botCapabilities("codex").mcp).toBe("unavailable");
    turns[1].finish();
  });

  it("runs conversations on the same checkout concurrently and dispatches each exactly once", async () => {
    const { engine, store, project, id, turns } = setup();
    const second = engine.command({ type: "create", commandId: "second", projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised" }).sessionId;
    engine.command({ type: "send", commandId: "first-run", sessionId: id, text: "First" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    engine.command({ type: "send", commandId: "second-run", sessionId: second, text: "Second" });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(store.session(second).status).toBe("running");
    turns[0].finish();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.sessionId).toBe(second);
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(second).status).toBe("idle"));
  });

  it("persists resource wait reasons, cancels before dispatch, and starts a later request once", async () => {
    const { engine, store, turns, id, directory } = setup("pi");
    await engine.ready;
    store.db.prepare("INSERT INTO checkout_resources VALUES ('exclusive', ?, 'integrating', ?)").run(checkoutPath(directory), process.pid);
    engine.command({ type: "send", commandId: "waiting", sessionId: id, text: "Wait" });
    await vi.waitFor(() => expect(store.session(id).session.executionState).toMatchObject({ phase: "waiting-resource", reason: "integrating", blockers: [{ id: "exclusive" }] }));
    expect(turns).toHaveLength(0);
    engine.command({ type: "cancel", commandId: "cancel-wait", sessionId: id, runId: store.session(id).runId! });
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.executionState).toBeUndefined();
    store.db.prepare("DELETE FROM checkout_resources WHERE id='exclusive'").run();
    engine.command({ type: "send", commandId: "retry-wait", sessionId: id, text: "Retry" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(store.session(id).session.executionState?.phase).toBe("starting");
    turns[0].input.onEvent({ type: "session.started" });
    expect(store.session(id).session.executionState?.phase).toBe("awaiting-response");
    turns[0].input.onEvent({ type: "reasoning.delta", text: "Thinking now" });
    expect(engine.session(id)?.session.executionState?.phase).toBe("active");
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(turns).toHaveLength(1);
    expect(store.session(id).session.executionState).toBeUndefined();
  });

  it("reads Claude hooks from the execution Host for each new turn", async () => {
    const { store, engine, turns, id } = setup("claude");
    const preferences = new HostClientState(store);
    preferences.preferencesPatch({ operationId: "disable-hooks", changes: { "omnicode.claudeHooks": "0" } });
    engine.command({ type: "send", commandId: "no-hooks", sessionId: id, text: "First request" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.claudeHooks).toBe(false);
    preferences.preferencesPatch({ operationId: "enable-hooks", changes: { "omnicode.claudeHooks": "1" } });
    expect(turns[0].input.claudeHooks).toBe(false);
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    engine.command({ type: "send", commandId: "with-hooks", sessionId: id, text: "Second request" });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.claudeHooks).toBe(true);
    turns[1].finish();
  });

  it("preserves activity time when restoring queue capabilities at startup", async () => {
    const { engine, store, provider, directory, id } = setup();
    const current = store.session(id);
    store.save({ ...current, revision: current.revision + 1, updatedAt: 1_000, supportsQueue: false }, { type: "test" });
    await engine.close();
    const restarted = new HostEngine(store, { codex: provider }, undefined, {
      native: { environment: { home: join(directory, "home"), env: {} } },
    });
    try {
      expect(store.session(id)).toMatchObject({ updatedAt: 1_000, supportsQueue: true });
      expect(store.summaries()[0].updatedAt).toBe(1_000);
    } finally {
      await restarted.workflows.ready;
      await restarted.close();
    }
  });

  it("reads one session for orchestration without enumerating history and preserves unflushed output", async () => {
    const { engine, store, turns, id } = setup();
    await engine.ready;
    const sessions = vi.spyOn(store, "sessions");
    expect(engine.orchestration.scheduler.submissionError(id)).toBeNull();
    expect(engine.orchestration.scheduler.submissionError("missing")).toBeNull();
    expect(sessions).not.toHaveBeenCalled();

    engine.command({ type: "send", commandId: "single-session-send", sessionId: id, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const started = store.session(id).revision;
    turns[0].input.onEvent({ type: "message.delta", text: "Unflushed response" });
    expect(store.session(id).revision).toBe(started);
    expect(store.session(id).session.blocks.some((block) => block.text === "Unflushed response")).toBe(false);
    expect(engine.session(id)?.session.blocks.some((block) => block.text === "Unflushed response")).toBe(true);
    expect(engine.session("missing")).toBeUndefined();
    expect(sessions).not.toHaveBeenCalled();
    sessions.mockRestore();
    turns[0].finish();
  });

  it("skips submission checks for native refreshes while still enforcing them for sends", async () => {
    const { engine, id } = setup();
    await engine.ready;
    const submission = vi.spyOn(engine.orchestration.scheduler, "submissionError").mockReturnValue("Submission is blocked");
    engine.orchestration.assertSessionWrite(id, "refresh");
    expect(submission).not.toHaveBeenCalled();
    expect(() => engine.orchestration.assertSessionWrite(id, "send")).toThrow("Submission is blocked");
    expect(submission).toHaveBeenCalledOnce();
    submission.mockRestore();
  });

  it.each(["pi", "omp"] as const)("uses the independent title API immediately for %s", async (harness) => {
    const { engine, store, provider, turns, id } = setup(harness);
    const generate = vi.spyOn(engine.titleModel, "generate").mockResolvedValue({ title: "API title", workItem: null });
    engine.command({ type: "send", commandId: "api-title", sessionId: id, text: "First request" });
    await vi.waitFor(() => expect(store.session(id).session.title).toBe(`${harness} · API title`));
    expect(generate).toHaveBeenCalledExactlyOnceWith("First request");
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("refreshes event-automation titles once and protects subsequent manual names", async () => {
    const { engine, store, turns, id } = setup();
    const generateTitle = vi.spyOn(engine.titleModel, "generate").mockImplementation(async () => ({ title: "New automation goal", workItem: null }));
    engine.command({ type: "send", commandId: "initial-title", sessionId: id, text: "First goal" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "native" });
    turns[0].input.onEvent({ type: "session.titleUpdated", providerSessionId: "native", title: "Initial native goal" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    engine.command({ type: "send", commandId: "automation-title", sessionId: id, text: "New event goal", refreshTitle: true });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    await vi.waitFor(() => expect(store.session(id).session.title).toBe("codex · New automation goal"));
    turns[1].input.onEvent({ type: "session.titleUpdated", providerSessionId: "native", title: "Old native goal" });
    expect(store.session(id).session.title).toBe("codex · New automation goal");
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    engine.updateSession(id, { title: "My title" });
    engine.command({ type: "send", commandId: "manual-title", sessionId: id, text: "Another event", refreshTitle: true });
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    turns[2].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(generateTitle).toHaveBeenCalledTimes(1);
    expect(store.session(id).session.title).toBe("My title");
  });
  it("persists late native title metadata after settlement without changing transcript stamps", async () => {
    const { engine, store, provider, turns, id } = setup();
    provider.readSessionTitle = vi.fn(async () => null);
    const generateTitle = vi.spyOn(engine.titleModel, "generate").mockImplementation(async () => ({ title: "Extra request", workItem: null }));
    engine.command({ type: "send", commandId: "native-title", sessionId: id, text: "Title this conversation" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "native" });
    turns[0].input.onEvent({ type: "message.delta", text: "Answer" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const before = store.session(id);
    turns[0].input.onEvent({ type: "session.titleUpdated", providerSessionId: "other", title: "Wrong session" });
    turns[0].input.onEvent({ type: "session.titleUpdated", providerSessionId: "native", title: "原生标题" });
    expect(store.session(id).session.title).toBe("codex · 原生标题");
    expect(store.session(id).blockRevisions).toEqual(before.blockRevisions);
    expect(store.session(id).updatedAt).toBe(before.updatedAt);
    expect(store.session(id).status).toBe("idle");
    expect(store.summaries(before.projectId)[0].titleState?.source).toBe("native");
    expect(generateTitle).not.toHaveBeenCalled();
    provider.readSessionTitle = vi.fn(async () => "Updated native title");
    turns[0].input.onEvent({ type: "session.titleRefreshRequested", providerSessionId: "native" });
    await vi.waitFor(() => expect(store.session(id).session.title).toBe("codex · Updated native title"));
    engine.updateSession(id, { title: "User title" });
    turns[0].input.onEvent({ type: "session.titleUpdated", providerSessionId: "native", title: "Later native" });
    expect(store.session(id).session.title).toBe("User title");
    expect(store.summaries(before.projectId)[0].titleState?.source).toBe("manual");
  });

  it("binds an imported provider identity on first use after the Host is already running", async () => {
    const { store, engine, id, provider, turns } = setup();
    const current = store.session(id);
    store.save({ ...current, revision: current.revision + 1,
      session: { ...current.session, providerSessionId: "imported-native", providerAccountId: "saved-account" } },
      { type: "desktop.import" });
    engine.command({ type: "send", commandId: "continue-import", sessionId: id, text: "Continue old history" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(provider.bind).toHaveBeenCalledWith(id, "imported-native", current.session.cwd, "saved-account");
    expect(turns[0].input.providerAccountId).toBe("saved-account");
    turns[0].finish();
  });

  it("reuses DeepSeek between turns without a title reader and releases it after 30 idle minutes", async () => {
    vi.useFakeTimers();
    const { engine, store, provider, turns, id } = setup("deepseek");
    await engine.ready;
    engine.nativeSessions.setAutoSync(false);
    provider.keepAlive = hostProviders.deepseek.keepAlive;
    provider.idleTimeoutMs = hostProviders.deepseek.idleTimeoutMs;
    expect(provider.readSessionTitle).toBeUndefined();
    engine.command({ type: "send", commandId: "deepseek-cold", sessionId: id, text: "First turn" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "dsh-thread" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(provider.stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(29 * 60_000);
    engine.command({ type: "send", commandId: "deepseek-warm", sessionId: id, text: "Continue" });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(provider.stop).not.toHaveBeenCalled();
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    // A follow-up resets the idle deadline instead of retaining the first timer.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(provider.stop).toHaveBeenCalledExactlyOnceWith(id);
    engine.command({ type: "send", commandId: "deepseek-resume", sessionId: id, text: "Resume after idle" });
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect(provider.bind).toHaveBeenLastCalledWith(id, "dsh-thread", store.session(id).session.cwd);
    turns[2].finish();
  });

  it.each(["failed", "cancelled"] as const)("releases a kept-alive DeepSeek process when a turn is %s", async (outcome) => {
    const { engine, store, provider, turns, id } = setup("deepseek");
    await engine.ready;
    provider.keepAlive = hostProviders.deepseek.keepAlive;
    engine.command({ type: "send", commandId: "deepseek-stop", sessionId: id, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    if (outcome === "failed") {
      turns[0].input.onEvent({ type: "session.error", message: "Fixture failure" });
      turns[0].finish();
    } else {
      engine.command({ type: "cancel", commandId: "deepseek-cancel", sessionId: id, runId: store.session(id).runId });
    }
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(provider.stop).toHaveBeenCalledWith(id);
  });

  it.each([
    { harness: "codex", failed: false },
    { harness: "codex", failed: true },
    { harness: "pi", failed: false },
    { harness: "omp", failed: false },
  ] as const)(
    "resumes the saved $harness conversation after its process is released (failed: $failed)",
    async ({ harness, failed }) => {
      vi.useFakeTimers();
      const { engine, store, provider, turns, id } = setup(harness);
      await engine.ready;
      engine.nativeSessions.setAutoSync(false);
      provider.readSessionTitle = vi.fn(async () => null);
      let retained: string | undefined;
      provider.bind = vi.fn((_id, providerId) => { retained = providerId; });
      provider.stop = vi.fn(async () => { retained = undefined; turns.at(-1)?.finish(); });
      const identities: Array<string | undefined> = [];
      const send = provider.send;
      provider.send = vi.fn((input) => { identities.push(retained); return send(input); });
      const current = store.session(id);
      store.save({ ...current, revision: current.revision + 1,
        session: { ...current.session, providerAccountId: "saved-account" } }, { type: "test" });

      engine.command({ type: "send", commandId: "before-idle", sessionId: id, text: "Remember this task" });
      await vi.waitFor(() => expect(turns).toHaveLength(1));
      turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "original-thread" });
      if (failed) turns[0].input.onEvent({ type: "session.error", message: "You've hit your usage limit" });
      turns[0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
      // Failed providers stop before the final checkpoint; successful ones
      // remain parked until their idle timeout. Both retain the conversation.
      expect(provider.stop).toHaveBeenCalledTimes(failed ? 1 : 0);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(provider.stop).toHaveBeenCalledOnce();
      expect(retained).toBe(failed ? "original-thread" : undefined);

      engine.command({ type: "send", commandId: "after-idle", sessionId: id, text: "Continue" });
      await vi.waitFor(() => expect(turns).toHaveLength(2));
      expect(identities).toEqual([undefined, "original-thread"]);
      expect(provider.bind).toHaveBeenLastCalledWith(id, "original-thread", current.session.cwd, "saved-account");
      turns[1].finish();
    },
  );

  it("waits for idle cleanup before rebinding and sending a follow-up", async () => {
    vi.useFakeTimers();
    const { engine, store, provider, turns, id } = setup();
    await engine.ready;
    engine.nativeSessions.setAutoSync(false);
    provider.readSessionTitle = vi.fn(async () => null);
    engine.command({ type: "send", commandId: "before-cleanup", sessionId: id, text: "First turn" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "session.providerBound", providerSessionId: "original-thread" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    let finishStop = () => {};
    provider.stop = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    try {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(provider.stop).toHaveBeenCalledOnce();
      vi.mocked(provider.bind).mockClear();
      engine.command({ type: "send", commandId: "during-cleanup", sessionId: id, text: "Continue" });
      await vi.advanceTimersByTimeAsync(100);
      expect(turns).toHaveLength(1);
      expect(provider.bind).not.toHaveBeenCalled();
      finishStop();
      await vi.waitFor(() => expect(turns).toHaveLength(2));
      expect(provider.bind).toHaveBeenCalledWith(id, "original-thread", store.session(id).session.cwd);
    } finally {
      finishStop();
      turns.at(-1)?.finish();
    }
  });
  it("persists generated PNG history, deduplicates events and enforces session ownership", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "paint", sessionId: id, text: "Paint" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const event = { type: "image.generated" as const, itemId: "paint", name: "saved.png", data: png, mimeType: "image/png" };
    turns[0].input.onEvent(event); turns[0].input.onEvent(event);
    expect(store.session(id).session.blocks.filter(block => block.role === "image")).toHaveLength(1);
    const block = store.session(id).session.blocks.find(block => block.role === "image")!;
    const file = block.attachments![0];
    expect(readAttachmentChunk(store, { sessionId: id, id: file.id, offset: 0 }).data).toBe(png);
    expect(JSON.stringify(store.session(id))).not.toContain(png);
    const other = engine.command({ type: "create", commandId: "other-image-session", projectId: store.session(id).projectId,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" });
    expect(() => readAttachmentChunk(store, { sessionId: other.sessionId, id: file.id, offset: 0 })).toThrow("not found");
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const snapshot = store.sync(id);
    expect(snapshot.kind).toBe("snapshot");
    if (snapshot.kind === "snapshot") expect(snapshot.value.session.blocks.find(row => row.role === "image")?.attachments?.[0]?.id).toBe(file.id);
    turns[0].input.onEvent({ ...event, itemId: "late" });
    expect(readdirSync(store.attachmentDir)).toHaveLength(1);
  });

  it("persists generated child images inside their agent and authorizes session reads", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "child-paint", sessionId: id, text: "Paint" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const emit = turns[0].input.onEvent;
    emit({ type: "tool.started", callId: "painter", title: "Painter", kind: "agent" });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const event = { type: "image.generated" as const, agentCallId: "painter", itemId: "paint", name: "saved.png", data: png, mimeType: "image/png" };
    emit(event);
    emit(event);
    const blocks = store.session(id).session.blocks;
    expect(blocks.filter(block => block.role === "image")).toHaveLength(0);
    const images = blocks.find(block => block.tool?.callId === "painter")?.agentRun?.transcript?.filter(block => block.role === "image");
    expect(images).toHaveLength(1);
    const file = images![0].attachments![0];
    expect(readAttachmentChunk(store, { sessionId: id, id: file.id, offset: 0 }).data).toBe(png);
    expect(JSON.stringify(store.session(id))).not.toContain(png);
    expect(readdirSync(store.attachmentDir)).toHaveLength(1);
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.blocks.find(block => block.tool?.callId === "painter")?.agentRun?.transcript?.[0].attachments?.[0].id).toBe(file.id);
  });

  it("shows image-save errors and removes files when database persistence fails", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "bad-image", sessionId: id, text: "Paint" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "image.generated", itemId: "bad", name: "bad.png", data: "AAAA" });
    expect(store.session(id).session.blocks.at(-1)?.notice).toBe("error");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "save").mockImplementationOnce(() => { throw new Error("disk full"); });
    try {
      turns[0].input.onEvent({ type: "image.generated", itemId: "save-fails", name: "saved.png", data: png });
      expect(readdirSync(store.attachmentDir)).toHaveLength(0);
      await vi.waitFor(() => expect(store.session(id).status).toBe("interrupted"));
      expect(store.session(id).session.blocks.some(block => block.role === "image")).toBe(false);
    } finally { log.mockRestore(); }
  });

  it.each(["send", "compact"] as const)("clears the old draft when a normal %s starts", async (type) => {
    const { engine, store, turns, provider, id } = setup();
    provider.compact = (input) => provider.send({ ...input, text: "/compact" });
    engine.command({ type: "draft", commandId: "draft", sessionId: id, text: "Later" });
    engine.command({ type, commandId: "next", sessionId: id, text: "New work" });
    expect(store.session(id).session.blocks.some((block) => block.draft)).toBe(false);
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].finish();
  });

  it("contains a persistence failure while requesting approval", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({ type: "send", commandId: "approval-failure", sessionId: id, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "save").mockImplementationOnce(() => { throw new Error("disk full"); });
    try {
      expect(() => turns[0].input.onEvent({ type: "approval.requested", requestId: 1, title: "Run?" })).not.toThrow();
      await vi.waitFor(() => expect(provider.stop).toHaveBeenCalled());
      await vi.waitFor(() => expect(store.session(id).status).toBe("interrupted"));
    } finally { log.mockRestore(); }
  });

  it("stores a remote draft with an uploaded file, then sends it in plan mode", async () => {
    const { engine, store, turns, id } = setup();
    const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      writeAttachmentChunk(store, {
        id: fileId,
        offset: 0,
        size: 5,
        data: Buffer.from("hello").toString("base64"),
      }),
    ).toEqual({ offset: 5 });
    const attachment = {
      id: fileId,
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file" as const,
      size: 5,
    };
    engine.command({
      type: "draft",
      commandId: "draft-1",
      sessionId: id,
      text: "Plan this",
      attachments: [attachment],
    });
    expect(store.session(id).session.blocks[0]).toMatchObject({
      draft: true,
      attachments: [{ name: "notes.txt" }],
    });
    expect(store.summaries(store.session(id).projectId)[0].draft).toBe(true);
    engine.command({
      type: "send",
      commandId: "send-draft",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
      draftBlockId: "draft-1",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({
      intent: "plan",
      attachments: [{ name: "notes.txt", size: 5 }],
    });
    expect(turns[0].input.attachments?.[0].path).toContain(fileId);
    expect(store.summaries(store.session(id).projectId)[0].draft).toBe(false);
    turns[0].finish();
  });

  it.each([
    { method: "request-total", tokenSource: "provider" },
    { method: "stream-observed", tokenSource: "provider" },
    { method: "stream-observed", tokenSource: "text-estimate", estimator: "text-heuristic-v1" },
  ] as const)("preserves $method/$tokenSource generation samples through Host snapshots and delta sync", async (source) => {
    const { engine, store, turns, id } = setup();
    engine.command({ type: "send", commandId: "rate-turn", sessionId: id, text: "Hello" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const revision = store.session(id).revision;
    const generationSample = { outputTokens: 4, durationMs: 1_000, ...source, scope: "turn" as const };
    turns[0].input.onEvent({ type: "turn.metrics", generationSample });
    await vi.waitFor(() => expect(store.session(id).revision).toBeGreaterThan(revision));
    const delta = JSON.parse(JSON.stringify(store.sync(id, revision)));
    expect(delta.kind).toBe("delta");
    expect(delta.blocks.find((block: { id: string }) => block.id === "rate-turn").turnMetrics).toEqual({ generationSample });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const snapshot = JSON.parse(JSON.stringify(store.sync(id)));
    expect(snapshot.value.session.blocks[0].turnMetrics).toEqual({ generationSample });
  });

  it.each(["codex", "claude"] as const)("passes an uploaded image to %s on an attachment-only turn", async (harness) => {
    const { engine, store, turns, id } = setup(harness);
    const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const image = Buffer.from("image-bytes");
    writeAttachmentChunk(store, {
      id: fileId,
      offset: 0,
      size: image.length,
      data: image.toString("base64"),
    });
    engine.command({
      type: "send",
      commandId: "image-turn",
      sessionId: id,
      text: "",
      attachments: [
        {
          id: fileId,
          name: "shot.png",
          mimeType: "image/png",
          kind: "image",
          size: image.length,
        },
      ],
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.attachments?.[0]).toMatchObject({
      name: "shot.png",
      path: expect.stringContaining(fileId),
    });
    expect(turns[0].input.attachments?.[0].data).toBe(
      harness === "codex" ? undefined : image.toString("base64"),
    );
    expect(readAttachmentChunk(store, { sessionId: id, id: fileId, offset: 0 })).toEqual({
      offset: image.length, size: image.length, data: image.toString("base64"),
    });
    const other = engine.command({ type: "create", commandId: "other-session", projectId: store.session(id).projectId,
      harness: "claude", model: "claude:test", runtimeMode: "supervised" });
    expect(() => readAttachmentChunk(store, { sessionId: other.sessionId, id: fileId, offset: 0 })).toThrow();
    turns[0].finish();
  });

  it("removes a remote draft without starting the provider", () => {
    const { engine, store, provider, id } = setup();
    engine.command({
      type: "draft",
      commandId: "draft-2",
      sessionId: id,
      text: "Later",
    });
    engine.command({
      type: "removeDraft",
      commandId: "remove-2",
      sessionId: id,
      draftBlockId: "draft-2",
    });
    expect(store.session(id).session.blocks).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("marks a reviewed host plan as built after its build turn", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "plan-turn",
      sessionId: id,
      text: "Plan this",
      intent: "plan",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "plan", text: "# Steps\n\n1. Change code" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const plan = store
      .session(id)
      .session.blocks.find((block) => block.role === "plan")!;
    engine.command({
      type: "send",
      commandId: "build-turn",
      sessionId: id,
      text: `Build the approved plan:\n\n${plan.text}`,
      intent: "build",
      planBlockId: plan.id,
    });
    expect(
      store.session(id).session.blocks.find((block) => block.id === plan.id)
        ?.plan?.status,
    ).toBe("building");
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    turns[1].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(
      store.session(id).session.blocks.find((block) => block.id === plan.id)
        ?.plan?.status,
    ).toBe("built");
  });

  it("keeps a manually renamed title when first-turn generation finishes later", async () => {
    vi.useFakeTimers();
    const { engine, store, turns, id } = setup();
    let finishTitle: (title: {
      title: string;
      workItem: null;
    }) => void = () => {};
    const generateTitle = vi.spyOn(engine.titleModel, "generate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTitle = resolve;
        }),
    );
    engine.command({
      type: "send",
      commandId: "name-first-turn",
      sessionId: id,
      text: "Fix remote project titles",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(generateTitle).toHaveBeenCalledTimes(1);
    engine.updateSession(id, { title: "codex · My own title" });
    finishTitle({ title: "Generated title", workItem: null });
    await vi.waitFor(() =>
      expect(generateTitle).toHaveBeenCalledTimes(1),
    );
    expect(store.session(id).session.title).toBe("codex · My own title");
  });

  it("uses one creation timestamp and advances only updatedAt on later commands", () => {
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
    try {
      const { engine, store, project, id } = setup();
      const initial = store.session(id);
      const timestamps = {
        createdAt: initial.createdAt,
        updatedAt: initial.createdAt,
        revision: 1,
      };
      expect(initial).toMatchObject(timestamps);
      expect(store.sessions(project.id)[0]).toMatchObject(timestamps);
      expect(store.summaries(project.id)[0]).toMatchObject(timestamps);

      now = initial.updatedAt + 1_000;
      engine.command({
        type: "configure",
        commandId: "configure-timestamps",
        sessionId: id,
        model: "codex:updated",
        modelSettings: {},
        runtimeMode: "supervised",
      });
      const updatedTimestamps = {
        createdAt: initial.createdAt,
        updatedAt: initial.updatedAt + 1_000,
        revision: 2,
      };
      expect(store.session(id)).toMatchObject(updatedTimestamps);
      expect(store.sessions(project.id)[0]).toMatchObject(updatedTimestamps);
      expect(store.summaries(project.id)[0]).toMatchObject(updatedTimestamps);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps remote card changes in host history and removes deleted sessions", () => {
    const { store, project, id } = setup();
    const initial = store.summaries(project.id)[0];
    expect(initial.model).toBe("codex:test");
    expect(initial.createdAt).toBe(initial.updatedAt);

    store.save(
      {
        ...store.session(id),
        revision: initial.revision + 1,
        updatedAt: initial.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect(store.summaries(project.id)[0]).toMatchObject({
      createdAt: initial.createdAt,
      updatedAt: initial.updatedAt + 1_000,
    });

    const updated = store.updateSession(id, {
      title: "Codex · Renamed",
      pinned: true,
      archived: true,
      linkedWorkItem: {
        kind: "issue",
        repo: "example/repo",
        number: 42,
        url: "https://github.com/example/repo/issues/42",
      },
    });
    expect(updated).toMatchObject({
      title: "Codex · Renamed",
      pinned: true,
      archived: true,
      model: "codex:test",
      linkedWorkItem: { number: 42 },
    });
    expect(store.summaries(project.id)[0]).toMatchObject({
      title: updated.title,
      pinned: true,
      archived: true,
      revision: updated.revision,
    });
    expect(store.sync(id, initial.revision)).toMatchObject({ kind: "delta" });
    store.updateSession(id, { linkedWorkItem: null });
    expect(store.summaries(project.id)[0].linkedWorkItem).toBeUndefined();

    store.deleteSession(id);
    expect(store.summaries(project.id)).toEqual([]);
    expect(() => store.session(id)).toThrow("Session not found");
  });

  it("includes the harness ID in remote summaries, including older cached rows", () => {
    const { store, project, id } = setup();
    const current = store.session(id);
    store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: { ...current.session, providerSessionId: "harness-session" },
      },
      { type: "session.test" },
    );
    expect(store.summaries(project.id)[0].providerSessionId).toBe(
      "harness-session",
    );

    const legacySummary = { ...store.summaries(project.id)[0] };
    delete legacySummary.providerSessionId;
    store.db.prepare("UPDATE sessions SET summary=? WHERE id=?").run(
      JSON.stringify(legacySummary),
      id,
    );
    expect(store.summaries(project.id)[0].providerSessionId).toBe(
      "harness-session",
    );
    const repaired = store.db
      .prepare("SELECT summary FROM sessions WHERE id=?")
      .get(id)!;
    expect(JSON.parse(String(repaired.summary)).providerSessionId).toBe(
      "harness-session",
    );
  });

  it("keeps a legacy session's last known timestamp when adding creation time", () => {
    const { directory, store, project, id } = setup();
    const legacy = { ...store.session(id) };
    delete legacy.createdAt;
    store.db.prepare("UPDATE sessions SET snapshot=? WHERE id=?").run(
      JSON.stringify(legacy),
      id,
    );

    const reopened = new HostStore(join(directory, "host.db"));
    cleanups.push(() => reopened.close());
    const original = reopened.session(id);
    reopened.save(
      {
        ...original,
        revision: original.revision + 1,
        updatedAt: original.updatedAt + 1_000,
      },
      { type: "session.test" },
    );
    expect(reopened.summaries(project.id)[0]).toMatchObject({
      createdAt: original.updatedAt,
      updatedAt: original.updatedAt + 1_000,
    });
  });

  it("preserves the transaction error and invalidates cached state if rollback fails", () => {
    const { store, id } = setup();
    const cached = store.session(id);
    store.db.prepare("UPDATE sessions SET snapshot=? WHERE id=?").run(
      JSON.stringify({
        ...cached,
        session: { ...cached.session, title: "Updated" },
      }),
      id,
    );
    const exec = store.db.exec.bind(store.db);
    const rollback = vi.spyOn(store.db, "exec").mockImplementation((sql) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return exec(sql);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new Error("transaction failed");
    try {
      expect(() =>
        store.transaction(() => {
          throw original;
        }),
      ).toThrow(original);
      expect(store.session(id).session.title).toBe("Updated");
    } finally {
      rollback.mockRestore();
      log.mockRestore();
      store.db.exec("ROLLBACK");
    }
  });
  it("keeps the checkout idle while a branch switch is in progress", async () => {
    const { engine, project, id, turns } = setup();
    let finishSwitch = () => {};
    const switching = engine.withIdleProject(
      project.id,
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
    );
    expect(() =>
      engine.command({
        type: "send",
        commandId: "during-switch",
        sessionId: id,
        text: "Work",
      }),
    ).toThrow("branch switch");
    expect(() =>
      engine.command({
        type: "create",
        commandId: "new-during-switch",
        projectId: project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      }),
    ).toThrow("branch switch");
    finishSwitch();
    await switching;
    engine.command({
      type: "send",
      commandId: "after-switch",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].finish();
  });

  it("runs provider context compaction once and persists its transcript marker", async () => {
    const { engine, store, provider, id } = setup();
    let finishCompact = () => {};
    provider.compact = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCompact = resolve;
        }),
    );
    const command = { type: "compact", commandId: "compact", sessionId: id };
    const receipt = engine.command(command);
    expect(engine.command(command)).toEqual(receipt);
    await vi.waitFor(() => expect(provider.compact).toHaveBeenCalledTimes(1));
    expect(store.session(id).session.blocks).toContainEqual(
      expect.objectContaining({ text: "/compact" }),
    );
    finishCompact();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  });

  it("persists model and permission changes for the next turn and rejects changes mid-turn", async () => {
    const { engine, store, turns, id } = setup();
    const change = {
      type: "configure",
      commandId: "settings",
      sessionId: id,
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    };
    const receipt = engine.command(change);
    expect(engine.command(change)).toEqual(receipt);
    expect(store.session(id).session).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    engine.command({
      type: "send",
      commandId: "turn",
      sessionId: id,
      text: "Continue",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input).toMatchObject({
      model: "codex:new",
      modelSettings: { reasoningEffort: "high" },
      runtimeMode: "full-access",
    });
    expect(() => engine.command({ ...change, commandId: "later" })).toThrow(
      "current turn",
    );
    turns[0].finish();
  });
  it("keeps working with no client, persists output, and deduplicates a lost acknowledgement", async () => {
    const { engine, store, turns, provider, id } = setup();
    const command = {
      type: "send",
      commandId: "send-once",
      sessionId: id,
      text: "Do the work",
    };
    const receipt = engine.command(command);
    expect(engine.command(command)).toEqual(receipt);
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(provider.send).toHaveBeenCalledTimes(1);
    const before = store.session(id).revision;
    turns[0].input.onEvent({
      type: "session.providerBound",
      providerSessionId: "provider-thread",
    });
    turns[0].input.onEvent({
      type: "message.delta",
      text: "still working while disconnected",
    });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(
      store
        .session(id)
        .session.blocks.some((block) => block.text.includes("still working")),
    ).toBe(true);
    expect(store.events(id, before).events?.length).toBeGreaterThan(1);
    expect(engine.command(command)).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.bind).toHaveBeenCalledWith(
      id,
      "provider-thread",
      expect.any(String),
    );
    expect(() =>
      engine.command({ ...command, text: "Changed payload" }),
    ).toThrow("different payload");
  });

  it.each(["codex", "claude"] as const)(
    "keeps %s turn timing and model provenance after settlement and reconnect",
    async (harness) => {
      const { engine, store, turns, id } = setup(harness);
      engine.command({
        type: "send",
        commandId: "first-turn",
        sessionId: id,
        text: "Inspect the project",
      });
      await vi.waitFor(() => expect(turns).toHaveLength(1));
      const running = store.session(id);
      expect(running.session.blocks[0]).toMatchObject({
        id: "first-turn",
        startedAt: expect.any(Number),
        turnModel: { harness, id: `${harness}:test` },
      });
      turns[0].input.onEvent({ type: "message.delta", text: "Found it" });
      turns[0].finish();
      await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));

      const reconnected = store.sync(id);
      expect(reconnected.kind).toBe("snapshot");
      if (reconnected.kind !== "snapshot") return;
      expect(reconnected.value.session.blocks[0]).toMatchObject({
        id: "first-turn",
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        turnModel: { harness, id: `${harness}:test` },
      });
      expect(
        reconnected.value.session.blocks[0].durationMs,
      ).toBeGreaterThanOrEqual(0);
      expect(reconnected.value.session.blocks[1].text).toBe("Found it");

      const delta = store.sync(id, running.revision);
      expect(delta.kind).toBe("delta");
      if (delta.kind === "delta")
        expect(
          delta.blocks.some(
            (block) => block.id === "first-turn" && block.durationMs != null,
          ),
        ).toBe(true);
    },
  );

  it("serializes concurrent sends and accepts only one approval decision for a run", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    engine.command({ type: "send", commandId: "other-send", sessionId: id, text: "More work" });
    expect(store.session(id).session.queuedMessages?.map(row => row.text)).toEqual(["More work"]);
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 7,
      title: "Run a command?",
    });
    const runId = store.session(id).runId!;
    const approval = {
      type: "approve",
      commandId: "approval-1",
      sessionId: id,
      runId,
      requestId: 7,
      decision: "allow",
    };
    expect(() => engine.command({ ...approval, runId: "stale" })).toThrow(
      "finished or replaced",
    );
    engine.command(approval);
    engine.command(approval);
    expect(() =>
      engine.command({
        ...approval,
        commandId: "approval-2",
        decision: "deny",
      }),
    ).toThrow("already resolved");
    expect(provider.approve).toHaveBeenCalledTimes(1);
    expect(provider.approve).toHaveBeenCalledWith(id, 7, "allow");
  });

  it("stores pending questions and rejects a second device's stale answer", async () => {
    const { engine, store, turns, provider, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({
      type: "question.asked",
      requestId: 3,
      questions: [
        {
          id: "q1",
          prompt: "Choose",
          multiSelect: false,
          allowCustom: false,
          options: [{ id: "yes", label: "Yes" }],
        },
      ],
    });
    const reply = {
      type: "answer",
      commandId: "answer",
      sessionId: id,
      runId: store.session(id).runId,
      requestId: 3,
      reply: { kind: "answered", answers: { q1: ["yes"] } },
    };
    engine.command(reply);
    expect(store.session(id).session.pendingQuestion).toBeUndefined();
    expect(() =>
      engine.command({ ...reply, commandId: "other-answer" }),
    ).toThrow("already resolved");
    expect(provider.answer).toHaveBeenCalledTimes(1);
  });

  it("recovers interrupted durable state without replaying an uncertain provider send", async () => {
    const { store, provider, id } = setup();
    const value = store.session(id);
    store.transaction(() =>
      store.save(
        {
          ...value,
          revision: value.revision + 1,
          status: "running",
          runId: "old-run",
          session: {
            ...value.session,
            busy: true,
            providerSessionId: "retained",
            blocks: [
              {
                id: "interrupted-turn",
                role: "user",
                text: "Work",
                startedAt: value.updatedAt - 2_000,
              },
            ],
          },
        },
        { type: "accepted" },
      ),
    );
    const allHistory = vi.spyOn(store, "sessions").mockImplementation(() => { throw new Error("Recovery must not load all transcripts at once"); });
    const recovered = new HostEngine(store, { codex: provider });
    expect(store.session(id).status).toBe("interrupted");
    expect(store.session(id).session.busy).toBe(false);
    expect(store.session(id).session.blocks[0].durationMs).toBe(2_000);
    expect(provider.send).not.toHaveBeenCalled();
    expect(provider.bind).toHaveBeenCalledWith(
      id,
      "retained",
      value.session.cwd,
    );
    await recovered.workflows.ready;
    await recovered.ready;
    expect(allHistory).not.toHaveBeenCalled();
    allHistory.mockRestore();
    await recovered.close();
  });

  it("retries a failed event write and settles the stopped turn", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const original = store.save.bind(store);
    let failed = false;
    vi.spyOn(store, "save").mockImplementation((value, event) => {
      if (!failed && (event as { type?: string }).type === "events") {
        failed = true;
        throw new Error("temporary storage error");
      }
      return original(value, event);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      turns[0].input.onEvent({
        type: "message.delta",
        text: "Retained output",
      });
      turns[0].finish();
      await vi.waitFor(
        () => expect(store.session(id).status).toBe("interrupted"),
        {
          timeout: 4_000,
        },
      );
      expect(
        store
          .session(id)
          .session.blocks.some((block) => block.text === "Retained output"),
      ).toBe(true);
      expect(store.session(id).session.busy).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("retries a failed final settlement", async () => {
    const { engine, store, turns, id } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const original = store.save.bind(store);
    let failed = false;
    vi.spyOn(store, "save").mockImplementation((value, event) => {
      if (!failed && (event as { type?: string }).type === "settled") {
        failed = true;
        throw new Error("temporary storage error");
      }
      return original(value, event);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      turns[0].finish();
      await vi.waitFor(
        () => expect(store.session(id).status).toBe("interrupted"),
        {
          timeout: 4_000,
        },
      );
      expect(store.session(id).session.busy).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it.each(["pi", "omp", "codex"] as const)("batches %s text and telemetry while immediately persisting approvals and final output", async (harness) => {
    const { engine, store, turns, id } = setup(harness);
    await engine.ready;
    engine.command({ type: "send", commandId: "telemetry-stream", sessionId: id, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const observer = vi.spyOn(engine.bots.defaultAssistant, "observe");
    const started = store.session(id).revision;
    for (let index = 0; index < 50; index++) {
      turns[0].input.onEvent({ type: "message.delta", text: `chunk ${index} ` });
      turns[0].input.onEvent({ type: "context", window: 128000, used: index });
      turns[0].input.onEvent({ type: "turn.metrics", outputTokens: index });
    }
    expect(store.session(id).revision).toBe(started);
    await vi.waitFor(() => expect(store.session(id).revision).toBe(started + 1));
    expect(observer).not.toHaveBeenCalled();
    expect(store.session(id).session.context).toEqual({ used: 49, window: 128000 });
    expect(store.session(id).session.blocks[0].turnMetrics?.outputTokens).toBe(49);
    turns[0].input.onEvent({ type: "message.delta", text: "before approval" });
    turns[0].input.onEvent({ type: "approval.requested", requestId: 1, title: "Allow?" });
    expect(store.session(id).revision).toBe(started + 2);
    expect(observer).toHaveBeenCalled();
    expect(store.session(id).session.blocks.some(block => block.text.includes("before approval"))).toBe(true);
    turns[0].input.onEvent({ type: "message.delta", text: "final chunk" });
    turns[0].input.onEvent({ type: "turn.metrics", outputTokens: 100 });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(store.session(id).session.blocks[0].turnMetrics?.outputTokens).toBe(100);
    expect(store.session(id).session.blocks.some(block => block.text.includes("final chunk"))).toBe(true);
    observer.mockRestore();
  });

  it("batches streamed output and syncs only changed blocks", async () => {
    const { engine, store, turns, id, project } = setup();
    engine.command({
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work",
    });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const started = store.session(id).revision;
    for (let index = 0; index < 50; index++)
      turns[0].input.onEvent({
        type: "message.delta",
        text: `chunk ${index} `,
      });
    expect(store.session(id).revision).toBe(started);
    await vi.waitFor(() =>
      expect(store.session(id).revision).toBe(started + 1),
    );
    const sync = store.sync(id, started);
    expect(sync.kind).toBe("delta");
    if (sync.kind !== "delta") return;
    expect(sync.blocks.map((block) => block.role)).toEqual(["assistant"]);
    expect(sync.blockIds).toHaveLength(2);

    turns[0].input.onEvent({
      type: "approval.requested",
      requestId: 1,
      title: "Run a command?",
    });
    expect(store.session(id).revision).toBe(started + 2);

    const streamed = store.session(id).revision;
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    const settled = store.sync(id, streamed);
    if (settled.kind !== "delta") throw new Error("Expected a delta");
    expect(
      settled.blocks.some(
        (block) => block.role === "user" && block.durationMs != null,
      ),
    ).toBe(true);
    expect(store.sync(id, store.session(id).revision).kind).toBe("unchanged");
    expect(store.sync(id).kind).toBe("snapshot");
    expect(store.summaries(project.id)[0]).toMatchObject({
      id,
      status: "idle",
      title: "codex · Work",
    });
  });

  it("requires snapshot recovery when the client's event cursor is invalid", () => {
    const { store, id } = setup();
    expect(store.events(id, 100_000).snapshot?.session.id).toBe(id);
  });

  it("validates untrusted commands before execution", () => {
    const lateAnswer = { type: "send", commandId: "late", sessionId: "session", text: "Answer",
      questionAnswer: { blockId: "question", reply: { kind: "answered", answers: { q: ["local"] } } } };
    expect(parseCommand(lateAnswer)).toMatchObject(lateAnswer);
    for (const questionAnswer of [null, { blockId: "question", reply: { kind: "skipped" } },
      { ...lateAnswer.questionAnswer, reply: { kind: "answered", answers: { q: [42] } } },
      { ...lateAnswer.questionAnswer, blockId: "" }]) {
      expect(() => parseCommand({ ...lateAnswer, questionAnswer })).toThrow();
    }
    expect(() => parseCommand({ ...lateAnswer, intent: "build" })).toThrow();
    expect(() => parseCommand({ ...lateAnswer, draftBlockId: "draft" })).toThrow();
    expect(() =>
      parseCommand({ type: "send", commandId: "x", sessionId: "y", text: "" }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "create",
        commandId: "x",
        projectId: "y",
        harness: "shell",
        model: "x",
        runtimeMode: "auto",
      }),
    ).toThrow();
    expect(() =>
      parseCommand({
        type: "answer",
        commandId: "x",
        sessionId: "y",
        runId: "z",
        requestId: 1,
        reply: { kind: "answered", answers: { a: [42] } },
      }),
    ).toThrow();
  });
});

describe("imported native sessions", () => {
  async function nativeSetup() {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const context = setup("claude");
    writeFileSync(join(context.directory, "desktop-owner.json"), JSON.stringify({ desktopDirectory: join(context.directory, "desktop") }));
    // Process detection spans all test workers. Synthetic CLI fixtures in other
    // suites must not accidentally own this independently imported conversation.
    const nativeId = randomUUID();
    const projects = join(context.directory, "home/.claude/projects/fixture");
    mkdirSync(projects, { recursive: true });
    const path = join(projects, `${nativeId}.jsonl`);
    const row = (uuid: string, parentUuid: string | null, type: "user" | "assistant", text: string) =>
      JSON.stringify({
        type, uuid, parentUuid, sessionId: nativeId, cwd: context.directory, timestamp: new Date(1_000).toISOString(),
        message: type === "user" ? { role: "user", content: text } : { role: "assistant", content: [{ type: "text", text }] },
      }) + "\n";
    writeFileSync(path, row("u1", null, "user", "Imported question") + row("a1", "u1", "assistant", "Imported answer"));
    const value = context.store.session(context.id);
    const nativeSession = {
      provider: "claude" as const,
      providerSessionId: nativeId,
      path,
      revision: "1",
      blockIds: [],
      nativeIds: [],
      mode: "managed" as const,
      storage: "jsonl" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    context.store.save(
      { ...value, revision: value.revision + 1, session: { ...value.session, providerSessionId: nativeId, nativeSession } },
      { type: "test" },
    );
    const { nativeLockPath } = await import("./native-access");
    return { ...context, lock: nativeLockPath(context.directory, nativeSession), path, nativeId, row };
  }

  it.runIf(process.platform === "linux")("continues under the Host's lock with a strict binding, then releases it", async () => {
    const { acquireNativeLease, IN_USE_BY_OMNICODE } = await import("./native-access");
    const { engine, provider, turns, id, lock, path, store, nativeId } = await nativeSetup();
    expect(await engine.nativeAccess(id)).toMatchObject({ state: "idle" });
    engine.command({ type: "send", commandId: "native-send", sessionId: id, text: "Continue from the phone" });
    await vi.waitFor(() => expect(turns, store.session(id).session.blocks.at(-1)?.text).toHaveLength(1), { timeout: 5_000 });
    expect(provider.bind).toHaveBeenCalledWith(id, nativeId, expect.any(String), undefined, expect.objectContaining({ path }));
    expect(turns[0].input.nativeSession?.path).toBe(path);
    // Another OmniCode writer cannot start while the Host turn runs.
    await expect(acquireNativeLease(lock)).rejects.toThrow(IN_USE_BY_OMNICODE);
    expect(await engine.nativeAccess(id)).toMatchObject({ state: "idle" });
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    // The provider is stopped right away so no idle CLI keeps owning the file.
    expect(provider.stop).toHaveBeenCalledWith(id);
    const lease = await acquireNativeLease(lock);
    await lease.release();
  }, 10_000);

  it.runIf(process.platform === "linux")("refuses to write while another OmniCode writer holds the session", async () => {
    const { acquireNativeLease } = await import("./native-access");
    const { engine, provider, id, lock, store } = await nativeSetup();
    const other = await acquireNativeLease(lock);
    try {
      expect(await engine.nativeAccess(id)).toMatchObject({ reason: "anotherOmniCode" });
      // A known owner fails fast, before a turn starts.
      expect(() => engine.command({ type: "send", commandId: "blocked", sessionId: id, text: "x" })).toThrow(
        "OmniCode desktop is using this conversation",
      );
      expect(provider.send).not.toHaveBeenCalled();
      expect(store.session(id).status).toBe("idle");
    } finally {
      await other.release();
    }
  });
});

it.each(["codex", "claude"] as const)("pins the shared %s default at creation and preserves older conversations", async (harness) => {
  const { directory, engine, project, id: legacyId, store, turns } = setup(harness);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(directory, "provider-accounts"));
  writeFileSync(join(directory, "desktop-owner.json"), JSON.stringify({ desktopDirectory: directory }));
  writeFileSync(join(directory, "provider-accounts/accounts.json"), JSON.stringify({ [harness]: [{ id: "work", label: "Work" }, { id: "personal", label: "Personal" }] }));
  const defaults = join(directory, "provider-accounts/defaults.json");
  writeFileSync(defaults, JSON.stringify({ [harness]: "work" }));
  const create = (commandId: string, providerAccountId?: string) => engine.command({ type: "create", commandId, projectId: project.id, harness, model: `${harness}:test`, runtimeMode: "supervised", providerAccountId });
  const following = create("following");
  expect(store.session(create("explicit-cli", "default").sessionId).session.providerAccountId).toBeUndefined();
  const explicit = create("explicit", "personal");
  expect(store.session(following.sessionId).session.providerAccountId).toBe("work");
  expect(store.session(explicit.sessionId).session.providerAccountId).toBe("personal");
  writeFileSync(defaults, JSON.stringify({ [harness]: "personal" }));
  expect(store.session(create("after-change").sessionId).session.providerAccountId).toBe("personal");
  engine.command({ type: "send", commandId: "old-named", sessionId: following.sessionId, text: "Continue" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  expect(turns[0].input.providerAccountId).toBe("work"); turns[0].finish();
  engine.command({ type: "send", commandId: "old-cli", sessionId: legacyId, text: "Continue" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.providerAccountId).toBeUndefined(); turns[1].finish();
  writeFileSync(defaults, JSON.stringify({ [harness]: "removed" }));
  expect(() => create("missing-default")).toThrow("no longer available");
  expect(store.session(create("override-broken", "work").sessionId).session.providerAccountId).toBe("work");
});

it.each(["running", "idle"] as const)("submits an expired Codex question as a durable follow-up while %s", async (phase) => {
  const { engine, store, turns, provider, id } = setup();
  provider.steer = vi.fn(async () => {});
  engine.command({ type: "send", commandId: "question-start", sessionId: id, text: "Work" });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  turns[0].input.onEvent({ type: "question.asked", requestId: 3, allowLateReply: true,
    questions: [{ id: "q", prompt: "Which source?", multiSelect: false, allowCustom: false,
      options: [{ id: "local", label: "Local" }] }] });
  const blockId = store.session(id).session.pendingQuestion!.historyId!;
  turns[0].input.onEvent({ type: "question.resolved", requestId: 3, decision: "skipped" });
  if (phase === "idle") {
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
  }
  const command = { type: "send", commandId: "late-answer", sessionId: id, text: "untrusted client text",
    questionAnswer: { blockId, reply: { kind: "answered", answers: { q: ["local"] } } } };
  const receipt = engine.command(command);
  expect(engine.command(command)).toEqual(receipt);
  expect(store.session(id).session.blocks.find(block => block.id === blockId)?.question).toMatchObject({
    decision: "answered", reply: { kind: "answered", answers: { q: ["local"] } },
  });
  if (phase === "running") {
    await vi.waitFor(() => expect(provider.steer).toHaveBeenCalledWith(expect.objectContaining({ text: "Which source?\nLocal" })));
    expect(turns).toHaveLength(1);
  } else {
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toBe("Which source?\nLocal");
  }
  expect(provider.answer).not.toHaveBeenCalled();
  expect(() => engine.command({ ...command, commandId: "duplicate-late-answer" })).toThrow("already answered");
  turns.at(-1)!.finish();
});

describe("session checkpoints", () => {
  const review = { files: [{ path: "notes.txt", relative: "notes.txt", status: "modified", additions: 1, deletions: 1, exact: true, undoable: true }] };

  it("checks review status against 1500 histories without reading their transcripts", async () => {
    const { engine, store, id } = setup();
    await engine.ready;
    const template = store.session(id);
    store.transaction(() => {
      for (let index = 0; index < 1500; index++)
        store.save({ ...template, session: { ...template.session, id: `history-${index}` } }, { type: "seed" });
    });
    store.session(id);
    vi.spyOn(engine.checkpoints, "status").mockResolvedValue(review);
    const history = vi.spyOn(store, "sessions").mockImplementation(() => { throw new Error("Full history scan"); });
    const queries = vi.spyOn(store.db, "prepare");
    for (let index = 0; index < 3; index++)
      expect(await engine.sessionCheckpoint(id, "status", undefined)).toEqual(review);
    expect(history).not.toHaveBeenCalled();
    expect(queries.mock.calls.filter(([sql]) => /SELECT snapshot FROM sessions/i.test(sql))).toHaveLength(0);
    history.mockRestore();
    queries.mockRestore();
  });

  it("shares in-flight status reads, releases failures and reevaluates locks after the read", async () => {
    const { engine, store, project, id, turns } = setup();
    await engine.ready;
    let release!: (value: typeof review) => void;
    const status = vi.spyOn(engine.checkpoints, "status").mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = engine.sessionCheckpoint(id, "status", undefined);
    const second = engine.sessionCheckpoint(id, "status", undefined);
    expect(status).toHaveBeenCalledTimes(1);
    const other = engine.command({ type: "create", commandId: "review-other", projectId: project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }).sessionId;
    engine.command({ type: "send", commandId: "review-running", sessionId: other, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    // An unflushed live run still guards the checkout if stored metadata lags.
    const running = store.session(other);
    store.save({ ...running, revision: running.revision + 1, status: "idle" }, { type: "lagging-metadata" });
    release(review);
    for (const result of await Promise.all([first, second])) expect(result).toMatchObject({ undoLocked: true });
    status.mockResolvedValue(review);
    await expect(engine.sessionCheckpoint(id, "undo", undefined)).rejects.toThrow("another session is running");
    store.save({ ...running, revision: running.revision + 2 }, { type: "metadata-caught-up" });
    engine.command({ type: "cancel", commandId: "review-cancel", sessionId: other, runId: running.runId! });
    await vi.waitFor(() => expect(store.session(other).lastCompletedRunId).toBe(running.runId));
    expect(await engine.sessionCheckpoint(id, "status", undefined)).toEqual(review);
    status.mockRejectedValueOnce(new Error("temporary read failure"));
    const failures = await Promise.allSettled([engine.sessionCheckpoint(id, "status", undefined), engine.sessionCheckpoint(id, "status", undefined)]);
    expect(failures.every(result => result.status === "rejected")).toBe(true);
    expect(await engine.sessionCheckpoint(id, "status", undefined)).toEqual(review);
  });

  it("keeps overlapping checkout and undo protections without scanning history", async () => {
    const { engine, store, id, directory } = setup();
    await engine.ready;
    const cwd = join(directory, "checkout");
    const child = join(cwd, "child");
    const unrelated = join(directory, "unrelated");
    mkdirSync(child, { recursive: true });
    mkdirSync(unrelated);
    const alias = join(directory, "alias");
    symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
    const target = store.session(id);
    store.save({ ...target, revision: target.revision + 1, session: { ...target.session, cwd } }, { type: "move" });
    vi.spyOn(engine.checkpoints, "status").mockResolvedValue(review);
    const undo = vi.spyOn(engine.checkpoints, "undo").mockImplementation(async () => {
      expect(store.db.prepare("SELECT 1 FROM checkout_resources WHERE kind='integrating'").get()).toBeDefined();
      return { files: [] };
    });
    let revision = 0;
    const other = (path: string, status: "running" | "idle") => store.save({ ...target,
      revision: ++revision, status, session: { ...target.session, id: "other", cwd: path } }, { type: "other" });
    for (const path of [cwd, directory, child, alias]) {
      other(path, "running");
      expect(await engine.sessionCheckpoint(id, "status", undefined)).toMatchObject({ undoLocked: true });
      await expect(engine.sessionCheckpoint(id, "undo", undefined)).rejects.toThrow("another session is running");
    }
    expect(undo).not.toHaveBeenCalled();
    other(unrelated, "running");
    expect(await engine.sessionCheckpoint(id, "status", undefined)).toEqual(review);
    expect(await engine.sessionCheckpoint(id, "undo", undefined)).toEqual({ files: [] });
    other(cwd, "idle");
    expect(await engine.sessionCheckpoint(id, "status", undefined)).toEqual(review);
    // An unlocked status is only a display hint: undo rechecks after a new run.
    other(cwd, "running");
    await expect(engine.sessionCheckpoint(id, "undo", undefined)).rejects.toThrow("another session is running");
    other(cwd, "idle");
    undo.mockRejectedValueOnce(new Error("changed outside this session"));
    await expect(engine.sessionCheckpoint(id, "undo", undefined)).rejects.toThrow("changed outside this session");
    expect(store.db.prepare("SELECT 1 FROM checkout_resources WHERE kind='integrating'").get()).toBeUndefined();
  });

  it.each(["completed", "cancelled", "rejected", "error event"] as const)(
    "records Git turns after %s providers settle, including writes before edit events",
    async (outcome) => {
      const { engine, store, turns, provider, id, directory } = setup();
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      const file = join(directory, "notes.txt");
      // Host database and checkpoint storage live in the fixture too.
      writeFileSync(join(directory, ".gitignore"), "*\n!notes.txt\n");
      writeFileSync(file, "before\n");
      git("init", "-q");
      git("config", "core.autocrlf", "false");
      git("add", "notes.txt");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial");
      provider.readSessionTitle = vi.fn(async () => null);
      const send = provider.send;
      provider.send = vi.fn(async (input) => {
        await send(input);
        if (outcome === "rejected") throw new Error("Provider stream failed");
      });
      let releaseStop!: () => void;
      const stopping = new Promise<void>((resolve) => { releaseStop = resolve; });
      provider.stop = vi.fn(async () => {
        await stopping;
        if (outcome !== "completed") writeFileSync(file, "after\nsettled\n");
      });
      try {
        engine.command({ type: "send", commandId: "git-edit", sessionId: id, text: "Edit notes" });
        await vi.waitFor(() => expect(turns).toHaveLength(1));
        const emit = turns[0].input.onEvent;
        // Full-access providers may write before either structured event arrives.
        for (const [callId, contents] of [["first", "intermediate\n"], ["second", "after\n"]]) {
          writeFileSync(file, contents);
          emit({ type: "tool.started", callId, title: "Edit notes.txt", kind: "edit", paths: [file] });
          emit({ type: "tool.updated", callId, status: "completed" });
        }
        if (outcome === "error event") emit({ type: "session.error", message: "Provider failed" });
        if (outcome === "cancelled")
          engine.command({ type: "cancel", commandId: "cancel-edit", sessionId: id, runId: store.session(id).runId! });
        else turns[0].finish();
        if (outcome !== "completed") {
          await vi.waitFor(() => expect(provider.stop).toHaveBeenCalled());
          expect(store.session(id).status).toBe("running");
          await expect(engine.sessionCheckpoint(id, "status", undefined)).rejects.toThrow(/without a final/);
        }
        releaseStop();
        await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
        expect(await engine.sessionCheckpoint(id, "diff", "notes.txt")).toMatchObject({
          original: "before\n",
          current: outcome === "completed" ? "after\n" : "after\nsettled\n",
        });
        expect(await engine.sessionCheckpoint(id, "status", undefined)).toMatchObject({
          files: [{ relative: "notes.txt", exact: true, undoable: true }],
        });
        if (outcome === "completed") expect(provider.stop).not.toHaveBeenCalled();
      } finally {
        releaseStop();
      }
    },
  );

  it("captures structured edits for review and undoes them once the turn ends", async () => {
    const { engine, store, turns, id, directory } = setup("claude");
    const file = join(directory, "notes.txt");
    writeFileSync(file, "before\n");
    engine.command({ type: "send", commandId: "edit", sessionId: id, text: "Edit notes" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const emit = turns[0].input.onEvent;
    emit({ type: "tool.started", callId: "write", title: "Edit notes.txt", kind: "edit", paths: [file] });
    writeFileSync(file, "after\n");
    // The completion omits the paths its start reported.
    emit({ type: "tool.updated", callId: "write", status: "completed" });
    await vi.waitFor(async () =>
      expect(await engine.sessionCheckpoint(id, "status", undefined)).toMatchObject({
        files: [{ relative: "notes.txt", additions: 1, deletions: 1, undoable: true }],
      }));
    await expect(engine.sessionCheckpoint(id, "undo", undefined)).rejects.toThrow(/while the session is running/);
    expect(await engine.sessionCheckpoint(id, "diff", "notes.txt")).toMatchObject({ original: "before\n", current: "after\n" });

    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));
    expect(await engine.sessionCheckpoint(id, "undo", undefined)).toEqual({ files: [] });
    expect(readFileSync(file, "utf8")).toBe("before\n");
  });
});

describe("projectless chats", () => {
  it("creates a dated chat folder under Documents and lists it as a project", async () => {
    const { directory, engine, store } = setup();
    const home = join(directory, "home");
    const chat = await engine.createChat(home);
    expect(chat.cwd.replaceAll("\\", "/")).toMatch(
      /\/home\/Documents\/omnicode\/\d{4}-\d{2}-\d{2}\/chat-\d{6}-[a-z0-9]{6}$/,
    );
    expect(statSync(chat.cwd).isDirectory()).toBe(true);
    expect(store.projects().some((project) => project.id === chat.id)).toBe(true);
    expect((await engine.createChat(home)).id).not.toBe(chat.id);
  });
});
