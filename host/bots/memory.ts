import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { HostStore } from "../store";
import type { BotMemoryBudget, BotMemoryChange, BotMemoryContext, BotMemoryDocument, BotMemoryExpected, BotMemoryFile, BotMemoryKind, BotMemoryList } from "../../src/features/bots/model/botMemory";
import { MEMORY_MAX_BYTES, MEMORY_MAX_LINES, redactSecrets, validMemoryName } from "./thread/memory";

const FILE_LIMIT = 1024 * 1024;
const FILE_COUNT_LIMIT = 2000;
const TOPIC_LIMIT = 100;
const TOPIC_INDEX_CHARS = 8000;
const services = new WeakMap<HostStore, Map<string, FileMemoryService>>();
const temporaryRoots = new WeakMap<HostStore, string>();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type Snapshot = { text: string; hash: string; present: boolean; bytes: number };
type Indexed = Snapshot & { path: string; revision: number; updatedAt: number };
type Operation = { path: string; before: Snapshot; after: Snapshot; apply: boolean; change: BotMemoryChange };
type Journal = { version: 1; botId: string; id: string; operations: Operation[] };
type Pending = { id: string; operations: Map<string, Operation>; journalWritten: boolean };

function snapshot(text: string, present = true): Snapshot {
  return { text, hash: digest(text), present, bytes: Buffer.byteLength(text, "utf8") };
}
function conflict(): Error {
  return Object.assign(new Error("Memory changed elsewhere. Reload before saving."), { code: "MEMORY_CONFLICT" });
}
function kind(path: string): BotMemoryKind {
  if (path === "SOUL.md") return "soul";
  if (path === "MEMORY.md") return "resident";
  if (path === "memory/archive.md") return "archive";
  if (/^memory\/log\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return "log";
  const match = /^(memory|playbooks)\/([^/]+)\.md$/.exec(path);
  if (!match || !validMemoryName(match[2]) || /\.md$/i.test(match[2]) || (match[1] === "memory" && ["chat-days", "archive"].includes(match[2].toLowerCase())))
    throw new Error("Invalid memory file path");
  return match[1] === "playbooks" ? "playbook" : "topic";
}
function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function same(a: Snapshot, b: Snapshot): boolean { return a.hash === b.hash && a.present === b.present; }
function resident(text: string): { text: string; budget: BotMemoryBudget } {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [], kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line);
    if (kept.length >= MEMORY_MAX_LINES) break;
    if (bytes + size <= MEMORY_MAX_BYTES) { kept.push(line); bytes += size; continue; }
    let prefix = "";
    for (const point of line) {
      const size = Buffer.byteLength(point);
      if (bytes + size > MEMORY_MAX_BYTES) break;
      prefix += point; bytes += size;
    }
    if (prefix) kept.push(prefix);
    break;
  }
  return { text: kept.join(""), budget: { maxLines: MEMORY_MAX_LINES, maxBytes: MEMORY_MAX_BYTES,
    lines: lines.length, bytes: Buffer.byteLength(text), loadedLines: kept.length, loadedBytes: bytes, truncated: kept.join("").length < text.length } };
}
function diaryParts(text: string): Map<string, string> {
  const parts = new Map<string, string[]>();
  let day = "1970-01-01";
  for (const line of text.split(/(?<=\n)/)) {
    if (!line) continue;
    day = line.match(/ · (\d{4}-\d{2}-\d{2}):/)?.[1] ?? line.match(/^- (?:~~)?(\d{4}-\d{2}-\d{2}) · /)?.[1] ?? day;
    const path = `memory/log/${day}.md`;
    parts.set(path, [...(parts.get(path) ?? []), line]);
  }
  return new Map([...parts].map(([path, lines]) => [path, lines.join("")]));
}

/** Markdown is authoritative; SQLite contains revisions and rebuildable search projections. */
export class FileMemoryService {
  static forBot(host: HostStore, botId: string): FileMemoryService {
    let cached = services.get(host);
    if (!cached) services.set(host, cached = new Map());
    let service = cached.get(botId);
    if (!service) { service = new FileMemoryService(host, botId); cached.set(botId, service); }
    return service;
  }
  readonly workspace: string;
  readonly directory: string;
  private pending?: Pending;
  private recovering = false;
  private aliases?: Record<string, string>;

