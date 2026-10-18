import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { BotThreadStore, signature, type BotThreadRecord } from "./thread/store";
import { BotStore, type MigrationPhase } from "./store";
import { botErrorCode } from "./thread/errors";
import { fullBotPolicy, type BotAction } from "../../src/features/bots/model/botView";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bots-store-"));
  const path = join(directory, "host.db"), host = new HostStore(path);
  cleanup.push(() => { host.close(); rmSync(directory, { recursive: true, force: true }); });
  return { host, path, directory };
}
function legacy(host: HostStore) {
  const record: BotThreadRecord = {
    id: "original-assistant", name: "My assistant", revision: 7, chatRevision: 4,
    enabled: true, lifecycle: "idle", harness: "codex", model: "old-model", modelSettings: {},
    runtimeMode: "full-access", targetRuntimeMode: "full-access", policy: fullBotPolicy(), policyVersion: 3,
    triggers: { user: true, event: true, schedule: true }, schedules: [], watches: [],
    maxAutoTurns: 8, chainWindowMinutes: 15, brainGeneration: 3, brainSessionId: "replaceable-provider-cache",
    brainMemory: { generation: 3, revision: 2 }, sourceCursor: 8,
    reminders: [{ id: "keep-reminder", prompt: "remember", dueAt: 1, createdAt: 0, createdBy: "old-wakeup", rootCauseId: "root", state: "pending" }],
    habits: [],
  };
  const message = { id: "original-message", kind: "user", text: "你好", revision: 4, createdAt: 10, readAt: 12, attachments: [{ id: "original-attachment", name: "photo.png" }] };
  const wakeup = { id: "old-wakeup", kind: "user", text: "hello", rootCauseId: "root", state: "pending", createdAt: 1, attempts: 0 };
  const action = { id: "old-action", requestId: "old-request", action: "sessions.create", state: "completed", origin: { assistantId: record.id, wakeupId: "old-wakeup" } };
  host.db.exec(`
    CREATE TABLE assistants (singleton INTEGER PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE assistant_messages (revision INTEGER PRIMARY KEY,id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE assistant_wakeups (id TEXT PRIMARY KEY,dedupe TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE assistant_receipts (id TEXT PRIMARY KEY,signature TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE assistant_actions (request_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE assistant_sources (seq INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE assistant_chains (root TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE assistant_memory (name TEXT PRIMARY KEY,revision INTEGER NOT NULL,text TEXT NOT NULL);
    CREATE TABLE im_test_cursor (binding_id TEXT PRIMARY KEY,cursor TEXT);
    INSERT INTO im_test_cursor VALUES ('original-binding','original-cursor');
  `);
  host.db.prepare("INSERT INTO assistants VALUES (1,?)").run(JSON.stringify(record));
  host.db.prepare("INSERT INTO assistant_messages VALUES (4,?,?)").run(message.id, JSON.stringify(message));
  host.db.prepare("INSERT INTO assistant_wakeups VALUES (?, 'user:old-command', ?)").run(wakeup.id, JSON.stringify(wakeup));
  host.db.prepare("INSERT INTO assistant_receipts VALUES ('old-command',?,?)").run(signature({ text: "hello", attachments: [] }), JSON.stringify({ commandId: "old-command", messageId: message.id }));
  host.db.prepare("INSERT INTO assistant_actions VALUES (?,?)").run(action.requestId, JSON.stringify(action));
  host.db.prepare("INSERT INTO assistant_sources VALUES (9,'event-one',?)").run(JSON.stringify({ eventKey: "event-one", kind: "completed" }));
  host.db.prepare("INSERT INTO assistant_chains VALUES ('root',?)").run(JSON.stringify({ count: 2, paused: true, startedAt: 1 }));
  host.db.exec("INSERT INTO assistant_memory VALUES ('memory',2,'A remembered fact'),('playbook:procedure',3,'# Procedure'),('topic:topic',4,'Topic body')");
  return { record, message, wakeup, action };
}

