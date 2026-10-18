// Node implementations of the narrow file-system, execution and artifact-store
// ports that the ZCode-derived workflow world-read and artifact publish modules
// call. Only the methods those modules use are provided.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { assertMachinePath, currentMachineIO, machineFs, machinePath } from "../machine-io";

export type FileSystemPortErrorCode = "not_found" | "is_directory" | "not_file" | "too_large" | "io";

export class FileSystemPortError extends Error {
  constructor(readonly code: FileSystemPortErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FileSystemPortError";
  }
}

export function isFileSystemPortError(error: unknown): error is FileSystemPortError {
  return error instanceof FileSystemPortError;
}

export type FileSystemReadBytesResult = { content: Uint8Array };

export interface FileSystemPort {
  searchFiles(request: { path: string; pattern: string; maxResults: number }): Promise<{ files: string[]; truncated: boolean }>;
  readTextFile(request: { path: string }): Promise<{ content: string }>;
  readBinaryFile(request: { path: string; maxBytes?: number }): Promise<FileSystemReadBytesResult>;
  searchText(request: {
    path: string;
    pattern: string;
    glob?: string;
    outputMode: "content";
    showLineNumbers: boolean;
    headLimit: number;
  }): Promise<{ entries: { path: string; lineNumber?: number; text?: string }[]; truncated: boolean }>;
}

export type ExecutionStatus = "completed" | "failed" | "timed_out" | "spawn_error" | "cancelled";

export type ExecutionStream = { text: string; bytes: number; truncated: boolean };

export interface ExecutionResult {
  status: ExecutionStatus;
  exitCode?: number;
  stdout: ExecutionStream;
  stderr: ExecutionStream;
  error?: { message: string };
}

export interface ExecutionPort {
  run(request: {
    command: { mode: "argv"; file: string; args: string[] };
    cwd: string;
    timeoutMs?: number;
    outputLimit?: { maxInlineBytes: number };
  }): Promise<ExecutionResult>;
}

export type SessionId = string;

export interface ToolArtifactWriteResult {
  id: string;
  uri: string;
  path?: string;
  bytes: number;
  contentType: string;
  createdAt: Date;
}

type ToolArtifactWriteCommon = {
  sessionId: SessionId;
  toolCallId: string;
  toolName: string;
  retention: "project";
  contentType: string;
};

export interface ToolArtifactStorePort {
  writeToolResultArtifact(request: ToolArtifactWriteCommon & { content: string }): Promise<ToolArtifactWriteResult>;
  writeToolResultBinaryArtifact?(request: ToolArtifactWriteCommon & { content: Uint8Array; extension?: string }): Promise<ToolArtifactWriteResult>;
}

