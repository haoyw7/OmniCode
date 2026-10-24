// Connect once to a configured MCP server and list what it offers.
// Self-contained (Node built-ins only): the Host runs it on the project's
// execution machine, including WSL, so server commands, environment variables
// and network access resolve where the provider would run them.

const PROTOCOL_VERSION = "2025-06-18";
// First runs of `npx`/`uvx` servers download packages before they answer.
const TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;
const STDERR_TAIL = 4000;

/** `${VAR}`, `${VAR:-default}` (Claude) and `{env:VAR}` (OpenCode). */
export function expandVars(raw, lookup) {
  let out = "";
  let rest = raw;
  for (;;) {
    const dollar = rest.indexOf("${");
    const env = rest.indexOf("{env:");
    let start, prefix;
    if (dollar >= 0 && env >= 0 && env < dollar) [start, prefix] = [env, "{env:"];
    else if (dollar >= 0) [start, prefix] = [dollar, "${"];
    else if (env >= 0) [start, prefix] = [env, "{env:"];
    else break;
    const end = rest.indexOf("}", start);
    if (end < 0) break;
    out += rest.slice(0, start);
    const body = rest.slice(start + prefix.length, end);
    const split = prefix === "${" ? body.indexOf(":-") : -1;
    const key = split >= 0 ? body.slice(0, split) : body;
    const fallback = split >= 0 ? body.slice(split + 2) : undefined;
    const value = lookup(key);
    out += value ? value : fallback ?? "";
    rest = rest.slice(end + 1);
  }
  return out + rest;
}

/** Provider configs share most keys: Claude/Cursor/Pi (`command` + `args`),
 * OpenCode (`command` array, `environment`), Codex (`http_headers`, …). */
export function parseSpec(config, lookup) {
  const text = (value) => (typeof value === "string" ? expandVars(value, lookup) : undefined);
  const pairs = (key) => {
    const map = config[key];
    if (!map || typeof map !== "object" || Array.isArray(map)) return [];
    return Object.entries(map).flatMap(([name, value]) => {
      const expanded = text(value);
      return expanded === undefined ? [] : [[name, expanded]];
    });
  };
  const url = text(config.url);
  if (url !== undefined) {
    const headers = [...pairs("headers"), ...pairs("http_headers")];
    const variables = config.env_http_headers;
    if (variables && typeof variables === "object" && !Array.isArray(variables))
      for (const [header, variable] of Object.entries(variables)) {
        const value = typeof variable === "string" ? lookup(variable) : undefined;
        if (value !== undefined) headers.push([header, value]);
      }
    const token = typeof config.bearer_token_env_var === "string" ? lookup(config.bearer_token_env_var) : undefined;
    if (token !== undefined) headers.push(["Authorization", `Bearer ${token}`]);
    return { kind: "http", url, headers, sse: config.type === "sse" };
  }
  const parts = Array.isArray(config.command)
    ? config.command.map(text).filter((part) => part !== undefined)
    : config.command !== undefined && text(config.command) !== undefined ? [text(config.command)] : [];
  if (Array.isArray(config.args)) parts.push(...config.args.map(text).filter((part) => part !== undefined));
  if (!parts.length || !parts[0].trim()) throw new Error("Server configuration has no command or URL");
  const [command, ...args] = parts;
  return { kind: "stdio", command, args, env: [...pairs("env"), ...pairs("environment")], cwd: text(config.cwd) };
}

const isResponse = (message, id) =>
  message && typeof message === "object" && message.method === undefined && message.id === id;

function rpcResult(message) {
  if (message.error !== undefined) {
    const error = message.error;
    throw new Error(typeof error?.message === "string" ? error.message : JSON.stringify(error));
  }
  return message.result ?? null;
}

