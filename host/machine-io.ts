import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export interface MachineStat {
  size: number;
  mtimeMs: number;
  mode: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
export interface MachineEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
type WriteOptions = BufferEncoding | { encoding?: BufferEncoding; flag?: "wx"; mode?: number };
export interface MachineFileSystem {
  stat(file: string): Promise<MachineStat>;
  lstat(file: string): Promise<MachineStat>;
  realpath(file: string): Promise<string>;
  readFile(file: string): Promise<Buffer>;
  readFile(file: string, encoding: BufferEncoding): Promise<string>;
  writeFile(file: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
  readdir(file: string, options: { withFileTypes: true }): Promise<MachineEntry[]>;
  readdir(file: string): Promise<string[]>;
  mkdir(file: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  rm(file: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(file: string, destination: string): Promise<void>;
  cp(file: string, destination: string, options?: { recursive?: boolean; errorOnExist?: boolean }): Promise<void>;
  chmod(file: string, mode: number): Promise<void>;
  unlink(file: string): Promise<void>;
  readlink(file: string): Promise<string>;
  hash(file: string): Promise<string>;
  readPrefix(file: string, maxBytes: number, options?: { noFollow?: boolean }): Promise<Buffer>;
}

export type MachineExecOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  windowsHide?: boolean;
  timeout?: number;
  maxBuffer?: number;
  encoding?: BufferEncoding | "buffer";
  input?: string | Buffer;
};
export interface MachineIO {
  readonly key: string;
  readonly pathStyle: "win32" | "posix";
  readonly path: typeof path.posix;
  readonly fs: MachineFileSystem;
  /** Runtime Node on this execution machine, independent of the login PATH. */
  nodePath(): Promise<string>;
  /** Map Host-owned data (accounts, scratch files, user skills) into this machine. */
  hostPath(file: string): Promise<string>;
  exec(command: string, args: string[], options: MachineExecOptions & { encoding: "buffer" }): Promise<{ stdout: Buffer; stderr: Buffer }>;
  exec(command: string, args: string[], options?: MachineExecOptions): Promise<{ stdout: string; stderr: string }>;
}

/** Machine selection follows an async operation, never a process-global active project. */
const scope = new AsyncLocalStorage<MachineIO>();
export const withMachineIO = <T>(io: MachineIO, operation: () => T): T => scope.run(io, operation);
export const currentMachineIO = (): MachineIO => scope.getStore() ?? localMachineIO;

export function assertMachinePath(file: string, io: Pick<MachineIO, "key" | "pathStyle"> = currentMachineIO()): void {
  const style = io.pathStyle === "win32" ? path.win32 : path.posix;
  if (!file || file.includes("\0") || !style.isAbsolute(file) ||
    (io.pathStyle === "win32" && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/i.test(file)) ||
    (io.pathStyle === "posix" && /^(?:[a-z]:[\\/]|\\\\)/i.test(file)) ||
    /^[/\\]{2}wsl(?:\.localhost|\$)[/\\]/i.test(file))
    throw new Error(`Invalid ${io.pathStyle} path for machine ${io.key}: ${file}`);
}

/** Synchronous callers cannot cross the WSL transport. Fail before touching local disk. */
export function assertLocalMachinePath(file: string): void {
  if (currentMachineIO().key !== "local")
    throw new Error("This synchronous operation requires the local machine");
  assertMachinePath(file, localMachineIO);
}

const localExec = promisify(execFile);
const localFs = new Proxy(fs, {
  get(target, property) {
    if (property === "hash") return async (file: string) => {
      assertMachinePath(file, localMachineIO);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest("hex");
    };
    if (property === "readPrefix") return async (file: string, maxBytes: number, options?: { noFollow?: boolean }) => {
      assertMachinePath(file, localMachineIO);
      const handle = await fs.open(file, options?.noFollow ? constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) : "r");
      try {
        const buffer = Buffer.alloc(Math.min(maxBytes, (await handle.stat()).size));
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        return buffer.subarray(0, offset);
      } finally { await handle.close(); }
    };
    const method = Reflect.get(target, property);
    if (typeof method !== "function") return method;
    return (file: string, ...args: unknown[]) => {
      assertMachinePath(file, localMachineIO);
      if (property === "rename" || property === "cp") assertMachinePath(args[0] as string, localMachineIO);
      return method(file, ...args);
    };
  },
}) as unknown as MachineFileSystem;

export const localMachineIO: MachineIO = {
  key: "local",
  pathStyle: process.platform === "win32" ? "win32" : "posix",
  path,
  fs: localFs,
  nodePath: async () => process.execPath,
  hostPath: async (file) => { assertMachinePath(file, localMachineIO); return file; },
  exec: (async (command: string, args: string[], options: MachineExecOptions = {}) => {
    if (options.cwd) assertMachinePath(options.cwd, localMachineIO);
    const { input, ...native } = options;
    const pending = localExec(command, args, { ...native, encoding: options.encoding ?? "utf8" });
    if (input !== undefined) {
      pending.child.stdin?.on("error", () => {}); // execFile reports process failure through pending.
      pending.child.stdin?.end(input);
    }
    return pending;
  }) as MachineIO["exec"],
};

export interface MachineTransport {
  request<T>(op: string, params?: Record<string, unknown>): Promise<T>;
}
type WireStat = { size: number; mtimeMs: number; mode: number; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean };
const statMethods = <T extends Pick<WireStat, "isFile" | "isDirectory" | "isSymbolicLink">>(value: T) => ({
  ...value,
  isFile: () => value.isFile,
  isDirectory: () => value.isDirectory,
  isSymbolicLink: () => value.isSymbolicLink,
});

/** Linux workspaces are accessed over RPC, including Git; UNC/9P paths are rejected. */
export class WslMachineIO implements MachineIO {
  readonly key: string;
  readonly pathStyle = "posix" as const;
  readonly path = path.posix;
  readonly fs: MachineFileSystem;

  async nodePath(): Promise<string> {
    const { node } = await this.transport.request<{ node: string }>("env.info");
    assertMachinePath(node, this);
    return node;
  }

  constructor(distribution: string, private readonly transport: MachineTransport) {
    if (!distribution || /[\0\r\n]/.test(distribution)) throw new Error("Invalid WSL distribution");
    this.key = `wsl:${distribution}`;
    const request = <T>(op: string, file: string, params: Record<string, unknown> = {}) => {
      assertMachinePath(file, this);
      if (typeof params.destination === "string") assertMachinePath(params.destination, this);
      return transport.request<T>(op, { path: file, ...params });
    };
    this.fs = {
      stat: async (file) => statMethods(await request<WireStat>("fs.stat", file)),
      lstat: async (file) => statMethods(await request<WireStat>("fs.stat", file, { followSymlinks: false })),
      realpath: (file) => request<string>("fs.realpath", file),
      readFile: (async (file: string, encoding?: BufferEncoding) => {
        const bytes = Buffer.from(await request<string>("fs.readFile", file, { encoding: "base64" }), "base64");
        return encoding ? bytes.toString(encoding) : bytes;
      }) as MachineFileSystem["readFile"],
      writeFile: async (file, data, options) => {
        const settings = typeof options === "string" ? { encoding: options } : options;
        await request("fs.writeFile", file, {
          data: (typeof data === "string" ? Buffer.from(data, settings?.encoding) : Buffer.from(data)).toString("base64"),
          encoding: "base64", mode: settings?.mode, flag: settings?.flag,
        });
      },
      readdir: (async (file: string, options?: { withFileTypes: true }) => {
        const entries = await request<Array<WireStat & { name: string }>>("fs.readdir", file);
        return options?.withFileTypes ? entries.map(statMethods) : entries.map((entry) => entry.name);
      }) as MachineFileSystem["readdir"],
      mkdir: (file, options) => request<string | undefined>("fs.mkdir", file, options),
      rm: (file, options) => request<void>("fs.rm", file, options),
      rename: (file, destination) => request<void>("fs.rename", file, { destination }),
      cp: (file, destination, options) => request<void>("fs.cp", file, { destination, ...options }),
      chmod: (file, mode) => request<void>("fs.chmod", file, { mode }),
      unlink: (file) => request<void>("fs.rm", file),
      readlink: (file) => request<string>("fs.readlink", file),
      hash: (file) => request<string>("fs.hash", file, { algorithm: "sha256" }),
      readPrefix: async (file, maxBytes, options) => Buffer.from(await request<string>("fs.readPrefix", file, { maxBytes, ...options }), "base64"),
    };
  }

  async hostPath(file: string): Promise<string> {
    assertMachinePath(file, localMachineIO);
    const mapped = (await this.exec("wslpath", ["-a", file])).stdout.trim();
    assertMachinePath(mapped, this);
    return mapped;
  }

  exec(command: string, args: string[], options: MachineExecOptions & { encoding: "buffer" }): Promise<{ stdout: Buffer; stderr: Buffer }>;
  exec(command: string, args: string[], options?: MachineExecOptions): Promise<{ stdout: string; stderr: string }>;
  async exec(command: string, args: string[], options: MachineExecOptions = {}): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
    if (options.cwd) assertMachinePath(options.cwd, this);
    if (/^(?:[a-z]:[\\/]|\\\\)/i.test(command)) throw new Error("Windows executable cannot run in WSL");
    const result = await this.transport.request<{ stdout: string; stderr: string; code: number | null; signal: string | null }>("exec", {
      command, args, cwd: options.cwd,
      env: options.env ? Object.fromEntries(Object.entries(options.env).map(([key, value]) => [key, value ?? null])) : undefined,
      stdin: options.input === undefined ? undefined : Buffer.from(options.input).toString("base64"),
      encoding: "base64", timeout: options.timeout,
      maxBuffer: options.maxBuffer === Infinity ? 2 ** 31 - 1 : options.maxBuffer,
    });
    const decode = (data: string) => options.encoding === "buffer" ? Buffer.from(data, "base64") : Buffer.from(data, "base64").toString(options.encoding ?? "utf8");
    const output = { stdout: decode(result.stdout), stderr: decode(result.stderr) };
    if (result.code !== 0)
      throw Object.assign(new Error(output.stderr.toString() || `${command} exited ${result.code ?? result.signal}`), { ...output, code: result.code, signal: result.signal });
    return output;
  }
}

export const machineFs = new Proxy({} as MachineFileSystem, {
  get(_target, property: keyof MachineFileSystem) {
    const io = currentMachineIO();
    return io.fs[property].bind(io.fs);
  },
});
export const machinePath = new Proxy({} as typeof path.posix, {
  get(_target, property: keyof typeof path.posix) {
    const io = currentMachineIO();
    const value = io.path[property];
    if (typeof value !== "function") return value;
    return (...args: string[]) => {
      // Reject the other OS's absolute syntax before resolve can reinterpret it.
      if (property === "resolve" || property === "relative" || property === "join")
        for (const arg of args)
          if (/^(?:[/\\]|[a-z]:)/i.test(arg)) assertMachinePath(arg, io);
      return (value as (...args: string[]) => unknown)(...args);
    };
  },
});
export const machineExec: MachineIO["exec"] = ((...args: Parameters<MachineIO["exec"]>) => currentMachineIO().exec(...args)) as MachineIO["exec"];
/** Do not pass Windows PATH/HOME into Linux subprocesses. */
export const machineEnvironment = (): NodeJS.ProcessEnv => currentMachineIO().key === "local" ? process.env : {};
