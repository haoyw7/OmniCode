import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export type SupervisorLimit = "output_limit" | "diagnostic_limit";

export type SupervisorEvents = {
  line(sessionId: string, stream: "stdout" | "stderr", line: string): void;
  exit(sessionId: string, pid: number, code: number | null, limit?: SupervisorLimit): void;
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  spawning?: { sessionId: string; started?: (pid: number) => void };
};

const BINARY = process.platform === "win32" ? "monocode-supervisor.exe" : "monocode-supervisor";

/** The Rust supervisor ships next to the bundled Host. `MONOCODE_PROVIDER_SUPERVISOR`
 * points at another build, or `node` keeps the per-provider Node guard. */
export function providerSupervisorPath(): string | undefined {
  const configured = process.env.MONOCODE_PROVIDER_SUPERVISOR?.trim();
  if (configured === "node") return undefined;
  if (configured) return configured;
  const bundled = join(dirname(fileURLToPath(import.meta.url)), BINARY);
  return existsSync(bundled) ? bundled : undefined;
}

/** One long-lived Rust process owns every provider tree. Closing its stdin,
 * including when this Host crashes, makes it stop them all. */
export class ProviderSupervisor {
  private process?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<number, Pending>();
  /** The child whose output each session still wants; cleared by kill. */
  private current = new Map<string, number>();
  /** Every child that has not reported its exit yet. */
  private running = new Map<number, string>();
  private nextId = 1;

  constructor(
    private readonly binary: string,
    private readonly events: SupervisorEvents,
  ) {}

  isCurrent(sessionId: string): boolean {
    return this.current.has(sessionId);
  }

  /** `started` runs before any of the child's events are delivered. */
  async spawn(
    sessionId: string,
    request: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv },
    started?: (pid: number) => void,
  ): Promise<number> {
    const env = Object.fromEntries(
      Object.entries(request.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    return Number(await this.request({ op: "spawn", sessionId, ...request, env }, { sessionId, started }));
  }

  async write(sessionId: string, line: string): Promise<void> {
    await this.request({ op: "write", sessionId, line });
  }

  async kill(sessionId: string): Promise<void> {
    this.current.delete(sessionId);
    if (!this.process) return;
    await this.request({ op: "kill", sessionId });
  }

  async killAll(): Promise<void> {
    this.current.clear();
    if (!this.process) return;
    await this.request({ op: "killAll" });
  }

  /** Closing stdin is the supervisor's signal to stop every tree and exit. */
  stop(): void {
    this.process?.stdin.end();
  }

  private async request(message: Record<string, unknown>, spawning?: Pending["spawning"]): Promise<unknown> {
    await this.start();
    const child = this.process;
    if (!child) throw new Error("Provider supervisor is not running");
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, spawning });
      child.stdin.write(`${JSON.stringify({ id, ...message })}\n`, (error) => {
        if (!error || !this.pending.delete(id)) return;
        reject(error);
      });
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const child = spawn(this.binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      // Terminal signals for the Host's group must not skip the cleanup that
      // the supervisor performs when the Host's pipe closes.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    this.process = child;
    child.stdin.on("error", () => {
      /* request callbacks and the close handler report failures */
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => process.stderr.write(`[supervisor] ${data}`));
    this.ready = new Promise<void>((resolve, reject) => {
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
        if (line) this.receive(JSON.parse(line), resolve);
      });
      child.once("error", reject);
      child.once("close", (code) => {
        reject(new Error(`Provider supervisor exited (${code ?? "signal"})`));
        this.stopped(child);
      });
    });
    return this.ready;
  }

  private receive(message: Record<string, any>, ready: () => void): void {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!pending) return;
      if ("error" in message) {
        pending.reject(new Error(String(message.error)));
        return;
      }
      // Register synchronously: the child's first lines can follow in this
      // same chunk, before the awaiting caller resumes.
      if (pending.spawning) {
        this.current.set(pending.spawning.sessionId, message.ok);
        this.running.set(message.ok, pending.spawning.sessionId);
        try {
          pending.spawning.started?.(message.ok);
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)));
          void this.kill(pending.spawning.sessionId).catch(() => undefined);
          return;
        }
      }
      pending.resolve(message.ok);
      return;
    }
    switch (message.event) {
      case "ready":
        ready();
        return;
      case "stdout":
      case "stderr":
        if (this.current.get(message.sessionId) === message.pid)
          this.events.line(message.sessionId, message.event, message.line);
        return;
      case "exit":
        if (this.current.get(message.sessionId) === message.pid)
          this.current.delete(message.sessionId);
        this.running.delete(message.pid);
        this.events.exit(message.sessionId, message.pid, message.code ?? null, message.error);
        return;
    }
  }

  /** Windows job handles die with the supervisor; elsewhere its groups may
   * outlive it, so stop them here before reporting each one as exited. */
  private stopped(child: ChildProcessWithoutNullStreams): void {
    if (this.process !== child) return;
    this.process = undefined;
    this.ready = undefined;
    const error = new Error("Provider supervisor stopped");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.current.clear();
    for (const [pid, sessionId] of this.running) {
      if (process.platform !== "win32")
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      this.events.exit(sessionId, pid, null);
    }
    this.running.clear();
  }
}
