import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { readCursorSubagents } from "./cursor-subagents";
import { promisify } from "node:util";
import { isAbsolute, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { ChildBackend } from "../src/integrations/harness/core/child";
import {
  isRemoteProvider,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import { providerLaunch, resolveProvider, resolveProviderRuntime } from "./process";
import {
  MAX_PROVIDER_OUTPUT_BYTES,
  MAX_PROVIDER_DIAGNOSTIC_BYTES,
  ProviderOutputReader,
} from "./provider-output";
import {
  HOST_OUTPUT_LIMIT_ERROR,
  HOST_DIAGNOSTIC_LIMIT_ERROR,
} from "../src/integrations/harness/core/childErrors";
import { readClaudeTitleFile } from "./native-title";
import { defaultProviderAccountHome, namedProviderAccountHome, providerAccountDirectory } from "./provider-accounts";
import type { HostStore } from "./store";
import { claimCheckoutResource } from "./checkout-guards";
import {
  ProviderSupervisor,
  providerSupervisorPath,
  type SupervisorLimit,
} from "./provider-supervisor";
import { randomUUID } from "node:crypto";
import { withProviderAccountLock } from "./provider-account-lock";
import { sharedProviderHome } from "./wsl-provider-config";

const exec = promisify(execFile);
const ALLOWED_EXEC_ARGS = new Set([
  "--version",
  "--list-models",
  "models --verbose",
  "models --json",
  "models",
  "status --json",
  "agent list",
]);

export function execArgsAllowed(provider: RemoteProvider, args: string[]): boolean {
  return (
    ALLOWED_EXEC_ARGS.has(args.join(" ")) ||
    (provider === "grok" &&
      args.length === 4 &&
      args[0] === "--no-auto-update" &&
      args[1] === "sessions" &&
      args[2] === "delete" &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args[3]))
  );
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MONOCODE_HOST: "1" };
  for (const key of ["MONOCODE_CONTROL_ENDPOINT", "MONOCODE_CONTROL_TOKEN", "MONOCODE_APP_ENDPOINT", "MONOCODE_APP_TOKEN"])
    delete env[key];
  return env;
}

function loopbackUrl(value: unknown): string {
  const url = new URL(String(value));
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("OpenCode HTTP is limited to localhost");
  return url.href;
}

/** Native process implementation for the headless execution proof. */
export class HostChildBackend implements ChildBackend {
  private events = new EventEmitter();
  private children = new Map<string, ChildProcessWithoutNullStreams>();
  private outputErrors = new WeakMap<ChildProcessWithoutNullStreams, string>();
  private streams = new Map<string, AbortController>();
  private closing = false;
  private sessionEnvironment?: (id: string) => Record<string, string>;
  private supervisor?: ProviderSupervisor;
  private supervisedReleases = new Map<number, () => void>();

  constructor(
    private readonly binaries: Partial<Record<RemoteProvider, string>> = {},
    private readonly desktopConfigPath?: string,
    private readonly store?: HostStore,
  ) {
    this.events.setMaxListeners(0);
    const supervisor = providerSupervisorPath();
    if (supervisor)
      this.supervisor = new ProviderSupervisor(supervisor, {
        line: (sessionId, stream, line) =>
          this.emit(`harness-${stream}`, { sessionId, line }),
        exit: (sessionId, pid, code, limit) => this.supervisedExit(sessionId, pid, code, limit),
      });
  }

  private supervisedExit(
    sessionId: string,
    pid: number,
    code: number | null,
    limit?: SupervisorLimit,
  ): void {
    this.supervisedReleases.get(pid)?.();
    this.supervisedReleases.delete(pid);
    const error = limit === "output_limit"
      ? HOST_OUTPUT_LIMIT_ERROR
      : limit === "diagnostic_limit" ? HOST_DIAGNOSTIC_LIMIT_ERROR : undefined;
    this.emit("harness-exit", { sessionId, code, pid, ...(error ? { error } : {}) });
  }

  configureSessionEnvironment(environment: (id: string) => Record<string, string>): void {
    this.sessionEnvironment = environment;
  }

  environmentForSession(id: string): Record<string, string> {
    return this.sessionEnvironment?.(id) ?? {};
  }

