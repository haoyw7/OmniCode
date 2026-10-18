import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../../store";
import { BotThreadStore, signature } from "./store";
import { fullBotPolicy } from "../../../src/features/bots/model/botView";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-store-"));
  const store = new HostStore(join(dir, "host.db"));
  cleanup.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, assistant: new BotThreadStore(store) };
}
it("adds assistant storage to a legacy Host database without changing ordinary projects", () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-legacy-")),
    path = join(directory, "host.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(
    "CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL); INSERT INTO projects VALUES ('ordinary', '/tmp/legacy', 'Legacy');",
  );
  legacy.close();
  const host = new HostStore(path);
  try {
    const assistant = new BotThreadStore(host);
    expect(host.projects()).toEqual([
      { id: "ordinary", cwd: "/tmp/legacy", name: "Legacy", kind: undefined },
    ]);
    expect(assistant.get()).toBeNull();
    host.addProject(join(directory, "brain"), "Brain", "assistant");
    expect(host.projects()).toHaveLength(1);
  } finally {
    host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("receives input and its public message atomically, deduplicating retries", () => {
  const { assistant } = setup();
  assistant.initialize({
    harness: "codex",
    model: "test",
    policy: fullBotPolicy(),
  });
  const first = assistant.receive("send-1", "hello", []);
  expect(assistant.receive("send-1", "hello", [])).toEqual(first);
  expect(assistant.messages(0, 50).entries).toHaveLength(1);
  expect(assistant.pending()).toHaveLength(1);
  expect(() => assistant.receive("send-1", "changed", [])).toThrow(/different/);
});
it("keeps legacy receipt retries compatible while binding IM receipts to their trusted source", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  assistant.recordReceipt("legacy", signature({ text: "hello", attachments: [] }), { commandId: "legacy" });
  expect(assistant.receive("legacy", "hello", [])).toEqual({ commandId: "legacy" });
  const received = assistant.receive("im", "hello", [], { kind: "im", bindingId: "owner-one" });
  expect(assistant.receive("im", "hello", [], { kind: "im", bindingId: "owner-one" })).toEqual(received);
  expect(() => assistant.receive("im", "hello", [], { kind: "im", bindingId: "owner-two" })).toThrow(/different/);
  expect(() => assistant.receive("im", "hello", [])).toThrow(/different/);
  for (const kind of ["user", "event", "schedule"] as const) {
    const old = { id: kind, kind, text: "old", state: "pending", rootCauseId: kind, createdAt: 1, attempts: 0 };
    store.db.prepare("INSERT INTO bot_wakeups VALUES (?, ?, ?, ?, ?)").run(assistant.botId, assistant.threadId, kind, kind, JSON.stringify(old));
    const source = { kind: kind === "user" ? "client" : "automatic" };
    expect(assistant.wakeup(kind)?.source).toEqual(source);
    expect(assistant.pending().find((wakeup) => wakeup.id === kind)?.source).toEqual(source);
    expect(assistant.wakeups().find((wakeup) => wakeup.id === kind)?.source).toEqual(source);
  }
});
it("persists user read receipts only when claimed and preserves send time across retry and recovery", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  const first = assistant.receive("read-one", "First", []);
  // Another sender's message is not merged into the claimed turn.
  const second = assistant.receive("read-two", "Second", [], { kind: "im", bindingId: "owner" });
  const unread = assistant
    .latestMessages()
    .find((m) => m.id === first.messageId)!;
  expect(unread).toMatchObject({ readAt: null });
  assistant.claim(first.wakeupId!);
  const read = assistant
    .latestMessages()
    .find((m) => m.id === first.messageId)!;
  expect(read).toMatchObject({
    readAt: expect.any(Number),
    createdAt: unread.createdAt,
  });
  expect(assistant.messages(unread.revision).entries).toContainEqual(read);
  expect(
    assistant.latestMessages().find((m) => m.id === second.messageId),
  ).toMatchObject({ readAt: null });
  expect(assistant.receive("read-one", "First", [])).toEqual(first);
  const restored = new BotThreadStore(store);
  restored.recover();
  expect(
    restored.latestMessages().find((m) => m.id === first.messageId),
  ).toEqual(read);
  expect(
    restored.latestMessages().find((m) => m.id === second.messageId),
  ).toMatchObject({ readAt: null });
});
it("rolls back the claim if its read receipt cannot be saved", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  const received = assistant.receive("read-fail", "Pending", []);
  store.db.exec(
    "CREATE TRIGGER fail_read BEFORE INSERT ON bot_messages BEGIN SELECT RAISE(ABORT, 'storage failure'); END",
  );
  expect(() => assistant.claim(received.wakeupId!)).toThrow(/storage failure/);
  expect(assistant.wakeup(received.wakeupId!)?.state).toBe("pending");
  expect(assistant.latestMessages()[0]).toMatchObject({ readAt: null });
});
it("rolls back a message and wakeup when persistence fails", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  store.db.exec(
    "CREATE TRIGGER fail_wakeup BEFORE INSERT ON bot_wakeups BEGIN SELECT RAISE(ABORT, 'storage failure'); END",
  );
  expect(() => assistant.receive("send-1", "hello", [])).toThrow(
    /storage failure/,
  );
  expect(assistant.messages(0, 50).entries).toHaveLength(0);
});
it("recovers started work as interrupted and never retries unknown actions", () => {
  const { assistant, store } = setup();
  const config = assistant.initialize({ harness: "codex", model: "test" });
  const input = assistant.receive("send-1", "hello", []);
  assistant.claim(input.wakeupId!);
  assistant.putAction({
    id: "action",
    requestId: "req",
    signature: "sig",
    action: "sessions.send",
    input: {},
    rootCauseId: "root",
    origin: {
      kind: "assistant",
      assistantId: config.id,
      actionId: "action",
      wakeupId: input.wakeupId!,
    },
    state: "executing",
  });
  const restored = new BotThreadStore(store);
  restored.recover();
  expect(restored.pending()).toHaveLength(0);
  expect(restored.action("req")?.state).toBe("unknown");
  expect(restored.get()?.lifecycle).toBe("interrupted");
  expect(restored.latestMessages()).toContainEqual(expect.objectContaining({
    id: `restart-interrupted:${input.wakeupId}`,
    kind: "status", code: "interrupted", wakeupId: input.wakeupId,
  }));
  const revision = restored.get()!.chatRevision;
  restored.recover();
  expect(restored.get()!.chatRevision).toBe(revision);
});
it("compacts partial snapshots while preserving cursors, order and interrupted output", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  const first = assistant.message({
    id: "reply",
    kind: "assistant",
    text: "First",
    streaming: true,
    createdAt: 1,
  });
  const between = assistant.message({
    id: "status",
    kind: "status",
    text: "Other message",
    createdAt: 2,
  });
  const second = assistant.message({
    id: "reply",
    kind: "assistant",
    text: "First partial",
    streaming: true,
  });
  expect(second.createdAt).toBe(1);
  const page = assistant.messages(first.revision, 1);
  expect(page.entries).toEqual([between]);
  expect(page.hasMore).toBe(true);
  expect(assistant.messages(page.nextRevision).entries).toEqual([second]);
  expect(assistant.messages().entries).toHaveLength(2);
  const restored = new BotThreadStore(store);
  restored.recover();
  expect(restored.messages(second.revision).entries).toEqual([
    expect.objectContaining({
      id: "reply",
      text: "First partial",
      createdAt: 1,
      streaming: false,
    }),
  ]);
  expect(restored.messages().entries).toHaveLength(2);
});
it("pages newest message snapshots by stable creation order across revisions and timestamp ties", () => {
  const { assistant } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  const messages = Array.from({ length: 65 }, (_, index) => assistant.message({
    id: `m${String(index).padStart(2, "0")}`,
    kind: "assistant",
    text: `Reply ${index}`,
    createdAt: Math.floor(index / 3) + 1,
    streaming: index === 35,
  }));
  const first = assistant.history();
  expect(first.entries).toEqual(messages.slice(-30));
  expect(first.hasMore).toBe(true);
  expect(first.assistant?.chatRevision).toBe(messages.at(-1)?.revision);
  expect(first.assistant).not.toHaveProperty("brainSessionId");
  // Streaming compaction removes the boundary's old revision. The cursor must
  // still work, and updating an older reply must not move it between pages.
  assistant.message({ id: "m35", kind: "assistant", text: "Boundary updated", streaming: true });
  messages[10] = assistant.message({ id: "m10", kind: "assistant", text: "Older reply updated" });
  assistant.message({ id: "new", kind: "user", text: "New arrival", createdAt: 100 });
  const second = assistant.history(first.nextCursor);
  expect(second.entries).toEqual(messages.slice(5, 35));
  expect(second.hasMore).toBe(true);
  const last = assistant.history(second.nextCursor);
  expect(last.entries).toEqual(messages.slice(0, 5));
  expect(last.hasMore).toBe(false);
  expect(assistant.history(last.nextCursor).entries).toEqual([]);
  expect(assistant.messages(first.assistant!.chatRevision).entries.map((m) => m.id))
    .toEqual(["m35", "m10", "new"]);
});
it("validates history limits and cursors and returns empty history before setup", () => {
  const { assistant } = setup();
  expect(assistant.history()).toMatchObject({ assistant: null, entries: [], hasMore: false });
  for (const limit of [0, 101, 1.5, NaN])
    expect(() => assistant.history(undefined, limit)).toThrow(/cursor or limit/);
  for (const before of [
    { createdAt: -1, id: "one" }, { createdAt: 0.5, id: "one" },
    { createdAt: 1, id: "" }, { createdAt: 1, id: null },
  ])
    expect(() => assistant.history(before as any)).toThrow(/cursor or limit/);
});
it("canonical signatures ignore object key order but preserve content", () => {
  expect(signature({ b: 2, a: { c: 1 } })).toBe(
    signature({ a: { c: 1 }, b: 2 }),
  );
  expect(signature([1, 2])).not.toBe(signature([2, 1]));
});

