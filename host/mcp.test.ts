import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localMachineIO } from "./machine-io";
import { discoverMcp, serverFromJson, stripJsonc, writeJsonServer, writeOpencodeServer, type McpMachineContext } from "./mcp-config";
import { expandVars, inspectServer, parseSpec } from "./mcp-inspector.mjs";
import { defaultMcpDependencies, HostMcp, type HostMcpDependencies } from "./mcp";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omnicode-mcp-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "work", "project");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(home, { recursive: true });
  const context: McpMachineContext = { io: localMachineIO, home, env: {}, platform: "linux" };
  return { root, home, project, context };
}

async function write(file: string, content: unknown) {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

function service(project: string, context: McpMachineContext, overrides: Partial<HostMcpDependencies> = {}) {
  const deps: HostMcpDependencies = {
    context: async () => context,
    resolve: async (provider) => ({ path: `/bin/${provider}` }),
    run: vi.fn(async () => ({ stdout: "", stderr: "" })),
    inspect: vi.fn(),
    ...overrides,
  };
  return { mcp: new HostMcp({ project: () => ({ cwd: project }) } as never, deps), deps };
}

async function finish(mcp: HostMcp, request: Record<string, unknown>) {
  mcp.start("owner", { projectId: "p", requestId: crypto.randomUUID(), ...request });
  const id = [...(mcp as unknown as { jobs: Map<string, unknown> }).jobs.keys()].at(-1)!.slice("owner:".length);
  return mcp.status("owner", { requestId: id });
}

describe("MCP configuration", () => {
  it("discovers every provider's configured servers without exposing commands or credentials", async () => {
    const { home, project, context } = await fixture();
    await write(join(home, ".claude.json"), {
      mcpServers: { global: { command: "npx", env: { TOKEN: "secret-user" } } },
      projects: { [project]: { mcpServers: { local: { type: "http", url: "https://x", headers: { Authorization: "Bearer secret" } } } } },
    });
    await write(join(project, ".mcp.json"), { mcpServers: { shared: { command: "node" } } });
    await write(join(project, "..", ".mcp.json"), { mcpServers: { outside: { command: "node" } } });
    await write(join(home, ".cursor/mcp.json"), { mcpServers: { cursor: { url: "https://c" } } });
    await write(join(home, ".codex/config.toml"), "[mcp_servers.docs]\ncommand = \"docs\"\n[mcp_servers.off]\nurl = \"https://o\"\nenabled = false\n");
    await write(join(home, ".config/opencode/opencode.jsonc"), '{ // comment\n "mcp": { "servers": { "two": { "type": "remote", "url": "https://t", "disabled": true }, }, "timeout": { "startup": 5000 } } }');
    await write(join(project, "opencode.json"), { mcp: { one: { type: "local", command: ["x"], enabled: false }, timeout: { startup: 10 } } });
    await write(join(home, ".pi/agent/mcp.json"), { mcpServers: { piUser: { command: "pi-mcp" } } });
    await write(join(project, ".pi/mcp.json"), { mcpServers: { piProject: { url: "https://p" } } });
    await write(join(home, ".config/Claude/claude_desktop_config.json"), { mcpServers: { desktop: { command: "d" } } });

    const found = await discoverMcp(context, project);
    expect(found.map((entry) => [entry.provider, entry.scope, entry.name, entry.transport, entry.enabled])).toEqual([
      ["claude", "user", "global", "stdio", true],
      ["claude", "local", "local", "http", true],
      ["claude", "project", "shared", "stdio", true],
      ["claude_desktop", "user", "desktop", "stdio", true],
      ["codex", "user", "docs", "stdio", true],
      ["codex", "user", "off", "http", false],
      ["cursor", "user", "cursor", "http", true],
      ["opencode", "project", "one", "local", false],
      ["opencode", "user", "two", "remote", false],
      ["pi", "project", "piProject", "http", true],
      ["pi", "user", "piUser", "stdio", true],
    ]);
    expect(JSON.stringify(found)).not.toMatch(/secret|npx/);
  });

  it("validates pasted server JSON like the native implementation", () => {
    expect(serverFromJson("cursor", "", '{"mcpServers":{"docs":{"command":"x"}}}')).toEqual({ name: "docs", server: { command: "x" } });
    expect(() => serverFromJson("cursor", "other", '{"mcpServers":{"docs":{"command":"x"}}}')).toThrow("Name does not match");
    expect(() => serverFromJson("cursor", "a b", '{"command":"x"}')).toThrow("letters, numbers");
    expect(() => serverFromJson("cursor", "a", '{"command":"x","url":"https://x"}')).toThrow("either a command or a URL");
    expect(serverFromJson("opencode", "My docs", '{"command":["node","s.js"]}')).toEqual({ name: "My docs", server: { command: "node", args: ["s.js"] } });
    expect(stripJsonc('{"u":"https://x//y", /* c */ "a":[1,],}')).toBe('{"u":"https://x//y",  "a":[1]}');
  });

  it("adds to existing JSONC without discarding other settings and keeps concurrent additions", async () => {
    const { home } = await fixture();
    const file = join(home, ".cursor/mcp.json");
    await write(file, '{ // keep\n "theme": "dark", "mcpServers": { "old": { "command": "o" }, } }');
    await Promise.all(Array.from({ length: 8 }, (_, index) => writeJsonServer(localMachineIO, file, `s${index}`, { command: "x" })));
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.theme).toBe("dark");
    expect(Object.keys(saved.mcpServers).sort()).toEqual(["old", ...Array.from({ length: 8 }, (_, index) => `s${index}`)].sort());
    await expect(writeJsonServer(localMachineIO, file, "old", { command: "x" })).rejects.toThrow("already configured");
  });

  it("writes OpenCode 1.x and 2.x layouts and refuses mismatched existing layouts", async () => {
    const { root } = await fixture();
    const one = join(root, "one.json");
    await writeOpencodeServer(localMachineIO, one, "a", { command: "node", args: ["s"], env: { K: "v" }, disabled: true }, 1);
    expect(JSON.parse(await readFile(one, "utf8")).mcp.a).toEqual({ command: ["node", "s"], environment: { K: "v" }, type: "local", enabled: false });
    const two = join(root, "two.json");
    await write(two, { mcp: { timeout: { startup: 1000 } }, other: 1 });
    await writeOpencodeServer(localMachineIO, two, "b", { url: "https://b", enabled: true }, 2);
    expect(JSON.parse(await readFile(two, "utf8"))).toEqual({ mcp: { timeout: { startup: 1000 }, servers: { b: { url: "https://b", type: "remote", disabled: false } } }, other: 1 });
    await expect(writeOpencodeServer(localMachineIO, two, "c", { command: "x" }, 1)).rejects.toThrow("2.x MCP layout");
    const legacy = join(root, "legacy.json");
    await write(legacy, { mcp: { timeout: { command: ["x"], type: "local" } } });
    await expect(writeOpencodeServer(localMachineIO, legacy, "d", { command: "x" }, 2)).rejects.toThrow("1.x MCP layout");
    expect(JSON.parse(await readFile(legacy, "utf8"))).toEqual({ mcp: { timeout: { command: ["x"], type: "local" } } });
  });
});