it("reserves stable compatibility IDs without creating a Bot on an empty Host", () => {
  const { host } = setup(), bots = new BotStore(host), scope = bots.defaultScope();
  expect(new BotStore(host).defaultScope()).toEqual(scope);
  expect(bots.listBots()).toEqual([]);
  expect(new BotThreadStore(host).get()).toBeNull();
  expect(() => new BotThreadStore(host, scope)).toThrow(/does not belong/);
  bots.recordCommandReceipt("create", "request", "sig", { pending: true });
  expect(bots.commandReceipt("create", "request", "sig")).toEqual({ pending: true });
  expect(() => bots.commandReceipt("create", "request", "changed")).toThrow(/different input/);
  const assistant = new BotThreadStore(host);
  expect(assistant.initialize({ harness: "codex", model: "default" }).id).toBe(scope.botId);
  expect(bots.getBot(scope.botId)?.defaultThreadId).toBe(scope.threadId);
});

it("isolates messages, history, receipts, queues, actions, source cursors and recovery by Thread", () => {
  const { host } = setup(), bots = new BotStore(host);
  const one = bots.createBot({ harness: "codex", model: "one" }), two = bots.createBot({ harness: "pi", model: "two" });
  const sibling = bots.createThread(one.botId);
  const stores = [one, sibling, two].map(scope => new BotThreadStore(host, scope));
  for (const [index, store] of stores.entries()) {
    store.message({ id: "shared-id", kind: "assistant", text: `private-${index}`, streaming: index === 0, createdAt: index + 1 });
    store.receive("same-command", `request-${index}`, []);
    store.enqueue({ id: "same-wakeup", kind: "event", text: `event-${index}`, rootCauseId: "same-root", state: "backoff", retryAt: 0, attempts: 0, createdAt: 1 }, "same-dedupe");
    store.putAction({ id: `action-${index}`, requestId: "same-request", action: "sessions.send", state: "executing", origin: { assistantId: store.botId, wakeupId: "same-wakeup" } } as BotAction);
    store.source({ eventKey: "same-event", sessionId: `session-${index}`, projectId: "project", kind: "completed", rootCauseId: "same-root", createdAt: 1 });
    store.writeChain("same-root", { count: index + 1, paused: true, startedAt: 1 });
    store.update({ brainSessionId: `brain-${index}`, sourceCursor: index, lifecycle: "running" });
  }
  stores[0].message({ id: "shared-id", kind: "assistant", text: "private-updated", streaming: false });
  stores[0].recover();
  for (const [index, store] of stores.entries()) {
    expect(store.history(undefined, 100).entries.filter(message => message.kind === "assistant").map(message => message.text)).toEqual([index === 0 ? "private-updated" : `private-${index}`]);
    expect(store.messageById("shared-id")).toMatchObject({ text: index === 0 ? "private-updated" : `private-${index}` });
    expect(store.receive("same-command", `request-${index}`, []).commandId).toBe("same-command");
    expect(store.pending().find(wakeup => wakeup.id === "same-wakeup")?.text).toBe(`event-${index}`);
    expect(store.actions()).toHaveLength(1);
    expect(store.action("same-request")?.state).toBe(index === 0 ? "unknown" : "executing");
    expect(store.sources(0)).toMatchObject([{ seq: 1, sessionId: `session-${index}` }]);
    expect(store.chain("same-root").count).toBe(index + 1);
    expect(store.get()).toMatchObject({ brainSessionId: `brain-${index}`, sourceCursor: index, lifecycle: index === 0 ? "interrupted" : "running" });
  }
  stores[0].discardPendingUserInput();
  expect(stores[1].pending().some(wakeup => wakeup.kind === "user")).toBe(true);
  expect(() => new BotThreadStore(host, { botId: one.botId, threadId: two.threadId })).toThrow(/does not belong/);
  expect(bots.getThread(one.botId, two.threadId)).toBeNull();
  expect(() => bots.updateThread(one.botId, two.threadId, { title: "forged" })).toThrow(/does not belong/);
});

