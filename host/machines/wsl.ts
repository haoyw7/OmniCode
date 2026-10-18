import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FRAME_BYTES, readLines, WSL_EXEC_PROTOCOL } from "../wsl-exec-protocol.mjs";
import bootstrapScript from "./wsl-bootstrap.sh?raw";

export interface WslExecutionEvent {
  stream: string;
  kind: "stdout" | "stderr" | "exit" | "sse" | "sse-error" | "sse-close" | "disconnect" | "tcp-open" | "tcp-data" | "tcp-end" | "tcp-close";
  data: unknown;
}

export interface WslConnectionOptions {
  distribution: string;
  runtimeDirectory?: string;
  setupTimeoutMs?: number;
  /** A local stdio process can exercise the transport without a WSL installation. */
  launch?: () => ChildProcessWithoutNullStreams;
}

export class WslRequestError extends Error {
  constructor(message: string, readonly delivered: boolean, readonly code?: string) {
    super(message);
    this.name = "WslRequestError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Connection {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  ready: boolean;
  closed: boolean;
}

export async function wslRuntimeDirectory(configured?: string): Promise<string> {
  const candidates = configured ? [configured] : [
    process.env.MONOCODE_WSL_RUNTIME,
    join(dirname(fileURLToPath(import.meta.url)), "wsl"),
    resolve("build/wsl-host"),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    try { if ((await stat(join(path, "SHA256SUMS"))).isFile() && (await stat(join(path, "wsl-exec.mjs"))).isFile()) return resolve(path); }
    catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  throw new WslRequestError("The WSL execution runtime is missing from this installation.", false);
}

/** One multiplexed wsl.exe stdio connection per machine, owned by the Windows Host. */
export class WslConnection {
  private readonly events = new EventEmitter();
  private nextId = 0;
  private connecting?: Promise<Connection>;
  private active?: Connection;
  private closed = false;

  constructor(private readonly options: WslConnectionOptions) {
    if (!options.distribution.trim() || /[\0\r\n]/.test(options.distribution)) throw new Error("Invalid WSL distribution");
    this.events.setMaxListeners(0);
  }

  onEvent(listener: (event: WslExecutionEvent) => void): () => void {
    this.events.on("event", listener);
    return () => { this.events.off("event", listener); };
  }

  /** Cleanup must not start a distribution merely to stop an unused backend. */
  isConnected(): boolean { return !!this.active?.ready && !this.active.closed; }

  private async connect(): Promise<Connection> {
    if (this.closed) throw new WslRequestError("WSL execution connection is closed", false);
    if (this.active && !this.active.closed) return this.active;
    if (this.connecting) return this.connecting;
    const pending = this.open();
    this.connecting = pending;
    try { return await pending; }
    finally { if (this.connecting === pending) this.connecting = undefined; }
  }

  private async open(): Promise<Connection> {
    const runtime = this.options.launch ? undefined : await wslRuntimeDirectory(this.options.runtimeDirectory);
    if (this.closed) throw new WslRequestError("WSL execution connection is closed", false);
    const child = this.options.launch?.() ?? spawn("wsl.exe", [
      "--distribution", this.options.distribution, "--exec", "bash", "-s", "--", runtime!,
    ], { stdio: "pipe", windowsHide: true });
    const connection: Connection = { child, pending: new Map(), ready: false, closed: false };
    this.active = connection;
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-64 * 1024); });
    return new Promise<Connection>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => fail(new Error("WSL execution setup timed out")), this.options.setupTimeoutMs ?? 300_000);
      const fail = (error: Error) => {
        if (connection.closed) return;
        connection.closed = true;
        clearTimeout(timer);
        const message = stderr.trim() || error.message;
        rejectReady(new WslRequestError(message, false));
        // Once bytes enter the pipe delivery is uncertain. Replaying an exec,
        // write or spawn could duplicate effects even when its reply was lost.
        for (const request of connection.pending.values())
          request.reject(new WslRequestError(`WSL request did not complete; confirm its result before retrying. ${message}`, true));
        connection.pending.clear();
        if (this.active === connection) this.active = undefined;
        child.stdin.destroy();
        child.kill();
        if (connection.ready) this.events.emit("event", { stream: "", kind: "disconnect", data: message } satisfies WslExecutionEvent);
      };
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.once("close", () => fail(new Error("WSL execution connection closed")));
      readLines(child.stdout, (line: string) => {
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(line); }
        catch { fail(new Error("Invalid WSL execution response")); return; }
        if (!connection.ready) {
          if (frame.ready !== WSL_EXEC_PROTOCOL || frame.service !== "wsl-exec") { fail(new Error("Unsupported WSL execution protocol")); return; }
          connection.ready = true;
          clearTimeout(timer);
          resolveReady(connection);
          return;
        }
        if (typeof frame.stream === "string" && typeof frame.kind === "string") {
          this.events.emit("event", frame as unknown as WslExecutionEvent);
          return;
        }
        const request = connection.pending.get(Number(frame.id));
        if (!request) return;
        connection.pending.delete(Number(frame.id));
        if (frame.error && typeof frame.error === "object") {
          const error = frame.error as { message?: string; code?: string };
          request.reject(new WslRequestError(error.message ?? "WSL execution failed", true, error.code));
        } else if (Object.hasOwn(frame, "result")) request.resolve(frame.result);
        else request.reject(new WslRequestError("Invalid WSL execution response", true));
      }, fail);
      if (!this.options.launch) child.stdin.write(`${bootstrapScript.replaceAll("\r\n", "\n").trimEnd()}\n`);
    });
  }

  async request<T = unknown>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const connection = await this.connect();
        if (connection.closed || connection.child.stdin.destroyed || connection.child.stdin.writableEnded)
          throw new WslRequestError("WSL execution disconnected before sending the request", false);
        const id = ++this.nextId;
        const frame = `${JSON.stringify({ ...params, id, op })}\n`;
        if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw new WslRequestError("WSL request exceeds the frame limit", false, "E2BIG");
        return await new Promise<T>((resolveRequest, rejectRequest) => {
          connection.pending.set(id, { resolve: (value) => resolveRequest(value as T), reject: rejectRequest });
          try {
            connection.child.stdin.write(frame, (error) => {
              if (!error) return;
              connection.pending.delete(id);
              rejectRequest(new WslRequestError("WSL request write failed; delivery is uncertain", true, (error as NodeJS.ErrnoException).code));
            });
          } catch (error) {
            connection.pending.delete(id);
            rejectRequest(new WslRequestError((error as Error).message, true));
          }
        });
      } catch (error) {
        if (attempt === 0 && !this.closed && error instanceof WslRequestError && !error.delivered && error.code !== "E2BIG") {
          this.active?.child.kill();
          this.active = undefined;
          continue;
        }
        throw error;
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const active = this.active;
    if (!active) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => { active.child.kill(); done(); }, 1500);
      active.child.once("close", () => { clearTimeout(timer); done(); });
      active.child.stdin.end();
    });
    this.events.removeAllListeners();
  }
}
