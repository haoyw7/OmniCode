import { randomUUID } from "node:crypto";
import { parse as parseToml } from "smol-toml";
import type { McpConnection, McpProvider, McpScope } from "../src/contracts/mcp";
import type { MachineIO } from "./machine-io";

type Json = Record<string, unknown>;
export type McpMachineContext = {
  io: MachineIO;
  home: string;
  /** Provider path overrides read from the execution machine's environment. */
  env: Partial<Record<"CODEX_HOME" | "OPENCODE_CONFIG" | "PI_CODING_AGENT_DIR" | "APPDATA", string>>;
  platform: NodeJS.Platform;
};

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

export function expandHome(context: McpMachineContext, file: string): string {
  if (file === "~") return context.home;
  if (/^~[\\/]/.test(file)) return context.io.path.join(context.home, file.slice(2));
  return file;
}

export function claudeDesktopConfig(context: McpMachineContext): string {
  const { path } = context.io;
  if (context.platform === "darwin") return path.join(context.home, "Library/Application Support/Claude/claude_desktop_config.json");
  if (context.platform === "win32")
    return path.join(context.env.APPDATA || path.join(context.home, "AppData/Roaming"), "Claude/claude_desktop_config.json");
  return path.join(context.home, ".config/Claude/claude_desktop_config.json");
}

const piAgentDir = (context: McpMachineContext) =>
  context.env.PI_CODING_AGENT_DIR ? expandHome(context, context.env.PI_CODING_AGENT_DIR) : undefined;

export function piConfigPath(context: McpMachineContext, project: string, scope: string): string {
  const { path } = context.io;
  if (scope === "user") return path.join(piAgentDir(context) ?? path.join(context.home, ".pi/agent"), "mcp.json");
  if (scope === "project") return path.join(project, ".pi/mcp.json");
  throw new Error("Unsupported scope for Pi");
}

async function exists(io: MachineIO, file: string) {
  return io.fs.stat(file).then(() => true, () => false);
}

export async function opencodeConfigPath(context: McpMachineContext, project: string, scope: string): Promise<string> {
  const { path } = context.io;
  if (scope === "user" && context.env.OPENCODE_CONFIG) return context.env.OPENCODE_CONFIG;
  const directory = scope === "user" ? path.join(context.home, ".config/opencode") : project;
  const candidates = scope === "user" ? ["opencode.json", "opencode.jsonc"]
    : ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"];
  for (const name of candidates) if (await exists(context.io, path.join(directory, name))) return path.join(directory, name);
  return path.join(directory, "opencode.json");
}

/** Remove JSONC comments and trailing commas without touching quoted text. */
export function stripJsonc(raw: string): string {
  let clean = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      clean += char;
      if (char === "\\" && index + 1 < raw.length) clean += raw[++index];
      else if (char === "\"") quoted = false;
    } else if (char === "\"") {
      quoted = true;
      clean += char;
    } else if (char === "/" && raw[index + 1] === "/") {
      while (index < raw.length && raw[index] !== "\n") index++;
      clean += "\n";
    } else if (char === "/" && raw[index + 1] === "*") {
      index += 2;
      while (index + 1 < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) index++;
      index++;
    } else clean += char;
  }
  let result = "";
  quoted = false;
  let escaped = false;
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
    } else if (char === "\"") quoted = true;
    if (!quoted && char === "," && /^\s*[}\]]/.test(clean.slice(index + 1))) continue;
    result += char;
  }
  return result;
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return JSON.parse(stripJsonc(raw)); }
}

export async function readJson(io: MachineIO, file: string): Promise<unknown> {
  try { return parseJson(await io.fs.readFile(file, "utf8")); } catch { return undefined; }
}

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validMcpName(name: string): boolean {
  return SERVER_NAME.test(name);
}