it("projects only durable public assistant activity and drops resolved input snapshots", () => {
  const { assistant } = setup();
  expect(assistant.notificationActivity()).toBeNull();
  assistant.initialize({ harness: "codex", model: "test" });
  expect(assistant.notificationActivity()?.latest).toBeUndefined();
  assistant.message({ id: "reply", kind: "assistant", text: "Working", streaming: true });
  expect(assistant.notificationActivity()?.latest).toBeUndefined();
  const reply = assistant.message({ id: "reply", kind: "assistant", text: "Finished\n\nDetails", streaming: false });
  expect(assistant.notificationActivity()?.latest).toEqual({ id: "reply", revision: reply.revision, kind: "reply", text: "Finished" });
  const input = { id: "input", kind: "input" as const, text: "Approve?", resolved: false, inputKind: "approval" as const,
    brainGeneration: 1, runId: "run", requestId: 1 };
  assistant.message(input);
  expect(assistant.notificationActivity()?.latest?.kind).toBe("input");
  assistant.message({ ...input, resolved: true });
  assistant.message({ id: "user", kind: "user", text: "Thanks" });
  assistant.message({ id: "status", kind: "status", text: "Internal" });
  assistant.message({ id: "empty", kind: "assistant", text: " \n\t " });
  expect(assistant.notificationActivity()?.latest?.id).toBe("reply");
  expect(assistant.notificationActivity()?.revision).toBe(7);
});
it("recovers an accepted create receipt and one card after a crash before projection", () => {
  const { assistant, store } = setup();
  const config = assistant.initialize({ harness: "codex", model: "test" });
  const project = store.addProject("/tmp/accepted", "Accepted");
  store.save(
    {
      projectId: project.id,
      revision: 1,
      status: "idle",
      updatedAt: 1,
      session: {
        id: "target",
        cwd: project.cwd,
        harness: "codex",
        model: "test",
        title: "New task",
        modelSettings: {},
        runtimeMode: "supervised",
        blocks: [],
      },
    },
    {},
  );
  const receipt = {
    commandId: "assistant:action",
    sessionId: "target",
    revision: 1,
  };
  store.recordReceipt("sig", receipt);
  assistant.putAction({
    id: "action",
    requestId: "create",
    signature: "sig",
    action: "sessions.create",
    input: {},
    rootCauseId: "root",
    origin: {
      kind: "assistant",
      assistantId: config.id,
      actionId: "action",
      wakeupId: "w",
    },
    state: "executing",
  });
  assistant.recover();
  assistant.recover();
  expect(assistant.action("create")).toMatchObject({
    state: "accepted",
    result: receipt,
    targetRef: { sessionId: "target" },
  });
  expect(
    assistant.latestMessages().filter((m) => m.kind === "session-card"),
  ).toHaveLength(1);
  expect(store.sessions()).toHaveLength(1);
});
it("rolls back the Host revision when its source journal cannot be saved", () => {
  const { assistant, store } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  const project = store.addProject("/tmp/source", "Source");
  store.onSessionSave = () =>
    assistant.source({
      eventKey: "source",
      sessionId: "s",
      projectId: project.id,
      kind: "completed",
      rootCauseId: "r",
      createdAt: 1,
    });
  store.db.exec(
    "CREATE TRIGGER fail_source BEFORE INSERT ON bot_sources BEGIN SELECT RAISE(ABORT, 'source failure'); END",
  );
  expect(() =>
    store.save(
      {
        projectId: project.id,
        revision: 1,
        status: "idle",
        updatedAt: 1,
        session: {
          id: "s",
          cwd: project.cwd,
          harness: "codex",
          model: "test",
          title: "Source",
          modelSettings: {},
          runtimeMode: "supervised",
          blocks: [],
        },
      },
      {},
    ),
  ).toThrow(/source failure/);
  expect(store.sessions()).toEqual([]);
  expect(assistant.sources(0)).toEqual([]);
});
it("bounds pending summaries at 100 while retaining the persistent overflow and user priority", () => {
  const { assistant } = setup();
  assistant.initialize({ harness: "codex", model: "test" });
  for (let i = 0; i < 150; i++)
    assistant.enqueue(
      {
        id: `e${i}`,
        kind: "event",
        text: "event",
        rootCauseId: `r${i}`,
        state: "pending",
        createdAt: i,
        attempts: 0,
      },
      `e${i}`,
    );
  const human = assistant.receive("human", "urgent", []);
  expect(assistant.pending()).toHaveLength(100);
  expect(assistant.pending()[0].id).toBe(human.wakeupId);
  expect(assistant.wakeups()).toHaveLength(151);
});