  private constructor(readonly host: HostStore, readonly botId: string) {
    if (!host.db.prepare("SELECT 1 FROM bots WHERE id=?").get(botId)) throw new Error("Bot does not exist");
    if (!botId || botId === "." || botId === "..") throw new Error("Invalid Bot identity");
    let root: string;
    if (host.databasePath === ":memory:") {
      root = temporaryRoots.get(host) ?? mkdtempSync(join(tmpdir(), "monocode-memory-"));
      temporaryRoots.set(host, root);
    } else root = realpathSync(dirname(host.databasePath));
    this.directory = join(root, "bots", encodeURIComponent(botId));
    this.workspace = join(this.directory, "workspace");
    this.safeDirectory(root, ["bots", encodeURIComponent(botId), "workspace"]);
    this.safeDirectory(this.directory, ["memory-journal"]);
    this.safeDirectory(this.directory, ["memory-history"]);
  }

  private safeDirectory(root: string, parts: string[]): string {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Memory directories must not be symbolic links");
    let path = root;
    for (const part of parts) {
      path = join(path, part);
      try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory directories must not be symbolic links");
    }
    return path;
  }
  private absolute(path: string, createParents = false): string {
    kind(path);
    const parts = path.split("/"), parents = parts.slice(0, -1);
    if (lstatSync(dirname(this.directory)).isSymbolicLink() || lstatSync(this.directory).isSymbolicLink() || lstatSync(this.workspace).isSymbolicLink())
      throw new Error("Memory directories must not be symbolic links");
    if (createParents) this.safeDirectory(this.workspace, parents);
    else {
      let current = this.workspace;
      for (const part of parents) {
        current = join(current, part);
        try {
          const stat = lstatSync(current);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Memory directories must not be symbolic links");
        } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
      }
    }
    const absolute = resolve(this.workspace, ...parts);
    if (!absolute.startsWith(`${this.workspace}${sep}`)) throw new Error("Invalid memory file path");
    return absolute;
  }
  private disk(path: string): Snapshot {
    const absolute = this.absolute(path);
    let before;
    try { before = lstatSync(absolute); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return snapshot("", false); throw error; }
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("Memory files must be regular files, not symbolic links");
    if (before.size > FILE_LIMIT) throw new Error("Memory file exceeds the 1 MiB limit");
    const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const actual = fstatSync(descriptor);
      if (actual.ino !== before.ino || actual.dev !== before.dev || actual.size > FILE_LIMIT) throw conflict();
      const bytes = readFileSync(descriptor);
      if (bytes.byteLength > FILE_LIMIT) throw new Error("Memory file exceeds the 1 MiB limit");
      return snapshot(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally { closeSync(descriptor); }
  }
  private atomic(path: string, value: Snapshot): void {
    const absolute = this.absolute(path, true);
    this.disk(path); // Reject a symlink instead of replacing it silently.
    if (!value.present) { rmSync(absolute, { force: true }); syncDirectory(dirname(absolute)); return; }
    const temporary = `${absolute}.pending-${randomUUID()}`;
    try {
      const descriptor = openSync(temporary, "wx", 0o600);
      try { writeFileSync(descriptor, value.text, "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      this.absolute(path);
      renameSync(temporary, absolute);
      syncDirectory(dirname(absolute));
    } finally { rmSync(temporary, { force: true }); }
  }
  private journalPath(id: string, history = false): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid memory journal identity");
    const directory = this.safeDirectory(this.directory, [history ? "memory-history" : "memory-journal"]);
    return join(directory, `${id}.json`);
  }
  private writeJournal(journal: Journal): void {
    const path = this.journalPath(journal.id), temporary = `${path}.pending`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(journal), "utf8"); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  }
  private readJournal(path: string): Journal {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid memory journal");
    const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
    if (journal.version !== 1 || journal.botId !== this.botId || !Array.isArray(journal.operations)) throw new Error("Invalid memory journal");
    for (const operation of journal.operations) {
      kind(operation.path);
      for (const value of [operation.before, operation.after])
        if (typeof value.text !== "string" || digest(value.text) !== value.hash || typeof value.present !== "boolean") throw new Error("Invalid memory journal content");
    }
    return journal;
  }
  private metadataFile(name: "memory-aliases.json" | "memory-sql-backup.json"): string {
    this.safeDirectory(dirname(this.directory), [this.directory.slice(dirname(this.directory).length + 1)]);
    const path = join(this.directory, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Memory metadata must not be a symbolic link");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return path;
  }
  private saveMetadata(name: "memory-aliases.json" | "memory-sql-backup.json", value: unknown): void {
    const path = this.metadataFile(name), temporary = `${path}.${randomUUID()}.pending`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(value), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    this.metadataFile(name);
    renameSync(temporary, path);
    syncDirectory(this.directory);
  }
  private aliasMap(): Record<string, string> {
    const path = this.metadataFile("memory-aliases.json");
    if (this.aliases) return this.aliases;
    let aliases: Record<string, string>;
    try { aliases = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; aliases = {}; }
    if (!aliases || Array.isArray(aliases) || typeof aliases !== "object" || Object.keys(aliases).length > FILE_COUNT_LIMIT) throw new Error("Invalid memory aliases");
    for (const [name, target] of Object.entries(aliases)) {
      if (!/^(topic|playbook):/.test(name) || typeof target !== "string") throw new Error("Invalid memory alias");
      const directory = name.startsWith("topic:") ? "memory" : "playbooks";
      if (!new RegExp(`^${directory}/legacy-${digest(name)}(?:-[0-9]{1,4})?\\.md$`).test(target)) throw new Error("Invalid memory alias");
      kind(target);
    }
    this.aliases = aliases;
    return aliases;
  }
  private encodedPath(name: string): string {
    const aliases = this.aliasMap();
    if (aliases[name]) return aliases[name];
    if (Object.keys(aliases).length >= FILE_COUNT_LIMIT) throw new Error("Too many legacy memory aliases");
    const directory = name.startsWith("topic:") ? "memory" : "playbooks";
    let candidate: string;
    for (let suffix = 0;; suffix++) {
      if (suffix > 9999) throw new Error("Could not allocate a unique legacy memory path");
      candidate = `${directory}/legacy-${digest(name)}${suffix ? `-${suffix}` : ""}.md`;
      const defaultName = `${directory === "memory" ? "topic:" : "playbook:"}${candidate.slice(directory.length + 1, -3)}`;
      if (!Object.values(aliases).some(path => path.toLowerCase() === candidate.toLowerCase()) && !this.disk(candidate).present &&
          !this.host.db.prepare("SELECT 1 FROM bot_memory WHERE bot_id=? AND name=?").get(this.botId, defaultName)) break;
    }
    const next = { ...aliases, [name]: candidate };
    // This mapping precedes content writes and survives a SQL rollback; retries
    // choose the same safe filename. It is not a rebuildable SQL-only alias.
    this.saveMetadata("memory-aliases.json", next);
    this.aliases = next;
    return candidate;
  }
  private settle(journal: Journal, committed: boolean): void {
    for (const operation of committed ? journal.operations : [...journal.operations].reverse()) {
      if (!operation.apply) continue;
      const current = this.disk(operation.path), expected = committed ? operation.after : operation.before;
      if (same(current, expected)) continue;
      const alternate = committed ? operation.before : operation.after;
      // A newer external edit always wins. Never erase it during recovery.
      if (same(current, alternate)) this.atomic(operation.path, expected);
    }
    const path = this.journalPath(journal.id);
    if (committed) {
      renameSync(path, this.journalPath(journal.id, true));
      syncDirectory(join(this.directory, "memory-history"));
    } else rmSync(path, { force: true });
    syncDirectory(dirname(path));
  }
  private recover(): void {
    if (this.pending || this.recovering) return;
    this.recovering = true;
    try {
      const directory = this.safeDirectory(this.directory, ["memory-journal"]);
      for (const entry of readdirSync(directory)) {
        if (!entry.endsWith(".json")) continue;
        const journal = this.readJournal(join(directory, entry));
        const committed = !!this.host.db.prepare("SELECT 1 FROM bot_memory_commits WHERE id=? AND bot_id=?").get(journal.id, this.botId);
        this.settle(journal, committed);
      }
    } finally { this.recovering = false; }
  }
  private transaction(): Pending {
    if (this.pending) return this.pending;
    const pending: Pending = { id: randomUUID(), operations: new Map(), journalWritten: false };
    this.pending = pending;
    this.host.db.prepare("INSERT INTO bot_memory_commits VALUES (?,?)").run(pending.id, this.botId);
    this.host.participateInTransaction({
      beforeCommit: () => {
        const operations = [...pending.operations.values()];
        for (const operation of operations)
          if (!same(this.disk(operation.path), operation.apply ? operation.before : operation.after)) throw conflict();
        this.writeJournal({ version: 1, botId: this.botId, id: pending.id, operations });
        pending.journalWritten = true;
        for (const operation of operations) if (operation.apply) {
          if (!same(this.disk(operation.path), operation.before)) throw conflict();
          this.atomic(operation.path, operation.after);
        }
      },
      afterCommit: () => {
        this.pending = undefined;
        // A committed result remains successful if only journal cleanup fails;
        // its SQLite marker makes the next process finish the same operation.
        try { this.settle({ version: 1, botId: this.botId, id: pending.id, operations: [...pending.operations.values()] }, true); }
        catch (error) { console.error("Memory journal cleanup will resume on the next read:", error); }
      },
      rollback: () => {
        this.pending = undefined;
        if (pending.journalWritten) this.settle({ version: 1, botId: this.botId, id: pending.id, operations: [...pending.operations.values()] }, false);
      },
    });
    return pending;
  }
  private row(path: string): Indexed {
    const row = this.host.db.prepare("SELECT * FROM bot_memory_files WHERE bot_id=? AND path=?").get(this.botId, path);
    return row ? { path, text: String(row.text), hash: String(row.hash), present: !!row.present, bytes: Number(row.bytes), revision: Number(row.revision), updatedAt: Number(row.updated_at) }
      : { path, ...snapshot("", false), revision: 0, updatedAt: 0 };
  }
  private index(path: string, value: Snapshot, revision: number, updatedAt: number): void {
    this.host.db.prepare("INSERT INTO bot_memory_files VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(bot_id,path) DO UPDATE SET revision=excluded.revision,hash=excluded.hash,present=excluded.present,bytes=excluded.bytes,updated_at=excluded.updated_at,text=excluded.text")
      .run(this.botId, path, revision, value.hash, value.present ? 1 : 0, value.bytes, updatedAt, value.text);
    const name = this.legacyName(path);
    if (name) this.host.db.prepare("INSERT INTO bot_memory VALUES (?,?,?,?) ON CONFLICT(bot_id,name) DO UPDATE SET revision=excluded.revision,text=excluded.text").run(this.botId, name, revision, value.text);
    this.host.db.prepare("UPDATE bots SET updated_at=? WHERE id=?").run(updatedAt, this.botId);
    this.host.db.prepare("UPDATE bot_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
  }
  private stage(path: string, after: Snapshot, source: BotMemoryChange["source"], revision?: number, apply = true): Indexed {
    const current = this.row(path), pending = this.transaction(), previous = pending.operations.get(path);
    const nextRevision = revision ?? current.revision + 1, at = Date.now();
    const change: BotMemoryChange = { id: previous?.change.id ?? randomUUID(), path, at, source, revision: nextRevision, beforeHash: previous?.before.hash ?? current.hash, afterHash: after.hash };
    const before = previous?.apply ? previous.before : apply ? this.disk(path) : previous?.before ?? snapshot(current.text, current.present);
    change.beforeHash = before.hash;
    pending.operations.set(path, { path, before, after, apply: !!previous?.apply || apply, change });
    this.index(path, after, nextRevision, at);
    this.host.db.prepare("INSERT INTO bot_memory_changes VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,at=excluded.at").run(change.id, this.botId, path, at, JSON.stringify(change));
    return this.row(path);
  }
  private syncPath(path: string): Indexed {
    kind(path);
    if (this.pending?.operations.has(path)) return this.row(path);
    const current = this.row(path), file = this.disk(path);
    return same(current, file) ? current : this.stage(path, file, "external", undefined, false);
  }
  private ensure(): void {
    this.recover();
    if (this.host.db.prepare("SELECT 1 FROM bot_memory_state WHERE bot_id=? AND initialized=1").get(this.botId)) return;
    this.host.transaction(() => {
      const old = this.host.db.prepare("SELECT name,revision,text FROM bot_memory WHERE bot_id=?").all(this.botId);
      const backup = this.metadataFile("memory-sql-backup.json");
      try { lstatSync(backup); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.saveMetadata("memory-sql-backup.json", { version: 1, botId: this.botId, documents: old });
      }
      const planned = new Map<string, { text: string; revision: number }>([["SOUL.md", { text: "", revision: 0 }], ["MEMORY.md", { text: "", revision: 0 }]]);
      const folded = new Map<string, number>();
      for (const row of old) {
        const name = String(row.name);
        if (name === "topic:chat-days") continue;
        const key = name.toLowerCase();
        folded.set(key, (folded.get(key) ?? 0) + 1);
      }
      for (const row of old) {
        const name = String(row.name), text = String(row.text), revision = Number(row.revision);
        if (name === "topic:chat-days") {
          for (const [path, contents] of diaryParts(text)) planned.set(path, { text: contents, revision });
        } else planned.set(this.legacyPath(name, (folded.get(name.toLowerCase()) ?? 0) > 1), { text, revision });
      }
      for (const [path, old] of planned) {
        const file = this.disk(path);
        // A file already edited outside the app is authoritative even on migration retry.
        if (file.present) this.stage(path, file, "migration", Math.max(1, old.revision), false);
        else this.stage(path, snapshot(old.text), "migration", old.revision);
      }
      this.host.db.prepare("INSERT INTO bot_memory_state VALUES (?,1) ON CONFLICT(bot_id) DO UPDATE SET initialized=1").run(this.botId);
    });
  }
  private scan(): string[] {
    const paths = new Set<string>(["SOUL.md", "MEMORY.md"]);
    const directories = ["", "memory", "memory/log", "playbooks"];
    for (const directory of directories) {
      const absolute = directory ? this.safeDirectory(this.workspace, directory.split("/")) : this.workspace;
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Memory files must not be symbolic links");
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        kind(path);
        paths.add(path);
        if (paths.size > FILE_COUNT_LIMIT) throw new Error("Bot workspace exceeds the 2000 memory file limit");
      }
    }
    for (const row of this.host.db.prepare("SELECT path FROM bot_memory_files WHERE bot_id=? AND present=1").all(this.botId)) paths.add(String(row.path));
    return [...paths].sort();
  }
  sync(): void {
    this.ensure();
    this.host.transaction(() => { for (const path of this.scan()) this.syncPath(path); });
  }
  private document(value: Indexed): BotMemoryDocument {
    return { path: value.path, kind: kind(value.path), revision: value.revision, hash: value.hash, bytes: value.bytes, updatedAt: value.updatedAt, text: value.text, ...(value.path === "MEMORY.md" ? { budget: resident(value.text).budget } : {}) };
  }
  read(path: string): BotMemoryDocument {
    this.ensure();
    return this.host.transaction(() => this.document(this.syncPath(path)));
  }
  save(path: string, text: string, expected: BotMemoryExpected, source: BotMemoryChange["source"] = "user"): BotMemoryDocument {
    this.ensure();
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > FILE_LIMIT || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error("Memory text must be valid Unicode and at most 1 MiB");
    return this.host.transaction(() => {
      const current = this.syncPath(path);
      if (current.revision !== expected.expectedRevision || current.hash !== expected.expectedHash) throw conflict();
      const clean = redactSecrets(text);
      if (current.present && current.text === clean) return this.document(current);
      if (!current.present && this.scan().length >= FILE_COUNT_LIMIT) throw new Error("Bot workspace exceeds the 2000 memory file limit");
      return this.document(this.stage(path, snapshot(clean), source));
    });
  }
  private topicIndex(files: BotMemoryFile[]): { topics: string[]; topicsTruncated: boolean } {
    const candidates = files.filter(file => file.kind === "topic").map(file => this.legacyName(file.path)!.slice(6));
    const topics: string[] = [];
    let chars = 0;
    for (const name of candidates) {
      if (topics.length >= TOPIC_LIMIT || chars + name.length > TOPIC_INDEX_CHARS) break;
      topics.push(name); chars += name.length;
    }
    return { topics, topicsTruncated: topics.length < candidates.length };
  }
  private files(): BotMemoryFile[] {
    return this.host.db.prepare("SELECT * FROM bot_memory_files WHERE bot_id=? AND present=1 ORDER BY path").all(this.botId).map(row => {
      const { text: _text, budget: _budget, ...file } = this.document(this.row(String(row.path)));
      return file;
    });
  }
  list(): BotMemoryList {
    this.sync();
    const files = this.files();
    const revision = Number(this.host.db.prepare("SELECT COALESCE(SUM(revision),0) AS revision FROM bot_memory_files WHERE bot_id=?").get(this.botId)!.revision);
    return { revision, files, topicLimit: TOPIC_LIMIT, topicsTruncated: this.topicIndex(files).topicsTruncated };
  }
  loadContext(): BotMemoryContext {
    this.sync();
    const soul = this.row("SOUL.md"), memory = this.row("MEMORY.md"), index = this.topicIndex(this.files());
    return { soul: soul.text, text: resident(memory.text).text, revision: memory.revision,
      hash: digest(JSON.stringify([soul.hash, memory.hash, index.topics])), budget: resident(memory.text).budget, ...index };
  }
  topicDocuments(): { path: string; text: string; revision: number; hash: string }[] {
    this.sync();
    return this.files().filter(file => file.kind === "topic").map(file => ({ path: file.path, text: this.row(file.path).text, revision: file.revision, hash: file.hash }));
  }
  log(path?: string, limit = 50): BotMemoryChange[] {
    if (path !== undefined) kind(path);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid memory log limit");
    this.sync();
    return this.host.db.prepare("SELECT payload FROM bot_memory_changes WHERE bot_id=? AND (? IS NULL OR path=?) ORDER BY at DESC,rowid DESC LIMIT ?").all(this.botId, path ?? null, path ?? null, limit).map(row => JSON.parse(String(row.payload)));
  }
  undo(changeId: string, expected: BotMemoryExpected): BotMemoryDocument {
    this.ensure();
    const row = this.host.db.prepare("SELECT path FROM bot_memory_changes WHERE bot_id=? AND id=?").get(this.botId, changeId);
    if (!row) throw new Error("Memory change does not belong to this Bot");
    for (const entry of readdirSync(this.safeDirectory(this.directory, ["memory-history"]))) {
      if (!entry.endsWith(".json")) continue;
      const journal = this.readJournal(join(this.directory, "memory-history", entry));
      const operation = journal.operations.find(operation => operation.change.id === changeId);
      if (operation) return this.host.transaction(() => {
        const current = this.syncPath(operation.path);
        if (current.revision !== expected.expectedRevision || current.hash !== expected.expectedHash) throw conflict();
        return this.document(this.stage(operation.path, operation.before, "undo"));
      });
    }
    throw new Error("Memory change is not available for undo");
  }
  rebuildIndex(): BotMemoryList {
    this.ensure();
    this.host.transaction(() => {
      // Preserve CAS revisions. A lost index is rebuilt from Markdown and the
      // durable change history, never by copying the old SQL memory bodies.
      const latest = new Map<string, BotMemoryChange>();
      for (const entry of readdirSync(this.safeDirectory(this.directory, ["memory-history"]))) {
        if (!entry.endsWith(".json")) continue;
        for (const operation of this.readJournal(join(this.directory, "memory-history", entry)).operations) {
          const change = operation.change, previous = latest.get(change.path);
          if (!previous || previous.revision < change.revision) latest.set(change.path, change);
          this.host.db.prepare("INSERT OR IGNORE INTO bot_memory_changes VALUES (?,?,?,?,?)").run(change.id, this.botId, change.path, change.at, JSON.stringify(change));
        }
      }
      for (const path of this.scan()) {
        const file = this.disk(path), old = this.row(path), history = latest.get(path);
        const revision = Math.max(old.revision, history?.revision ?? 0, file.present ? 1 : 0) + (history && history.afterHash !== file.hash ? 1 : 0);
        this.index(path, file, revision, Date.now());
      }
    });
    return this.list();
  }
  private legacyPath(name: string, forceAlias = false): string {
    const alias = this.aliasMap()[name];
    if (alias) return alias;
    const path = name === "memory" ? "MEMORY.md" : name === "soul" ? "SOUL.md" : name === "archive" ? "memory/archive.md"
      : name.startsWith("topic:") ? `memory/${name.slice(6)}.md` : name.startsWith("playbook:") ? `playbooks/${name.slice(9)}.md` : "";
    const leaf = name.startsWith("topic:") ? name.slice(6) : name.startsWith("playbook:") ? name.slice(9) : undefined;
    // SQL accepted names which are unsafe as native filenames (CON, trailing
    // dots, repeated .md). Keep those names reachable via a durable alias.
    const legacy = leaf && leaf.length <= 80 && !leaf.startsWith(".") && /^[\p{L}\p{N} ._-]+$/u.test(leaf);
    if (forceAlias && legacy) return this.encodedPath(name);
    try { kind(path); } catch (error) { if (legacy) return this.encodedPath(name); throw error; }
    return path;
  }
  private legacyName(path: string): string | undefined {
    const alias = Object.entries(this.aliasMap()).find(([, target]) => target === path)?.[0];
    if (alias) return alias;
    const type = kind(path);
    return type === "resident" ? "memory" : type === "soul" ? "soul" : type === "archive" ? "archive"
      : type === "topic" ? `topic:${path.slice(7, -3)}` : type === "playbook" ? `playbook:${path.slice(10, -3)}` : undefined;
  }
  legacyRead(name: string): { text: string; revision: number } {
    if (name === "topic:chat-days") {
      this.sync();
      const logs = this.host.db.prepare("SELECT path FROM bot_memory_files WHERE bot_id=? ORDER BY path").all(this.botId).map(row => this.row(String(row.path))).filter(file => kind(file.path) === "log");
      return { text: logs.map(file => file.text).join(""), revision: logs.reduce((sum, file) => sum + file.revision, 0) };
    }
    const doc = this.read(this.legacyPath(name));
    return { text: doc.text, revision: doc.revision };
  }
  legacyWrite(name: string, text: string, expected?: number): number {
    this.ensure();
    return this.host.transaction(() => {
      const current = this.legacyRead(name);
      if (expected !== undefined && expected !== current.revision) throw conflict();
      if (name === "topic:chat-days") {
        const parts = diaryParts(text), paths = new Set([...parts.keys(), ...this.files().filter(file => file.kind === "log").map(file => file.path)]);
        for (const path of paths) { const current = this.read(path); this.save(path, parts.get(path) ?? "", { expectedRevision: current.revision, expectedHash: current.hash }, "assistant"); }
        return this.legacyRead(name).revision;
      }
      const path = this.legacyPath(name), file = this.read(path);
      return this.save(path, text, { expectedRevision: file.revision, expectedHash: file.hash }, "assistant").revision;
    });
  }
  legacyDocuments(prefix: "topic:" | "playbook:"): { name: string; text: string; revision: number }[] {
    this.sync();
    return this.host.db.prepare("SELECT path FROM bot_memory_files WHERE bot_id=? ORDER BY path").all(this.botId).flatMap(row => {
      const path = String(row.path), name = this.legacyName(path);
      if (!name?.startsWith(prefix)) return [];
      const value = this.row(path);
      return [{ name: name.slice(prefix.length), text: value.text, revision: value.revision }];
    });
  }
}