it("uses the first desktop-created Bot as the legacy phone and IM default", () => {
  const { host } = setup(), bots = new BotStore(host), assistant = new BotThreadStore(host);
  const reserved = bots.defaultScope();
  expect(assistant.get()).toBeNull();
  const created = bots.createBot({ name: "First desktop bot", harness: "codex", model: "default" });
  expect(created).toEqual(reserved);
  expect(assistant.get()).toMatchObject({ id: created.botId, name: "First desktop bot" });
  const second = bots.createBot({ harness: "codex", model: "second" });
  expect(second.botId).not.toBe(created.botId);
  expect(bots.defaultScope()).toEqual(created);
});

it("shares Bot memory and configuration while preserving Thread model overrides and runtime", () => {
  const { host } = setup(), bots = new BotStore(host);
  const main = bots.createBot({ harness: "codex", model: "default", modelSettings: { effort: "high" } });
  const scope = bots.createThread(main.botId, { modelOverride: { harness: "pi", model: "thread-model", modelSettings: { effort: "low" } } });
  const first = new BotThreadStore(host, main), second = new BotThreadStore(host, scope);
  const other = new BotThreadStore(host, bots.createBot({ harness: "codex", model: "other" }));
  first.writeMemoryDoc("topic:shared", "shared-note");
  second.writeMemoryDoc("playbook:shared", "procedure");
  expect(second.memoryDoc("topic:shared")).toEqual({ text: "shared-note", revision: 1 });
  expect(first.playbookRevision()).toBe(1);
  expect(other.memoryDoc("topic:shared")).toEqual({ text: "", revision: 0 });
  expect(() => second.writeMemoryDoc("topic:shared", "stale", 0)).toThrow(/changed elsewhere/);
  second.message({ id: "reply", kind: "assistant", text: "reply" });
  second.write({ ...second.get()!, brainGeneration: 8 });
  second.update({ name: "Shared name" }, true);
  expect(first.get()).toMatchObject({ name: "Shared name", harness: "codex", model: "default", modelSettings: { effort: "high" }, brainGeneration: 1, chatRevision: 0 });
  expect(second.get()).toMatchObject({ harness: "pi", model: "thread-model", brainGeneration: 8, chatRevision: 1 });
  expect(bots.getBot(main.botId)).toMatchObject({ harness: "codex", model: "default" });
  bots.updateThread(main.botId, main.threadId, { modelOverride: { harness: "pi", model: "override-default-thread" } });
  expect(first.get()?.modelSettings).toEqual({});
  expect(bots.getBot(main.botId)).toMatchObject({ harness: "codex", model: "default" });
  expect(bots.getBot(main.botId)).not.toHaveProperty("createdSessionWatchesMigrated");
  bots.updateThread(scope.botId, scope.threadId, { modelOverride: null });
  expect(second.get()).toMatchObject({ harness: "codex", model: "default" });
  const stale = second.get()!;
  first.update({ name: "Fresh configuration" }, true);
  second.write(stale);
  expect(first.get()?.name).toBe("Fresh configuration");
});

it("shares trusted session creation ownership within a Bot without exposing other Thread actions", () => {
  const { host } = setup(), bots = new BotStore(host);
  const scope = bots.createBot({ harness: "codex", model: "default" });
  const first = new BotThreadStore(host, scope), sibling = new BotThreadStore(host, bots.createThread(scope.botId));
  const other = new BotThreadStore(host, bots.createBot({ harness: "codex", model: "other" }));
  first.putAction({ id: "created", requestId: "created", action: "sessions.create", state: "accepted", origin: { assistantId: scope.botId }, targetRef: { sessionId: "shared-session" } } as BotAction);
  expect(sibling.createdSession("shared-session")).toBe(true);
  expect(sibling.actions()).toEqual([]);
  expect(other.createdSession("shared-session")).toBe(false);
});

