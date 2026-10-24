import { homedir } from "node:os";
import type { McpConnection, McpInspection, McpJobRequest, McpJobResult, McpJobView, McpProvider, McpScope, PiMcpList } from "../src/contracts/mcp";
import {
  resolveClaudeBinary, resolveCodexBinary, resolveCursorBinary, resolveOpenCodeBinary, resolvePiBinary,
} from "../src/integrations/harness/core/child";
import inspectorSource from "./mcp-inspector.mjs?raw";
import { resolveHostWorktreeAsync } from "./git-worktrees";
import { currentMachineIO, type MachineIO } from "./machine-io";
import {
  claudeDesktopConfig, configuredWsServers, discoverMcp, expandHome, opencodeConfigPath, piConfigPath,
  serverConfig, serverFromJson, validMcpName, writeJsonServer, writeOpencodeServer, type McpMachineContext,
} from "./mcp-config";
import { providerLaunch } from "./process";
import type { HostStore } from "./store";

const RETAIN_MS = 5 * 60_000;
const READ_WAIT_MS = 15_000;
const INSPECT_DEADLINE_MS = 5 * 60_000;
const PROVIDERS = ["claude", "claude_desktop", "codex", "cursor", "opencode", "pi"] as const;
const SCOPES = ["local", "project", "user"] as const;
type CliProvider = "claude" | "codex" | "cursor" | "opencode" | "pi";
type Binary = { path: string; args?: string[] };
type CommandOutput = { stdout: string; stderr: string };

export type HostMcpDependencies = {
  /** Home and provider path overrides on the selected execution machine. */
  context(io: MachineIO): Promise<McpMachineContext>;
  resolve(provider: CliProvider): Promise<Binary>;
  /** Runs a provider CLI on the selected machine. Rejects with stdout/stderr attached. */
  run(binary: Binary, args: string[], options: { cwd: string; timeout: number }): Promise<CommandOutput>;
  inspect(config: Record<string, unknown>, projectDir: string): Promise<McpInspection>;
};

const resolvers: Record<CliProvider, (path?: string | null) => Promise<Binary>> = {
  claude: resolveClaudeBinary, codex: resolveCodexBinary, cursor: resolveCursorBinary, opencode: resolveOpenCodeBinary, pi: resolvePiBinary,
};

async function machineContext(io: MachineIO): Promise<McpMachineContext> {
  const keys = ["CODEX_HOME", "OPENCODE_CONFIG", "PI_CODING_AGENT_DIR", "APPDATA"] as const;
  const pick = (env: Record<string, string | undefined>) =>
    Object.fromEntries(keys.flatMap((key) => env[key] ? [[key, env[key]!]] : [])) as McpMachineContext["env"];
  if (io.key === "local") return { io, home: homedir(), env: pick(process.env), platform: process.platform };
  const script = `process.stdout.write(JSON.stringify({home:require("os").homedir(),platform:process.platform,env:Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,process.env[k]]))}))`;
  const { stdout } = await io.exec(await io.nodePath(), ["-e", script], { timeout: 15_000 });
  const value = JSON.parse(stdout) as { home: string; platform: NodeJS.Platform; env: Record<string, string | undefined> };
  return { io, home: value.home, env: pick(value.env), platform: value.platform };
}

