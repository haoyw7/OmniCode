import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { BotThreadStore } from "./thread/store";
import { BotStore } from "./store";
import type { BotMemoryDocument } from "../../src/features/bots/model/botMemory";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
const expected = (doc: BotMemoryDocument) => ({ expectedRevision: doc.revision, expectedHash: doc.hash });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bot-memory-")), host = new HostStore(join(directory, "host.db"));
  const bots = new BotStore(host), scope = bots.createBot({ harness: "codex", model: "test" });
  const assistant = new BotThreadStore(host, scope);
  cleanups.push(() => { host.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, host, bots, scope, assistant, memory: assistant.memory };
}

it("migrates SQL documents, playbooks and diaries without overwriting external Markdown", () => {
  const { host, assistant, memory, scope } = setup();
  host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?)").run(scope.botId, "memory", 7, "old resident");
  host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?)").run(scope.botId, "topic:project", 4, "old project note");
  host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?)").run(scope.botId, "playbook:procedure", 3, "# Procedure");
  const diary = "- 2026-10-08 · 2026-10-07: previous conversation\n- 2026-10-09 · 2026-10-08: another conversation\n";
  host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?)").run(scope.botId, "topic:chat-days", 2, diary);
  writeFileSync(join(memory.workspace, "MEMORY.md"), "external resident");
  const list = memory.list();
  expect(memory.read("MEMORY.md")).toMatchObject({ text: "external resident", revision: 7 });
  expect(memory.read("SOUL.md").text).toBe("");
  expect(assistant.memoryDoc("topic:project")).toEqual({ text: "old project note", revision: 4 });
  expect(assistant.playbooks()[0].name).toBe("procedure");
  expect(assistant.memoryDoc("topic:chat-days").text).toBe(diary);
  expect(list.files.filter(file => file.kind === "log").map(file => file.path)).toEqual(["memory/log/2026-10-07.md", "memory/log/2026-10-08.md"]);
  expect(memory.loadContext().topics).toEqual(["project"]);
  expect(assistant.memoryTopics()).not.toContain("chat-days");
  host.db.prepare("UPDATE bot_memory SET text='stale SQL' WHERE bot_id=? AND name='memory'").run(scope.botId);
  expect(memory.read("MEMORY.md").text).toBe("external resident");
  expect(JSON.parse(readFileSync(join(memory.directory, "memory-sql-backup.json"), "utf8")).documents).toContainEqual({ name: "memory", revision: 7, text: "old resident" });
});

it("preserves unsafe historical names and case-colliding topics through durable aliases", () => {
  const { directory, host, assistant, memory, scope } = setup();
  const names = ["CON", "foo.", "foo.md", "Foo", "foo", "CHAT-DAYS", "_old"];
  for (const name of names) host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?)").run(scope.botId, `topic:${name}`, 3, `body for ${name}`);
  memory.list();
  for (const name of names) expect(assistant.memoryDoc(`topic:${name}`)).toMatchObject({ text: `body for ${name}`, revision: 3 });
  expect(assistant.memoryDoc("topic:chat-days").text).toBe("");
  expect(memory.loadContext().topics).toEqual(expect.arrayContaining(names));
  const aliases = JSON.parse(readFileSync(join(memory.directory, "memory-aliases.json"), "utf8"));
  expect(aliases["topic:Foo"]).not.toBe(aliases["topic:foo"]);
  expect(Object.values(aliases)).toHaveLength(6);
  host.db.prepare("DELETE FROM bot_memory_files WHERE bot_id=?").run(scope.botId);
  host.db.prepare("DELETE FROM bot_memory WHERE bot_id=?").run(scope.botId);
  memory.rebuildIndex();
  const reopened = new HostStore(join(directory, "host.db"));
  try {
    const restored = new BotThreadStore(reopened, scope);
    for (const name of names) expect(restored.memoryDoc(`topic:${name}`).text).toBe(`body for ${name}`);
  } finally { reopened.close(); }
});

it("enforces revision and hash CAS across sibling Threads, isolates Bots and redacts saved credentials", () => {
  const { host, bots, scope, memory } = setup();
  const sibling = new BotThreadStore(host, bots.createThread(scope.botId));
  const other = new BotThreadStore(host, bots.createBot({ harness: "codex", model: "other" }));
  expect(sibling.memory).toBe(memory);
  const original = memory.read("memory/项目.md");
  const saved = memory.save(original.path, "remember this token=unsafe-value", expected(original));
  expect(saved.text).toContain("redacted");
  expect(readFileSync(join(memory.workspace, saved.path), "utf8")).toBe(saved.text);
  expect(() => sibling.memory.save(original.path, "stale edit", expected(original))).toThrow(/changed elsewhere/);
  expect(() => memory.save(original.path, "forged hash", { expectedRevision: saved.revision, expectedHash: "wrong" })).toThrow(/changed elsewhere/);
  expect(other.memory.read(original.path).text).toBe("");
});