describe("MCP Host jobs", () => {
  it("adds file-backed servers on the execution machine and Claude/Codex through their CLIs", async () => {
    const { home, project, context } = await fixture();
    const run = vi.fn(async (_binary: { path: string }, args: string[]) => ({ stdout: args[0] === "--version" ? "opencode 2.1.0" : "", stderr: "" }));
    const { mcp } = service(project, context, { run });
    expect(await finish(mcp, { operation: "add", provider: "pi", scope: "user", name: "", config: '{"mcpServers":{"docs":{"url":"https://d","exposure":"deferred"}}}' }))
      .toEqual({ status: "completed", result: { operation: "add" } });
    expect(JSON.parse(await readFile(join(home, ".pi/agent/mcp.json"), "utf8")).mcpServers.docs).toEqual({ url: "https://d", exposure: "deferred" });
    await finish(mcp, { operation: "add", provider: "opencode", scope: "project", name: "oc", config: '{"command":"node"}' });
    expect(JSON.parse(await readFile(join(project, "opencode.json"), "utf8")).mcp.servers.oc).toEqual({ command: ["node"], type: "local" });
    await finish(mcp, { operation: "add", provider: "claude", scope: "local", name: "c", config: '{"command":"x"}' });
    await finish(mcp, { operation: "add", provider: "codex", scope: "user", name: "k", config: '{"command":"x","args":["--a"],"env":{"A":"b"}}' });
    expect(run.mock.calls.map(([binary, args]) => [binary.path, ...args])).toEqual([
      ["/bin/opencode", "--version"],
      ["/bin/claude", "mcp", "add-json", "c", '{"command":"x"}', "--scope", "local"],
      ["/bin/codex", "mcp", "add", "k", "--env", "A=b", "--", "x", "--a"],
    ]);
    expect(await finish(mcp, { operation: "add", provider: "codex", scope: "project", name: "k", config: '{"command":"x"}' }))
      .toEqual({ status: "failed", error: "Codex CLI adds user-scoped servers only" });
    expect(await finish(mcp, { operation: "add", provider: "claude_desktop", scope: "user", name: "r", config: '{"url":"https://x"}' }))
      .toEqual({ status: "failed", error: "Claude Desktop local configuration requires a command" });
  });

  it("keeps provider sign-in timeouts and reports CLI output on failure", async () => {
    const { project, context } = await fixture();
    const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const { mcp } = service(project, context, { run });
    await finish(mcp, { operation: "login", provider: "claude", name: "docs" });
    await finish(mcp, { operation: "login", provider: "pi", name: "docs" });
    await finish(mcp, { operation: "login", provider: "opencode", name: "My docs" });
    expect(run.mock.calls.map(([, args, options]) => [...args, (options as { timeout: number }).timeout])).toEqual([
      ["mcp", "login", "docs", 180_000], ["mcp", "login", "docs", 330_000], ["mcp", "auth", "My docs", 180_000],
    ]);
    run.mockRejectedValueOnce(Object.assign(new Error("exit 1"), { stdout: "out", stderr: " denied " }));
    expect(await finish(mcp, { operation: "remove", name: "docs", scope: "user" })).toEqual({ status: "failed", error: "denied out" });
    expect(await finish(mcp, { operation: "login", provider: "claude", name: "bad name" })).toEqual({ status: "failed", error: "Invalid MCP server name" });
  });

  it("lists Claude health with WebSocket servers and accepts Pi reports from a failing exit", async () => {
    const { project, context } = await fixture();
    await write(join(project, ".mcp.json"), { mcpServers: { live: { type: "ws", url: "ws://x" }, docs: { command: "d" } } });
    const run = vi.fn(async (binary: { path: string }) => {
      if (binary.path === "/bin/pi") throw Object.assign(new Error("exit 1"), { stdout: JSON.stringify({ servers: [{ name: "p", scope: "global", source: "/s", enabled: true, state: "needs-auth", tools: [{ name: "secret-schema" }] }], errors: ["e"], note: null }), stderr: "" });
      return { stdout: "docs: d - ✓ Connected\n", stderr: "" };
    });
    const { mcp } = service(project, context, { run });
    expect(await finish(mcp, { operation: "claudeList" })).toEqual({ status: "completed", result: {
      operation: "claudeList", output: "docs: d - ✓ Connected\nlive: WebSocket server (open Claude /mcp for status)" } });
    const pi = await finish(mcp, { operation: "piList" });
    expect(pi).toEqual({ status: "completed", result: { operation: "piList", report: { servers: [{ name: "p", scope: "global", source: "/s", enabled: true,
      state: "needs-auth", toolCount: 1, resources: null, resourceTemplates: null, override: null, error: null }], errors: ["e"], note: null } } });
  });

  it("reuses a request ID only for identical content and isolates owners", async () => {
    const { project, context } = await fixture();
    let release!: () => void;
    const { mcp } = service(project, context, { run: vi.fn(() => new Promise<{ stdout: string; stderr: string }>((resolve) => { release = () => resolve({ stdout: "", stderr: "" }); })) });
    const request = { projectId: "p", requestId: "r1", operation: "login", provider: "claude", name: "docs" };
    expect(mcp.start("owner", request)).toEqual({ status: "running" });
    expect(mcp.start("owner", request)).toEqual({ status: "running" });
    expect(() => mcp.start("owner", { ...request, name: "other" })).toThrow("different content");
    await expect(mcp.status("other", { requestId: "r1" })).rejects.toThrow("unavailable");
    expect(await mcp.status("owner", { requestId: "r1" }, 10)).toEqual({ status: "running" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    expect(await mcp.status("owner", { requestId: "r1" })).toEqual({ status: "completed", result: { operation: "login" } });
    expect(() => mcp.start("owner", { ...request, requestId: "../x" })).toThrow("Invalid MCP request ID");
  });

  it("inspects the configured server, including Claude local scope, without returning its config", async () => {
    const { home, project, context } = await fixture();
    await write(join(home, ".claude.json"), { projects: { [project]: { mcpServers: { a: { command: "x", env: { K: "secret" } } } } } });
    const inspect = vi.fn(async () => ({ serverName: "demo", serverVersion: null, protocolVersion: null, instructions: null, tools: [], resources: null, resourceTemplates: null, prompts: null, errors: [] }));
    const { mcp } = service(project, context, { inspect });
    const result = await finish(mcp, { operation: "inspect", provider: "claude", scope: "local", configPath: join(home, ".claude.json"), name: "a" });
    expect(result).toMatchObject({ status: "completed", result: { inspection: { serverName: "demo" } } });
    expect(inspect).toHaveBeenCalledWith({ command: "x", env: { K: "secret" } }, project);
    expect(await finish(mcp, { operation: "inspect", provider: "claude", scope: "user", configPath: join(home, ".claude.json"), name: "a" }))
      .toEqual({ status: "failed", error: `a was not found in ${join(home, ".claude.json")}` });
  });
});

const STDIO_SERVER = `
let buffer = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
process.stdin.setEncoding("utf8");
let pinged = false;
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (message.method === "initialize") {
      console.log("not json log line");
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: "demo", version: "1" }, instructions: process.env.DEMO_TOKEN ? "token present" : "missing" } });
    } else if (message.method === "tools/list" && !pinged) {
      pinged = true;
      send({ jsonrpc: "2.0", id: "server-ping", method: "ping" });
      send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "one" }], nextCursor: "2" } });
    } else if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "two" }] } });
    } else if (message.method === "prompts/list") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -1, message: "no prompts" } });
    }
  }
});
`;

async function listen(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => handler(request, response, body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe("MCP inspector", () => {
  it("expands Claude and OpenCode variables and parses provider transport shapes", () => {
    const lookup = (key: string) => key === "TOKEN" ? "secret" : undefined;
    expect(expandVars("a ${TOKEN} ${MISSING:-x} {env:TOKEN} ${NONE}", lookup)).toBe("a secret x secret ");
    expect(parseSpec({ type: "local", command: ["node", "s.js"], environment: { A: "b" } }, lookup))
      .toEqual({ kind: "stdio", command: "node", args: ["s.js"], env: [["A", "b"]], cwd: undefined });
    expect(parseSpec({ url: "https://e/mcp", bearer_token_env_var: "TOKEN", http_headers: { "X-A": "1" } }, lookup))
      .toEqual({ kind: "http", url: "https://e/mcp", headers: [["X-A", "1"], ["Authorization", "Bearer secret"]], sse: false });
    expect(parseSpec({ type: "sse", url: "https://e/sse" }, lookup)).toMatchObject({ sse: true });
  });

  it("inspects a stdio server with pagination, server pings, stdout noise and env expansion", async () => {
    const { root } = await fixture();
    const script = join(root, "server.mjs");
    await writeFile(script, STDIO_SERVER);
    vi.stubEnv("OMNICODE_TEST_TOKEN", "abc");
    try {
      const inspection = await inspectServer({ config: { command: process.execPath, args: [script], env: { DEMO_TOKEN: "${OMNICODE_TEST_TOKEN}" } }, projectDir: root });
      expect(inspection).toEqual({ serverName: "demo", serverVersion: "1", protocolVersion: "2025-06-18", instructions: "token present",
        tools: [{ name: "one" }, { name: "two" }], resources: null, resourceTemplates: null, prompts: [], errors: ["prompts/list: no prompts"] });
    } finally { vi.unstubAllEnvs(); }
  });

  it("reports the stderr tail when a stdio server exits", async () => {
    await expect(inspectServer({ config: { command: process.execPath, args: ["-e", "console.error('boom'); process.exit(3)"] } }))
      .rejects.toThrow("Server exited: boom");
  });

  it("speaks Streamable HTTP with sessions, JSON and SSE responses", async () => {
    const seen: Array<{ method?: string; session?: string; protocol?: string; auth?: string }> = [];
    const url = await listen((request, response, body) => {
      const message = JSON.parse(body);
      seen.push({ method: message.method, session: request.headers["mcp-session-id"] as string, protocol: request.headers["mcp-protocol-version"] as string, auth: request.headers.authorization });
      if (message.method === "initialize") {
        response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "s1" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: { resources: {} }, serverInfo: { title: "Remote" } } }));
      } else if (message.id === undefined) { response.writeHead(202); response.end(); }
      else if (message.method === "resources/list") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resources: [{ name: "r", uri: "x://r" }] } })}\n\n`);
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify([{ jsonrpc: "2.0", id: message.id, result: { resourceTemplates: [] } }]));
      }
    });
    vi.stubEnv("OMNICODE_TEST_TOKEN", "tok");
    try {
      const inspection = await inspectServer({ config: { url: `${url}/mcp`, headers: { Authorization: "Bearer ${OMNICODE_TEST_TOKEN}" } } });
      expect(inspection).toMatchObject({ serverName: "Remote", protocolVersion: "2025-03-26", resources: [{ name: "r", uri: "x://r" }], resourceTemplates: [], tools: null });
    } finally { vi.unstubAllEnvs(); }
    expect(seen.slice(1).every((entry) => entry.session === "s1" && entry.protocol === "2025-03-26")).toBe(true);
    expect(seen.every((entry) => entry.auth === "Bearer tok")).toBe(true);
  });

  it("explains that provider OAuth sessions cannot be reused for HTTP inspection", async () => {
    const url = await listen((_request, response) => { response.writeHead(401); response.end("nope"); });
    await expect(inspectServer({ config: { url } })).rejects.toThrow("Authentication required");
  });

  it("speaks legacy HTTP+SSE through the announced endpoint", async () => {
    let stream: ServerResponse | undefined;
    const url = await listen((request, response, body) => {
      if (request.method === "GET") {
        stream = response;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write("event: endpoint\ndata: /messages?session=1\n\n");
        return;
      }
      expect(request.url).toBe("/messages?session=1");
      const message = JSON.parse(body);
      response.writeHead(202); response.end();
      if (message.method === "initialize")
        stream!.write(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { capabilities: { tools: {} }, serverInfo: { name: "legacy" } } })}\n\n`);
      else if (message.method === "tools/list")
        stream!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "t" }] } })}\n\n`);
    });
    const inspection = await inspectServer({ config: { type: "sse", url: `${url}/sse` } });
    expect(inspection).toMatchObject({ serverName: "legacy", tools: [{ name: "t" }] });
    stream?.end();
  });

  it("runs the inspector as a process on the execution machine", async () => {
    const { root } = await fixture();
    const script = join(root, "server.mjs");
    await writeFile(script, STDIO_SERVER);
    const inspection = await defaultMcpDependencies.inspect({ command: process.execPath, args: [script] }, root);
    expect(inspection.tools).toEqual([{ name: "one" }, { name: "two" }]);
    await expect(defaultMcpDependencies.inspect({ args: [] }, root)).rejects.toThrow("no command or URL");
  });
});
