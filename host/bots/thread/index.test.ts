import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { executeBotAction } from "./control";
import { MEMORY_MAX_LINES } from "./memory";
import { enqueueDiaries } from "./diary";
import type { HostProvider } from "../../providers";
import type { SendTurnInput } from "../../../src/integrations/harness/core/types";
import { removeWatchedSession } from "../../../src/features/bots/model/botSessions";
import { fullBotPolicy } from "../../../src/features/bots/model/botView";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function setup(options: { steer?: boolean } = {}) {
  const dataDirectory = mkdtempSync(join(tmpdir(), "assistant-runtime-")), directory = join(dataDirectory, "project"),
    store = new HostStore(join(dataDirectory, "host.db"));
  mkdirSync(directory);
  const project = store.addProject(directory, "Test project");
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) => new Promise<void>((finish) => turns.push({ input, finish })),
    ),
    stop: vi.fn(async (id) => {
      turns.filter((t) => t.input.sessionId === id).forEach((t) => t.finish());
    }),
    cancel: vi.fn(async (id) => {
      turns.filter((t) => t.input.sessionId === id).forEach((t) => t.finish());
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
    ...(options.steer ? { steer: vi.fn(async () => {}) } : {}),
  };
  const engine = new HostEngine(store, { codex: provider });
  cleanup.push(async () => {
    await engine.close();
    store.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  });
  await engine.ready;
  engine.assistant.setCatalog(
    async () => ["codex"],
    async () => ({
      models: { codex: [{ id: "test", name: "Test" }] },
      errors: {},
    }),
  );
  await engine.assistant.rpc("assistant.configure", {
    commandId: "configure",
    expectedRevision: 0,
    patch: {
      harness: "codex",
      model: "test",
      triggers: { user: true, event: false, schedule: false },
    },
  });
  const receipt = await engine.assistant.rpc("assistant.send", {
    commandId: "hello",
    text: "Inspect the projects",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  return { directory, store, project, engine, turns, provider, receipt };
}
it("keeps queued user messages unread until the assistant starts their turn", async () => {
  const { engine, turns } = await setup();
  expect(
    engine.assistant.store.latestMessages().find((m) => m.kind === "user"),
  ).toMatchObject({ readAt: expect.any(Number) });
  const receipt = (await engine.assistant.rpc("assistant.send", {
    commandId: "queued-read",
    text: "Read me next",
  })) as { messageId: string };
  const get = () =>
    engine.assistant.store
      .latestMessages()
      .find((m) => m.id === receipt.messageId);
  expect(get()).toMatchObject({ readAt: null });
  turns[0].finish();
  // Queued work starts as soon as the brain turn ends, without waiting for a poll.
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(get()).toMatchObject({ readAt: expect.any(Number) });
});
it("creates real target cards and sends trusted messages idempotently", async () => {
  const { engine, project, store } = await setup();
  const create = { projectId: project.id, harness: "codex", model: "test" };
  const receipt = (await executeBotAction(
    engine.assistant,
    "new-task",
    "sessions.create",
    create,
    () => true,
  )) as { sessionId: string };
  expect(
    await executeBotAction(
      engine.assistant,
      "new-task",
      "sessions.create",
      create,
      () => true,
    ),
  ).toEqual(receipt);
  for (let i = 0; i < 10; i++)
    await executeBotAction(
      engine.assistant,
      "send-task",
      "sessions.send",
      {
        projectId: project.id,
        sessionId: receipt.sessionId,
        text: "Fix this task",
      },
      () => true,
    );
  expect(engine.assistant.store.get()!.policy.followedSessions).toEqual([{ projectId: project.id, sessionId: receipt.sessionId }]);
  expect(
    store
      .session(receipt.sessionId)
      .session.blocks.filter((b) => b.role === "user"),
  ).toHaveLength(1);
  expect(store.session(receipt.sessionId).session.blocks[0].origin?.kind).toBe(
    "assistant",
  );
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((m) => m.kind === "session-card"),
  ).toHaveLength(2);
  expect(store.projects().map((p) => p.id)).toEqual([project.id]);
});
it("uses the configured nickname and refreshes existing and queued origins without losing live output", async () => {
  const { engine, project, store, turns } = await setup();
  const rename = async (name: string) => engine.assistant.rpc("assistant.configure", {
    commandId: `name:${name}`, expectedRevision: engine.assistant.store.get()!.revision, patch: { name },
  });
  await rename("小团");
  const target = await executeBotAction(engine.assistant, "named-target", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }, () => true) as { sessionId: string };
  for (const requestId of ["named-first", "named-queued"]) {
    await executeBotAction(engine.assistant, requestId, "sessions.send", {
      projectId: project.id, sessionId: target.sessionId, text: requestId,
    }, () => true);
  }
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(store.session(target.sessionId).session.blocks[0].origin?.assistantName).toBe("小团");
  turns[1].input.onEvent({ type: "message.delta", text: "In-flight progress" });
  await rename("小圆");
  await engine.assistant.tick();
  const current = store.session(target.sessionId);
  expect(current.session.blocks[0].origin?.assistantName).toBe("小圆");
  expect(current.session.queuedMessages?.[0].origin?.assistantName).toBe("小圆");
  expect(current.session.blocks.some(block => block.text === "In-flight progress")).toBe(true);
  expect(current.status).toBe("running");
  await engine.assistant.tick();
  expect(store.session(target.sessionId).revision).toBe(current.revision);
});
it("retains trusted assistant provenance when steering a running target", async () => {
  const { engine, project, store, provider, turns } = await setup();
  provider.steer = vi.fn(async () => {});
  const target = engine.command({
    type: "create",
    commandId: "steer-target",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  follow(engine, project.id, target.sessionId);
  engine.command({
    type: "send",
    commandId: "human-start-steer",
    sessionId: target.sessionId,
    text: "Work",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  await executeBotAction(
    engine.assistant,
    "guide-target",
    "sessions.steer",
    {
      projectId: project.id,
      sessionId: target.sessionId,
      runId: store.session(target.sessionId).runId,
      text: "Focus on the failing test",
    },
    () => true,
  );
  const block = store.session(target.sessionId).session.blocks.at(-1)!;
  expect(block).toMatchObject({
    role: "user",
    text: "Focus on the failing test",
    origin: {
      kind: "assistant",
      actionId: engine.assistant.store.action("guide-target")!.id,
    },
  });
  expect(provider.steer).toHaveBeenCalledTimes(1);
});
it("revokes queued assistant sends without holding later human messages", async () => {
  const { engine, project, store, turns } = await setup();
  const created = engine.command({
    type: "create",
    commandId: "ordinary",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  follow(engine, project.id, created.sessionId);
  engine.command({
    type: "send",
    commandId: "human-start",
    sessionId: created.sessionId,
    text: "Start",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  await executeBotAction(
    engine.assistant,
    "queued",
    "sessions.send",
    {
      projectId: project.id,
      sessionId: created.sessionId,
      text: "Assistant queued",
    },
    () => true,
  );
  engine.command({
    type: "send",
    commandId: "human-next",
    sessionId: created.sessionId,
    text: "Human next",
  });
  const policy = fullBotPolicy();
  policy.permissions["sessions.send"] = false;
  engine.assistant.store.update({ policy });
  turns[1].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toBe("Human next");
  expect(
    store
      .session(created.sessionId)
      .session.blocks.some(
        (b) => b.role === "user" && b.text === "Assistant queued",
      ),
  ).toBe(false);
});
it("blocks forged authors, private brains, wrong projects and revoked permissions", async () => {
  const { engine, project, store } = await setup();
  expect(() =>
    engine.command({
      type: "create",
      commandId: "assistant:forged",
      projectId: project.id,
      harness: "codex",
      model: "test",
      runtimeMode: "full-access",
    }),
  ).toThrow(/reserved/);
  expect(() =>
    engine.command({
      type: "send",
      commandId: "fake",
      sessionId: "anything",
      text: "test",
      origin: { kind: "assistant" },
    }),
  ).toThrow(/reserved/);
  const brain = engine.assistant.store.get()!.brainSessionId!;
  await expect(
    executeBotAction(
      engine.assistant,
      "private",
      "sessions.get",
      { projectId: store.session(brain).projectId, sessionId: brain },
      () => true,
    ),
  ).rejects.toThrow(/private/);
  const policy = fullBotPolicy();
  policy.permissions["sessions.create"] = false;
  engine.assistant.store.update({ policy });
  await expect(
    executeBotAction(
      engine.assistant,
      "denied",
      "sessions.create",
      { projectId: project.id, harness: "codex", model: "test" },
      () => true,
    ),
  ).rejects.toThrow(/Permission/);
});
it("projects replies and necessary inputs without reasoning or tool logs", async () => {
  const { engine, turns } = await setup();
  for (let i = 0; i < 20; i++)
    turns[0].input.onEvent({
      type: "reasoning.delta",
      text: "PRIVATE THOUGHTS",
    });
  turns[0].input.onEvent({ type: "message.delta", text: "Here is the result" });
  turns[0].input.onEvent({ type: "message.completed" });
  const messages = engine.assistant.store.latestMessages();
  expect(messages.filter((m) => m.kind === "assistant")).toHaveLength(1);
  expect(JSON.stringify(messages)).not.toContain("PRIVATE THOUGHTS");
  expect(JSON.stringify(messages)).toContain("Here is the result");
});
it("streams public replies before completion and finalizes the same bubble", async () => {
  const { engine, turns } = await setup();
  turns[0].input.onEvent({ type: "reasoning.delta", text: "PRIVATE" });
  turns[0].input.onEvent({ type: "message.delta", text: "Hello" });
  await vi.waitFor(() =>
    expect(engine.assistant.store.latestMessages()).toContainEqual(
      expect.objectContaining({
        kind: "assistant",
        text: "Hello",
        streaming: true,
      }),
    ),
  );
  const first = engine.assistant.store
    .latestMessages()
    .find((m) => m.kind === "assistant")!;
  turns[0].input.onEvent({ type: "message.delta", text: " world" });
  turns[0].input.onEvent({ type: "message.completed" });
  const replies = engine.assistant.store
    .latestMessages()
    .filter((m) => m.kind === "assistant");
  expect(replies).toEqual([
    expect.objectContaining({
      id: first.id,
      createdAt: first.createdAt,
      text: "Hello world",
      streaming: false,
    }),
  ]);
  expect(replies[0].revision).toBeGreaterThan(first.revision);
  expect(JSON.stringify(engine.assistant.store.messages())).not.toContain(
    "PRIVATE",
  );
});
it("retains partial output and clears streaming when a turn is cancelled", async () => {
  const { engine, turns } = await setup();
  turns[0].input.onEvent({ type: "message.delta", text: "Partial reply" });
  await vi.waitFor(() =>
    expect(engine.assistant.store.latestMessages()).toContainEqual(
      expect.objectContaining({ text: "Partial reply", streaming: true }),
    ),
  );
  await engine.assistant.rpc("assistant.control", {
    commandId: "cancel-stream",
    action: "cancelTurn",
  });
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((m) => m.kind === "assistant"),
  ).toEqual([
    expect.objectContaining({ text: "Partial reply", streaming: false }),
  ]);
});
it("hides a quiet marker even when it arrives in fragments", async () => {
  const { engine, turns } = await setup();
  for (const text of ["  <", "assistant_", "quiet/>"]) {
    turns[0].input.onEvent({ type: "message.delta", text });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(
      engine.assistant.store
        .latestMessages()
        .some((m) => m.kind === "assistant"),
    ).toBe(false);
  }
  turns[0].input.onEvent({ type: "message.completed" });
  expect(
    engine.assistant.store.latestMessages().some((m) => m.kind === "assistant"),
  ).toBe(false);
});
it("does not broadcast unchanged scheduled checks", async () => {
  const { engine, turns } = await setup();
  turns[0].input.onEvent({ type: "message.delta", text: "<assistant_quiet/>" });
  turns[0].input.onEvent({ type: "message.completed" });
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.assistant.store.get()!.brainSessionId &&
        engine.store.session(engine.assistant.store.get()!.brainSessionId!)
          .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(
    engine.assistant.store
      .latestMessages()
      .filter((m) => m.kind === "assistant"),
  ).toHaveLength(0);
});
it("persists pause and stops the brain without cancelling delegated sessions", async () => {
  const { engine, project, store, turns } = await setup();
  const target = (await executeBotAction(
    engine.assistant,
    "target",
    "sessions.create",
    { projectId: project.id, harness: "codex", model: "test" },
    () => true,
  )) as { sessionId: string };
  await executeBotAction(
    engine.assistant,
    "target-send",
    "sessions.send",
    {
      projectId: project.id,
      sessionId: target.sessionId,
      text: "Continue independently",
    },
    () => true,
  );
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  await engine.assistant.rpc("assistant.control", {
    commandId: "pause",
    action: "pause",
  });
  expect(engine.assistant.store.get()!.lifecycle).toBe("paused");
  expect(store.session(target.sessionId).status).toBe("running");
  expect(engine.assistant.environment(target.sessionId)).toEqual({});
});
it("buffers automatic progress and discards the entire unchanged check", async () => {
  const { engine, turns } = await setup();
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  engine.assistant.store.enqueue(
    {
      id: "scheduled-check",
      kind: "schedule",
      text: "Check",
      rootCauseId: "schedule:test",
      state: "pending",
      createdAt: Date.now(),
      attempts: 0,
    },
    "scheduled-check",
  );
  await engine.assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[1].input.onEvent({ type: "message.delta", text: "I will check" });
  turns[1].input.onEvent({ type: "message.completed" });
  expect(
    engine.assistant.store.latestMessages().some((m) => m.kind === "assistant"),
  ).toBe(false);
  turns[1].input.onEvent({ type: "message.delta", text: "<assistant_quiet/>" });
  turns[1].input.onEvent({ type: "message.completed" });
  turns[1].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(
    engine.assistant.store.latestMessages().some((m) => m.kind === "assistant"),
  ).toBe(false);
});

it("denies every declared action before effects when its permission is off", async () => {
  const { engine, project, provider } = await setup();
  const { BOT_ACTIONS } = await import("./control");
  const policy = fullBotPolicy();
  for (const key of Object.keys(policy.permissions))
    policy.permissions[key as keyof typeof policy.permissions] = false;
  engine.assistant.store.update({ policy });
  // Reminders and habits are governed by the scheduled-check trigger and
  // memory and chat are the assistant's own records; none reaches project data.
  // Bot delegation has an independent callable-Bot allowlist and run identity.
  for (const action of BOT_ACTIONS.filter(
    (a) =>
      a !== "actions.get" &&
      a !== "chat.search" &&
      a !== "agents.list_bots" && a !== "agents.ask_bot" && a !== "agents.delegate_bot" && a !== "agents.coordinate_bots" &&
      !a.startsWith("playbooks.") &&
      !a.startsWith("reminders.") &&
      !a.startsWith("habits.") &&
      !a.startsWith("memory."),
  )) {
    const command =
      action === "git.read"
        ? "git_history"
        : action === "git.action"
          ? "git_commit"
          : action === "git.publish"
            ? "git_push"
            : "read_text_file";
    await expect(
      executeBotAction(
        engine.assistant,
        `deny-${action}`,
        action,
        action === "reply.attachments"
          ? { sources: [{ kind: "project-file", projectId: project.id, relativePath: "report.txt" }] }
          : { projectId: project.id, command },
        () => true,
      ),
    ).rejects.toThrow(/Permission/);
  }
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(engine.assistant.store.actions()).toEqual([]);
});
it("does not expose a saved file result after files.read is revoked", async () => {
  const { engine, project, directory } = await setup();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(directory, "note.txt"), "PRIVATE FILE DATA");
  await executeBotAction(
    engine.assistant,
    "read",
    "files.read",
    { projectId: project.id, args: { path: join(directory, "note.txt") } },
    () => true,
  );
  const policy = fullBotPolicy();
  policy.permissions["files.read"] = false;
  engine.assistant.store.update({ policy });
  await expect(
    executeBotAction(
      engine.assistant,
      "inspect-read",
      "actions.get",
      { requestId: "read" },
      () => true,
    ),
  ).rejects.toThrow(/Permission/);
});
it("rolls back pure database effects when the assistant acceptance or card cannot be saved", async () => {
  const { engine, project, store } = await setup();
  const target = engine.command({
    type: "create",
    commandId: "ordinary-target",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  follow(engine, project.id, target.sessionId);
  const original = store.session(target.sessionId);
  store.db.exec(
    "CREATE TRIGGER fail_acceptance BEFORE UPDATE ON bot_actions WHEN json_extract(NEW.payload, '$.state')='completed' BEGIN SELECT RAISE(ABORT, 'acceptance failure'); END",
  );
  await expect(
    executeBotAction(
      engine.assistant,
      "rename-failed",
      "sessions.update",
      { projectId: project.id, sessionId: target.sessionId, title: "Changed" },
      () => true,
    ),
  ).rejects.toThrow(/acceptance failure/);
  expect(store.session(target.sessionId)).toEqual(original);
  store.db.exec(
    "DROP TRIGGER fail_acceptance; CREATE TRIGGER fail_card BEFORE INSERT ON bot_messages WHEN json_extract(NEW.payload, '$.kind')='session-card' BEGIN SELECT RAISE(ABORT, 'card failure'); END",
  );
  const count = store.sessions().length;
  await expect(
    executeBotAction(
      engine.assistant,
      "create-failed",
      "sessions.create",
      { projectId: project.id, harness: "codex", model: "test" },
      () => true,
    ),
  ).rejects.toThrow(/card failure/);
  expect(store.sessions()).toHaveLength(count);
});

it("respects an external native owner and rejects stale target approvals already handled by a human", async () => {
  const { engine, project, store, provider, turns } = await setup();
  const target = engine.command({
    type: "create",
    commandId: "owned-target",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  follow(engine, project.id, target.sessionId);
  let saved = store.session(target.sessionId);
  const nativeSession = {
    provider: "codex" as const,
    providerSessionId: "native",
    path: join(project.cwd, "native.jsonl"),
    revision: "1",
    blockIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  store.save(
    {
      ...saved,
      revision: saved.revision + 1,
      session: { ...saved.session, nativeSession },
    },
    {},
  );
  vi.spyOn(engine.native, "cached").mockReturnValue({
    state: "external",
    holder: { provider: "codex", pid: 1234 },
  } as any);
  await expect(
    executeBotAction(
      engine.assistant,
      "native-send",
      "sessions.send",
      { projectId: project.id, sessionId: target.sessionId, text: "Work" },
      () => true,
    ),
  ).rejects.toThrow(/open in Codex/);
  expect(provider.send).toHaveBeenCalledTimes(1);
  saved = store.session(target.sessionId);
  store.save(
    {
      ...saved,
      revision: saved.revision + 1,
      session: { ...saved.session, nativeSession: undefined },
    },
    {},
  );
  engine.command({
    type: "send",
    commandId: "human-start-target",
    sessionId: target.sessionId,
    text: "Work",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[1].input.onEvent({
    type: "approval.requested",
    requestId: 5,
    title: "Run?",
  });
  await vi.waitFor(() =>
    expect(
      store
        .session(target.sessionId)
        .session.blocks.some((b) => b.approval?.requestId === 5),
    ).toBe(true),
  );
  const runId = store.session(target.sessionId).runId!;
  engine.command({
    type: "approve",
    commandId: "human-allow",
    sessionId: target.sessionId,
    runId,
    requestId: 5,
    decision: "allow",
  });
  await expect(
    executeBotAction(
      engine.assistant,
      "assistant-too-late",
      "sessions.approve",
      {
        projectId: project.id,
        sessionId: target.sessionId,
        runId,
        requestId: 5,
        decision: "deny",
      },
      () => true,
    ),
  ).rejects.toThrow(/already resolved/);
  await vi.waitFor(() => expect(provider.approve).toHaveBeenCalledTimes(1));
});
it("keeps configuration revisions stable while turns finish and rejects competing saves", async () => {
  const { engine, turns } = await setup();
  const revision = engine.assistant.store.get()!.revision;
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(engine.assistant.store.get()!.revision).toBe(revision);
  const first = {
    commandId: "rename",
    expectedRevision: revision,
    patch: { name: "Helper" },
  };
  expect(await engine.assistant.rpc("assistant.configure", first)).toEqual(
    await engine.assistant.rpc("assistant.configure", first),
  );
  await expect(
    engine.assistant.rpc("assistant.configure", {
      ...first,
      commandId: "competing",
      patch: { name: "Other" },
    }),
  ).rejects.toThrow(/settings changed/);
});
it("preserves public history and creates a different brain when switching agents", async () => {
  const { engine, provider, turns } = await setup();
  const brain = engine.assistant.store.get()!.brainSessionId;
  (engine.providers as any).claude = provider;
  engine.assistant.setCatalog(
    async () => ["codex", "claude"],
    async () => ({
      models: {
        codex: [{ id: "test", name: "Test" }],
        claude: [{ id: "test", name: "Test" }],
      },
      errors: {},
    }),
  );
  await engine.assistant.rpc("assistant.configure", {
    commandId: "switch",
    expectedRevision: engine.assistant.store.get()!.revision,
    patch: { harness: "claude", model: "test" },
  });
  await engine.assistant.rpc("assistant.send", {
    commandId: "after-switch",
    text: "Continue in the new agent",
  });
  expect(engine.assistant.store.get()!.brainSessionId).toBe(brain);
  expect(engine.assistant.store.get()!.lifecycle).toBe("running");
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(engine.assistant.store.get()!.brainSessionId).not.toBe(brain);
  expect(turns[1].input.text).toContain("Continue in the new agent");
  expect(
    engine.assistant.store.latestMessages().filter((m) => m.kind === "user"),
  ).toHaveLength(2);
});
it("responds to necessary brain input idempotently and rejects a competing answer", async () => {
  const { engine, turns, provider } = await setup();
  turns[0].input.onEvent({
    type: "approval.requested",
    requestId: 5,
    title: "Run?",
  });
  const message = engine.assistant.store
    .latestMessages()
    .find((m) => m.kind === "input")!;
  if (message.kind !== "input") throw new Error("Missing input");
  const input = {
    commandId: "allow",
    messageId: message.id,
    brainGeneration: message.brainGeneration,
    runId: message.runId,
    requestId: message.requestId,
    decision: "allow",
  };
  const first = await engine.assistant.rpc("assistant.respond", input);
  expect(await engine.assistant.rpc("assistant.respond", input)).toEqual(first);
  await expect(
    engine.assistant.rpc("assistant.respond", {
      ...input,
      commandId: "competing",
    }),
  ).rejects.toThrow(/no longer pending/);
  await vi.waitFor(() => expect(provider.approve).toHaveBeenCalledTimes(1));
});
it("recovers more than 100 sources durably with bounded, coalesced summaries", async () => {
  const { engine, project, turns } = await setup();
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  engine.assistant.store.update({
    watches: engine.assistant.store.get()!.watches.map((watch) => ({ ...watch,
      sessionIds: Array.from({ length: 125 }, (_, i) => `target-${i}`),
    })),
    triggers: { user: true, event: true, schedule: false },
  });
  for (let i = 0; i < 125; i++)
    engine.assistant.store.source({
      eventKey: `event-${i}`,
      sessionId: `target-${i}`,
      projectId: project.id,
      kind: "completed",
      rootCauseId: "one-task",
      createdAt: Date.now() - 3000,
    });
  expect(engine.assistant.store.view()?.backlog).toBe(true);
  await engine.assistant.tick();
  for (let batch = 0; batch < 3; batch++) {
    await vi.waitFor(() => expect(turns).toHaveLength(batch + 2));
    expect(
      turns.at(-1)!.input.text.match(/sessionId=target-/g)?.length,
    ).toBeLessThanOrEqual(50);
    turns.at(-1)!.finish();
  }
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(engine.assistant.store.get()!.sourceCursor).toBe(125);
  expect(
    engine.assistant.store.wakeups().filter((w) => w.kind === "event"),
  ).toHaveLength(3);
  expect(engine.assistant.store.pending()).toHaveLength(0);
  expect(engine.assistant.store.view()?.backlog).toBe(false);
});
it("applies automatic chain limits and lets a deliberate user message resume them", async () => {
  const { engine, turns } = await setup();
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  const journal = engine.assistant.store;
  journal.writeChain("root", {
    count: 8,
    paused: false,
    startedAt: Date.now(),
  });
  journal.enqueue(
    {
      id: "loop",
      rootCauseId: "root",
      kind: "event",
      text: "Again",
      state: "pending",
      createdAt: Date.now(),
      attempts: 0,
    },
    "loop",
  );
  await engine.assistant.tick();
  expect(journal.chain("root").paused).toBe(true);
  expect(turns).toHaveLength(1);
  await engine.assistant.rpc("assistant.send", {
    commandId: "explicit",
    text: "Continue this task",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(journal.chain("root").paused).toBe(false);
});
it("answers pending events from different tasks in one turn with their current outcome", async () => {
  const { engine, project, store, turns } = await setup();
  turns[0].finish();
  const journal = engine.assistant.store;
  await vi.waitFor(() =>
    expect(store.session(journal.get()!.brainSessionId!).status).toBe("idle"),
  );
  await engine.assistant.tick();
  const target = engine.command({
    type: "create",
    commandId: "brief-target",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  engine.command({
    type: "send",
    commandId: "brief-work",
    sessionId: target.sessionId,
    text: "Fix the build",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[1].input.onEvent({ type: "message.delta", text: "Build fixed in main.ts" });
  turns[1].input.onEvent({ type: "message.completed" });
  turns[1].finish();
  await vi.waitFor(() => expect(store.session(target.sessionId).status).toBe("idle"));
  const event = (id: string, root: string, sessionId: string) =>
    journal.enqueue(
      {
        id,
        kind: "event",
        text: `Report results.\ncompleted: projectId=${project.id}, sessionId=${sessionId}\nRe-read current state before acting.`,
        rootCauseId: root,
        state: "pending",
        createdAt: Date.now(),
        attempts: 0,
        refs: [sessionId],
      },
      id,
    );
  journal.writeChain("looping", { count: 8, paused: false, startedAt: Date.now() });
  event("first", "task-a", target.sessionId);
  event("second", "task-b", "other-session");
  event("limited", "looping", "looping-session");
  await engine.assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  const text = turns[2].input.text;
  expect(text).toContain(`sessionId=${target.sessionId}\n`);
  expect(text).toContain("sessionId=other-session");
  expect(text).not.toContain("looping-session");
  expect(text.match(/Report results\./g)).toHaveLength(1);
  expect(text.match(/Re-read current state before acting\./g)).toHaveLength(1);
  expect(text).toContain("Latest reply: Build fixed in main.ts");
  expect(journal.wakeup("second")).toMatchObject({ state: "completed", mergedInto: "first" });
  expect(journal.wakeup("limited")?.state).toBe("pending");
  expect(journal.wakeup("first")?.text).not.toContain("Latest reply");
  expect(journal.chain("task-a").count).toBe(1);
  expect(journal.chain("task-b").count).toBe(1);
  expect(journal.chain("looping").count).toBe(8);
});
it("uses backoff only when a usage rejection had no partial execution", async () => {
  const { engine, turns } = await setup();
  turns[0].input.onEvent({ type: "usage.limited" });
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(engine.assistant.store.get()!.lifecycle).toBe("backoff");
  expect(engine.assistant.store.wakeups()[0].state).toBe("backoff");
  expect(engine.assistant.store.get()!.nextRetryAt).toBeGreaterThan(Date.now());
});

it("retries a known usage rejection with a new attempt receipt and clears the old limit", async () => {
  const { engine, turns } = await setup();
  const journal = engine.assistant.store;
  turns[0].input.onEvent({ type: "usage.limited" });
  turns[0].finish();
  await vi.waitFor(() =>
    expect(engine.store.session(journal.get()!.brainSessionId!).status).toBe(
      "idle",
    ),
  );
  await engine.assistant.tick();
  const wakeup = journal.wakeups()[0];
  journal.saveWakeup({ ...wakeup, retryAt: Date.now() - 1 });
  await engine.assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(
    engine.store.session(journal.get()!.brainSessionId!).session.usageLimit,
  ).toBeUndefined();
  turns[1].input.onEvent({ type: "message.delta", text: "Recovered" });
  turns[1].input.onEvent({ type: "message.completed" });
  turns[1].finish();
  await vi.waitFor(() =>
    expect(engine.store.session(journal.get()!.brainSessionId!).status).toBe(
      "idle",
    ),
  );
  await engine.assistant.tick();
  expect(journal.get()!.lifecycle).toBe("idle");
  expect(journal.wakeups()[0].state).toBe("completed");
});
it("does not automatically replay a usage rejection after partial execution", async () => {
  const { engine, turns, project } = await setup();
  await executeBotAction(
    engine.assistant,
    "partial",
    "sessions.create",
    { projectId: project.id, harness: "codex", model: "test" },
    () => true,
  );
  turns[0].input.onEvent({ type: "usage.limited" });
  turns[0].finish();
  await vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
  await engine.assistant.tick();
  expect(engine.assistant.store.get()!.lifecycle).toBe("interrupted");
  expect(turns).toHaveLength(1);
});
it("keeps a durably accepted target queue running when only the brain is paused", async () => {
  const { engine, project, turns, store } = await setup();
  const target = engine.command({
    type: "create",
    commandId: "paused-target",
    projectId: project.id,
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
  });
  follow(engine, project.id, target.sessionId);
  engine.command({
    type: "send",
    commandId: "first-human",
    sessionId: target.sessionId,
    text: "First turn",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  await executeBotAction(
    engine.assistant,
    "accepted-queue",
    "sessions.send",
    {
      projectId: project.id,
      sessionId: target.sessionId,
      text: "Accepted follow-up",
    },
    () => true,
  );
  await engine.assistant.rpc("assistant.control", {
    commandId: "pause-brain",
    action: "pause",
  });
  turns[1].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toBe("Accepted follow-up");
  expect(
    store.session(target.sessionId).session.blocks.at(-1)?.origin?.kind,
  ).toBe("assistant");
});

const idleBrain = async (engine: HostEngine) =>
  vi.waitFor(() =>
    expect(
      engine.store.session(engine.assistant.store.get()!.brainSessionId!)
        .status,
    ).toBe("idle"),
  );
it("splits a reply into ordered bubbles and only streams the last one", async () => {
  const { engine, turns } = await setup();
  const replies = () =>
    engine.assistant.store
      .latestMessages()
      .filter((m) => m.kind === "assistant");
  turns[0].input.onEvent({ type: "message.delta", text: "Got it<msg_b" });
  await vi.waitFor(() =>
    expect(replies()).toEqual([
      expect.objectContaining({ text: "Got it", streaming: true }),
    ]),
  );
  turns[0].input.onEvent({
    type: "message.delta",
    text: "reak/>Checking now",
  });
  await vi.waitFor(() =>
    expect(replies()).toEqual([
      expect.objectContaining({ text: "Got it", streaming: false }),
      expect.objectContaining({ text: "Checking now", streaming: true }),
    ]),
  );
  turns[0].input.onEvent({ type: "message.completed" });
  turns[0].finish();
  await idleBrain(engine);
  await engine.assistant.tick();
  expect(replies().map((m) => m.kind === "assistant" && m.streaming)).toEqual([
    false,
    false,
  ]);
});
it("keeps promised follow-ups idempotent and fires each due reminder once", async () => {
  const { engine } = await setup();
  const create = { delayMinutes: 30, prompt: "Check the login fix" };
  await expect(
    executeBotAction(
      engine.assistant,
      "remind",
      "reminders.create",
      create,
      () => true,
    ),
  ).rejects.toThrow(/disabled/);
  engine.assistant.store.update({
    triggers: { user: true, event: false, schedule: true },
  });
  const first = await executeBotAction(
    engine.assistant,
    "remind",
    "reminders.create",
    create,
    () => true,
  );
  expect(
    await executeBotAction(
      engine.assistant,
      "remind",
      "reminders.create",
      create,
      () => true,
    ),
  ).toEqual(first);
  expect(engine.assistant.store.get()!.reminders).toHaveLength(1);
  const { enqueueSchedules } = await import("./scheduler");
  const due = engine.assistant.store.get()!.reminders![0].dueAt + 1;
  enqueueSchedules(engine.assistant.store, due);
  enqueueSchedules(engine.assistant.store, due + 60000);
  const fired = engine.assistant.store
    .wakeups()
    .filter((w) => w.text.includes("Check the login fix"));
  expect(fired).toHaveLength(1);
  expect(fired[0]).toMatchObject({ kind: "schedule", state: "pending" });
  expect(engine.assistant.store.get()!.reminders![0].state).toBe("fired");
});
it("lets the user cancel a pending reminder", async () => {
  const { engine } = await setup();
  engine.assistant.store.update({
    triggers: { user: true, event: false, schedule: true },
  });
  const { reminderId } = (await executeBotAction(
    engine.assistant,
    "remind",
    "reminders.create",
    { delayMinutes: 5, prompt: "Look again" },
    () => true,
  )) as { reminderId: string };
  await engine.assistant.rpc("assistant.control", {
    commandId: "cancel-reminder",
    action: "cancelReminder",
    reminderId,
  });
  expect(engine.assistant.store.get()!.reminders![0].state).toBe("cancelled");
  await expect(
    engine.assistant.rpc("assistant.control", {
      commandId: "cancel-again",
      action: "cancelReminder",
      reminderId,
    }),
  ).rejects.toThrow(/not pending/);
});
it("delivers a message sent during a running user turn into that turn when steering is supported", async () => {
  const { engine, provider } = await setup({ steer: true });
  const receipt = (await engine.assistant.rpc("assistant.send", {
    commandId: "follow-up",
    text: "Also check the tests",
  })) as { messageId: string; wakeupId: string };
  expect(provider.steer).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining("Also check the tests"),
    }),
  );
  expect(
    engine.assistant.store
      .latestMessages()
      .find((m) => m.id === receipt.messageId),
  ).toMatchObject({ readAt: expect.any(Number) });
  expect(engine.assistant.store.wakeup(receipt.wakeupId)).toMatchObject({
    state: "completed",
  });
  expect(engine.assistant.store.pending()).toEqual([]);
});
it("keeps IM and client turns separate while merging only follow-ups from the same binding", async () => {
  const { engine, provider, turns } = await setup({ steer: true });
  const input = { commandId: "im-first", text: "From Feishu", bindingId: "owner-one" };
  const [first, duplicate] = await Promise.all([
    engine.assistant.receiveImMessage(input), engine.assistant.receiveImMessage(input),
  ]);
  expect(duplicate).toEqual(first);
  expect(engine.assistant.store.wakeup(first.wakeupId!)?.source).toEqual({ kind: "im", bindingId: "owner-one" });
  expect(provider.steer).not.toHaveBeenCalled();
  expect(engine.assistant.store.wakeup(first.wakeupId!)?.state).toBe("pending");
  await expect(engine.assistant.rpc("assistant.send", { commandId: "spoof", text: "Spoof", source: { kind: "im", bindingId: "owner-one" } })).rejects.toThrow(/Unknown input field/);
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  const followup = await engine.assistant.receiveImMessage({ ...input, commandId: "im-followup", text: "Also check this" });
  expect(provider.steer).toHaveBeenCalledOnce();
  expect(engine.assistant.store.wakeup(followup.wakeupId!)).toMatchObject({ state: "completed", mergedInto: first.wakeupId });
  const otherBinding = await engine.assistant.receiveImMessage({ ...input, commandId: "im-other", bindingId: "owner-two" });
  const client = await engine.assistant.rpc("assistant.send", { commandId: "client-followup", text: "From desktop" }) as { wakeupId: string };
  expect(provider.steer).toHaveBeenCalledOnce();
  expect(engine.assistant.store.wakeup(otherBinding.wakeupId!)?.state).toBe("pending");
  expect(engine.assistant.store.wakeup(client.wakeupId)?.source).toEqual({ kind: "client" });
  turns[1].input.onEvent({ type: "message.delta", text: "Feishu reply" });
  turns[1].input.onEvent({ type: "message.completed" });
  expect(engine.assistant.store.latestMessages()).toContainEqual(expect.objectContaining({ text: "Feishu reply", wakeupId: first.wakeupId, streaming: false }));
});
it("attributes automatic replies and input requests and preserves their source when resumed", async () => {
  const { engine, turns } = await setup();
  turns[0].finish();
  await idleBrain(engine);
  await engine.assistant.tick();
  const journal = engine.assistant.store;
  journal.enqueue({ id: "automatic", kind: "schedule", text: "Check the work", rootCauseId: "schedule:test",
    state: "pending", createdAt: Date.now(), attempts: 0 }, "automatic");
  await engine.assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[1].input.onEvent({ type: "approval.requested", requestId: 9, title: "Confirm?" });
  expect(journal.latestMessages()).toContainEqual(expect.objectContaining({ kind: "input", wakeupId: "automatic", resolved: false }));
  turns[1].input.onEvent({ type: "message.delta", text: "A meaningful update" });
  turns[1].input.onEvent({ type: "message.completed" });
  turns[1].finish();
  await idleBrain(engine);
  await engine.assistant.tick();
  expect(journal.latestMessages()).toContainEqual(expect.objectContaining({ kind: "assistant", text: "A meaningful update", wakeupId: "automatic", streaming: false }));
  const automatic = journal.wakeup("automatic")!;
  journal.saveWakeup({ ...automatic, state: "interrupted" });
  journal.update({ lifecycle: "interrupted" });
  await engine.assistant.rpc("assistant.control", { commandId: "resume-auto", action: "resume" });
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  const resumed = journal.wakeups().find((wakeup) => wakeup.id !== "automatic" && wakeup.rootCauseId === automatic.rootCauseId)!;
  expect(resumed).toMatchObject({ kind: "user", source: { kind: "automatic" } });
});
it("shows the current action as activity and clears it when the turn ends", async () => {
  const { engine, turns } = await setup();
  await executeBotAction(
    engine.assistant,
    "look-all",
    "projects.list",
    {},
    () => true,
  );
  expect(engine.assistant.store.get()!.activity).toMatchObject({
    action: "projects.list",
  });
  turns[0].finish();
  await idleBrain(engine);
  await engine.assistant.tick();
  expect(engine.assistant.store.get()!.activity).toBeUndefined();
});
it("validates personality settings and reads older records with defaults", async () => {
  const { engine } = await setup();
  await expect(
    engine.assistant.rpc("assistant.configure", {
      commandId: "bad-persona",
      expectedRevision: engine.assistant.store.get()!.revision,
      patch: { persona: { preset: "pirate", style: "" } },
    }),
  ).rejects.toThrow(/personality/);
  await engine.assistant.rpc("assistant.configure", {
    commandId: "persona",
    expectedRevision: engine.assistant.store.get()!.revision,
    patch: {
      persona: { preset: "partner", style: "Be playful", userName: "Wy" },
      timezone: "Asia/Shanghai",
    },
  });
  expect(engine.assistant.store.view()).toMatchObject({
    persona: { preset: "partner", userName: "Wy" },
    timezone: "Asia/Shanghai",
  });
  engine.store.db.prepare("UPDATE bots SET config=json_remove(config,'$.persona','$.timezone','$.reminders') WHERE id=?")
    .run(engine.assistant.store.botId);
  expect(engine.assistant.store.get()).toMatchObject({
    persona: { preset: "secretary", style: "" },
    timezone: "UTC",
    reminders: [],
  });
});
it("rotates an oversized brain into a fresh generation briefed from the chat", async () => {
  const { engine, store, turns } = await setup();
  const first = engine.assistant.store.get()!;
  turns[0].finish();
  await vi.waitFor(() =>
    expect(store.session(first.brainSessionId!).status).toBe("idle"),
  );
  await engine.assistant.tick();
  const brain = store.session(first.brainSessionId!);
  store.save(
    {
      ...brain,
      revision: brain.revision + 1,
      session: {
        ...brain.session,
        providerSessionId: "native-1",
        context: { used: 200_000, window: 400_000 },
      },
    },
    { type: "test.context" },
  );
  await engine.assistant.rpc("assistant.send", {
    commandId: "after-growth",
    text: "Anything new?",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  const next = engine.assistant.store.get()!;
  expect(next.brainGeneration).toBe(first.brainGeneration + 1);
  expect(turns[1].input.sessionId).toBe(next.brainSessionId);
  expect(turns[1].input.sessionId).not.toBe(first.brainSessionId);
  expect(turns[1].input.text).toContain("<previous_conversation>");
  expect(turns[1].input.text).toContain("Inspect the projects");
  expect(turns[0].input.text).not.toContain("<previous_conversation>");
});
it("rereads resident memory every turn and replaces the native cache after memory changes", async () => {
  const { engine, store, turns } = await setup();
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  expect(turns[0].input.text).toContain("(Empty. Nothing has been remembered yet.)");
  const fact = { fact: "Prefers pnpm; token=abc123secret" };
  const first = await act("remember", "memory.add", fact);
  expect(await act("remember", "memory.add", fact)).toEqual(first);
  await act("topic", "memory.add", { fact: "Deploys go through staging", topic: "deploys" });
  const memory = engine.assistant.store.memoryDoc("memory").text;
  expect(memory).toMatch(/^- \d{4}-\d{2}-\d{2} · Prefers pnpm; «redacted/);
  expect(memory).not.toContain("abc123secret");
  expect(JSON.stringify(engine.assistant.store.action("remember"))).not.toContain("abc123secret");
  expect(await act("search", "memory.search", { query: "staging deploys" })).toEqual([
    expect.objectContaining({ file: "topic:deploys" }),
  ]);
  const brainId = engine.assistant.store.get()!.brainSessionId!;
  const nextTurn = async (text: string, count: number) => {
    const currentBrainId = turns.at(-1)!.input.sessionId;
    turns.at(-1)!.finish();
    await vi.waitFor(() => expect(store.session(currentBrainId).status).toBe("idle"));
    await engine.assistant.tick();
    await engine.assistant.rpc("assistant.send", { commandId: text, text });
    await vi.waitFor(() => expect(turns).toHaveLength(count));
    return turns[count - 1].input.text;
  };
  const second = await nextTurn("What do I prefer?", 2);
  expect(second).toContain("Prefers pnpm");
  expect(second).toContain("Topic notes: deploys");
  expect(turns[1].input.sessionId).not.toBe(brainId);
  expect(await nextTurn("Thanks", 3)).toContain("Your memory (current version");
  expect(turns[2].input.sessionId).toBe(turns[1].input.sessionId);
});
it("searches Chinese memory through controls across resident, topic and archived facts", async () => {
  const { engine } = await setup();
  const store = engine.assistant.store;
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  const historical = "- ~~2020-01-01 · 发布流程使用 Travis~~ · superseded 2021-01-01";
  store.writeMemoryDoc("memory", [
    historical,
    ...Array.from({ length: MEMORY_MAX_LINES - 1 }, (_, i) => `- 2025-01-01 · ordinary note ${i}`),
  ].join("\n"));
  await act("resident", "memory.add", { fact: "发布流程使用 GitHub Actions" });
  await act("topic", "memory.add", { topic: "notifications", fact: "飞书消息推送到局域网" });
  expect(store.memoryDoc("memory").text).not.toContain("Travis");
  expect(store.memoryDoc("archive").text).toContain(historical);
  const results = await act("search", "memory.search", { query: "发布流程" });
  expect(results).toHaveLength(2);
  expect(results).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: "memory", line: expect.stringContaining("GitHub Actions") }),
    expect.objectContaining({ file: "archive", line: expect.stringContaining(`${historical} · moved `), date: "2020-01-01" }),
  ]));
  expect(await act("search-topic", "memory.search", { query: "飞书消息推送给谁" })).toEqual([
    expect.objectContaining({ file: "topic:notifications", line: expect.stringContaining("局域网") }),
  ]);
  expect(await act("search-since", "memory.search", { query: "发布", since: "2025-01-01" })).toEqual([
    expect.objectContaining({ file: "memory" }),
  ]);
  expect(await act("search-date", "memory.search", { since: "2025-01-01", limit: 1 })).toHaveLength(1);
  expect(await act("search-default", "memory.search", { query: "ordinary" })).toHaveLength(20);
  expect(await act("search-max", "memory.search", { query: "ordinary", limit: 50 })).toHaveLength(50);
  await expect(act("search-invalid", "memory.search", { query: "发布", limit: 51 })).rejects.toThrow("limit");
});
it("reads desktop-authored Unicode topics through the legacy Bot controls", async () => {
  const { engine } = await setup(), store = engine.assistant.store;
  const memory = store.memory, path = "memory/发布流程.md", original = memory.read(path);
  memory.save(path, "发布前检查 staging", { expectedRevision: original.revision, expectedHash: original.hash });
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  expect(await act("read-unicode", "memory.read", { topic: "发布流程" })).toEqual({ text: "发布前检查 staging" });
  await act("append-unicode", "memory.add", { topic: "发布流程.md", fact: "发布后检查 health" });
  expect(memory.read(path).text).toContain("发布后检查 health");
  expect(await engine.assistant.rpc("assistant.memoryTopic", { topic: "发布流程" })).toMatchObject({ text: expect.stringContaining("发布后检查 health") });
  await expect(act("reserved-topic", "memory.read", { topic: "archive" })).rejects.toThrow("topic");
  // Existing diary automation still reaches its virtual log aggregate.
  expect(await act("legacy-diary", "memory.read", { topic: "chat-days" })).toEqual({ text: "" });
});
it("keeps historical topic aliases reachable without changing their spelling or diary identity", async () => {
  const { engine } = await setup(), store = engine.assistant.store;
  for (const [index, name] of ["CON", "foo.", "foo.md", "CHAT-DAYS"].entries()) {
    store.writeMemoryDoc(`topic:${name}`, `Original topic ${index}`);
    const input = { topic: `${name}.md` };
    expect(await executeBotAction(engine.assistant, `alias-${index}`, "memory.read", input, () => true))
      .toEqual({ text: `Original topic ${index}` });
    expect(await engine.assistant.rpc("assistant.memoryTopic", input)).toMatchObject({ name, text: `Original topic ${index}` });
  }
  expect(store.memoryDoc("topic:chat-days").text).toBe("");
});
it("lets the user read, add, edit and forget memory without overwriting newer writes", async () => {
  const { engine } = await setup();
  const rpc = engine.assistant.rpc.bind(engine.assistant);
  const read = () =>
    rpc("assistant.memory", {}) as Promise<{
      revision: number;
      facts: { index: number; text: string; struck: boolean }[];
    }>;
  expect(await read()).toEqual({ revision: 0, facts: [], topics: [] });
  await rpc("assistant.control", { commandId: "m1", action: "addMemory", fact: "Works in UTC+8" });
  let memory = await read();
  expect(memory.facts).toEqual([
    expect.objectContaining({ text: "Works in UTC+8", struck: false }),
  ]);
  expect(engine.assistant.store.view()!.memory).toEqual({ revision: 1, lines: 1 });
  const stale = memory.revision;
  await rpc("assistant.control", {
    commandId: "m2",
    action: "editMemory",
    index: memory.facts[0].index,
    fact: "Works in Asia/Shanghai",
    expectedRevision: stale,
  });
  await expect(
    rpc("assistant.control", {
      commandId: "m3",
      action: "forgetMemory",
      index: memory.facts[0].index,
      expectedRevision: stale,
    }),
  ).rejects.toThrow(/changed elsewhere/);
  memory = await read();
  expect(memory.facts.map((fact) => fact.text)).toEqual(["Works in Asia/Shanghai"]);
  await rpc("assistant.control", {
    commandId: "m4",
    action: "forgetMemory",
    index: memory.facts[0].index,
    expectedRevision: memory.revision,
  });
  expect((await read()).facts).toEqual([]);
});
it("keeps habits from the assistant and the user and records each run's outcome", async () => {
  const { engine, store, turns, project } = await setup();
  const assistant = engine.assistant;
  assistant.store.update({ triggers: { user: true, event: false, schedule: true } });
  const created = (await executeBotAction(
    assistant,
    "habit",
    "habits.create",
    {
      name: "PR sweep",
      prompt: "Check open PRs",
      schedule: { scheduleKind: "weekdays", time: "09:00" },
    },
    () => true,
  )) as { habitId: string; nextRunAt: number };
  expect(created.nextRunAt).toBeGreaterThan(Date.now());
  await expect(
    executeBotAction(
      assistant,
      "habit-bad",
      "habits.create",
      { name: "x", prompt: "y", schedule: { scheduleKind: "monthly" } },
      () => true,
    ),
  ).rejects.toThrow("scheduleKind");
  await assistant.rpc("assistant.control", {
    commandId: "pause",
    action: "updateHabit",
    habitId: created.habitId,
    habit: { enabled: false },
  });
  expect(assistant.store.get()!.habits![0]).toMatchObject({ enabled: false });
  turns[0].finish();
  const brain = assistant.store.get()!.brainSessionId!;
  await vi.waitFor(() => expect(store.session(brain).status).toBe("idle"));
  await assistant.tick();
  await assistant.rpc("assistant.control", {
    commandId: "run-now",
    action: "runHabit",
    habitId: created.habitId,
  });
  await assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toContain('Your habit "PR sweep" is due');
  expect(turns[1].input.text).toContain("Habits you keep:");
  turns[1].finish();
  await vi.waitFor(() => expect(store.session(brain).status).toBe("idle"));
  await assistant.tick();
  // The fake provider says nothing, so the run had nothing worth posting.
  expect(assistant.store.get()!.habits![0]).toMatchObject({
    lastOutcome: "quiet",
    lastRunAt: expect.any(Number),
  });
  await assistant.rpc("assistant.control", {
    commandId: "run-with-file", action: "runHabit", habitId: created.habitId,
  });
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  writeFileSync(join(project.cwd, "report.txt"), "A report worth sharing");
  const publication = await executeBotAction(assistant, "habit-report", "reply.attachments", {
    sources: [{ kind: "project-file", projectId: project.id, relativePath: "report.txt" }],
  }, () => true) as { messageId: string };
  const message = assistant.store.latestMessages().find((entry) => entry.id === publication.messageId)!;
  expect(assistant.store.wakeup(message.wakeupId!)?.source).toEqual({ kind: "automatic" });
  turns[2].input.onEvent({ type: "message.delta", text: "<assistant_quiet/>" });
  turns[2].input.onEvent({ type: "message.completed" });
  turns[2].finish();
  await idleBrain(engine);
  await assistant.tick();
  expect(assistant.store.get()!.habits![0].lastOutcome).toBe("posted");
  await assistant.rpc("assistant.control", {
    commandId: "delete",
    action: "deleteHabit",
    habitId: created.habitId,
  });
  expect(assistant.store.get()!.habits).toEqual([]);
});
it("answers queued messages from the same sender in one turn", async () => {
  const { engine, turns } = await setup();
  const first = (await engine.assistant.rpc("assistant.send", { commandId: "queued-one", text: "Hello" })) as { wakeupId: string };
  const second = (await engine.assistant.rpc("assistant.send", { commandId: "queued-two", text: "Read both files" })) as { wakeupId: string };
  turns[0].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toMatch(/Hello\nRead both files$/);
  expect(engine.assistant.store.wakeup(second.wakeupId)).toMatchObject({ state: "completed", mergedInto: first.wakeupId });
  expect(engine.assistant.store.latestMessages().filter((m) => m.kind === "user" && m.readAt == null)).toEqual([]);
});
it("treats a lone stop word as a stop that also drops queued messages", async () => {
  const { engine, turns, provider } = await setup();
  const queued = (await engine.assistant.rpc("assistant.send", { commandId: "queued", text: "Read both files" })) as { wakeupId: string };
  const stop = (await engine.assistant.rpc("assistant.send", { commandId: "stop", text: " 停止 " })) as { messageId: string; wakeupId?: string };
  expect(stop.wakeupId).toBeUndefined();
  expect(provider.stop).toHaveBeenCalled();
  expect(engine.assistant.store.wakeup(queued.wakeupId)?.state).toBe("completed");
  expect(engine.assistant.store.get()?.lifecycle).toBe("idle");
  const messages = engine.assistant.store.latestMessages();
  expect(messages).toContainEqual(expect.objectContaining({ id: stop.messageId, text: " 停止 ", readAt: expect.any(Number) }));
  expect(messages.at(-1)).toMatchObject({ kind: "status", text: "Stopped" });
  await engine.assistant.tick();
  expect(turns).toHaveLength(1);
  // With nothing to stop, the same word is an ordinary message.
  const later = (await engine.assistant.rpc("assistant.send", { commandId: "stop-idle", text: "stop" })) as { wakeupId?: string };
  expect(later.wakeupId).toEqual(expect.any(String));
  await vi.waitFor(() => expect(turns).toHaveLength(2));
});
it("searches the chat and writes each finished day into the diary once", async () => {
  const { engine } = await setup();
  const assistant = engine.assistant;
  assistant.store.update({ timezone: "UTC", triggers: { user: true, event: false, schedule: true } });
  const at = Date.UTC(2026, 9, 7, 21);
  assistant.store.message({ id: "u1", kind: "user", text: "放一首读心术", createdAt: at });
  assistant.store.message({ id: "a1", kind: "assistant", text: "好，正在播放。", createdAt: at + 60_000 });
  expect(
    await executeBotAction(assistant, "chat", "chat.search", { query: "读心术" }, () => true),
  ).toEqual([
    {
      at: "2026-10-07 21:00",
      from: "user",
      text: "放一首读心术",
      context: { from: "assistant", text: "好，正在播放。" },
    },
  ]);
  const diaries = () =>
    assistant.store.wakeups().filter((w) => w.rootCauseId === "diary:2026-10-07");
  // Not before the next local day is a few hours old.
  expect(enqueueDiaries(assistant.store, Date.UTC(2026, 9, 8, 3))).toBe(true);
  expect(diaries()).toEqual([]);
  enqueueDiaries(assistant.store, Date.UTC(2026, 9, 8, 5));
  enqueueDiaries(assistant.store, Date.UTC(2026, 9, 8, 6));
  expect(diaries()).toHaveLength(1);
  expect(diaries()[0].text).toContain("21:00 User: 放一首读心术\n21:01 You: 好，正在播放。");
  expect(
    assistant.store.wakeups().filter((w) => w.rootCauseId.startsWith("diary:")),
  ).toHaveLength(1);
  assistant.store.message({ id: "u2", kind: "user", text: "关闭显示器", createdAt: at + 86_400_000 });
  await executeBotAction(
    assistant,
    "diary-8",
    "memory.add",
    { topic: "chat-days", fact: "2026-10-08: 用户让我关闭显示器。" },
    () => true,
  );
  enqueueDiaries(assistant.store, Date.UTC(2026, 9, 9, 5));
  expect(
    assistant.store.wakeups().filter((w) => w.rootCauseId === "diary:2026-10-08"),
  ).toEqual([]);
  assistant.store.update({ triggers: { user: true, event: false, schedule: false } });
  expect(enqueueDiaries(assistant.store, Date.UTC(2026, 9, 10, 5))).toBe(false);
});
it("keeps playbooks the brain can list, follow and refine", async () => {
  const { engine, turns } = await setup();
  const assistant = engine.assistant;
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(assistant, requestId, action, input, () => true);
  const save = {
    name: "mobile-release",
    description: "发布手机端 APK 到局域网时使用",
    body: "1. 运行 npm run mobile:publish\n2. 确认更新源版本号",
    verified: true,
  };
  expect(await act("pb1", "playbooks.save", save)).toEqual({ name: "mobile-release", created: true });
  expect(await act("pb1", "playbooks.save", save)).toEqual({ name: "mobile-release", created: true });
  const [listed] = (await act("pb-list", "playbooks.list", {})) as { verified?: string }[];
  expect(listed).toEqual(expect.objectContaining({ name: "mobile-release", verified: expect.any(String) }));
  // A later correction keeps the last verified run.
  await act("pb2", "playbooks.save", { ...save, body: "1. 先拉取最新代码\n2. 运行 npm run mobile:publish", verified: undefined });
  expect(await act("pb-read", "playbooks.read", { name: "mobile-release" })).toEqual(
    expect.objectContaining({ body: "1. 先拉取最新代码\n2. 运行 npm run mobile:publish", verified: listed.verified }),
  );
  await expect(act("pb-bad", "playbooks.save", { ...save, name: "Mobile Release" })).rejects.toThrow("lowercase");
  turns[0].finish();
  await assistant.rpc("assistant.send", { commandId: "release", text: "帮我把手机端发布一下" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toContain("- mobile-release: 发布手机端 APK 到局域网时使用 (last worked");
  expect(turns[1].input.text).toContain('looks like your playbook "mobile-release"');
  expect(turns[1].input.text).toContain("1. 先拉取最新代码");
  expect(await act("pb-del", "playbooks.delete", { name: "mobile-release" })).toEqual({ deleted: true });
  expect(await act("pb-list2", "playbooks.list", {})).toEqual([]);
});

it("dispatches a single playbook and snapshots ordered playbooks in the queue across edits and retries", async () => {
  const { engine, project, store, turns } = await setup();
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  const release = { name: "release", description: "Ship a release", body: "Run the release checks" };
  const verify = { name: "verify", description: "Verify a release", body: "Check the installed version" };
  await act("save-release", "playbooks.save", release);
  await act("save-verify", "playbooks.save", verify);
  await act("save-private", "playbooks.save", { name: "private", description: "Unrelated", body: "Unrelated private procedure" });
  const target = await act("target", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }) as { sessionId: string };
  const ref = { projectId: project.id, sessionId: target.sessionId };
  await act("single", "sessions.send", { ...ref, text: "Ship it", playbooks: "release" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toContain(release.body);
  expect(turns[1].input.text).not.toContain(verify.body);
  expect(turns[1].input.text).not.toContain("Unrelated private procedure");
  const queuedInput = { ...ref, text: "Ship and verify", playbooks: ["release", "verify", "release"] };
  const accepted = await act("queued-playbooks", "sessions.send", queuedInput);
  const queued = store.session(target.sessionId).session.queuedMessages!;
  expect(queued).toHaveLength(1);
  expect(queued[0].text.indexOf(release.body)).toBeLessThan(queued[0].text.indexOf(verify.body));
  expect(queued[0].text.split(release.body)).toHaveLength(2);
  expect(queued[0].origin?.kind).toBe("assistant");
  expect(engine.assistant.store.action("queued-playbooks")!.input).toEqual(queuedInput);
  await act("revise", "playbooks.save", { ...release, body: "Different release steps" });
  await act("delete", "playbooks.delete", { name: "verify" });
  expect(await act("queued-playbooks", "sessions.send", queuedInput)).toEqual(accepted);
  expect(store.session(target.sessionId).session.queuedMessages).toHaveLength(1);
  turns[1].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toBe(queued[0].text);
  expect(turns[2].input.text).not.toContain("Different release steps");
});

it("rejects invalid playbook assignments and enforces dispatch permissions before resolving names", async () => {
  const { engine, project, store, turns } = await setup();
  const act = (requestId: string, action: string, input: Record<string, unknown>, authorized = true) =>
    executeBotAction(engine.assistant, requestId, action, input, () => authorized);
  await act("save", "playbooks.save", { name: "release", description: "Release", body: "Run checks" });
  const target = await act("target", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }) as { sessionId: string };
  const input = { projectId: project.id, sessionId: target.sessionId, text: "Ship it" };
  for (const [index, playbooks] of ["missing", ["release", "missing"], null, [42]].entries()) {
    await expect(act(`invalid-${index}`, "sessions.send", { ...input, playbooks })).rejects.toThrow();
    expect(engine.assistant.store.action(`invalid-${index}`)?.state).toBe("failed");
  }
  await expect(act("too-long", "sessions.send", { ...input, text: "a".repeat(256_000), playbooks: "release" })).rejects.toThrow("too long");
  await expect(act("revoked", "sessions.send", { ...input, playbooks: "release" }, false)).rejects.toThrow("revoked");
  const policy = fullBotPolicy();
  policy.permissions["sessions.send"] = false;
  engine.assistant.store.update({ policy });
  await expect(act("denied", "sessions.send", { ...input, playbooks: "missing" })).rejects.toThrow("Permission denied: sessions.send");
  expect(store.session(target.sessionId).session.blocks).toHaveLength(0);
  expect(store.session(target.sessionId).session.queuedMessages ?? []).toHaveLength(0);
  expect(turns).toHaveLength(1);
});

it("attaches playbooks to steering and queue edits without changing ordinary messages", async () => {
  const { engine, project, store, provider, turns } = await setup({ steer: true });
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  const playbook = { name: "review", description: "Review work", body: "Inspect the failing test first" };
  await act("save", "playbooks.save", playbook);
  const target = await act("target", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }) as { sessionId: string };
  const ref = { projectId: project.id, sessionId: target.sessionId };
  await act("start", "sessions.send", { ...ref, text: "Work" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  expect(turns[1].input.text).toBe("Work");
  const steerInput = { ...ref, text: "Focus here", runId: store.session(target.sessionId).runId, playbooks: [playbook.name] };
  await act("steer", "sessions.steer", steerInput);
  await act("steer", "sessions.steer", steerInput);
  expect(provider.steer).toHaveBeenCalledTimes(1);
  expect(provider.steer).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(playbook.body) }));
  expect(store.session(target.sessionId).session.blocks.at(-1)).toMatchObject({ text: expect.stringContaining(playbook.body), origin: { kind: "assistant" } });
  await act("enqueue", "sessions.send", { ...ref, text: "Next task" });
  const messageId = store.session(target.sessionId).session.queuedMessages![0].id;
  const queueRef = { ...ref, messageId, editor: "assistant-editor" };
  await expect(act("invalid-hold", "sessions.queue", { ...queueRef, action: "hold", playbooks: "review" })).rejects.toThrow("queue edits");
  await act("hold", "sessions.queue", { ...queueRef, action: "hold" });
  await act("edit", "sessions.queue", { ...queueRef, action: "edit", text: "Review next", playbooks: "review" });
  const queued = store.session(target.sessionId).session.queuedMessages![0];
  expect(queued.text).toContain(playbook.body);
  expect(queued.origin?.kind).toBe("assistant");
  turns[1].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toBe(queued.text);
});

it("routes assigned playbooks to worker messages, steering and retries after checking permissions", async () => {
  const { engine, project, store } = await setup();
  const act = (requestId: string, action: string, input: Record<string, unknown>) =>
    executeBotAction(engine.assistant, requestId, action, input, () => true);
  const playbook = { name: "review", description: "Review work", body: "Inspect the failing test first" };
  await act("save", "playbooks.save", playbook);
  const lead = await act("lead", "sessions.create", { projectId: project.id, harness: "codex", model: "test" }) as { sessionId: string };
  // Test the assistant boundary; the scheduler owns worker state validation.
  const run = vi.spyOn(engine.orchestration.scheduler, "run").mockReturnValue({ tasks: [] } as never);
  const generation = vi.spyOn(store, "orchestration").mockReturnValue({ id: "generation" } as never);
  const handle = vi.spyOn(engine.orchestration.scheduler, "handle").mockResolvedValue({ accepted: true });
  try {
    const input = { projectId: project.id, leadId: lead.sessionId, orchestrationId: "generation", taskId: "worker", input: { text: "Review now", files: ["src"] }, playbooks: "review" };
    for (const action of ["message", "steer", "retry"]) {
      await act(action, "orchestration.worker", { ...input, action });
      expect(handle).toHaveBeenLastCalledWith(
        lead.sessionId, expect.any(String), action,
        expect.objectContaining({ taskId: "worker", files: ["src"], text: expect.stringContaining(playbook.body) }),
        expect.any(Function), expect.objectContaining({ kind: "assistant" }),
      );
    }
    await expect(act("cancel", "orchestration.worker", { ...input, action: "cancel" })).rejects.toThrow("accept playbooks");
    await expect(act("oversized-worker", "orchestration.worker", {
      ...input, action: "message", input: { text: "a".repeat(30_000) },
    })).rejects.toThrow("too long");
    expect(engine.assistant.store.action("oversized-worker")?.state).toBe("failed");
    const policy = fullBotPolicy();
    policy.permissions["sessions.send"] = false;
    engine.assistant.store.update({ policy });
    await expect(act("denied-worker", "orchestration.worker", { ...input, action: "message", playbooks: "missing" })).rejects.toThrow("Permission denied: sessions.send");
    expect(handle).toHaveBeenCalledTimes(3);
  } finally {
    handle.mockRestore();
    generation.mockRestore();
    run.mockRestore();
  }
});

function follow(engine: HostEngine, projectId: string, sessionId: string) {
  const config = engine.assistant.store.get()!;
  engine.assistant.store.update({ policy: { ...config.policy,
    followedSessions: [...(config.policy.followedSessions ?? []), { projectId, sessionId }],
  } });
}

it("pages a transcript from its latest blocks backwards", async () => {
  const { engine, project, store, turns } = await setup();
  const target = engine.command({ type: "create", commandId: "paged-target", projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  engine.command({ type: "send", commandId: "paged-work", sessionId: target.sessionId, text: "Work" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  turns[1].input.onEvent({ type: "message.delta", text: "Newest reply" });
  turns[1].input.onEvent({ type: "message.completed" });
  turns[1].finish();
  await vi.waitFor(() => expect(store.session(target.sessionId).status).toBe("idle"));
  const total = store.session(target.sessionId).session.blocks.length;
  const input = { projectId: project.id, sessionId: target.sessionId };
  const latest = await executeBotAction(engine.assistant, "page-latest", "sessions.get",
    { ...input, latest: true, limit: 1 }, () => true) as { blocks: { text: string }[]; offset: number; total: number; hasMore: boolean };
  expect(latest).toMatchObject({ offset: total - 1, total, hasMore: false });
  expect(latest.blocks.map((b) => b.text)).toEqual(["Newest reply"]);
  const earlier = await executeBotAction(engine.assistant, "page-earlier", "sessions.get",
    { ...input, offset: 0, limit: total - 1 }, () => true) as { blocks: { text: string }[]; hasMore: boolean };
  expect(earlier.blocks[0].text).toBe("Work");
  expect(earlier.hasMore).toBe(true);
  await expect(executeBotAction(engine.assistant, "page-both", "sessions.get",
    { ...input, latest: true, offset: 0 }, () => true)).rejects.toThrow(/Invalid transcript page/);
});
it("keeps ordinary conversations read-only even with every permission enabled", async () => {
  const { engine, project, store } = await setup();
  const target = engine.command({ type: "create", commandId: "human-read-only", projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  const input = { projectId: project.id, sessionId: target.sessionId };
  expect(await executeBotAction(engine.assistant, "read-ordinary", "sessions.get", input, () => true)).toBeTruthy();
  const original = store.session(target.sessionId);
  for (const action of ["send", "steer", "configure", "compact", "cancel", "approve", "answer", "queue", "update", "delete"])
    await expect(executeBotAction(engine.assistant, `deny-unfollowed-${action}`, `sessions.${action}`, input, () => true)).rejects.toThrow(/read-only/);
  expect(store.session(target.sessionId)).toEqual(original);
  expect(engine.assistant.store.get()!.policy.followedSessions).toBeUndefined();
});

it("hands over only the chosen conversation idempotently and preserves permission switches", async () => {
  const { engine, project, store } = await setup();
  const create = (commandId: string) => engine.command({ type: "create", commandId, projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  const target = create("human-handoff"), sibling = create("human-sibling");
  const policy = fullBotPolicy();
  policy.permissions["sessions.send"] = false;
  engine.assistant.store.update({ policy });
  const command = { action: "delegateSession", commandId: "handoff", environmentId: store.environmentId,
    projectId: project.id, sessionId: target.sessionId };
  const before = engine.assistant.store.wakeups().length;
  const receipt = await engine.assistant.rpc("assistant.control", command);
  expect(await engine.assistant.rpc("assistant.control", command)).toEqual(receipt);
  expect(engine.assistant.store.wakeups()).toHaveLength(before + 1);
  expect(engine.assistant.store.get()!.policy).toEqual({ ...policy, followedSessions: [{ projectId: project.id, sessionId: target.sessionId }] });
  await expect(executeBotAction(engine.assistant, "still-denied", "sessions.send", {
    projectId: project.id, sessionId: target.sessionId, text: "Work",
  }, () => true)).rejects.toThrow(/Permission denied/);
  await executeBotAction(engine.assistant, "allowed-rename", "sessions.update", {
    projectId: project.id, sessionId: target.sessionId, title: "Followed task",
  }, () => true);
  await expect(executeBotAction(engine.assistant, "sibling-rename", "sessions.update", {
    projectId: project.id, sessionId: sibling.sessionId, title: "Must not change",
  }, () => true)).rejects.toThrow(/read-only/);
  expect(store.session(target.sessionId).session.title).toBe("Followed task");
  const config = engine.assistant.store.get()!;
  await engine.assistant.rpc("assistant.configure", { commandId: "remove-follow", expectedRevision: config.revision,
    patch: removeWatchedSession(config.policy, config.watches, target.sessionId) });
  await expect(executeBotAction(engine.assistant, "removed-rename", "sessions.update", {
    projectId: project.id, sessionId: target.sessionId, title: "Must not change",
  }, () => true)).rejects.toThrow(/read-only/);
  expect(await executeBotAction(engine.assistant, "read-removed", "sessions.get", {
    projectId: project.id, sessionId: target.sessionId,
  }, () => true)).toBeTruthy();
});

it("exempts assistant-created conversations using durable creation provenance", async () => {
  const { engine, project } = await setup();
  const created = await executeBotAction(engine.assistant, "assistant-owned", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }, () => true) as { sessionId: string };
  const config = engine.assistant.store.get()!;
  await engine.assistant.rpc("assistant.configure", { commandId: "remove-owned-watch", expectedRevision: config.revision,
    patch: removeWatchedSession(config.policy, config.watches, created.sessionId) });
  expect(engine.assistant.store.createdSession(created.sessionId)).toBe(true);
  expect(engine.assistant.store.get()!.policy.followedSessions ?? []).toEqual([]);
  await executeBotAction(engine.assistant, "owned-rename", "sessions.update", {
    projectId: project.id, sessionId: created.sessionId, title: "Still manageable",
  }, () => true);
  const policy = fullBotPolicy();
  policy.permissions["sessions.metadata"] = false;
  engine.assistant.store.update({ policy });
  await expect(executeBotAction(engine.assistant, "owned-denied", "sessions.update", {
    projectId: project.id, sessionId: created.sessionId, title: "Forbidden",
  }, () => true)).rejects.toThrow(/Permission denied/);
});

it("blocks queued assistant messages after unfollowing while letting human messages proceed", async () => {
  const { engine, project, store, turns } = await setup();
  const target = engine.command({ type: "create", commandId: "human-queue", projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  follow(engine, project.id, target.sessionId);
  engine.command({ type: "send", commandId: "begin-human", sessionId: target.sessionId, text: "Human first" });
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  await executeBotAction(engine.assistant, "pending-assistant", "sessions.send", {
    projectId: project.id, sessionId: target.sessionId, text: "Assistant queued",
  }, () => true);
  engine.command({ type: "send", commandId: "later-human", sessionId: target.sessionId, text: "Human next" });
  const config = engine.assistant.store.get()!;
  engine.assistant.store.update(removeWatchedSession(config.policy, config.watches, target.sessionId));
  turns[1].finish();
  await vi.waitFor(() => expect(turns).toHaveLength(3));
  expect(turns[2].input.text).toBe("Human next");
  expect(store.session(target.sessionId).session.blocks.some((b) => b.role === "user" && b.text === "Assistant queued")).toBe(false);
});

it("rejects handoffs for wrong Hosts, projects and private brains before granting access", async () => {
  const { engine, project, store } = await setup();
  const target = engine.command({ type: "create", commandId: "handoff-validation", projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  const brain = engine.assistant.store.get()!.brainSessionId!;
  const command = { action: "delegateSession", commandId: "invalid-handoff", environmentId: store.environmentId,
    projectId: project.id, sessionId: target.sessionId };
  for (const patch of [{ environmentId: "wrong-host" }, { projectId: "wrong-project" },
    { sessionId: brain, projectId: store.session(brain).projectId }])
    await expect(engine.assistant.rpc("assistant.control", { ...command, ...patch })).rejects.toThrow();
  expect(engine.assistant.store.get()!.policy.followedSessions).toBeUndefined();
});

it("observes only managed conversations and respects configured event kinds", async () => {
  const { engine, project, turns } = await setup();
  const human = (commandId: string) => engine.command({ type: "create", commandId, projectId: project.id,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  const ordinary = human("ordinary-event"), watched = human("watched-event");
  follow(engine, project.id, watched.sessionId);
  const owned = await executeBotAction(engine.assistant, "owned-event", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }, () => true) as { sessionId: string };
  turns[0].finish();
  await vi.waitFor(() => expect(engine.store.session(engine.assistant.store.get()!.brainSessionId!).status).toBe("idle"));
  await engine.assistant.tick();
  const config = engine.assistant.store.get()!;
  engine.assistant.store.update({ triggers: { user: true, event: true, schedule: false },
    watches: config.watches.map((watch) => ({ ...watch, eventKinds: ["completed"] })),
  });
  const sources = [
    { sessionId: ordinary.sessionId, kind: "completed" },
    { sessionId: watched.sessionId, kind: "approval" },
    { sessionId: watched.sessionId, kind: "completed" },
    { sessionId: owned.sessionId, kind: "completed" },
  ];
  sources.forEach((source, index) => engine.assistant.store.source({ ...source, eventKey: `scope-${index}`,
    projectId: project.id, rootCauseId: "event-scope", createdAt: Date.now() - 3000,
  }));
  await engine.assistant.tick();
  await vi.waitFor(() => expect(turns).toHaveLength(2));
  const wakeup = engine.assistant.store.wakeups().find((w) => w.kind === "event")!;
  expect(wakeup.refs).toEqual([watched.sessionId, owned.sessionId]);
  expect(wakeup.text).not.toContain("approval:");
  expect(engine.assistant.store.get()!.sourceCursor).toBe(4);
});

it("applies ongoing project follows to future conversations without changing configured permissions", async () => {
  const { engine, project, store } = await setup();
  const other = store.addProject(join(project.cwd, "other"), "Other");
  const policy = { ...fullBotPolicy(), followedProjects: [project.id] };
  policy.permissions["sessions.send"] = false;
  await engine.assistant.rpc("assistant.configure", { commandId: "follow-project", expectedRevision: engine.assistant.store.get()!.revision, patch: { policy } });
  const create = (commandId: string, projectId: string) => engine.command({ type: "create", commandId, projectId,
    harness: "codex", model: "test", runtimeMode: "supervised" });
  const followed = create("future-followed", project.id), unfollowed = create("future-unfollowed", other.id);
  await executeBotAction(engine.assistant, "future-rename", "sessions.update", { projectId: project.id, sessionId: followed.sessionId, title: "Allowed" }, () => true);
  await expect(executeBotAction(engine.assistant, "future-send", "sessions.send", { projectId: project.id, sessionId: followed.sessionId, text: "Still disabled" }, () => true)).rejects.toThrow(/Permission/);
  await expect(executeBotAction(engine.assistant, "outside-rename", "sessions.update", { projectId: other.id, sessionId: unfollowed.sessionId, title: "Denied" }, () => true)).rejects.toThrow(/read-only/);
  let config = engine.assistant.store.get()!;
  await engine.assistant.rpc("assistant.configure", { commandId: "exclude-followed", expectedRevision: config.revision,
    patch: removeWatchedSession(config.policy, config.watches, followed.sessionId) });
  await expect(executeBotAction(engine.assistant, "excluded-rename", "sessions.update", { projectId: project.id, sessionId: followed.sessionId, title: "Denied" }, () => true)).rejects.toThrow(/read-only/);
  config = engine.assistant.store.get()!;
  await engine.assistant.rpc("assistant.configure", { commandId: "follow-all", expectedRevision: config.revision,
    patch: { policy: { ...config.policy, followedProjects: "all" } } });
  await executeBotAction(engine.assistant, "all-rename", "sessions.update", { projectId: other.id, sessionId: unfollowed.sessionId, title: "Allowed now" }, () => true);
  await expect(executeBotAction(engine.assistant, "still-excluded", "sessions.update", { projectId: project.id, sessionId: followed.sessionId, title: "Denied" }, () => true)).rejects.toThrow(/read-only/);
  const lead = create("followed-lead", project.id);
  const child = store.session(followed.sessionId);
  store.save({ ...child, revision: child.revision + 1, session: { ...child.session, orchestrationLeadId: lead.sessionId } }, {});
  expect(engine.assistant.canManageSession(project.id, followed.sessionId)).toBe(false);
});

it("migrates previous assistant creations once and preserves subsequent unfollows across recovery", async () => {
  const { engine, project } = await setup();
  const created = await executeBotAction(engine.assistant, "legacy-created", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }, () => true) as { sessionId: string };
  engine.assistant.store.update({ policy: fullBotPolicy(), createdSessionWatchesMigrated: undefined });
  engine.assistant.store.recover();
  expect(engine.assistant.store.view()!.policy.followedSessions).toEqual([{ projectId: project.id, sessionId: created.sessionId }]);
  expect(engine.assistant.store.view()).not.toHaveProperty("createdSessionWatchesMigrated");
  const config = engine.assistant.store.get()!;
  engine.assistant.store.update(removeWatchedSession(config.policy, config.watches, created.sessionId));
  engine.assistant.store.recover();
  expect(engine.assistant.store.get()!.policy.followedSessions).toEqual([]);
  expect(engine.assistant.canManageSession(project.id, created.sessionId)).toBe(true);
});
it("stops the conversations a stopped task delegated", async () => {
  const { engine, project, turns, provider } = await setup();
  const { sessionId } = (await executeBotAction(engine.assistant, "delegate", "sessions.create", {
    projectId: project.id, harness: "codex", model: "test",
  }, () => true)) as { sessionId: string };
  for (const requestId of ["delegate-run", "delegate-queued"])
    await executeBotAction(engine.assistant, requestId, "sessions.send", {
      projectId: project.id, sessionId, text: "Investigate",
    }, () => true);
  await vi.waitFor(() => expect(turns.some((t) => t.input.sessionId === sessionId)).toBe(true));
  expect(engine.store.session(sessionId).session.queuedMessages).toHaveLength(1);
  await engine.assistant.rpc("assistant.control", { commandId: "stop-task", action: "cancelTurn" });
  expect(provider.cancel).toHaveBeenCalledWith(sessionId);
  expect(engine.store.session(sessionId).session.queuedMessages ?? []).toEqual([]);
  await vi.waitFor(() => expect(engine.store.session(sessionId).status).not.toBe("running"));
});
