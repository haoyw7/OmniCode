import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { parse as parseToml } from "smol-toml";
import { defaultProviderAccountHome, namedProviderAccountHome, providerAccountDirectory } from "./provider-accounts";
import type { MachineTransport } from "./machine-io";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function windowsOnlyCommand(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /(?:^|[\s"'])(?:[a-z]:[\\/]|\\\\|[^\s"']*\.(?:exe|cmd|bat|com)(?:[\s"']|$))/i.test(value) ||
    /^(?:powershell|cmd)(?:\s|$)/i.test(value.trim());
}

export function sharedProviderHome(owner: string, provider: "claude" | "codex", id = "default"): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid provider account");
  const directory = providerAccountDirectory(owner);
  if (id !== "default") {
    if (!directory) throw new Error("This provider account is no longer available");
    return namedProviderAccountHome(directory, provider, id);
  }
  return directory && defaultProviderAccountHome(directory, provider) ||
    (provider === "codex" ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR) || join(homedir(), `.${provider}`);
}

async function optionalText(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
async function optionalJson(path: string): Promise<Record<string, unknown>> {
  const text = await optionalText(path);
  return text ? object(JSON.parse(text)) : {};
}
async function remoteJson(rpc: MachineTransport, path: string): Promise<Record<string, unknown>> {
  try {
    const value = await rpc.request<string>("fs.readFile", { path, encoding: "utf8" });
    return object(JSON.parse(value));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Filter only Windows-only commands. Values and credentials are never logged. */
export function filterClaudeConfiguration(settings: Record<string, unknown>, servers: Record<string, unknown>) {
  const warnings: string[] = [];
  const mcpServers = Object.fromEntries(Object.entries(servers).filter(([name, value]) => {
    if (!windowsOnlyCommand(object(value).command)) return true;
    warnings.push(`MCP: ${name}`); return false;
  }));
  const hooks = Object.fromEntries(Object.entries(object(settings.hooks)).map(([event, entries]) => [event,
    Array.isArray(entries) ? entries.flatMap(entry => {
      const group = object(entry);
      if (!Array.isArray(group.hooks)) return [entry];
      const filtered = group.hooks.filter(hook => {
        if (!windowsOnlyCommand(object(hook).command)) return true;
        warnings.push(`Hook: ${event}`); return false;
      });
      return filtered.length ? [{ ...group, hooks: filtered }] : [];
    }) : entries,
  ]));
  return { settings: { ...settings, ...(settings.hooks ? { hooks } : {}) }, mcpServers, warnings };
}

function mergeConfiguration(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(next)])].map(key => {
    if (!Object.hasOwn(next, key)) return [key, base[key]];
    const value = next[key];
    return [key, value && typeof value === "object" && !Array.isArray(value)
      ? mergeConfiguration(object(base[key]), object(value)) : value];
  }));
}

/** Claude merges nested settings and additive lists across user/project scopes. */
function mergeClaudeSettings(base: Record<string, unknown>, next: Record<string, unknown>, root = true): Record<string, unknown> {
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(next)])].map(key => {
    if (!Object.hasOwn(next, key)) return [key, base[key]];
    const value = next[key];
    // These settings represent an ordered choice, not an additive list.
    if (root && (key === "fallbackModel" || key === "modelPicker")) return [key, value];
    if (Array.isArray(value) && Array.isArray(base[key])) {
      const seen = new Set<string>();
      return [key, [...base[key], ...value].filter(item => {
        const identity = JSON.stringify(item);
        if (seen.has(identity)) return false;
        seen.add(identity); return true;
      })];
    }
    return [key, value && typeof value === "object" && !Array.isArray(value)
      ? mergeClaudeSettings(object(base[key]), object(value), false) : value];
  }));
}

function inlineToml(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(inlineToml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${inlineToml(item)}`).join(",")}}`;
  throw new Error("Unsupported Codex MCP configuration value");
}

/** Codex parses only the value as TOML; quotes in dotted CLI keys are literal. */
function normalizeCodexOverrides(args: string[]): string[] {
  const result = [...args];
  for (let index = 0; index < result.length; index++) {
    const option = result[index];
    const target = option === "-c" || option === "--config" ? ++index : option.startsWith("--config=") ? index : -1;
    if (target < 0 || !result[target]) continue;
    const prefix = option.startsWith("--config=") ? "--config=" : "";
    const assignment = result[target].slice(prefix.length);
    const equals = assignment.indexOf("=");
    if (equals < 0) continue;
    const key = assignment.slice(0, equals).replace(/"(?:\\.|[^"\\])*"/g, value => {
      try { const name: unknown = JSON.parse(value); return typeof name === "string" && /^[A-Za-z0-9_-]+$/.test(name) ? name : value; }
      catch { return value; }
    });
    result[target] = `${prefix}${key}${assignment.slice(equals)}`;
  }
  return result;
}