it("checks metadata revisions and archive/restore without losing runtime or user titles", () => {
  const { host } = setup(), bots = new BotStore(host), scope = bots.createBot({ harness: "codex", model: "default" });
  const thread = bots.getThread(scope.botId, scope.threadId)!;
  bots.updateThread(scope.botId, scope.threadId, { title: "User title", archivedAt: 123 }, thread.revision);
  expect(bots.listThreads(scope.botId)).toEqual([]);
  expect(bots.listThreads(scope.botId, true)[0]).toMatchObject({ title: "User title", archivedAt: 123 });
  try { bots.updateThread(scope.botId, scope.threadId, { title: "stale" }, thread.revision); expect.fail("stale Thread update must fail"); }
  catch (error) { expect(botErrorCode(error)).toBe("conflict"); }
  bots.updateThread(scope.botId, scope.threadId, { archivedAt: undefined });
  expect(bots.listThreads(scope.botId)[0].title).toBe("User title");
  const bot = bots.getBot(scope.botId)!;
  bots.updateBot(scope.botId, { archivedAt: 123 }, bot.revision);
  expect(bots.listBots()).toEqual([]);
  try { bots.updateBot(scope.botId, { name: "stale" }, bot.revision); expect.fail("stale Bot update must fail"); }
  catch (error) { expect(botErrorCode(error)).toBe("conflict"); }
  bots.updateBot(scope.botId, { archivedAt: undefined });
  expect(bots.listBots()).toHaveLength(1);
});

it("migrates legacy IDs and data once, preserving an independent backup and freezing the old tables", () => {
  const { host, path, directory } = setup(), old = legacy(host), bots = new BotStore(host);
  const scope = bots.defaultScope(), assistant = new BotThreadStore(host);
  expect(scope.botId).toBe(old.record.id);
  expect(scope.threadId).not.toBe(old.record.brainSessionId);
  expect(assistant.get()).toMatchObject(old.record);
  expect(assistant.messageById(old.message.id)).toEqual(old.message);
  expect(assistant.wakeup(old.wakeup.id)).toMatchObject(old.wakeup);
  expect(assistant.action(old.action.requestId)).toEqual(old.action);
  expect(assistant.receive("old-command", "hello", [])).toEqual({ commandId: "old-command", messageId: old.message.id });
  expect(assistant.sources(8)).toMatchObject([{ seq: 9, eventKey: "event-one" }]);
  expect(assistant.chain("root")).toEqual({ count: 2, paused: true, startedAt: 1 });
  expect(assistant.memoryDoc("memory")).toEqual({ text: "A remembered fact", revision: 2 });
  expect(assistant.memoryDoc("playbook:procedure").revision).toBe(3);
  expect(host.db.prepare("SELECT cursor FROM im_test_cursor").get()?.cursor).toBe("original-cursor");
  expect(existsSync(`${path}.pre-bots-v1.sqlite`)).toBe(true);
  expect(JSON.parse(readFileSync(join(directory, "bots/migration-v1.json"), "utf8")).scope).toEqual(scope);
  const backup = new DatabaseSync(`${path}.pre-bots-v1.sqlite`, { readOnly: true });
  try { expect(JSON.parse(String(backup.prepare("SELECT payload FROM assistants").get()!.payload))).toEqual(old.record); }
  finally { backup.close(); }
  for (const sql of ["DELETE FROM assistant_messages", "UPDATE assistants SET payload='{}'", "INSERT INTO assistant_memory VALUES ('new',1,'blocked')"])
    expect(() => host.db.exec(sql)).toThrow(/read-only/);
  assistant.receive("new-command", "new message", []);
  expect(host.db.prepare("SELECT COUNT(*) AS count FROM assistant_messages").get()?.count).toBe(1);
  expect(new BotStore(host).defaultScope()).toEqual(scope);
  expect(new BotThreadStore(host).latestMessages()).toHaveLength(2);
});

it.each<MigrationPhase>(["backup", "prepared", "copied", "complete"])("resumes safely after the %s migration checkpoint", phase => {
  const { host } = setup(), old = legacy(host);
  expect(() => new BotStore(host, { onMigrationPhase: current => { if (current === phase) throw new Error("simulated interruption"); } })).toThrow(/interruption/);
  const firstScope = JSON.parse(String(host.db.prepare("SELECT value FROM bot_metadata WHERE key='defaultScope'").get()!.value));
  const resumed = new BotStore(host);
  expect(resumed.defaultScope()).toEqual(firstScope);
  expect(resumed.listBots()).toHaveLength(1);
  expect(resumed.listThreads(firstScope.botId)).toHaveLength(1);
  expect(new BotThreadStore(host).messageById(old.message.id)).toEqual(old.message);
});

