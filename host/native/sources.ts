import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  type BigIntStats,
} from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configuredProviderAccountHomes } from "../provider-accounts";
import type {
  NativeSessionFile,
  NativeSessionProvider,
} from "../../src/integrations/harness/core/nativeSessions";

/**
 * Host port of the desktop's `src-tauri/src/native_sessions.rs` listing: the
 * same roots, environment overrides, account profiles, limits and identities,
 * so the Host resolves the sources the desktop used to import.
 */

export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_FILES = 5000;
const CLAUDE_HEADER_LINES = 400;

export type NativeSource = {
  provider: NativeSessionProvider;
  /** Directory of JSONL transcripts, or OpenCode's database file. */
  root: string;
  /** Provider data directory that owns the root (the account profile). */
  dataDir: string;
  accountId?: string;
  storage: { kind: "jsonl"; maxDepth: number } | { kind: "sqlite" };
};

export type NativeListing = { sessions: (NativeSessionFile & { dataDir: string })[]; warnings: string[] };

export type SourceEnvironment = {
  home?: string;
  env?: Record<string, string | undefined>;
  /** Paired desktop data directory holding `provider-accounts/<provider>/<id>`. */
  desktopDirectory?: string;
};

export const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id);
const slash = (value: string) => value.replace(/\\/g, "/");

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function dirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function accountDirs(desktop: string | undefined, provider: string): [string, string][] {
  if (!desktop) return [];
  const root = join(desktop, "provider-accounts", provider);
  const homes = new Map<string, string>(dirs(root)
    .filter((id) => validId(id) && id !== "default"
      && !existsSync(join(desktop, "provider-accounts", "removed", provider, id)))
    .map((id) => [id, join(root, id)]));
  for (const [id, home] of configuredProviderAccountHomes(desktop, provider)) homes.set(id, home);
  return [...homes];
}