  async resolve(provider: RemoteProvider): Promise<string> {
    if (this.binaries[provider]) return this.binaries[provider]!;
    if (this.desktopConfigPath) {
      let owner;
      try {
        owner = JSON.parse(await readFile(this.desktopConfigPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const paths = owner?.providerBinaryPaths;
      if (paths !== undefined && (!paths || typeof paths !== "object" || Array.isArray(paths)))
        throw new Error("Invalid desktop CLI path configuration");
      if (paths && Object.hasOwn(paths, provider)) {
        const path = paths[provider];
        if (typeof path !== "string" || !isAbsolute(path) || !(await stat(path)).isFile())
          throw new Error(`Invalid configured ${provider} CLI path`);
        await providerLaunch(path, []);
        return path;
      }
    }
    try { return await resolveProvider(provider); } catch (error) {
      if (!this.desktopConfigPath || !["claude", "codex", "pi", "opencode"].includes(provider)) throw error;
      // A headless/SSH Host remains discovery-only. Desktop ownership opts into
      // verified managed installation when its usual CLI discovery found none.
      try { if (!(await stat(this.desktopConfigPath)).isFile()) throw error; }
      catch { throw error; }
      return (await resolveProviderRuntime(provider, { installMissing: true })).command;
    }
  }

  async listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void> {
    this.events.on(event, handler);
    return () => {
      this.events.off(event, handler);
    };
  }

  private emit(event: string, payload: unknown): void {
    this.events.emit(event, { payload });
  }

  async invoke<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const id = String(args.sessionId ?? "");
    if (command.startsWith("harness_resolve_")) {
      const provider = command.slice("harness_resolve_".length);
      if (!isRemoteProvider(provider))
        throw new Error(`Unsupported provider: ${provider}`);
      return {
        path: await this.resolve(provider),
        ...(provider === "antigravity"
          ? { args: process.platform === "linux" ? ["--uid="] : [] }
          : {}),
      } as T;
    }
    switch (command) {
      case "harness_read_claude_title":
        return await readClaudeTitleFile({ cwd: String(args.cwd ?? ""), providerSessionId: String(args.providerSessionId ?? ""), providerAccountId: typeof args.providerAccountId === "string" ? args.providerAccountId : undefined }, this.desktopConfigPath) as T;
      case "harness_exec": {
        const provider = args.binaryProvider;
        if (!isRemoteProvider(provider))
          throw new Error("Unsupported headless catalog command");
        const commandPath = await this.resolve(provider);
        if (
          args.command !== commandPath ||
          !Array.isArray(args.args) ||
          !args.args.every((arg) => typeof arg === "string") ||
          !execArgsAllowed(provider, args.args)
        )
          throw new Error("Unsupported headless catalog command");
        const launch = await providerLaunch(commandPath, args.args as string[]);
        const { stdout } = await exec(launch.command, launch.args, {
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: childEnvironment(),
        });
        return stdout as T;
      }
      case "harness_free_port": {
        const server = createServer();
        try {
          return await new Promise<T>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (!address || typeof address === "string")
                reject(new Error("Could not reserve a local port"));
              else resolve(address.port as T);
            });
          });
        } finally {
          server.close();
        }
      }
      case "harness_http": {
        const url = loopbackUrl(args.url);
        const response = await fetch(url, {
          method: String(args.method),
          headers: args.headers as Record<string, string> | undefined,
          body: args.body as string | undefined,
          redirect: "error",
          signal: AbortSignal.timeout(
            typeof args.timeoutMs === "number"
              ? Math.max(1, args.timeoutMs)
              : 30_000,
          ),
        });
        return { status: response.status, body: await response.text() } as T;
      }
      case "harness_sse_open": {
        const url = loopbackUrl(args.url);
        this.stopStream(id);
        const controller = new AbortController();
        this.streams.set(id, controller);
        void this.readStream(
          id,
          url,
          args.headers as Record<string, string> | undefined,
          controller,
        );
        return undefined as T;
      }
      case "harness_sse_close":
        this.stopStream(id);
        return undefined as T;
      case "cursor_subagent_runs":
        return await readCursorSubagents(args) as T;
      case "harness_read_text_file": {
        const path = String(args.path ?? "");
        const info = await stat(path);
        if (!info.isFile() || info.size > 8 * 1024 * 1024)
          throw new Error("File is not a readable text file of at most 8 MiB");
        const bytes = await readFile(path);
        if (bytes.includes(0))
          throw new Error("Binary file is not readable as text");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as T;
      }
      case "harness_spawn":
        return (await this.start(id, args)) as T;
      case "harness_write": {
        if (this.supervisor) {
          if (!this.supervisor.isCurrent(id))
            throw new Error("Provider process is not running");
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            this.supervisor.write(id, String(args.line)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Provider stdin write timed out")),
                15_000,
              );
            }),
          ]).finally(() => clearTimeout(timer));
          return undefined as T;
        }
        const child = this.children.get(id);
        if (!child || child.stdin.destroyed)
          throw new Error("Provider process is not running");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Provider stdin write timed out")),
            15_000,
          );
          child.stdin.write(`${String(args.line)}\n`, (error) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          });
        });
        return undefined as T;
      }
      case "harness_kill":
        await this.kill(id);
        return undefined as T;
      case "harness_kill_all":
        await this.close();
        return undefined as T;
      default:
        throw new Error(`Unsupported headless process operation: ${command}`);
    }
  }

  private stopStream(id: string): void {
    this.streams.get(id)?.abort();
    this.streams.delete(id);
  }

  private async readStream(
    id: string,
    url: string,
    headers: Record<string, string> | undefined,
    controller: AbortController,
  ): Promise<void> {
    let error: string | undefined;
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream", ...headers },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          `OpenCode event stream returned HTTP ${response.status}`,
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: string[] = [];
      let dataLength = 0;
      while (!controller.signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 8 * 1024 * 1024)
          throw new Error("OpenCode event stream frame is too large");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (!line) {
            if (data.length)
              this.emit("harness-sse", {
                sessionId: id,
                data: data.join("\n"),
              });
            data = [];
            dataLength = 0;
          } else if (line.startsWith("data:")) {
            const piece = line.slice(5).replace(/^ /, "");
            dataLength += piece.length;
            if (dataLength > 8 * 1024 * 1024)
              throw new Error("OpenCode event stream frame is too large");
            data.push(piece);
          }
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      if (this.streams.get(id) === controller) this.streams.delete(id);
      this.emit("harness-sse-end", { sessionId: id, error });
    }
  }

  private async start(
    id: string,
    args: Record<string, unknown>,
  ): Promise<number> {
    const account = args.account as { provider?: string; id?: string } | undefined;
    const provider = account?.provider ?? args.binaryProvider;
    if (this.desktopConfigPath && (provider === "claude" || provider === "codex"))
      return withProviderAccountLock(`${provider}:${sharedProviderHome(this.desktopConfigPath, provider, account?.id)}`,
        () => this.startUnlocked(id, args));
    return this.startUnlocked(id, args);
  }

  private async startUnlocked(id: string, args: Record<string, unknown>): Promise<number> {
    if (this.closing) throw new Error("Host is stopping");
    await this.kill(id);
    if (this.closing) throw new Error("Host is stopping");
    const account = (args.account as { id?: string; provider?: string } | undefined)
      ?? (["codex", "claude"].includes(String(args.binaryProvider))
        ? { id: "default", provider: String(args.binaryProvider) } : undefined);
    const env = childEnvironment();
    Object.assign(env, this.sessionEnvironment?.(id));
    if (account?.id && (account.id !== "default" || ["codex", "claude"].includes(account.provider ?? ""))) {
      if (!this.desktopConfigPath && account.id !== "default")
        throw new Error("Named provider accounts require a desktop-owned Host");
      if (
        !/^[A-Za-z0-9_-]{1,80}$/.test(account.id) ||
        !["codex", "claude"].includes(account.provider ?? "")
      )
        throw new Error("Invalid provider account");
      let profile: string | undefined;
      if (this.desktopConfigPath) {
        const directory = providerAccountDirectory(this.desktopConfigPath);
        if (!directory && account.id !== "default")
          throw new Error("This provider account is no longer available");
        if (directory) profile = account.id === "default"
          ? defaultProviderAccountHome(directory, account.provider!)
          : namedProviderAccountHome(directory, account.provider!, account.id);
      }
      if (profile) {
        if (!(await stat(profile).catch(() => undefined))?.isDirectory())
          throw new Error("This provider account is no longer available");
        if (account.provider === "codex") {
          env.CODEX_HOME = profile;
          for (const key of [
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "CODEX_ACCESS_TOKEN",
          ])
            delete env[key];
        } else {
          env.CLAUDE_CONFIG_DIR = profile;
          env.CLAUDE_SECURESTORAGE_CONFIG_DIR = profile;
          for (const key of [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
          ])
            delete env[key];
        }
      }
    }
    const launch = await providerLaunch(
      String(args.command),
      args.args as string[],
    );
    if (this.closing) throw new Error("Host is stopping");
    const release = this.store ? claimCheckoutResource(this.store, `host-guard:${randomUUID()}`, String(args.cwd)) : undefined;
    if (this.supervisor) {
      let pid: number;
      try {
        pid = await this.supervisor.spawn(id, {
          command: launch.command,
          args: launch.args,
          cwd: String(args.cwd),
          env,
        }, (pid) => {
          release?.transfer(pid);
          if (release) this.supervisedReleases.set(pid, release);
        });
      } catch (error) {
        release?.();
        throw error;
      }
      if (this.closing) {
        await this.kill(id);
        throw new Error("Host is stopping");
      }
      return pid;
    }
    // Node's spawn overload does not infer the three piped streams when an
    // additional IPC channel is present.
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./provider-guard.mjs", import.meta.url)),
        launch.command,
        ...launch.args,
      ],
      {
        cwd: String(args.cwd),
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        detached: process.platform !== "win32",
        windowsHide: true,
        env,
      },
    ) as ChildProcessWithoutNullStreams;
    this.children.set(id, child);
    child.stdin.on("error", () => {
      /* write callbacks report failures */
    });
    this.lines(child, id, "stdout");
    this.lines(child, id, "stderr");
    child.on("close", (code) => {
      release?.();
      if (this.children.get(id) === child) this.children.delete(id);
      const error = this.outputErrors.get(child);
      this.emit("harness-exit", { sessionId: id, code, pid: child.pid,
        ...(error ? { error } : {}) });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", () => { if (child.pid) release?.transfer(child.pid); resolve(); });
        child.once("error", reject);
      });
    } catch (error) { release?.(); throw error; }
    return child.pid!;
  }

  private lines(
    child: ChildProcessWithoutNullStreams,
    id: string,
    stream: "stdout" | "stderr",
  ): void {
    const reader = new ProviderOutputReader(
      stream === "stdout" ? MAX_PROVIDER_OUTPUT_BYTES : MAX_PROVIDER_DIAGNOSTIC_BYTES,
      (line) => this.emit(`harness-${stream}`, { sessionId: id, line }),
      () => {
        this.outputErrors.set(child,
          stream === "stdout" ? HOST_OUTPUT_LIMIT_ERROR : HOST_DIAGNOSTIC_LIMIT_ERROR);
        void this.kill(id);
      },
    );
    child[stream].setEncoding("utf8");
    child[stream].on("data", (data: string) => {
      if (this.children.get(id) !== child || this.outputErrors.has(child)) return;
      reader.push(data);
    });
    child[stream].on("end", () => {
      if (this.children.get(id) !== child || this.outputErrors.has(child)) return;
      reader.end();
    });
  }

  private signal(
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals,
  ): void {
    try {
      if (process.platform === "win32") child.kill(signal);
      else if (child.pid) process.kill(-child.pid, signal);
    } catch {
      /* already exited */
    }
  }

  async kill(id: string): Promise<void> {
    if (this.supervisor) {
      if (this.supervisor.isCurrent(id)) await this.supervisor.kill(id);
      return;
    }
    const child = this.children.get(id);
    if (!child) return;
    this.children.delete(id);
    if (process.platform === "win32") {
      // Kill descendants while the leader still exists. Closing stdin first
      // can let the leader exit, making its remaining children untraceable.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          await exec(
            join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32",
              "taskkill.exe",
            ),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 10_000 },
          );
        } catch {
          child.kill();
        }
      }
      child.stdin.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return;
    }
    child.stdin.destroy();
    this.signal(child, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.signal(child, "SIGKILL");
        resolve();
        // The guard needs a full second to escalate against the provider's
        // separate process group before we may kill the guard itself.
      }, 3_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const id of this.streams.keys()) this.stopStream(id);
    if (this.supervisor) {
      await this.supervisor.killAll().catch(() => undefined);
      this.supervisor.stop();
      return;
    }
    await Promise.all([...this.children.keys()].map((id) => this.kill(id)));
  }
}