export function serverFromJson(provider: string, name: string, config: string): { name: string; server: Json } {
  let value: unknown;
  try { value = JSON.parse(config); } catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  let server: unknown;
  if (isObject(value) && "mcpServers" in value) {
    const servers = value.mcpServers;
    if (!isObject(servers)) throw new Error("mcpServers must be an object");
    const entries = Object.entries(servers);
    if (entries.length !== 1) throw new Error("Add one server at a time");
    const [serverName, entry] = entries[0];
    if (name.trim() && name.trim() !== serverName) throw new Error("Name does not match the mcpServers entry");
    name = serverName;
    server = entry;
  } else {
    name = name.trim();
    server = value;
  }
  if (!name || CONTROL.test(name)) throw new Error("Server name cannot be empty or contain control characters");
  if (provider !== "opencode" && !validMcpName(name)) throw new Error("Server name must use letters, numbers, hyphens, or underscores");
  if (!isObject(server)) throw new Error("Server configuration must be an object");
  server = structuredClone(server) as Json;
  const object = server as Json;
  if (provider === "opencode" && Array.isArray(object.command)) {
    if (!object.command.every((part): part is string => typeof part === "string" && !!part))
      throw new Error("OpenCode command must contain non-empty strings");
    if (!object.command.length) throw new Error("OpenCode command cannot be empty");
    if ("args" in object) throw new Error("Use either a command array or separate args");
    const [command, ...args] = object.command;
    object.command = command;
    object.args = args;
  }
  const command = typeof object.command === "string" && !!object.command;
  const url = typeof object.url === "string" && !!object.url;
  if (command === url) throw new Error("Server needs either a command or a URL");
  return { name, server: object };
}

function httpUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid server URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP URL must use HTTP or HTTPS");
}

export function normalizeOpencodeServer(server: Json, major: number): Json {
  const object = { ...server };
  const local = "command" in object;
  const allowed = local
    ? ["type", "command", "args", "env", "environment", "enabled", "disabled", "cwd", "timeout", "codemode", "protocol"]
    : ["type", "url", "headers", "enabled", "disabled", "oauth", "timeout", "codemode", "protocol"];
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`OpenCode configuration cannot preserve '${unknown}'`);
  const kind = typeof object.type === "string" ? object.type : undefined;
  delete object.type;
  if (local) {
    if (![undefined, "stdio", "local"].includes(kind)) throw new Error("OpenCode local server type must be local");
    const command = object.command;
    delete object.command;
    let parts: unknown[];
    if (typeof command === "string") parts = [command];
    else if (Array.isArray(command)) parts = [...command];
    else throw new Error("OpenCode command must be an array or string");
    if ("args" in object) {
      if (!Array.isArray(object.args)) throw new Error("args must be an array");
      parts.push(...object.args);
      delete object.args;
    }
    if (!parts.length || parts.some((part) => typeof part !== "string" || !part))
      throw new Error("OpenCode command must contain non-empty strings");
    if ("env" in object && "environment" in object) throw new Error("Use either env or environment");
    const environment = "env" in object ? object.env : object.environment;
    delete object.env;
    delete object.environment;
    if (environment !== undefined) {
      if (!isObject(environment)) throw new Error("environment must be an object");
      if (Object.values(environment).some((value) => typeof value !== "string")) throw new Error("environment values must be strings");
      object.environment = environment;
    }
    object.command = parts;
    object.type = "local";
  } else {
    if (![undefined, "http", "sse", "remote"].includes(kind)) throw new Error("OpenCode remote server type must be remote");
    if (typeof object.url !== "string") throw new Error("Remote server needs a URL");
    httpUrl(object.url);
    object.type = "remote";
  }
  if (major === 1) {
    if ("disabled" in object) {
      if (typeof object.disabled !== "boolean") throw new Error("disabled must be a boolean");
      object.enabled = !object.disabled;
      delete object.disabled;
    }
  } else if ("enabled" in object) {
    if (typeof object.enabled !== "boolean") throw new Error("enabled must be a boolean");
    object.disabled = !object.enabled;
    delete object.enabled;
  }
  return object;
}