export async function inspect(transport, clientVersion = "0.0.0") {
  const init = await transport.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "OmniCode", version: clientVersion },
  }) ?? {};
  await transport.notify("notifications/initialized", {});
  const string = (value) => (typeof value === "string" ? value : null);
  const info = init.serverInfo ?? {};
  const capabilities = init.capabilities ?? {};
  const errors = [];
  const list = async (method, key) => {
    const items = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      let result;
      try {
        result = await transport.request(method, cursor ? { cursor } : {});
      } catch (error) {
        errors.push(`${method}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (Array.isArray(result?.[key])) items.push(...result[key]);
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return items;
  };
  const declared = (key) => capabilities[key] !== undefined && capabilities[key] !== null;
  const tools = declared("tools") ? await list("tools/list", "tools") : null;
  const resources = declared("resources") ? await list("resources/list", "resources") : null;
  const resourceTemplates = declared("resources") ? await list("resources/templates/list", "resourceTemplates") : null;
  const prompts = declared("prompts") ? await list("prompts/list", "prompts") : null;
  return {
    serverName: string(info.title ?? info.name),
    serverVersion: string(info.version),
    protocolVersion: string(init.protocolVersion),
    instructions: string(init.instructions),
    tools,
    resources,
    resourceTemplates,
    prompts,
    errors,
  };
}

/** A queue of parsed messages with deadline-bound waits. */
class Mailbox {
  messages = [];
  waiters = [];
  closed;
  push(message) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(message);
    else this.messages.push(message);
  }
  close(error) {
    this.closed = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  next(timeoutMs, label) {
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`${label} timed out`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

async function resolveCommand(command, env) {
  const { access, constants } = await import("node:fs/promises");
  const path = await import("node:path");
  if (/[\\/]/.test(command)) {
    if (command === "~" || /^~[\\/]/.test(command)) {
      const { homedir } = await import("node:os");
      return path.join(homedir(), command.slice(1));
    }
    return command;
  }
  const windows = process.platform === "win32";
  const extensions = windows ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const directories = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories)
    for (const extension of windows && path.extname(command) ? ["", ...extensions] : extensions) {
      const candidate = path.join(directory.replace(/^"|"$/g, ""), command + extension);
      try { await access(candidate, windows ? constants.F_OK : constants.X_OK); return candidate; } catch { /* next */ }
    }
  if (!windows) {
    // GUI-launched Hosts may lack the login PATH that provider CLIs use.
    const { execFile } = await import("node:child_process");
    const shell = env.SHELL || "/bin/sh";
    const found = await new Promise((resolve) => execFile(shell, ["-lc", 'command -v -- "$1"', "omnicode", command],
      { timeout: 10_000, env }, (error, stdout) => resolve(error ? "" : String(stdout).trim())));
    if (found.startsWith("/")) return found;
  }
  return command;
}

const quoteCmd = (value) => (/^[A-Za-z0-9_\-+=.,:/\\@]+$/.test(value) ? value : `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`);

export class StdioTransport {
  static async spawn(spec, projectDir) {
    const { spawn } = await import("node:child_process");
    const { stat } = await import("node:fs/promises");
    const env = { ...process.env, ...Object.fromEntries(spec.env) };
    const program = await resolveCommand(spec.command, env);
    let cwd;
    for (const candidate of [spec.cwd, projectDir])
      if (candidate && await stat(candidate).then((value) => value.isDirectory(), () => false)) { cwd = candidate; break; }
    // npm/uv launchers on Windows are batch files, which Node only runs through cmd.
    const batch = process.platform === "win32" && /\.(cmd|bat)$/i.test(program);
    const child = batch
      ? spawn([quoteCmd(program), ...spec.args.map(quoteCmd)].join(" "), { shell: true, cwd, env, windowsHide: true, stdio: "pipe" })
      : spawn(program, spec.args, { cwd, env, windowsHide: true, stdio: "pipe" });
    const transport = new StdioTransport(child, spec.command);
    transport.batch = batch;
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => reject(new Error(`Failed to start ${spec.command}: ${error.message}`)));
    });
    return transport;
  }

  constructor(child, label) {
    this.child = child;
    this.label = label;
    this.nextId = 0;
    this.stderr = "";
    this.mailbox = new Mailbox();
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // Servers sometimes log to stdout; skip anything that is not JSON-RPC.
        try { this.mailbox.push(JSON.parse(line)); } catch { /* not JSON */ }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL);
    });
    child.stdin.on("error", () => {});
    child.on("close", () => this.mailbox.close(new Error(this.exited())));
    child.on("error", () => this.mailbox.close(new Error(this.exited())));
  }

  exited() {
    const tail = this.stderr.trim();
    return tail ? `Server exited: ${tail}` : "Server exited before answering";
  }

  send(message) {
    if (this.mailbox.closed || !this.child.stdin.writable) throw new Error(this.exited());
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params) {
    const id = ++this.nextId;
    this.send({ jsonrpc: "2.0", id, method, params });
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const message = await this.mailbox.next(Math.max(0, deadline - Date.now()), method);
      if (isResponse(message, id)) return rpcResult(message);
      // Answer server requests so servers that ping or ask for roots keep going.
      if (typeof message?.method === "string" && message.id !== undefined) {
        const reply = message.method === "ping" ? { jsonrpc: "2.0", id: message.id, result: {} }
          : message.method === "roots/list" ? { jsonrpc: "2.0", id: message.id, result: { roots: [] } }
          : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
        this.send(reply);
      }
    }
  }

  async notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Stop the server and wait briefly so it releases its working directory. */
  async close() {
    this.mailbox.close(new Error("Inspection finished"));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise((resolve) => {
      this.child.once("close", resolve);
      setTimeout(resolve, 5000).unref?.();
    });
    try { this.child.stdin.end(); } catch { /* already closed */ }
    if (this.batch && this.child.pid) {
      // A cmd-launched server is a child of the shell; end the whole tree.
      const { spawn } = await import("node:child_process");
      spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
    } else this.child.kill("SIGTERM");
    await exited;
  }
}

async function httpError(response) {
  if (response.status === 401 || response.status === 403)
    return new Error("Authentication required. Sign in to this server through its provider; OAuth sessions stored by providers cannot be reused here.");
  const body = (await response.text().catch(() => "")).trim();
  return new Error(body ? `HTTP ${response.status}: ${[...body].slice(0, 400).join("")}` : `HTTP ${response.status}`);
}

/** Read `event`/`data` pairs from a Server-Sent Events body until `onEvent` returns false. */
export async function readSse(body, onEvent) {
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data = "";
  let open = true;
  const line = (raw) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (text === "") {
      if (data && onEvent(event, data) === false) open = false;
      event = "";
      data = "";
    } else if (text.startsWith("event:")) event = text.slice(6).trim();
    else if (text.startsWith("data:")) {
      const value = text.slice(5);
      data = (data ? `${data}\n` : "") + (value.startsWith(" ") ? value.slice(1) : value);
    }
  };
  const reader = body.getReader();
  try {
    while (open) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while (open && (newline = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

const requestHeaders = (headers, extra) => {
  const result = new Headers(extra);
  for (const [key, value] of headers) result.set(key, value);
  return result;
};

/** Streamable HTTP: each request is a POST answered with JSON or an SSE stream. */
export class HttpTransport {
  constructor(url, headers) {
    this.url = url;
    this.headers = headers;
    this.nextId = 0;
  }

  async post(body) {
    const headers = requestHeaders(this.headers, { "Content-Type": "application/json", Accept: "application/json, text/event-stream" });
    if (this.session) headers.set("Mcp-Session-Id", this.session);
    if (this.protocol) headers.set("MCP-Protocol-Version", this.protocol);
    const response = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw await httpError(response);
    const session = response.headers.get("mcp-session-id");
    if (session) this.session = session;
    return response;
  }

  async request(method, params) {
    const id = ++this.nextId;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    let found;
    if ((response.headers.get("content-type") ?? "").split(";")[0].trim() === "text/event-stream" && response.body) {
      await readSse(response.body, (_event, data) => {
        try {
          const message = JSON.parse(data);
          if (isResponse(message, id)) { found = message; return false; }
        } catch { /* not JSON */ }
        return true;
      });
    } else {
      const body = JSON.parse(await response.text());
      found = Array.isArray(body) ? body.find((message) => isResponse(message, id)) : body;
    }
    if (!found) throw new Error(`${method}: no response`);
    const result = rpcResult(found);
    if (method === "initialize" && typeof result?.protocolVersion === "string") this.protocol = result.protocolVersion;
    return result;
  }

  async notify(method, params) {
    const response = await this.post({ jsonrpc: "2.0", method, params });
    await response.body?.cancel().catch(() => {});
  }

  close() {}
}

/** Legacy HTTP+SSE: a GET stream announces a POST endpoint and carries replies. */
export class SseTransport {
  static async connect(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, { headers: requestHeaders(headers, { Accept: "text/event-stream" }), signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!response.ok) { controller.abort(); throw await httpError(response); }
    const transport = new SseTransport(headers, controller);
    let announce;
    const endpoint = new Promise((resolve, reject) => { announce = { resolve, reject }; });
    void readSse(response.body, (event, data) => {
      if (event === "endpoint") {
        try { announce.resolve(new URL(data.trim(), url).href); } catch (error) { announce.reject(error); }
        return true;
      }
      try { transport.mailbox.push(JSON.parse(data)); } catch { /* not JSON */ }
      return true;
    }).catch(() => {}).finally(() => {
      transport.mailbox.close(new Error("Server closed the event stream"));
      announce.reject(new Error("Server did not announce an SSE endpoint"));
    });
    let wait;
    transport.endpoint = await Promise.race([endpoint, new Promise((_, reject) => {
      wait = setTimeout(() => reject(new Error("Server did not announce an SSE endpoint")), TIMEOUT_MS);
    })]).finally(() => clearTimeout(wait)).catch((error) => { controller.abort(); throw error; });
    return transport;
  }

  constructor(headers, controller) {
    this.headers = headers;
    this.controller = controller;
    this.mailbox = new Mailbox();
    this.nextId = 0;
  }

  async post(body) {
    const response = await fetch(this.endpoint, {
      method: "POST", headers: requestHeaders(this.headers, { "Content-Type": "application/json" }),
      body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw await httpError(response);
    await response.body?.cancel().catch(() => {});
  }

  async request(method, params) {
    const id = ++this.nextId;
    await this.post({ jsonrpc: "2.0", id, method, params });
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const message = await this.mailbox.next(Math.max(0, deadline - Date.now()), method);
      if (isResponse(message, id)) return rpcResult(message);
    }
  }

  async notify(method, params) {
    await this.post({ jsonrpc: "2.0", method, params });
  }

  close() {
    this.controller.abort();
  }
}

/** Inspect one server configuration. Secrets stay on this machine: headers and
 * environment values are used for the connection and never returned. */
export async function inspectServer({ config, projectDir, clientVersion }) {
  const spec = parseSpec(config, (key) => process.env[key]);
  const transport = spec.kind === "stdio" ? await StdioTransport.spawn(spec, projectDir)
    : spec.sse ? await SseTransport.connect(spec.url, spec.headers)
    : new HttpTransport(spec.url, spec.headers);
  try {
    return await inspect(transport, clientVersion);
  } finally {
    await transport.close();
  }
}