/** Directories never walked by files.glob / files.grep. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".monocode", "target", "dist", "build"]);
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;

async function* walk(root: string): AsyncGenerator<string> {
  let entries: import("../machine-io").MachineEntry[];
  try { entries = await machineFs.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = machinePath.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(path);
    } else if (entry.isFile()) yield path;
  }
}

function portable(path: string): string {
  return machinePath.sep === "/" ? path : path.split(machinePath.sep).join("/");
}

function globMatches(root: string, path: string, pattern: string): boolean {
  const rel = portable(machinePath.relative(root, path));
  // A pattern without a slash matches basenames anywhere, as ripgrep's --glob does.
  return machinePath.matchesGlob(rel, pattern) || (!pattern.includes("/") && machinePath.matchesGlob(rel.split("/").at(-1)!, pattern));
}

export const nodeFileSystemPort: FileSystemPort = {
  async searchFiles({ path, pattern, maxResults }) {
    const files: string[] = [];
    for await (const file of walk(path)) {
      if (!globMatches(path, file, pattern)) continue;
      files.push(file);
      if (files.length >= maxResults) return { files, truncated: true };
    }
    return { files, truncated: false };
  },
  async readTextFile({ path }) {
    return { content: await machineFs.readFile(path, "utf8") };
  },
  async readBinaryFile({ path, maxBytes }) {
    let info;
    try { info = await machineFs.stat(path); } catch (cause) {
      throw new FileSystemPortError("not_found", `${path} does not exist`, { cause });
    }
    if (info.isDirectory()) throw new FileSystemPortError("is_directory", `${path} is a directory`);
    if (!info.isFile()) throw new FileSystemPortError("not_file", `${path} is not a regular file`);
    if (maxBytes !== undefined && info.size > maxBytes) throw new FileSystemPortError("too_large", `${path} is too large`);
    const content = maxBytes === undefined ? await machineFs.readFile(path) : await machineFs.readPrefix(path, maxBytes + 1);
    if (maxBytes !== undefined && content.length > maxBytes) throw new FileSystemPortError("too_large", `${path} is too large`);
    return { content: new Uint8Array(content) };
  },
  async searchText({ path, pattern, glob, headLimit }) {
    const expression = new RegExp(pattern);
    const entries: { path: string; lineNumber: number; text: string }[] = [];
    for await (const file of walk(path)) {
      if (glob !== undefined && !globMatches(path, file, glob)) continue;
      let text: string;
      try {
        if ((await machineFs.stat(file)).size > MAX_GREP_FILE_BYTES) continue;
        text = (await machineFs.readPrefix(file, MAX_GREP_FILE_BYTES + 1)).toString("utf8");
        if (Buffer.byteLength(text) > MAX_GREP_FILE_BYTES) continue;
      } catch { continue; }
      if (text.includes("\u0000")) continue;
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (!expression.test(lines[index]!)) continue;
        entries.push({ path: file, lineNumber: index + 1, text: lines[index]! });
        if (entries.length >= headLimit) return { entries, truncated: true };
      }
    }
    return { entries, truncated: false };
  },
};

export const nodeExecutionPort: ExecutionPort = {
  async run({ command, cwd, timeoutMs, outputLimit }) {
    const limit = outputLimit?.maxInlineBytes ?? 1024 * 1024;
    const io = currentMachineIO();
    assertMachinePath(cwd, io);
    if (io.key !== "local") {
      const stream = (value: unknown): ExecutionStream => {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : "");
        return { text: bytes.subarray(0, limit).toString("utf8"), bytes: bytes.length, truncated: bytes.length > limit };
      };
      try {
        const result = await io.exec(command.file, command.args, { cwd, timeout: timeoutMs, maxBuffer: Math.max(limit + 1, 64 * 1024 * 1024), encoding: "buffer" });
        return { status: "completed", exitCode: 0, stdout: stream(result.stdout), stderr: stream(result.stderr) };
      } catch (error) {
        const failure = error as { code?: string | number; stdout?: unknown; stderr?: unknown; message?: string };
        return { status: failure.code === "ETIMEDOUT" ? "timed_out" : typeof failure.code === "number" ? "failed" : "spawn_error",
          ...(typeof failure.code === "number" ? { exitCode: failure.code } : {}),
          stdout: stream(failure.stdout), stderr: stream(failure.stderr),
          ...(typeof failure.code !== "number" ? { error: { message: failure.message ?? String(error) } } : {}) };
      }
    }
    return new Promise((resolveRun) => {
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let stdoutBytes = 0, stderrBytes = 0, timedOut = false, settled = false;
      const finish = (result: ExecutionResult) => { if (!settled) { settled = true; resolveRun(result); } };
      const stream = (chunks: Buffer[], bytes: number): ExecutionStream => {
        const buffer = Buffer.concat(chunks);
        return { text: buffer.subarray(0, limit).toString("utf8"), bytes, truncated: bytes > limit };
      };
      let child;
      try {
        child = spawn(command.file, command.args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        finish({ status: "spawn_error", stdout: stream([], 0), stderr: stream([], 0), error: { message: error instanceof Error ? error.message : String(error) } });
        return;
      }
      const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs) : undefined;
      child.stdout.on("data", (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes <= limit + chunk.length) stdout.push(chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes <= limit + chunk.length) stderr.push(chunk); });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish({ status: "spawn_error", stdout: stream(stdout, stdoutBytes), stderr: stream(stderr, stderrBytes), error: { message: error.message } });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) { finish({ status: "timed_out", stdout: stream(stdout, stdoutBytes), stderr: stream(stderr, stderrBytes) }); return; }
        finish({ status: code === 0 ? "completed" : "failed", exitCode: code ?? undefined, stdout: stream(stdout, stdoutBytes), stderr: stream(stderr, stderrBytes) });
      });
    });
  },
};

export const WORKFLOW_ARTIFACT_URI_PREFIX = "monocode-artifact://";

/** Workflow artifacts stored under the Host data directory, scoped by parent session. */
export class FileArtifactStore implements ToolArtifactStorePort {
  constructor(private readonly root: string) {}

  private async write(sessionId: string, toolCallId: string, content: string | Uint8Array, contentType: string, extension?: string): Promise<ToolArtifactWriteResult> {
    const id = createHash("sha256").update(`${sessionId}\0${toolCallId}`).digest("hex").slice(0, 32);
    const name = `${id}${extension ? `.${extension}` : ""}`;
    const directory = join(this.root, sessionId.replace(/[^A-Za-z0-9_-]/g, "_"));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, name);
    const bytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
    await writeFile(path, content, { mode: 0o600 });
    await writeFile(`${path}.type`, contentType, { mode: 0o600 });
    return { id, uri: `${WORKFLOW_ARTIFACT_URI_PREFIX}${sessionId}/${name}`, path, bytes, contentType, createdAt: new Date() };
  }

  writeToolResultArtifact(request: ToolArtifactWriteCommon & { content: string }) {
    return this.write(request.sessionId, request.toolCallId, request.content, request.contentType);
  }

  writeToolResultBinaryArtifact(request: ToolArtifactWriteCommon & { content: Uint8Array; extension?: string }) {
    return this.write(request.sessionId, request.toolCallId, request.content, request.contentType, request.extension);
  }

  /** Reads stored bytes for a URI this store minted, or undefined when it is not one. */
  async read(uri: string): Promise<{ bytes: Buffer; contentType: string } | undefined> {
    if (!uri.startsWith(WORKFLOW_ARTIFACT_URI_PREFIX)) return undefined;
    const [sessionId, name] = uri.slice(WORKFLOW_ARTIFACT_URI_PREFIX.length).split("/");
    if (!sessionId || !name || !/^[0-9a-f]{32}(\.[a-z0-9]+)?$/.test(name)) return undefined;
    const path = resolve(this.root, sessionId.replace(/[^A-Za-z0-9_-]/g, "_"), name);
    if (!path.startsWith(resolve(this.root) + sep)) return undefined;
    try {
      const [bytes, contentType] = await Promise.all([readFile(path), readFile(`${path}.type`, "utf8").catch(() => "application/octet-stream")]);
      return { bytes, contentType };
    } catch { return undefined; }
  }
}