export function nativeSources(context: SourceEnvironment = {}): NativeSource[] {
  const env = context.env ?? process.env;
  const home = context.home ?? homedir();
  const envDir = (key: string) => (env[key] ? env[key] : undefined);
  const jsonl = (
    provider: NativeSessionProvider,
    dataDir: string,
    root: string,
    maxDepth: number,
    accountId?: string,
  ): NativeSource => ({
    provider,
    root,
    dataDir,
    storage: { kind: "jsonl", maxDepth },
    ...(accountId ? { accountId } : {}),
  });
  const out: NativeSource[] = [];
  // Named Homes take precedence over duplicate default/sibling discoveries,
  // otherwise native history loses the account binding used by the child.
  for (const [id, dir] of accountDirs(context.desktopDirectory, "codex"))
    out.push(jsonl("codex", dir, join(dir, "sessions"), 4, id));
  const codex = envDir("CODEX_HOME") ?? join(home, ".codex");
  out.push(jsonl("codex", codex, join(codex, "sessions"), 4));
  // The default home and sibling `~/.codex-<name>` profiles; dedupe drops repeats.
  const profiles = dirs(home)
    .filter((name) => name.startsWith(".codex-") && existsSync(join(home, name, "sessions")))
    .map((name) => join(home, name));
  for (const dir of [join(home, ".codex"), ...profiles])
    out.push(jsonl("codex", dir, join(dir, "sessions"), 4));
  const pi = envDir("PI_CODING_AGENT_DIR") ?? join(home, ".pi/agent");
  out.push(jsonl("pi", pi, envDir("PI_CODING_AGENT_SESSION_DIR") ?? join(pi, "sessions"), 4));
  // Claude keeps main conversations at projects/<cwd>/<id>.jsonl; deeper files are subagents.
  for (const [id, dir] of accountDirs(context.desktopDirectory, "claude"))
    out.push(jsonl("claude", dir, join(dir, "projects"), 1, id));
  const claude = envDir("CLAUDE_CONFIG_DIR") ?? join(home, ".claude");
  out.push(jsonl("claude", claude, join(claude, "projects"), 1));
  const profile = (env.OMP_PROFILE ?? env.PI_PROFILE)?.trim();
  const namedProfile = profile && profile !== "default" ? profile : undefined;
  if (!namedProfile || /^[a-z0-9][a-z0-9._-]{0,63}$/.test(namedProfile) && !namedProfile.endsWith(".") && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(namedProfile)) {
    const root = join(home, env.PI_CONFIG_DIR || ".omp");
    const defaultAgent = namedProfile ? join(root, "profiles", namedProfile, "agent") : join(root, "agent");
    const omp = namedProfile ? defaultAgent : (envDir("PI_CODING_AGENT_DIR")?.replace(/^~(?=[\\/]|$)/, home) ?? defaultAgent);
    // OMP only adopts an existing XDG data directory on Linux/macOS when using
    // its default agent directory. Windows always records sessions in the agent directory.
    const xdg = envDir("XDG_DATA_HOME");
    const xdgData = xdg ? join(xdg, "omp", ...(namedProfile ? ["profiles", namedProfile] : [])) : undefined;
    const data = process.platform !== "win32" && omp === defaultAgent && xdgData && existsSync(xdgData) ? xdgData : omp;
    out.push(jsonl("omp", omp, join(data, "sessions"), 4));
  }
  const data = envDir("XDG_DATA_HOME") ?? join(home, ".local/share");
  out.push({
    provider: "opencode",
    root: join(data, "opencode/opencode.db"),
    dataDir: join(data, "opencode"),
    storage: { kind: "sqlite" },
  });
  // An environment override may point at an account profile; list each location once.
  const seen = new Set<string>();
  return out.filter((source) => {
    const key = `${source.provider}\0${canonical(source.root)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `<size>:<mtime nanoseconds>`, identical to the desktop revision string. */
export function jsonlRevision(stats: BigIntStats): string {
  return `${stats.size}:${stats.mtimeNs}`;
}

function absoluteCwd(value: unknown): string | undefined {
  return typeof value === "string" && (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value))
    ? slash(value)
    : undefined;
}

function promptLabel(row: Record<string, unknown>): string | undefined {
  const content = (row.message as Record<string, unknown> | undefined)?.content;
  if (typeof content !== "string") return undefined;
  const text = content.trim();
  if (!text || text.startsWith("<")) return undefined;
  return [...(text.split("\n")[0] ?? "").trim()].slice(0, 80).join("");
}

const HEAD_WINDOW = 1024 * 1024;
const HEAD_CHUNK = 64 * 1024;

/** Collects complete leading lines from successive chunks, within a 1 MiB window. */
class HeadLines {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly limit: number) {}
  /** Adds a chunk; returns the lines once enough are known. */
  push(chunk: Buffer, end: boolean): string[] | null {
    this.chunks.push(chunk);
    this.size += chunk.length;
    const text = Buffer.concat(this.chunks).toString("utf8");
    const lines = text.split("\n");
    const complete = end && this.size < HEAD_WINDOW ? lines : lines.slice(0, -1);
    if (complete.length >= this.limit || end || this.size >= HEAD_WINDOW) return complete.slice(0, this.limit);
    return null;
  }
}

function headLines(path: string, limit: number): string[] {
  const fd = openSync(path, "r");
  try {
    const head = new HeadLines(limit);
    for (let offset = 0; ; ) {
      const buffer = Buffer.alloc(Math.min(HEAD_CHUNK, HEAD_WINDOW - offset));
      const read = readSync(fd, buffer, 0, buffer.length, offset);
      offset += read;
      const lines = head.push(buffer.subarray(0, read), read < buffer.length);
      if (lines) return lines;
    }
  } finally {
    closeSync(fd);
  }
}

async function headLinesAsync(path: string, limit: number): Promise<string[]> {
  const handle = await open(path, "r");
  try {
    const head = new HeadLines(limit);
    for (let offset = 0; ; ) {
      const buffer = Buffer.alloc(Math.min(HEAD_CHUNK, HEAD_WINDOW - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      offset += bytesRead;
      const lines = head.push(buffer.subarray(0, bytesRead), bytesRead < buffer.length);
      if (lines) return lines;
    }
  } finally {
    await handle.close();
  }
}

type Header = { id: string; cwd: string; preview?: string };

/** `null` skips a file silently (sidechains or Claude files without a conversation yet). */
const headerLimit = (provider: NativeSessionProvider) =>
  provider === "claude" ? CLAUDE_HEADER_LINES : provider === "omp" ? 4 : 1;
const skippedFile = (path: string, provider: NativeSessionProvider) =>
  provider === "claude" && basename(path, extname(path)).startsWith("agent-");

export function nativeHeader(path: string, provider: NativeSessionProvider): Header | null {
  if (skippedFile(path, provider)) return null;
  return headerFrom(path, provider, headLines(path, headerLimit(provider)));
}

function headerFrom(path: string, provider: NativeSessionProvider, lines: string[]): Header | null {
  const stem = basename(path, extname(path));
  for (const line of lines) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (provider === "claude") continue;
      throw error;
    }
    const kind = value.type;
    let row: Record<string, unknown>;
    if (provider === "codex" && kind === "session_meta") row = (value.payload ?? {}) as Record<string, unknown>;
    else if ((provider === "pi" || provider === "omp") && kind === "session" && value.version === 3) row = value;
    else if (provider === "omp" && kind === "title") continue;
    else if (provider === "claude") {
      // Claude resumes by file name; rows copied from another file keep their old id.
      if (value.isSidechain === true || (kind !== "user" && kind !== "assistant")) continue;
      const cwd = absoluteCwd(value.cwd);
      if (cwd && typeof value.sessionId === "string" && validId(stem))
        return { id: stem, cwd, ...(promptLabel(value) ? { preview: promptLabel(value) } : {}) };
      continue;
    } else throw new Error("Unsupported native session format");
    const id = typeof row.id === "string" && validId(row.id) ? row.id : undefined;
    if (!id) throw new Error("Invalid native session id");
    const cwd = absoluteCwd(row.cwd);
    if (!cwd) throw new Error("Native session has no absolute working directory");
    return { id, cwd };
  }
  if (provider === "claude") return null;
  throw new Error("Unsupported native session format");
}

function jsonlFile(source: NativeSource, path: string): (NativeSessionFile & { dataDir: string }) | null {
  const stats = statSync(path, { bigint: true });
  if (stats.size > BigInt(MAX_BYTES)) throw new Error("Native session exceeds 64 MiB");
  return fileFrom(source, path, stats, nativeHeader(path, source.provider));
}

async function jsonlFileAsync(source: NativeSource, path: string): Promise<(NativeSessionFile & { dataDir: string }) | null> {
  const stats = await stat(path, { bigint: true });
  if (stats.size > BigInt(MAX_BYTES)) throw new Error("Native session exceeds 64 MiB");
  if (skippedFile(path, source.provider)) return null;
  return fileFrom(source, path, stats, headerFrom(path, source.provider, await headLinesAsync(path, headerLimit(source.provider))));
}

function fileFrom(
  source: NativeSource,
  path: string,
  stats: BigIntStats,
  header: Header | null,
): (NativeSessionFile & { dataDir: string }) | null {
  if (!header) return null;
  return {
    provider: source.provider,
    providerSessionId: header.id,
    cwd: header.cwd,
    path: slash(path),
    revision: jsonlRevision(stats),
    modifiedAt: Number(stats.mtimeMs),
    storage: "jsonl",
    dataDir: source.dataDir,
    ...(source.accountId ? { accountId: source.accountId } : {}),
    ...(header.preview ? { preview: header.preview } : {}),
  };
}

function scan(
  source: NativeSource,
  dir: string,
  depth: number,
  state: { seen: number },
  out: NativeListing,
  match?: (name: string) => boolean,
): void {
  if (source.storage.kind !== "jsonl" || depth > source.storage.maxDepth || state.seen >= MAX_FILES) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") out.warnings.push(`${dir}: ${(error as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (state.seen >= MAX_FILES) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(source, path, depth + 1, state, out, match);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== ".jsonl") continue;
    if (match && !match(entry.name)) continue;
    state.seen++;
    try {
      const file = jsonlFile(source, path);
      if (file) out.sessions.push(file);
    } catch (error) {
      out.warnings.push(`${path}: ${(error as Error).message}`);
    }
  }
}

/** Listing variant of `scan`: yields to the event loop between files. */
async function scanAsync(
  source: NativeSource,
  dir: string,
  depth: number,
  state: { seen: number },
  out: NativeListing,
): Promise<void> {
  if (source.storage.kind !== "jsonl" || depth > source.storage.maxDepth || state.seen >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") out.warnings.push(`${dir}: ${(error as Error).message}`);
    return;
  }
  for (const entry of entries) {
    if (state.seen >= MAX_FILES) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanAsync(source, path, depth + 1, state, out);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== ".jsonl") continue;
    state.seen++;
    try {
      const file = await jsonlFileAsync(source, path);
      if (file) out.sessions.push(file);
    } catch (error) {
      out.warnings.push(`${path}: ${(error as Error).message}`);
    }
  }
}

/** OpenCode keeps WAL-mode history; a read-only handle never blocks its writer. */
export function openOpenCode(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout=1500");
  return db;
}

export const OPENCODE_SESSIONS = `SELECT s.id AS id, s.directory AS directory, s.title AS title,
  MAX(s.time_updated,
      COALESCE((SELECT MAX(m.time_updated) FROM message m WHERE m.session_id = s.id), 0),
      COALESCE((SELECT MAX(p.time_updated) FROM part p WHERE p.session_id = s.id), 0)) AS updated,
  (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS messages,
  (SELECT COUNT(*) FROM part p WHERE p.session_id = s.id) AS parts
FROM session s
WHERE s.parent_id IS NULL AND s.time_archived IS NULL`;

export function openCodeRow(
  source: NativeSource,
  path: string,
  row: Record<string, unknown>,
): (NativeSessionFile & { dataDir: string }) | null {
  const id = String(row.id ?? "");
  const cwd = absoluteCwd(row.directory);
  if (!cwd || !validId(id)) return null;
  const updated = Number(row.updated ?? 0);
  const title = typeof row.title === "string" && row.title.trim() ? row.title : undefined;
  return {
    provider: "opencode",
    providerSessionId: id,
    cwd,
    path,
    // Counts catch reverts that delete rows without touching newer timestamps.
    revision: `sqlite:${updated}:${Number(row.messages ?? 0)}:${Number(row.parts ?? 0)}`,
    modifiedAt: Math.max(0, updated),
    storage: "sqlite",
    dataDir: source.dataDir,
    ...(title ? { title } : {}),
  };
}

function listOpenCode(source: NativeSource, out: NativeListing, id?: string): void {
  if (!existsSync(source.root)) return;
  const path = slash(canonical(source.root));
  let db: DatabaseSync | undefined;
  try {
    db = openOpenCode(path);
    const rows = id
      ? db.prepare(`${OPENCODE_SESSIONS} AND s.id = ?`).all(id)
      : db.prepare(`${OPENCODE_SESSIONS} ORDER BY updated DESC LIMIT ${MAX_FILES}`).all();
    for (const row of rows) {
      const file = openCodeRow(source, path, row as Record<string, unknown>);
      if (file) out.sessions.push(file);
    }
  } catch (error) {
    out.warnings.push(`${path}: ${(error as Error).message}`);
  } finally {
    db?.close();
  }
}

/**
 * Codex keeps generated thread names in `$CODEX_HOME/session_index.jsonl`
 * (append-only; the latest row for an id wins).
 */
function codexNames(sessionsRoot: string): Map<string, string> {
  const names = new Map<string, string>();
  let text: string;
  try {
    text = readFileSync(join(dirname(sessionsRoot), "session_index.jsonl"), "utf8").slice(0, 16 * 1024 * 1024);
  } catch {
    return names;
  }
  for (const line of text.split("\n")) {
    try {
      const row = JSON.parse(line);
      const name = typeof row.thread_name === "string" ? row.thread_name.trim() : "";
      if (typeof row.id === "string" && validId(row.id) && name) names.set(row.id, [...name].slice(0, 200).join(""));
    } catch {
      /* Partial or foreign rows carry no title. */
    }
  }
  return names;
}

export async function listNativeSessions(context: SourceEnvironment = {}): Promise<NativeListing> {
  const out: NativeListing = { sessions: [], warnings: [] };
  const state = { seen: 0 };
  for (const source of nativeSources(context)) {
    const start = out.sessions.length;
    if (source.storage.kind === "jsonl") await scanAsync(source, source.root, 0, state, out);
    else listOpenCode(source, out);
    if (source.provider === "codex") {
      const names = codexNames(source.root);
      for (const file of out.sessions.slice(start)) {
        const title = names.get(file.providerSessionId);
        if (title) file.title = title;
      }
    }
  }
  if (state.seen >= MAX_FILES) out.warnings.push("Native session scan reached the 5000-file limit");
  out.sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}

/** The configured source containing a canonical path. */
export function sourceFor(path: string, context: SourceEnvironment = {}, provider?: NativeSessionProvider): NativeSource {
  const target = slash(canonical(path));
  const found = nativeSources(context).find((source) => {
    if (provider && source.provider !== provider) return false;
    const root = slash(canonical(source.root));
    return source.storage.kind === "jsonl"
      ? target.startsWith(`${root}/`) && extname(target) === ".jsonl"
      : target === root;
  });
  if (!found) throw new Error("Not a native session in a configured source directory");
  return found;
}

/** Current metadata of one bound source, validating that its identity is unchanged. */
export function sourceFile(
  path: string,
  providerSessionId: string,
  context: SourceEnvironment = {},
  provider?: NativeSessionProvider,
): NativeSessionFile & { dataDir: string } {
  const source = sourceFor(path, context, provider);
  const out: NativeListing = { sessions: [], warnings: [] };
  if (source.storage.kind === "sqlite") {
    listOpenCode(source, out, providerSessionId);
    if (out.warnings.length) throw new Error(out.warnings[0]);
    const file = out.sessions[0];
    if (!file) throw new Error("Native session is no longer available");
    return file;
  }
  const file = jsonlFile(source, canonical(path));
  if (!file) throw new Error("Native session has no conversation yet");
  if (file.providerSessionId !== providerSessionId) throw new Error("Native session identity changed");
  if (source.provider === "codex") {
    const title = codexNames(source.root).get(providerSessionId);
    if (title) file.title = title;
  }
  return file;
}

/**
 * Locate the source of a conversation MonoCode started, by provider ID. File
 * names carry the ID for every JSONL provider, so only matching names are read.
 * More than one match is ambiguous and is never guessed.
 */
export function findNativeSource(
  provider: NativeSessionProvider,
  providerSessionId: string,
  accountId: string | undefined,
  context: SourceEnvironment = {},
): (NativeSessionFile & { dataDir: string }) | null {
  if (!validId(providerSessionId)) return null;
  const out: NativeListing = { sessions: [], warnings: [] };
  const state = { seen: 0 };
  for (const source of nativeSources(context)) {
    if (source.provider !== provider) continue;
    if ((source.accountId ?? "default") !== (accountId ?? "default") && (provider === "claude" || provider === "codex"))
      continue;
    if (source.storage.kind === "sqlite") listOpenCode(source, out, providerSessionId);
    else scan(source, source.root, 0, state, out, (name) => name.includes(providerSessionId));
  }
  const matches = out.sessions.filter((file) => file.providerSessionId === providerSessionId);
  const unique = new Map(matches.map((file) => [`${file.path}#${file.providerSessionId}`, file]));
  if (unique.size > 1) throw new Error("Native session source is ambiguous");
  return unique.values().next().value ?? null;
}

/** Opaque Host-issued identity of a listed source. */
export function nativeSourceId(file: Pick<NativeSessionFile, "provider" | "path" | "providerSessionId" | "storage"> & { dataDir?: string }): string {
  const key = file.storage === "sqlite" ? `${file.path}#${file.providerSessionId}` : file.path;
  return createHash("sha256")
    .update([file.provider, file.storage ?? "jsonl", file.dataDir ?? "", key].join("|"))
    .digest("hex")
    .slice(0, 32);
}