it("rolls back a failed copy transaction and retries from the prepared checkpoint", () => {
  const { host } = setup(), old = legacy(host);
  expect(() => new BotStore(host, { onMigrationPhase: phase => {
    if (phase === "prepared") host.db.exec("CREATE TRIGGER fail_copy BEFORE INSERT ON bot_messages BEGIN SELECT RAISE(ABORT,'copy failed'); END");
  } })).toThrow(/copy failed/);
  expect(host.db.prepare("SELECT COUNT(*) AS count FROM bots").get()?.count).toBe(0);
  expect(host.db.prepare("SELECT value FROM bot_metadata WHERE key='migration'").get()?.value).toBe("prepared");
  host.db.exec("DROP TRIGGER fail_copy");
  new BotStore(host);
  expect(new BotThreadStore(host).messageById(old.message.id)).toEqual(old.message);
});

it("preserves a legacy Bot pause independently from later Thread runtime updates", () => {
  const { host } = setup(), old = legacy(host);
  host.db.prepare("UPDATE assistants SET payload=?").run(JSON.stringify({ ...old.record, lifecycle: "paused" }));
  const bots = new BotStore(host), scope = bots.defaultScope();
  const sibling = new BotThreadStore(host, bots.createThread(scope.botId));
  expect(bots.getBot(scope.botId)?.paused).toBe(true);
  expect(sibling.view()?.lifecycle).toBe("paused");
  expect(bots.getThread(sibling.botId, sibling.threadId)?.lifecycle).toBe("paused");
  sibling.update({ lifecycle: "running" });
  expect(bots.getBot(scope.botId)?.paused).toBe(true);
  expect(new BotThreadStore(host).get()?.lifecycle).toBe("paused");
  bots.updateBot(scope.botId, { enabled: false });
  expect(sibling.view()?.lifecycle).toBe("disabled");
  expect(bots.getThread(sibling.botId, sibling.threadId)?.lifecycle).toBe("disabled");
  expect(sibling.get()?.lifecycle).toBe("running");
});

it("persists run attempts with scoped lookup, stable history cursors and independent interruption", () => {
  const { host } = setup(), bots = new BotStore(host);
  const first = bots.createBot({ harness: "codex", model: "test" }), sibling = bots.createThread(first.botId);
  const one = bots.queuedRun(first, { id: "shared-wakeup", attempts: 0, createdAt: 10 });
  expect(bots.queuedRun(first, { id: "shared-wakeup", attempts: 0, createdAt: 10 }).id).toBe(one.id);
  const two = bots.queuedRun(sibling, { id: "shared-wakeup", attempts: 0, createdAt: 10 });
  expect(two.id).not.toBe(one.id);
  expect(bots.run(sibling, one.id)).toBeUndefined();
  expect(() => bots.updateRun(sibling, one.id, { status: "completed" })).toThrow(/does not belong/);
  bots.updateRun(first, one.id, { status: "waiting_approval", startedAt: 11 });
  bots.updateRun(sibling, two.id, { status: "running", startedAt: 11 });
  bots.interruptRuns(first);
  expect(bots.run(first, one.id)).toMatchObject({ status: "interrupted", endedAt: expect.any(Number) });
  expect(bots.run(sibling, two.id)?.status).toBe("running");
  const retry = bots.queuedRun(first, { id: "shared-wakeup", attempts: 1, createdAt: 12 });
  const page = bots.runs(first, 1);
  expect(page).toMatchObject({ hasMore: true, runs: [{ id: retry.id, attempt: 2 }] });
  expect(bots.runs(first, 1, page.next).runs.map(run => run.id)).toEqual([one.id]);
  expect(() => bots.runs(first, 0)).toThrow(/limit/);
});
