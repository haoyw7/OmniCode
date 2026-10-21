import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { filterClaudeConfiguration, filterCodexConfiguration, windowsOnlyCommand, wslProviderConfiguration } from "./wsl-provider-config";
import { withProviderAccountLock } from "./provider-account-lock";

const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("filters Windows commands while preserving Linux MCP values and hooks", () => {
  const linux = { command: "/usr/bin/node", args: ["server.js"], env: { VALUE: "user value" } };
  const settings = { permissions: { allow: ["Read"] }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [
    { type: "command", command: '"C:\\Tools\\check.exe" --run' }, { type: "command", command: "sh ./check.sh" },
  ] }] } };
  const filtered = filterClaudeConfiguration(settings, { windows: { command: "npx.cmd" }, linux, http: { url: "https://example.com" } });
  expect(filtered.mcpServers).toEqual({ linux, http: { url: "https://example.com" } });
  expect(filtered.settings.hooks).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "sh ./check.sh" }] }] });
  expect(filtered.warnings).toEqual(["MCP: windows", "Hook: PreToolUse"]);
  expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(2);
  expect(windowsOnlyCommand("/opt/example/server")).toBe(false);
  expect(windowsOnlyCommand('cmd /c "start"')).toBe(true);
});

it("parses quoted TOML server names and prevents keyring fallback", () => {
  const filtered = filterCodexConfiguration(String.raw`cli_auth_credentials_store = "auto"
notify = ["powershell.exe", "-File", "notify.ps1"]
[mcp_servers."win.tools"]
command = 'C:\Tools\server.exe'
[mcp_servers.linux]
command = "/usr/bin/node"
`);
  expect(filtered.args[3]).toContain('mcp_servers={"win.tools"={');
  expect(filtered.args[3]).toContain('"enabled"=false');
  expect(filtered.args[3]).toContain('"linux"={"command"="/usr/bin/node"}');
  expect(filtered.args.slice(-2)).toEqual(["-c", "notify=[]"]);
  expect(() => filterCodexConfiguration('cli_auth_credentials_store = "keyring"')).toThrow("managed account");
});

it("filters the effective Codex project and CLI configuration, preserving Linux overrides", () => {
  const filtered = filterCodexConfiguration('[mcp_servers.inherited]\ncommand="windows.exe"', {
    files: ['[mcp_servers.project]\ncommand="server.cmd"', '[mcp_servers.inherited]\ncommand="node"'],
    args: ["app-server", "-c", 'mcp_servers."host.agents".command="C:/Node/node.exe"', "--config=mcp_servers.linux.command=node"],
  });
  expect(filtered.warnings).toEqual(["MCP: project", "MCP: host.agents"]);
  expect(filtered.args[3]).toContain('"project"={"command"="server.cmd","enabled"=false}');
  expect(filtered.args[3]).toContain('"inherited"={"command"="node"}');
});

it.each(["claude", "codex"] as const)("uses the desktop %s home and explicitly deletes inherited WSL auth overrides", async provider => {
  const home = await mkdtemp(join(tmpdir(), "omnicode-wsl-config-")); directories.push(home);
  vi.stubEnv(provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME", home);
  await writeFile(join(home, "auth.json"), '{}');
  const rpc = { request: async <T>(op: string, args?: Record<string, unknown>): Promise<T> => {
    if (op === "exec") return { code: 0, stdout: "/mounted/desktop/home\n" } as T;
    if (op === "env.info") return { home: "/home/test" } as T;
    if (op === "fs.mkdir") return null as T;
    if (args?.path === "/repo/.codex/config.toml") return '[mcp_servers.fromProject]\ncommand="tool.exe"' as T;
    throw Object.assign(new Error("Missing fixture file"), { code: "ENOENT" });
  } };
  const prepared = await wslProviderConfiguration({ provider, owner: join(home, "missing-owner.json"), cwd: "/repo/sub", args: provider === "codex" ? ["app-server", "-c", 'mcp_servers."host_agents".command="/usr/bin/node"'] : [], rpc });
  expect(prepared.home).toBe(home);
  if (provider === "codex") {
    expect(prepared.env).toEqual({ CODEX_HOME: "/mounted/desktop/home", CODEX_SQLITE_HOME: expect.stringMatching(/^\/home\/test\/\.omnicode\/remote\/codex-state\/[a-f0-9]{64}$/), OPENAI_API_KEY: null, CODEX_API_KEY: null, CODEX_ACCESS_TOKEN: null, OPENAI_BASE_URL: null });
    expect(prepared.warnings).toEqual(["MCP: fromProject"]);
    expect(prepared.args).toContain('mcp_servers.host_agents.command="/usr/bin/node"');
    expect(prepared.args).toContain('mcp_servers.fromProject.enabled=false');
  } else {
    expect(prepared.env).toMatchObject({ CLAUDE_CONFIG_DIR: "/mounted/desktop/home", ANTHROPIC_API_KEY: null, ANTHROPIC_AUTH_TOKEN: null, CLAUDE_CODE_OAUTH_TOKEN: null });
  }
});

it("keeps Codex SQLite in WSL per shared Home, overriding mounted paths without changing user configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omnicode-wsl-sqlite-")); directories.push(directory);
  const owner = join(directory, "owner.json");
  const home = join(directory, "codex-home");
  await mkdir(home);
  await mkdir(join(directory, "provider-accounts"));
  await writeFile(join(directory, "provider-accounts/state.json"), JSON.stringify({ accounts: { codex: [
    { id: "one", label: "One", dataHome: home }, { id: "alias", label: "Same home", dataHome: home },
  ] }, defaults: {} }));
  await writeFile(join(home, "auth.json"), '{}');
  const sourceConfig = 'sqlite_home="C:/desktop/state"\nmodel="user-model"\n';
  await writeFile(join(home, "config.toml"), sourceConfig);
  let mappedHome = "/mounted/desktop/account";
  const request = vi.fn(async <T>(op: string, args?: Record<string, unknown>): Promise<T> => {
    if (op === "exec") return { code: 0, stdout: mappedHome } as T;
    if (op === "env.info") return { home: "/home/test" } as T;
    if (op === "fs.mkdir") return null as T;
    if (args?.path === "/repo/.codex/config.toml") return 'sqlite_home="/mounted/project/state"' as T;
    throw Object.assign(new Error("Missing fixture file"), { code: "ENOENT" });
  });
  const prepare = (accountId: string, cwd = "/repo") => wslProviderConfiguration({ provider: "codex", owner, accountId, cwd,
    args: ["app-server", "-c", 'sqlite_home="/mounted/cli/state"'], rpc: { request } });
  const first = await prepare("one");
  const sqliteHome = first.env.CODEX_SQLITE_HOME;
  expect(sqliteHome).toMatch(/^\/home\/test\/\.omnicode\/remote\/codex-state\/[a-f0-9]{64}$/);
  expect(request).toHaveBeenCalledWith("fs.mkdir", { path: sqliteHome, recursive: true, mode: 0o700 });
  expect(first.args.slice(-2)).toEqual(["-c", `sqlite_home=${JSON.stringify(sqliteHome)}`]);
  expect(first.env.CODEX_HOME).toBe(mappedHome);
  expect((await prepare("alias", "/other-project")).env.CODEX_SQLITE_HOME).toBe(sqliteHome);
  mappedHome = "/mounted/desktop/other-account";
  expect((await prepare("one")).env.CODEX_SQLITE_HOME).not.toBe(sqliteHome);
  expect(await readFile(join(home, "config.toml"), "utf8")).toBe(sourceConfig);
});

