import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { ChildBackend } from "../src/integrations/harness/core/childBackendRegistry";
import { isRemoteProvider, type RemoteProvider } from "../src/integrations/harness/core/provider";
import type { HostChildBackend } from "./child-backend";
import { execArgsAllowed } from "./child-backend";
import { type MachineIO, type MachineTransport, withMachineIO } from "./machine-io";
import type { WslExecutionEvent } from "./machines/wsl";
import { resolveProviderRuntime } from "./process";
import { ensureProviderRuntime, supportsProviderRuntime, UnsupportedProviderRuntimeError } from "./provider-runtime";
import { ensureWslProviderRuntime } from "./wsl-provider-runtime";
import { withProviderAccountLock } from "./provider-account-lock";
import { sharedProviderHome, wslProviderConfiguration } from "./wsl-provider-config";
import { readClaudeTitleFile } from "./native-title";
import { claimCheckoutResource } from "./checkout-guards";
import { refreshCodexAccountBeforeWsl } from "./provider-account-refresh";
import type { HostStore } from "./store";
import { readWslCursorSubagents } from "./cursor-subagents";
import { WslLoopbackRelay } from "./machines/wsl-relay";
import { assertWslSharedProviderSupported, wslSharedProviderEnvironment } from "./wsl-provider-environment";

type Runtime = { command: string; args?: string[]; version?: string; fallback?: boolean };
const runtimeArguments = (runtime: Runtime, args: string[]): string[] => {
  const prefix = runtime.args ?? [];
  return prefix.every((arg, index) => args[index] === arg) ? args : [...prefix, ...args];
};
type Connection = MachineTransport & { onEvent(listener: (event: WslExecutionEvent) => void): () => void; isConnected?(): boolean };
const names: Record<RemoteProvider, string[]> = {
  claude: ["claude"], codex: ["codex"], pi: ["pi", "pi-coding-agent"], omp: ["omp"],
  opencode: ["opencode"], cursor: ["cursor-agent", "agent"], grok: ["grok"], fx: ["fx"], hermes: ["hermes"], antigravity: ["agy_acp_server.par"],
};

/** Provider protocols are shared; only the process and network endpoints move. */
export class WslChildBackend implements ChildBackend {
  private events = new EventEmitter();
  private children = new Map<string, number>();
  private releases = new Map<number, () => void>();
  private earlyExits = new Map<string, number>();
  private sse = new Map<string, { sessionId: string; buffer: string; data: string[]; error?: string }>();
  private runtime = new Map<string, Runtime>();
  private stopEvents: () => void;
  private closing = false;
  private closePromise?: Promise<void>;
  private relay: WslLoopbackRelay;

  constructor(private readonly rpc: Connection, private readonly io: MachineIO,
    private readonly local: Pick<HostChildBackend, "resolve">, private readonly owner: string,
    private readonly notice: (id: string, warnings: string[]) => void = () => {},
    private readonly resolveOverride?: (provider: RemoteProvider) => Promise<Runtime>,
    private readonly sessionEnvironment: (id: string) => Record<string, string> | Promise<Record<string, string>> = () => ({}),
    private readonly store?: HostStore) {
    this.events.setMaxListeners(0);
    this.relay = new WslLoopbackRelay(rpc);
    this.stopEvents = rpc.onEvent(event => withMachineIO(io, () => this.event(event)));
  }

  private emit(name: string, payload: unknown) { this.events.emit(name, { payload }); }
  private event(event: WslExecutionEvent) {
    if (event.kind === "stdout" || event.kind === "stderr") this.emit(`harness-${event.kind}`, { sessionId: event.stream, line: event.data });
    else if (event.kind === "exit") {
      const value = event.data as { pid?: number; code?: number | null; error?: string };
      if (value.pid) { this.releases.get(value.pid)?.(); this.releases.delete(value.pid); }
      if (this.children.get(event.stream) === value.pid) this.children.delete(event.stream);
      else if (value.pid) this.earlyExits.set(event.stream, value.pid);
      this.emit("harness-exit", { sessionId: event.stream, ...value });
    } else if (event.kind === "sse") {
      const state = this.sse.get(event.stream);
      if (!state) return;
      state.buffer += String(event.data);
      if (state.buffer.length + state.data.join("").length > 8 * 1024 * 1024) {
        state.error = "OpenCode event stream frame is too large";
        void this.rpc.request("net.sseClose", { stream: event.stream }).catch(() => {});
        return;
      }
      let end: number;
      while ((end = state.buffer.indexOf("\n")) >= 0) {
        const line = state.buffer.slice(0, end).replace(/\r$/, "");
        state.buffer = state.buffer.slice(end + 1);
        if (!line) {
          if (state.data.length) this.emit("harness-sse", { sessionId: state.sessionId, data: state.data.join("\n") });
          state.data = [];
        } else if (line.startsWith("data:")) state.data.push(line.slice(5).replace(/^ /, ""));
      }
    } else if (event.kind === "sse-error") {
      const state = this.sse.get(event.stream); if (state) state.error = String(event.data);
    } else if (event.kind === "sse-close") {
      const state = this.sse.get(event.stream); this.sse.delete(event.stream);
      if (state) this.emit("harness-sse-end", { sessionId: state.sessionId, error: state.error });
    } else if (event.kind === "disconnect") {
      for (const [sessionId, pid] of this.children) this.emit("harness-exit", { sessionId, pid, code: null, error: "WSL execution connection was interrupted" });
      this.children.clear();
      for (const release of this.releases.values()) release();
      this.releases.clear();
      for (const { sessionId } of this.sse.values()) this.emit("harness-sse-end", { sessionId, error: "WSL execution connection was interrupted" });
      this.sse.clear();
      this.runtime.clear();
    }
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
    this.events.on(event, handler);
    return () => { this.events.off(event, handler); };
  }