async function runCli(binary: Binary, args: string[], options: { cwd: string; timeout: number }): Promise<CommandOutput> {
  const io = currentMachineIO();
  const argv = [...(binary.args ?? []), ...args];
  const launch = io.key === "local" ? await providerLaunch(binary.path, argv) : { command: binary.path, args: argv };
  return io.exec(launch.command, launch.args, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

// The inspector runs as a short-lived Node process on the execution machine so
// stdio servers, env expansion and network requests resolve where providers run.
const BOOTSTRAP = `let d="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>d+=c);process.stdin.on("end",async()=>{let o;try{const{source,input}=JSON.parse(d);const m=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));o={ok:true,inspection:await m.inspectServer(input)}}catch(e){o={ok:false,error:e instanceof Error?e.message:String(e)}}process.stdout.write(JSON.stringify(o),()=>process.exit(0))});setTimeout(()=>process.exit(2),${INSPECT_DEADLINE_MS}).unref()`;

async function inspectOnMachine(config: Record<string, unknown>, projectDir: string): Promise<McpInspection> {
  const io = currentMachineIO();
  const input = JSON.stringify({ source: inspectorSource, input: { config, projectDir, clientVersion: "1" } });
  let stdout: string;
  try {
    ({ stdout } = await io.exec(await io.nodePath(), ["--input-type=module", "-e", BOOTSTRAP],
      { input, timeout: INSPECT_DEADLINE_MS + 10_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    stdout = String((error as { stdout?: unknown }).stdout ?? "");
    if (!stdout) throw new Error("MCP inspection did not finish");
  }
  const result = JSON.parse(stdout) as { ok: true; inspection: McpInspection } | { ok: false; error: string };
  if (!result.ok) throw new Error(result.error);
  return result.inspection;
}

export const defaultMcpDependencies: HostMcpDependencies = {
  context: machineContext,
  resolve: (provider) => resolvers[provider](),
  run: runCli,
  inspect: inspectOnMachine,
};

function commandError(error: unknown): Error {
  const value = error as { stdout?: unknown; stderr?: unknown; message?: string };
  if (value && (value.stdout !== undefined || value.stderr !== undefined)) {
    const text = `${String(value.stderr ?? "").trim()} ${String(value.stdout ?? "")}`.trim();
    if (text) return new Error(text);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function oneOf<T extends string>(value: unknown, values: readonly T[], message: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(message);
  return value as T;
}

function text(value: unknown, message: string, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error(message);
  return value;
}

function decode(input: Record<string, unknown>): McpJobRequest {
  const requestId = text(input.requestId, "Invalid MCP request ID", 100);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new Error("Invalid MCP request ID");
  const projectId = text(input.projectId, "Invalid MCP request", 200);
  if (!projectId) throw new Error("Invalid MCP request");
  const cwd = input.cwd === undefined ? undefined : text(input.cwd, "Invalid MCP request");
  const base = { requestId, projectId, ...(cwd !== undefined ? { cwd } : {}) };
  const provider = () => oneOf(input.provider, PROVIDERS, "Unsupported MCP provider");
  const scope = () => oneOf(input.scope, SCOPES, "Invalid MCP scope");
  const name = () => text(input.name, "Invalid MCP server name", 256);
  switch (input.operation) {
    case "add": return { ...base, operation: "add", provider: provider(), scope: scope(), name: name(), config: text(input.config, "Invalid MCP configuration", 1_000_000) };
    case "remove": return { ...base, operation: "remove", scope: scope(), name: name() };
    case "login": return { ...base, operation: "login", provider: provider(), name: name() };
    case "inspect": return { ...base, operation: "inspect", provider: provider(), scope: scope(), name: name(), configPath: text(input.configPath, "Invalid MCP configuration path") };
    case "claudeList": case "piList": return { ...base, operation: input.operation };
    default: throw new Error("Unsupported MCP operation");
  }
}

function parsePiList(output: string): PiMcpList {
  let report: { servers?: unknown; errors?: unknown; note?: unknown };
  try { report = JSON.parse(output); } catch { throw new Error("Invalid Pi MCP status response"); }
  if (!Array.isArray(report.servers) || !Array.isArray(report.errors)) throw new Error("Invalid Pi MCP status response");
  const optional = (value: unknown) => typeof value === "number" ? value : null;
  return {
    servers: report.servers.map((raw) => {
      const server = raw as Record<string, unknown>;
      if (typeof server.name !== "string" || typeof server.scope !== "string" || typeof server.source !== "string" ||
        typeof server.enabled !== "boolean" || typeof server.state !== "string" || !Array.isArray(server.tools))
        throw new Error("Invalid Pi MCP status response");
      // Selected metadata only; tool schemas and raw configuration stay on the Host.
      return { name: server.name, scope: server.scope, source: server.source, enabled: server.enabled, state: server.state,
        toolCount: server.tools.length, resources: optional(server.resources), resourceTemplates: optional(server.resourceTemplates),
        override: typeof server.override === "string" ? server.override : null, error: typeof server.error === "string" ? server.error : null };
    }),
    errors: report.errors.map(String),
    note: typeof report.note === "string" ? report.note : null,
  };
}

function cliAddArgs(provider: "claude" | "codex", scope: McpScope, name: string, config: Record<string, unknown>): string[] {
  if (provider === "claude") return ["mcp", "add-json", name, JSON.stringify(config), "--scope", scope];
  if (scope !== "user") throw new Error("Codex CLI adds user-scoped servers only");
  const remote = typeof config.url === "string" ? config.url : undefined;
  const allowed = remote !== undefined ? ["type", "url", "bearerTokenEnvVar"] : ["type", "command", "args", "env"];
  const unknown = Object.keys(config).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${provider} add cannot preserve '${unknown}'; edit its config file instead`);
  const kind = typeof config.type === "string" ? config.type : undefined;
  if (remote !== undefined && ![undefined, "http", "remote"].includes(kind)) throw new Error(`${provider} CLI supports HTTP URLs only`);
  if (remote === undefined && ![undefined, "stdio", "local"].includes(kind)) throw new Error("Local server type must be stdio");
  const args = ["mcp", "add", name];
  if (remote !== undefined) {
    let parsed: URL;
    try { parsed = new URL(remote); } catch { throw new Error("Invalid server URL"); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP URL must use HTTP or HTTPS");
    args.push("--url", remote);
    if (typeof config.bearerTokenEnvVar === "string") args.push("--bearer-token-env-var", config.bearerTokenEnvVar);
    return args;
  }
  if (config.env !== undefined) {
    if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) throw new Error("env must be an object");
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value !== "string") throw new Error("env values must be strings");
      args.push("--env", `${key}=${value}`);
    }
  }
  if (typeof config.command !== "string" || !config.command) throw new Error("Local server needs a command");
  if (config.args !== undefined && !Array.isArray(config.args)) throw new Error("args must be an array");
  const parameters = (config.args as unknown[] | undefined) ?? [];
  if (parameters.some((value) => typeof value !== "string")) throw new Error("args must contain strings");
  return [...args, "--", config.command, ...parameters as string[]];
}

type JobRecord = { fingerprint: string; view: McpJobView; finished?: number; settled: Promise<void>; cancelled: boolean };

/** MCP configuration, provider CLI management and server inspection on the
 * project's execution machine. Credentials in configs never leave the Host:
 * discovery returns names and paths, inspection returns server metadata. */
export class HostMcp {
  private readonly jobs = new Map<string, JobRecord>();
  private closed = false;

  constructor(private readonly store: Pick<HostStore, "project">, private readonly deps: HostMcpDependencies = defaultMcpDependencies) {}

  private async projectDirectory(projectId: unknown, cwd: unknown): Promise<string> {
    if (typeof projectId !== "string" || !projectId) throw new Error("Invalid MCP request");
    const project = this.store.project(projectId);
    return resolveHostWorktreeAsync(project.cwd, cwd);
  }

  async discover(params: Record<string, unknown>): Promise<McpConnection[]> {
    const project = await this.projectDirectory(params.projectId, params.cwd);
    return discoverMcp(await this.deps.context(currentMachineIO()), project);
  }

  start(owner: string, raw: Record<string, unknown>): McpJobView {
    if (this.closed) throw new Error("Host is shutting down");
    this.prune();
    const input = decode(raw);
    const key = `${owner}:${input.requestId}`;
    // Hash nothing secret into logs; the fingerprint only stays in memory.
    const fingerprint = JSON.stringify([currentMachineIO().key, input]);
    const existing = this.jobs.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("MCP request ID was already used with different content");
      return existing.view;
    }
    if (this.jobs.size >= 256 || [...this.jobs].filter(([id, job]) => id.startsWith(`${owner}:`) && job.view.status === "running").length >= 8)
      throw new Error("Too many MCP requests");
    const record: JobRecord = { fingerprint, view: { status: "running" }, settled: Promise.resolve(), cancelled: false };
    this.jobs.set(key, record);
    record.settled = Promise.resolve().then(() => this.execute(input)).then(
      (result) => { if (!record.cancelled) record.view = { status: "completed", result }; },
      (error) => { if (!record.cancelled) record.view = { status: "failed", error: error instanceof Error ? error.message : String(error) }; },
    ).finally(() => { record.finished = Date.now(); });
    return record.view;
  }

  /** Waits briefly for completion so long jobs need few polls but no request
   * approaches the client's HTTP timeout. */
  async status(owner: string, params: Record<string, unknown>, waitMs = READ_WAIT_MS): Promise<McpJobView> {
    this.prune();
    const id = text(params.requestId, "Invalid MCP request ID", 100);
    const job = this.jobs.get(`${owner}:${id}`);
    if (!job) throw new Error("MCP request is unavailable");
    if (job.view.status === "running") {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([job.settled, new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })]); }
      finally { clearTimeout(timer); }
    }
    return job.view;
  }

  /** Stops reporting a job. Provider CLIs that already started may still finish. */
  cancel(owner: string, params: Record<string, unknown>): McpJobView {
    const id = text(params.requestId, "Invalid MCP request ID", 100);
    const job = this.jobs.get(`${owner}:${id}`);
    if (!job) throw new Error("MCP request is unavailable");
    if (job.view.status === "running") { job.cancelled = true; job.view = { status: "cancelled" }; }
    return job.view;
  }

  close(): void {
    this.closed = true;
    this.jobs.clear();
  }

  private prune() {
    for (const [key, job] of this.jobs)
      if (job.finished && Date.now() - job.finished > RETAIN_MS) this.jobs.delete(key);
  }

  private async cli(provider: CliProvider, args: string[], cwd: string, timeout: number): Promise<string> {
    const binary = await this.deps.resolve(provider).catch((error) => {
      throw new Error(`${provider} CLI not found${error instanceof Error && error.message ? `: ${error.message}` : ""}`);
    });
    try { return (await this.deps.run(binary, args, { cwd, timeout })).stdout.trim(); }
    catch (error) { throw commandError(error); }
  }

  private async opencodeMajor(cwd: string): Promise<number> {
    const version = await this.cli("opencode", ["--version"], cwd, 10_000);
    const major = version.split(/\s+/).map((part) => Number.parseInt(part.replace(/^v/, "").split(".")[0], 10)).find(Number.isFinite);
    if (major !== 1 && major !== 2) throw new Error(`Unsupported OpenCode version: ${version}`);
    return major;
  }

  private async execute(input: McpJobRequest): Promise<McpJobResult> {
    const project = await this.projectDirectory(input.projectId, input.cwd);
    const io = currentMachineIO();
    switch (input.operation) {
      case "claudeList": {
        let output = await this.cli("claude", ["mcp", "list"], project, 30_000);
        for (const name of await configuredWsServers(await this.deps.context(io), project))
          if (!output.split("\n").some((line) => line.startsWith(`${name}:`)))
            output += `\n${name}: WebSocket server (open Claude /mcp for status)`;
        return { operation: "claudeList", output };
      }
      case "piList": {
        const binary = await this.deps.resolve("pi");
        let stdout: string;
        // Pi exits 1 for needs-auth, failed servers and invalid configuration,
        // while still returning a useful JSON report.
        try { stdout = (await this.deps.run(binary, ["mcp", "list", "--json"], { cwd: project, timeout: 60_000 })).stdout; }
        catch (error) {
          stdout = String((error as { stdout?: unknown }).stdout ?? "");
          if (!stdout.trim()) throw commandError(error);
        }
        return { operation: "piList", report: parsePiList(stdout) };
      }
      case "login": {
        const valid = input.provider === "opencode" ? !!input.name.trim() && !/[\u0000-\u001f\u007f]/.test(input.name) : validMcpName(input.name);
        if (!valid) throw new Error("Invalid MCP server name");
        if (input.provider === "claude_desktop") throw new Error("Unsupported MCP provider");
        // Interactive OAuth: preserve the provider's sign-in window (Pi waits longer).
        await this.cli(input.provider, ["mcp", input.provider === "opencode" ? "auth" : "login", input.name], project,
          input.provider === "pi" ? 330_000 : 180_000);
        return { operation: "login" };
      }
      case "remove": {
        if (!validMcpName(input.name)) throw new Error("Invalid MCP server name");
        await this.cli("claude", ["mcp", "remove", input.name, "--scope", input.scope], project, 30_000);
        return { operation: "remove" };
      }
      case "inspect": {
        const context = await this.deps.context(io);
        const config = await serverConfig(context, input, project);
        return { operation: "inspect", inspection: await this.deps.inspect(config, project) };
      }
      case "add": {
        const { name, server } = serverFromJson(input.provider, input.name, input.config);
        if (!await io.fs.stat(project).then((value) => value.isDirectory(), () => false)) throw new Error("Project directory does not exist");
        const context = await this.deps.context(io);
        const provider: McpProvider = input.provider;
        if (provider === "claude" || provider === "codex") {
          await this.cli(provider, cliAddArgs(provider, input.scope, name, server), project, 30_000);
        } else if (provider === "opencode") {
          if (input.scope !== "user" && input.scope !== "project") throw new Error("Invalid OpenCode MCP scope");
          const major = await this.opencodeMajor(project);
          await writeOpencodeServer(io, await opencodeConfigPath(context, project, input.scope), name, server, major);
        } else {
          let file: string;
          if (provider === "cursor" && input.scope === "user") file = io.path.join(context.home, ".cursor/mcp.json");
          else if (provider === "cursor" && input.scope === "project") file = io.path.join(project, ".cursor/mcp.json");
          else if (provider === "claude_desktop" && input.scope === "user") file = claudeDesktopConfig(context);
          else if (provider === "pi") file = piConfigPath(context, project, input.scope);
          else throw new Error("Unsupported scope for this provider");
          if (provider === "claude_desktop" && server.command === undefined) throw new Error("Claude Desktop local configuration requires a command");
          await writeJsonServer(io, expandHome(context, file), name, server);
        }
        return { operation: "add" };
      }
    }
  }
}