it("serializes one account but allows unrelated accounts and releases after failure", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const first = withProviderAccountLock("one", async () => { calls.push("first"); await new Promise<void>(resolve => { release = resolve; }); throw new Error("failed"); });
  const second = withProviderAccountLock("one", async () => { calls.push("second"); });
  await withProviderAccountLock("two", async () => { calls.push("other"); });
  expect(calls).toEqual(["first", "other"]);
  release(); await expect(first).rejects.toThrow("failed"); await second;
  expect(calls).toEqual(["first", "other", "second"]);
});

it("preserves hooks and permission lists from every Claude settings scope before filtering", async () => {
  const home = await mkdtemp(join(tmpdir(), "omnicode-wsl-settings-")); directories.push(home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", home);
  const hook = (command: string) => ({ hooks: [{ type: "command", command }] });
  await writeFile(join(home, "settings.json"), JSON.stringify({
    permissions: { allow: ["Read"], deny: ["Read(.env)"] }, env: { SHARED: "user", USER: "kept" },
    hooks: { PreToolUse: [hook("sh user.sh")], Stop: [hook("notify.exe")] }, fallbackModel: ["old"],
  }));
  const rpc = { request: async <T>(op: string, args?: Record<string, unknown>): Promise<T> => {
    if (op === "exec") return { code: 0, stdout: "/mounted/desktop/home\n" } as T;
    const config = args?.path === "/repo/.claude/settings.json" ? {
      permissions: { allow: ["Read", "Edit"] }, env: { SHARED: "project" },
      hooks: { PreToolUse: [hook("sh project.sh")] }, fallbackModel: ["new"],
    } : args?.path === "/repo/.claude/settings.local.json" ? {
      hooks: { PreToolUse: [hook("sh local.sh")], Stop: [hook("sh stop.sh")] },
    } : undefined;
    if (config) return JSON.stringify(config) as T;
    throw Object.assign(new Error("Missing fixture file"), { code: "ENOENT" });
  } };
  const prepared = await wslProviderConfiguration({ provider: "claude", owner: join(home, "missing-owner.json"), cwd: "/repo",
    args: ["--settings", JSON.stringify({ env: { SHARED: "cli" }, hooks: { PreToolUse: [hook("sh cli.sh")] } })], rpc });
  const settings = JSON.parse(prepared.args[prepared.args.indexOf("--settings") + 1]);
  expect(settings.permissions).toEqual({ allow: ["Read", "Edit"], deny: ["Read(.env)"] });
  expect(settings.env).toEqual({ SHARED: "cli", USER: "kept" });
  expect(settings.hooks).toEqual({ PreToolUse: [hook("sh user.sh"), hook("sh project.sh"), hook("sh local.sh"), hook("sh cli.sh")], Stop: [hook("sh stop.sh")] });
  expect(settings.fallbackModel).toEqual(["new"]);
  expect(prepared.warnings).toEqual(["Hook: Stop"]);
});