  private async resolve(provider: RemoteProvider): Promise<Runtime> {
    assertWslSharedProviderSupported(provider);
    if (this.resolveOverride) return this.resolveOverride(provider);
    try {
      if (!supportsProviderRuntime(provider)) throw new UnsupportedProviderRuntimeError(provider);
      const desktop = await resolveProviderRuntime(provider, { configuredPath: await this.local.resolve(provider) });
      const info = await this.rpc.request<{ arch: string }>("env.info");
      if (info.arch !== "x64" && info.arch !== "arm64") throw new Error("Unsupported WSL architecture");
      const key = `${provider}:${desktop.version}:${info.arch}`;
      const previous = this.runtime.get(key); if (previous) return previous;
      const artifact = await ensureProviderRuntime(provider, desktop.version, `linux-${info.arch}`);
      const installed = await ensureWslProviderRuntime(this.rpc, artifact);
      const result = { command: installed.command, args: installed.args, version: desktop.version };
      this.runtime.set(key, result);
      return result;
    } catch (error) {
      if (!(error instanceof UnsupportedProviderRuntimeError)) throw error;
      for (const name of names[provider]) {
        const found = await this.rpc.request<{ code: number; stdout: string }>("exec", {
          command: "/bin/sh", args: ["-c", 'command -v -- "$1"', "monocode", name], timeout: 10_000,
        });
        if (found.code === 0 && found.stdout.trim().startsWith("/"))
          return { command: found.stdout.trim(), fallback: true, ...(provider === "antigravity" ? { args: ["--uid="] } : {}) };
      }
      throw new Error(`No Linux runtime is available for ${provider}. Install this provider inside WSL to use the fallback.`);
    }
  }

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closing && command !== "harness_kill_all") throw new Error("Host is stopping");
    const id = String(args.sessionId ?? "");
    if (command.startsWith("harness_resolve_")) {
      const provider = command.slice("harness_resolve_".length);
      if (!isRemoteProvider(provider)) throw new Error("Unsupported provider");
      const runtime = await this.resolve(provider);
      return { path: runtime.command, args: runtime.args } as T;
    }
    switch (command) {
      case "harness_spawn": {
        if (!isRemoteProvider(args.binaryProvider) || !Array.isArray(args.args) || !args.args.every(arg => typeof arg === "string")) throw new Error("Invalid WSL provider process");
        const provider = args.binaryProvider;
        const runtime = await this.resolve(provider);
        if (args.command !== runtime.command) throw new Error("Provider runtime changed; retry the turn");
        const account = args.account as { id?: string; provider?: string } | undefined;
        if (account?.provider && account.provider !== provider) throw new Error("Invalid provider account");
        const start = async () => {
          if (this.closing) throw new Error("Host is stopping");
          await this.rpc.request("process.kill", { stream: id });
          this.earlyExits.delete(id);
          const prepared = provider === "claude" || provider === "codex"
            ? await wslProviderConfiguration({ provider, owner: this.owner, accountId: account?.id, cwd: String(args.cwd), args: args.args as string[], rpc: this.rpc })
            : { args: args.args as string[], env: await wslSharedProviderEnvironment(provider, this.rpc), warnings: [] };
          if (provider === "codex" && "home" in prepared)
            await refreshCodexAccountBeforeWsl({ command: await this.local.resolve("codex"), home: prepared.home, accountId: account?.id });
          const environment = await this.relay.environment(await this.sessionEnvironment(id));
          if (this.closing) throw new Error("Host is stopping");
          const warnings = [...prepared.warnings];
          if (runtime.fallback) warnings.unshift(`Using the provider installed inside WSL: ${provider}`);
          this.notice(id, warnings);
          const release = this.store ? withMachineIO(this.io, () => claimCheckoutResource(this.store!, `host-guard:${randomUUID()}`, String(args.cwd))) : undefined;
          try {
            const result = await this.rpc.request<{ pid: number }>("process.spawn", { stream: id,
              command: runtime.command, args: runtimeArguments(runtime, prepared.args), cwd: args.cwd,
              env: { MONOCODE_HOST: "1", ...environment, ...prepared.env } });
            if (this.earlyExits.get(id) !== result.pid) {
              this.children.set(id, result.pid);
              // Linux PIDs cannot be checked from the Windows registry. Keep
              // the Host as owner until the execution service reports exit.
              if (release) this.releases.set(result.pid, release);
            } else release?.();
            this.earlyExits.delete(id);
            if (this.closing) {
              await this.rpc.request("process.kill", { stream: id });
              this.releases.get(result.pid)?.(); this.releases.delete(result.pid);
              this.children.delete(id);
              throw new Error("Host is stopping");
            }
            return result.pid as T;
          } catch (error) { release?.(); throw error; }
        };
        return provider === "claude" || provider === "codex"
          ? withProviderAccountLock(`${provider}:${sharedProviderHome(this.owner, provider, account?.id)}`, start) : start();
      }
      case "harness_write": return await this.rpc.request("process.write", { stream: id, data: `${String(args.line)}\n` }) as T;
      case "harness_kill": return await this.rpc.request("process.kill", { stream: id }) as T;
      case "harness_kill_all": await this.close(); return undefined as T;
      case "harness_exec": {
        if (!isRemoteProvider(args.binaryProvider) || !Array.isArray(args.args) || !args.args.every(arg => typeof arg === "string") || !execArgsAllowed(args.binaryProvider, args.args)) throw new Error("Unsupported headless catalog command");
        const runtime = await this.resolve(args.binaryProvider);
        if (args.command !== runtime.command) throw new Error("Provider runtime changed; retry the request");
        const provider = args.binaryProvider;
        const account = args.account as { id?: string; provider?: string } | undefined;
        if (account?.provider && account.provider !== provider) throw new Error("Invalid provider account");
        const env = await wslSharedProviderEnvironment(provider, this.rpc, provider === "claude" || provider === "codex"
          ? { dataHome: sharedProviderHome(this.owner, provider, account?.id) } : {});
        const result = await this.rpc.request<{ stdout: string; stderr: string; code: number }>("exec", { command: runtime.command, args: runtimeArguments(runtime, args.args), cwd: args.cwd, env, timeout: 10_000 });
        if (result.code !== 0) throw new Error(result.stderr || "WSL provider command failed");
        return result.stdout as T;
      }
      case "harness_free_port": return this.rpc.request<T>("net.freePort");
      case "harness_http": return this.rpc.request<T>("net.http", { ...args, timeout: args.timeoutMs });
      case "harness_sse_open": {
        for (const [stream, state] of this.sse) if (state.sessionId === id) {
          this.sse.delete(stream);
          await this.rpc.request("net.sseClose", { stream });
        }
        if (this.closing) throw new Error("Host is stopping");
        const stream = `${id}:${randomUUID()}`;
        this.sse.set(stream, { sessionId: id, buffer: "", data: [] });
        try { return await this.rpc.request<T>("net.sseOpen", { ...args, stream }); }
        catch (error) { this.sse.delete(stream); throw error; }
      }
      case "harness_sse_close":
        await Promise.all([...this.sse].filter(([, state]) => state.sessionId === id).map(([stream]) => this.rpc.request("net.sseClose", { stream })));
        return undefined as T;
      case "cursor_subagent_runs": return await readWslCursorSubagents(args, this.rpc) as T;
      case "harness_read_claude_title": return await readClaudeTitleFile(args as { cwd: string; providerSessionId: string }, this.owner) as T;
      case "harness_read_text_file": {
        const path = String(args.path);
        // Native transcripts returned as Windows paths stay on the desktop.
        if (/^(?:[a-z]:[\\/]|\\\\)/i.test(path)) {
          const info = await stat(path); if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("File exceeds the text limit");
          return await readFile(path, "utf8") as T;
        }
        const info = await this.rpc.request<{ size: number }>("fs.stat", { path });
        if (info.size > 8 * 1024 * 1024) throw new Error("File exceeds the text limit");
        return this.rpc.request<T>("fs.readFile", { path, encoding: "utf8" });
      }
      default: throw new Error(`Unsupported WSL process operation: ${command}`);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    return this.closePromise = (async () => {
      try {
        const connected = this.rpc.isConnected?.() ?? true;
        await Promise.all([...(connected ? [this.rpc.request("process.killAll")] : []), this.relay.close(connected),
          ...(connected ? [...this.sse.keys()].map(stream => this.rpc.request("net.sseClose", { stream })) : [])]);
      } finally {
        this.stopEvents(); this.children.clear(); this.sse.clear();
        for (const release of this.releases.values()) release();
        this.releases.clear();
      }
    })();
  }
}