export function isOpencodeTimeoutSettings(value: unknown): boolean {
  return isObject(value) && Object.entries(value).every(([key, setting]) =>
    ["startup", "catalog", "execution"].includes(key) && typeof setting === "number" && setting > 0 && Number.isInteger(setting));
}

const writers = new Map<string, Promise<unknown>>();

/** Read-modify-write a JSON config: serialized in this Host, guarded by a lock
 * file for other writers, and replaced atomically with owner-only permissions. */
export async function writeJsonConfig(io: MachineIO, file: string, update: (root: Json) => void): Promise<void> {
  const key = `${io.key}\0${file}`;
  const previous = writers.get(key) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => writeLocked(io, file, update));
  writers.set(key, task);
  try { await task; } finally { if (writers.get(key) === task) writers.delete(key); }
}

async function writeLocked(io: MachineIO, file: string, update: (root: Json) => void) {
  const parent = io.path.dirname(file);
  if (parent === file) throw new Error("Invalid config path");
  await io.fs.mkdir(parent, { recursive: true });
  const lock = io.path.join(parent, `.${io.path.basename(file) || "mcp"}.lock`);
  for (let attempt = 0; ; attempt++) {
    try {
      await io.fs.writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      const stale = await io.fs.stat(lock).then((stat) => Date.now() - stat.mtimeMs > 30_000, () => false);
      if (stale) { await io.fs.rm(lock, { force: true }); continue; }
      if (attempt >= 100 || (error as NodeJS.ErrnoException)?.code !== "EEXIST" && !/exist/i.test(String(error)))
        throw new Error(`Config file is locked: ${file}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    let root: unknown = {};
    try {
      const raw = await io.fs.readFile(file, "utf8");
      try { root = parseJson(raw); } catch (error) { throw new Error(`Existing config is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    } catch (error) { if (!missing(error) && !/no such file|ENOENT/i.test(String(error))) throw error; }
    if (!isObject(root)) throw new Error("Existing config must be a JSON object");
    update(root);
    const temporary = io.path.join(parent, `.${io.path.basename(file) || "mcp"}.${randomUUID()}.tmp`);
    try {
      await io.fs.writeFile(temporary, JSON.stringify(root, null, 2), { flag: "wx", mode: 0o600 });
      await io.fs.rename(temporary, file);
    } catch (error) {
      await io.fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  } finally {
    await io.fs.rm(lock, { force: true }).catch(() => undefined);
  }
}

export function writeJsonServer(io: MachineIO, file: string, name: string, server: Json): Promise<void> {
  return writeJsonConfig(io, file, (root) => {
    root.mcpServers ??= {};
    if (!isObject(root.mcpServers)) throw new Error("Existing mcpServers must be an object");
    if (name in root.mcpServers) throw new Error(`${name} is already configured in this file`);
    root.mcpServers[name] = server;
  });
}

export function writeOpencodeServer(io: MachineIO, file: string, name: string, input: Json, major: number): Promise<void> {
  const server = normalizeOpencodeServer(input, major);
  return writeJsonConfig(io, file, (root) => {
    root.mcp ??= {};
    const mcp = root.mcp;
    if (!isObject(mcp)) throw new Error("Existing mcp must be an object");
    let servers: Json;
    if (major === 1) {
      if (isObject(mcp.servers) && Object.values(mcp.servers).every(isObject))
        throw new Error("Existing OpenCode config uses the 2.x MCP layout");
      servers = mcp;
    } else {
      if (Object.entries(mcp).some(([key, value]) => key !== "servers" && isObject(value) && !(key === "timeout" && isOpencodeTimeoutSettings(value))))
        throw new Error("Existing OpenCode config uses the 1.x MCP layout");
      mcp.servers ??= {};
      if (!isObject(mcp.servers)) throw new Error("Existing mcp.servers must be an object");
      servers = mcp.servers;
    }
    if (name in servers) throw new Error(`${name} is already configured in this file`);
    servers[name] = server;
  });
}

function transport(config: Json): string {
  return typeof config.type === "string" ? config.type : "url" in config ? "http" : "stdio";
}

function addJsonServers(connections: McpConnection[], provider: McpProvider, scope: McpScope, file: string, value: unknown) {
  // OpenCode 2.x nests the map under mcp.servers; older versions use mcp.
  // A server can itself be named "servers", so inspect the nested shape.
  if (provider === "opencode" && isObject(value) && isObject(value.servers) && Object.values(value.servers).every(isObject))
    value = value.servers;
  if (!isObject(value)) return;
  for (const [name, config] of Object.entries(value)) {
    if (!isObject(config)) continue;
    if (provider === "opencode" && name === "timeout" && isOpencodeTimeoutSettings(config)) continue;
    connections.push({ provider, name, scope, configPath: file, transport: transport(config),
      enabled: config.enabled !== false && config.disabled !== true });
  }
}

async function addJsonFile(io: MachineIO, connections: McpConnection[], provider: McpProvider, scope: McpScope, file: string, key: string) {
  const config = await readJson(io, file);
  if (isObject(config)) addJsonServers(connections, provider, scope, file, config[key]);
}

async function readToml(io: MachineIO, file: string): Promise<Json | undefined> {
  try { return parseToml(await io.fs.readFile(file, "utf8")) as Json; } catch { return undefined; }
}

async function addTomlFile(io: MachineIO, connections: McpConnection[], provider: McpProvider, scope: McpScope, file: string) {
  const servers = (await readToml(io, file))?.mcp_servers;
  if (!isObject(servers)) return;
  for (const [name, entry] of Object.entries(servers)) {
    const config = isObject(entry) ? entry : {};
    connections.push({ provider, name, scope, configPath: file, transport: "url" in config ? "http" : "stdio",
      enabled: config.enabled !== false });
  }
}

/** Ancestors from the project up to (excluding) home, stopping at a repository root. */
async function projectDirectories(context: McpMachineContext, project: string): Promise<string[]> {
  const { io } = context;
  const directories: string[] = [];
  for (let directory = project; ; directory = io.path.dirname(directory)) {
    if (directory === context.home) break;
    directories.push(directory);
    if (await exists(io, io.path.join(directory, ".git"))) break;
    if (io.path.dirname(directory) === directory) break;
  }
  return directories;
}

/** Configured servers only: names, scopes, paths and transport — never commands,
 * headers or environment values. */
export async function discoverMcp(context: McpMachineContext, project: string): Promise<McpConnection[]> {
  const { io } = context;
  const { path } = io;
  const connections: McpConnection[] = [];
  const claude = path.join(context.home, ".claude.json");
  const claudeConfig = await readJson(io, claude);
  if (isObject(claudeConfig)) {
    addJsonServers(connections, "claude", "user", claude, claudeConfig.mcpServers);
    const projects = claudeConfig.projects;
    const entry = isObject(projects) ? projects[project] : undefined;
    if (isObject(entry)) addJsonServers(connections, "claude", "local", claude, entry.mcpServers);
  }
  await addJsonFile(io, connections, "cursor", "user", path.join(context.home, ".cursor/mcp.json"), "mcpServers");
  await addJsonFile(io, connections, "claude_desktop", "user", claudeDesktopConfig(context), "mcpServers");
  await addTomlFile(io, connections, "codex", "user", path.join(context.env.CODEX_HOME || path.join(context.home, ".codex"), "config.toml"));
  for (const file of ["opencode.json", "opencode.jsonc"])
    await addJsonFile(io, connections, "opencode", "user", path.join(context.home, ".config/opencode", file), "mcp");
  if (context.env.OPENCODE_CONFIG) await addJsonFile(io, connections, "opencode", "user", context.env.OPENCODE_CONFIG, "mcp");
  // Pi reads only the selected working directory, not ancestor MCP files.
  for (const scope of ["user", "project"] as const)
    await addJsonFile(io, connections, "pi", scope, piConfigPath(context, project, scope), "mcpServers");
  // Project configuration is inherited from parent directories. Stop at the
  // repository boundary so an unrelated parent project is not shown.
  for (const directory of await projectDirectories(context, project)) {
    await addJsonFile(io, connections, "claude", "project", path.join(directory, ".mcp.json"), "mcpServers");
    await addJsonFile(io, connections, "cursor", "project", path.join(directory, ".cursor/mcp.json"), "mcpServers");
    await addTomlFile(io, connections, "codex", "project", path.join(directory, ".codex/config.toml"));
    for (const file of ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"])
      await addJsonFile(io, connections, "opencode", "project", path.join(directory, file), "mcp");
  }
  const order = (value: McpConnection) => [value.provider, value.name, value.scope, value.configPath];
  return connections.sort((a, b) => {
    const left = order(a), right = order(b);
    for (let index = 0; index < left.length; index++)
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    return 0;
  });
}

/** The raw configuration of one discovered server, for inspection on this machine. */
export async function serverConfig(context: McpMachineContext, input: { provider: string; scope: string; configPath: string; name: string }, project: string): Promise<Json> {
  if (!input.configPath) throw new Error("This server has no local configuration to inspect.");
  const file = expandHome(context, input.configPath);
  const notFound = () => new Error(`${input.name} was not found in ${input.configPath}`);
  if (input.provider === "codex") {
    let config: Json;
    try { config = parseToml(await context.io.fs.readFile(file, "utf8")) as Json; } catch (error) { throw new Error(error instanceof Error ? error.message : String(error)); }
    const server = isObject(config.mcp_servers) ? config.mcp_servers[input.name] : undefined;
    if (!isObject(server)) throw notFound();
    return server;
  }
  const config = await readJson(context.io, file);
  if (!isObject(config)) throw new Error(`Cannot read ${input.configPath}`);
  let servers: unknown;
  if (input.provider === "claude" && input.scope === "local") {
    const entry = isObject(config.projects) ? config.projects[project] : undefined;
    servers = isObject(entry) ? entry.mcpServers : undefined;
  } else if (input.provider === "opencode") {
    const mcp = config.mcp;
    // OpenCode 2.x nests the map under mcp.servers.
    servers = isObject(mcp) && isObject(mcp.servers) && Object.values(mcp.servers).every(isObject) && input.name in mcp.servers ? mcp.servers : mcp;
  } else servers = config.mcpServers;
  const server = isObject(servers) ? servers[input.name] : undefined;
  if (!isObject(server)) throw notFound();
  return server;
}

/** WebSocket servers are not listed by `claude mcp list`. */
export async function configuredWsServers(context: McpMachineContext, project: string): Promise<string[]> {
  const names: string[] = [];
  const collect = (servers: unknown) => {
    if (!isObject(servers)) return;
    for (const [name, config] of Object.entries(servers))
      if (isObject(config) && config.type === "ws" && validMcpName(name) && !names.includes(name)) names.push(name);
  };
  const settings = await readJson(context.io, context.io.path.join(context.home, ".claude.json"));
  if (isObject(settings)) {
    collect(settings.mcpServers);
    const entry = isObject(settings.projects) ? settings.projects[project] : undefined;
    if (isObject(entry)) collect(entry.mcpServers);
  }
  for (let directory = project; ; directory = context.io.path.dirname(directory)) {
    const config = await readJson(context.io, context.io.path.join(directory, ".mcp.json"));
    if (isObject(config)) collect(config.mcpServers);
    if (await exists(context.io, context.io.path.join(directory, ".git"))) break;
    if (context.io.path.dirname(directory) === directory) break;
  }
  return names;
}