it("loads exactly 200 lines or 24 KiB without splitting Unicode or changing the authoritative file", () => {
  const { memory } = setup();
  const save = (text: string) => memory.save("MEMORY.md", text, expected(memory.read("MEMORY.md")));
  const atLimit = "中".repeat(8192);
  save(atLimit);
  expect(memory.loadContext()).toMatchObject({ text: atLimit, budget: { loadedBytes: 24576, truncated: false } });
  save(`${atLimit}界`);
  expect(memory.loadContext()).toMatchObject({ text: atLimit, budget: { loadedBytes: 24576, loadedLines: 1, truncated: true } });
  expect(memory.read("MEMORY.md").text).toBe(`${atLimit}界`);
  save("😀\n".repeat(201));
  expect(memory.loadContext()).toMatchObject({ text: "😀\n".repeat(200), budget: { loadedLines: 200, lines: 201, truncated: true } });
  expect(memory.loadContext().text).not.toContain("�");
});

it("synchronizes external modifications/deletion and can undo both with current CAS", () => {
  const { memory } = setup(), path = "memory/note.md";
  const first = memory.save(path, "first", expected(memory.read(path)));
  writeFileSync(join(memory.workspace, path), "outside edit");
  const external = memory.read(path);
  expect(external.revision).toBe(first.revision + 1);
  const change = memory.log(path)[0];
  expect(change).toMatchObject({ source: "external", beforeHash: first.hash, afterHash: external.hash });
  expect(() => memory.undo(change.id, expected(first))).toThrow(/changed elsewhere/);
  const undone = memory.undo(change.id, expected(external));
  expect(undone.text).toBe("first");
  const beforeDeleteRevision = memory.list().revision;
  rmSync(join(memory.workspace, path));
  const deleted = memory.read(path), deletion = memory.log(path)[0];
  expect(deleted.text).toBe("");
  expect(memory.list().revision).toBeGreaterThan(beforeDeleteRevision);
  expect(memory.undo(deletion.id, expected(deleted)).text).toBe("first");
  const created = memory.log(path).find(change => change.source === "user")!;
  memory.undo(created.id, expected(memory.read(path)));
  expect(existsSync(join(memory.workspace, path))).toBe(false);
});

it("keeps staged writes private until the outer transaction commits and rolls back callback failures", () => {
  const { host, memory } = setup(), before = memory.read("MEMORY.md");
  expect(() => host.transaction(() => {
    memory.save("MEMORY.md", "staged", expected(before));
    expect(memory.read("MEMORY.md").text).toBe("staged");
    expect(readFileSync(join(memory.workspace, "MEMORY.md"), "utf8")).toBe("");
    throw new Error("outer operation failed");
  })).toThrow(/outer operation failed/);
  expect(memory.read("MEMORY.md")).toMatchObject({ text: "", revision: before.revision });
  expect(memory.log("MEMORY.md").filter(change => change.source === "user")).toEqual([]);
});

it("restores multiple replaced files when the real SQLite COMMIT fails", () => {
  const { host, memory } = setup();
  const resident = memory.read("MEMORY.md"), topic = memory.read("memory/transaction.md");
  host.db.exec("CREATE TABLE memory_test_parent (id INTEGER PRIMARY KEY); CREATE TABLE memory_test_child (id INTEGER REFERENCES memory_test_parent(id) DEFERRABLE INITIALLY DEFERRED)");
  expect(() => host.transaction(() => {
    memory.save(resident.path, "uncommitted resident", expected(resident));
    memory.save(topic.path, "uncommitted topic", expected(topic));
    host.db.exec("INSERT INTO memory_test_child VALUES (123)");
  })).toThrow(/FOREIGN KEY/);
  expect(readFileSync(join(memory.workspace, "MEMORY.md"), "utf8")).toBe("");
  expect(existsSync(join(memory.workspace, topic.path))).toBe(false);
  expect(memory.read(resident.path).revision).toBe(resident.revision);
  expect(readdirSync(join(memory.directory, "memory-journal"))).toEqual([]);
});