export function filterCodexConfiguration(text: string, overrides: { files?: string[]; args?: string[] } = {}): { args: string[]; warnings: string[] } {
  let config: Record<string, unknown> = parseToml(text);
  for (const file of overrides.files ?? []) config = mergeConfiguration(config, parseToml(file));
  const cli = overrides.args ?? [];
  for (let index = 0; index < cli.length; index++) {
    const option = cli[index];
    const assignment = option === "-c" || option === "--config" ? cli[++index]
      : option.startsWith("--config=") ? option.slice(9) : undefined;
    if (!assignment) continue;
    // Match Codex's -c key=value parser, which permits an unquoted string value.
    let parsed: Record<string, unknown>;
    try { parsed = parseToml(assignment); }
    catch {
      const equals = assignment.indexOf("=");
      if (equals <= 0) continue;
      try { parsed = parseToml(`${assignment.slice(0, equals)}=${JSON.stringify(assignment.slice(equals + 1))}`); }
      catch { continue; }
    }
    config = mergeConfiguration(config, parsed);
  }
  const store = config.cli_auth_credentials_store;
  if (store === "keyring" || store === "ephemeral")
    throw new Error("This Codex account uses a system credential store. Import it as a managed account before using WSL.");
  const args: string[] = ["-c", 'cli_auth_credentials_store="file"'];
  const warnings: string[] = [];
  const servers = { ...object(config.mcp_servers) };
  const disabled: string[] = [];
  for (const [name, server] of Object.entries(object(config.mcp_servers))) {
    if (!windowsOnlyCommand(object(server).command)) continue;
    servers[name] = { ...object(server), enabled: false };
    disabled.push(name);
    warnings.push(`MCP: ${name}`);
  }
  if (disabled.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) {
    // Dots cannot be escaped in a CLI key. Override the table as a TOML value.
    args.push("-c", `mcp_servers=${inlineToml(servers)}`);
  } else for (const name of disabled) args.push("-c", `mcp_servers.${name}.enabled=false`);
  if (Array.isArray(config.notify) && windowsOnlyCommand(config.notify[0])) {
    args.push("-c", "notify=[]"); warnings.push("Hook: notify");
  }
  return { args, warnings };
}

async function codexProjectConfigurations(rpc: MachineTransport, cwd: string): Promise<string[]> {
  if (!cwd.startsWith("/") || cwd.includes("\0")) throw new Error("Invalid WSL project directory");
  const paths: string[] = [];
  let directory = posix.normalize(cwd);
  while (true) {
    paths.unshift(posix.join(directory, ".codex/config.toml"));
    const parent = posix.dirname(directory);
    if (parent === directory) break;
    directory = parent;
    if (paths.length > 128) throw new Error("WSL project directory is too deep");
  }
  return Promise.all(paths.map(async path => {
    try { return await rpc.request<string>("fs.readFile", { path, encoding: "utf8" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  }));
}

export async function wslProviderConfiguration(input: {
  provider: "claude" | "codex"; owner: string; accountId?: string; cwd: string;
  args: string[]; rpc: MachineTransport;
}): Promise<{ args: string[]; env: Record<string, string | null>; warnings: string[]; home: string }> {
  const home = sharedProviderHome(input.owner, input.provider, input.accountId);
  // Ask WSL rather than assuming its automount root is /mnt.
  const converted = await input.rpc.request<{ stdout: string; code: number }>("exec", {
    command: "wslpath", args: ["-a", "-u", home], timeout: 10_000,
  });
  if (converted.code !== 0 || !converted.stdout.trim().startsWith("/")) throw new Error("The provider Data Home is not accessible from WSL");
  const linuxHome = converted.stdout.trim();
  if (input.provider === "codex") {
    const config = filterCodexConfiguration(await optionalText(join(home, "config.toml")), {
      files: await codexProjectConfigurations(input.rpc, input.cwd), args: input.args,
    });
    if (!(await optionalText(join(home, "auth.json"))))
      throw new Error("This Codex account has no shared auth.json. Import it as a managed account before using WSL.");
    return { home, args: [...normalizeCodexOverrides(input.args), ...config.args], env: {
      CODEX_HOME: linuxHome, OPENAI_API_KEY: null, CODEX_API_KEY: null, CODEX_ACCESS_TOKEN: null,
      OPENAI_BASE_URL: null,
    }, warnings: config.warnings };
  }
  const isolated = input.args.includes("--strict-mcp-config");
  const global = await optionalJson(join(home, ".claude.json"));
  let settings = mergeClaudeSettings(mergeClaudeSettings(await optionalJson(join(home, "settings.json")),
    await remoteJson(input.rpc, posix.join(input.cwd, ".claude/settings.json"))),
    await remoteJson(input.rpc, posix.join(input.cwd, ".claude/settings.local.json")));
  const servers = isolated ? {} : { ...object(global.mcpServers),
    ...object((await remoteJson(input.rpc, posix.join(input.cwd, ".mcp.json"))).mcpServers),
    ...object(object(object(global.projects)[input.cwd]).mcpServers) };
  const args: string[] = [];
  for (let index = 0; index < input.args.length; index++) {
    const arg = input.args[index];
    if (arg === "--settings" || arg === "--mcp-config") {
      const value = object(JSON.parse(input.args[++index]));
      if (arg === "--settings") settings = mergeClaudeSettings(settings, value);
      else Object.assign(servers, object(value.mcpServers));
    } else if (arg === "--setting-sources") index++;
    else if (!arg.startsWith("--setting-sources=") && arg !== "--strict-mcp-config") args.push(arg);
  }
  const filtered = filterClaudeConfiguration(settings, servers);
  args.push("--setting-sources", "", "--settings", JSON.stringify(filtered.settings),
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: filtered.mcpServers }));
  return { home, args, env: {
    CLAUDE_CONFIG_DIR: linuxHome, CLAUDE_SECURESTORAGE_CONFIG_DIR: linuxHome,
    ANTHROPIC_API_KEY: null, ANTHROPIC_AUTH_TOKEN: null, CLAUDE_CODE_OAUTH_TOKEN: null,
    ANTHROPIC_BASE_URL: null, ANTHROPIC_CUSTOM_HEADERS: null,
    CLAUDE_CODE_USE_BEDROCK: null, CLAUDE_CODE_USE_VERTEX: null, CLAUDE_CODE_USE_FOUNDRY: null,
  }, warnings: filtered.warnings };
}