it("detects an external edit between stage and commit without overwriting it", () => {
  const { host, memory } = setup(), before = memory.read("MEMORY.md");
  expect(() => host.transaction(() => {
    memory.save(before.path, "pending", expected(before));
    writeFileSync(join(memory.workspace, before.path), "external winner");
  })).toThrow(/changed elsewhere/);
  expect(memory.read(before.path).text).toBe("external winner");
});

it.each([true, false])("recovers a durable file journal with committed=%s", committed => {
  const { host, memory, scope } = setup();
  const first = memory.read("MEMORY.md"), saved = memory.save(first.path, "new content", expected(first));
  const history = join(memory.directory, "memory-history");
  const journalFile = readdirSync(history).find(file => {
    const journal = JSON.parse(readFileSync(join(history, file), "utf8"));
    return journal.operations.some((operation: { after: { text: string } }) => operation.after.text === "new content");
  })!;
  const journal = JSON.parse(readFileSync(join(history, journalFile), "utf8"));
  renameSync(join(history, journalFile), join(memory.directory, "memory-journal", journalFile));
  if (committed) writeFileSync(join(memory.workspace, first.path), first.text);
  else {
    host.db.prepare("DELETE FROM bot_memory_commits WHERE id=?").run(journal.id);
    host.db.prepare("UPDATE bot_memory_files SET revision=?,hash=?,text=?,bytes=0 WHERE bot_id=? AND path=?").run(first.revision, first.hash, first.text, scope.botId, first.path);
    host.db.prepare("DELETE FROM bot_memory_changes WHERE id=?").run(journal.operations[0].change.id);
  }
  expect(memory.read(first.path).text).toBe(committed ? saved.text : first.text);
  expect(readdirSync(join(memory.directory, "memory-journal"))).toEqual([]);
});

it("rebuilds missing SQL indexes from Markdown and audit history while keeping revisions", () => {
  const { host, scope, memory } = setup(), path = "memory/remember.md";
  const saved = memory.save(path, "authoritative file", expected(memory.read(path)));
  host.db.prepare("DELETE FROM bot_memory_files WHERE bot_id=?").run(scope.botId);
  host.db.prepare("DELETE FROM bot_memory WHERE bot_id=?").run(scope.botId);
  host.db.prepare("DELETE FROM bot_memory_changes WHERE bot_id=?").run(scope.botId);
  memory.rebuildIndex();
  expect(memory.read(path)).toMatchObject({ text: saved.text, revision: saved.revision, hash: saved.hash });
  expect(memory.log(path)).toHaveLength(1);
});

it("rejects traversal, symbolic links, invalid UTF-8 and oversized files without crossing Bot paths", () => {
  const { directory, memory } = setup();
  memory.list();
  for (const path of ["../MEMORY.md", "memory/../../secret.md", "memory\\secret.md", "/etc/passwd", "memory/archive/secret.md", "memory/Archive.md"])
    expect(() => memory.read(path)).toThrow(/Invalid memory/);
  writeFileSync(join(directory, "private.md"), "private text");
  symlinkSync(join(directory, "private.md"), join(memory.workspace, "memory/link.md"));
  expect(() => memory.read("memory/link.md")).toThrow(/symbolic links/);
  rmSync(join(memory.workspace, "memory/link.md"));
  writeFileSync(join(memory.workspace, "memory/broken.md"), Buffer.from([0xff, 0xfe]));
  expect(() => memory.read("memory/broken.md")).toThrow();
  rmSync(join(memory.workspace, "memory/broken.md"));
  writeFileSync(join(memory.workspace, "memory/large.md"), Buffer.alloc(1024 * 1024 + 1));
  expect(() => memory.read("memory/large.md")).toThrow(/1 MiB/);
  expect(readFileSync(join(directory, "private.md"), "utf8")).toBe("private text");
});

it("bounds the topic context index while keeping all topic files available to explicit reads and recall", () => {
  const { memory } = setup();
  memory.list();
  for (let index = 0; index < 105; index++) writeFileSync(join(memory.workspace, `memory/topic-${String(index).padStart(3, "0")}.md`), `topic ${index}`);
  expect(memory.loadContext()).toMatchObject({ topicsTruncated: true });
  expect(memory.loadContext().topics).toHaveLength(100);
  expect(memory.topicDocuments()).toHaveLength(105);
  expect(memory.list().files.filter(file => file.kind === "topic")).toHaveLength(105);
});
