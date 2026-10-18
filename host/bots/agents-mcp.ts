import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { requestControl } from "../control";

export const AGENTS_HELP = `OmniCode Bot collaboration — same Host, one hop.
Usage: <control-cli> agents ACTION [--json JSON | --input FILE|-] [--request-id ID]
  list_bots {} — list only Bots this run may call
  ask_bot {botId,prompt,timeoutMs?} — ask one Bot; maximum 240000 ms
  delegate_bot {teamId,botId,prompt,timeoutMs?} — Chief dispatch; returns immediately
  coordinate_bots {teamId,botIds,prompt,timeoutMs?} — Chief dispatch and aggregate selected members
Busy targets return immediately. Targets use their own permissions and approval.
An uncertain response includes requestId: retry exactly the same input and ID.
Short authenticated polls share the Host's original deadline; retries never extend it.
Credentials are inherited from the current Bot run. Never print credentials.`;

const terminal = new Set(["completed", "busy", "failed", "cancelled", "timed_out", "interrupted"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validate(action: string, input: Record<string, unknown>, requestId: string) {
  if (!["list_bots", "ask_bot", "delegate_bot", "coordinate_bots"].includes(action)) throw new Error("Unknown agents action; run agents --help");
  if (!requestId || requestId.length > 128 || requestId.includes("\0")) throw new Error("Invalid request ID");
  const allowed = action === "list_bots" ? [] : action === "ask_bot" ? ["botId", "prompt", "timeoutMs"]
    : ["teamId", action === "coordinate_bots" ? "botIds" : "botId", "prompt", "timeoutMs"];
  if (!record(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid agents input fields");
  if (action !== "list_bots") {
    if (action !== "ask_bot" && (typeof input.teamId !== "string" || !input.teamId.trim() || input.teamId.length > 200 || input.teamId.includes("\0"))) throw new Error("Invalid team ID");
    if (action === "coordinate_bots" && (!Array.isArray(input.botIds) || !input.botIds.length || input.botIds.length > 10 ||
        new Set(input.botIds).size !== input.botIds.length || input.botIds.some(botId => typeof botId !== "string" || !botId.trim() || botId.length > 200 || botId.includes("\0"))))
      throw new Error("Choose between 1 and 10 unique team members");
    if (action !== "coordinate_bots" && (typeof input.botId !== "string" || !input.botId.trim() || input.botId.length > 200 || input.botId.includes("\0"))) throw new Error("Invalid target Bot ID");
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 100_000 || input.prompt.includes("\0")) throw new Error("Invalid delegation prompt");
    if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || Number(input.timeoutMs) < 1 || Number(input.timeoutMs) > 240_000)) throw new Error("timeoutMs must be between 1 and 240000");
  }
}

/** Both transports use precisely the same authenticated Host operation. */
export async function callAgent(action: string, input: Record<string, unknown>, requestId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  validate(action, input, requestId);
  let deadline = Date.now() + 240_000;
  while (true) {
    const reply = await requestControl("assistant", `agents.${action}`, input, requestId, signal);
    if (!reply.ok || action === "list_bots" || action === "delegate_bot") return { ...reply, requestId };
    const result = reply.result;
    if (!record(result) || typeof result.status !== "string") throw new Error("Invalid Host delegation response");
    if (terminal.has(result.status)) return { ...reply, requestId };
    if (result.status !== "running" || typeof result.deadlineAt !== "number" || !Number.isFinite(result.deadlineAt)) throw new Error("Invalid Host delegation deadline");
    deadline = Math.min(deadline, result.deadlineAt);
    if (Date.now() >= deadline) throw new Error("Host delegation has not settled at its deadline; retry the same request ID");
    // The Host normally holds each poll for up to 25 seconds. Bound the rate if
    // it returns early (for example, an approval/state-change notification).
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error("Control request interrupted; retry the same request ID")); return; }
      const abort = () => { clearTimeout(timer); reject(new Error("Control request interrupted; retry the same request ID")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.min(100, Math.max(1, deadline - Date.now())));
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function errorReply(error: unknown, requestId: string) {
  const message = error instanceof Error ? error.message : String(error);
  const token = process.env.OMNICODE_CONTROL_TOKEN;
  return { ok: false, requestId, error: token ? message.replaceAll(token, "[redacted]") : message };
}

export async function runAgentsCli(args: string[]): Promise<number> {
  if (!args[0] || args[0] === "--help") { process.stdout.write(`${AGENTS_HELP}\n`); return 0; }
  let requestId: string = randomUUID();
  try {
    const options = new Map<string, string>();
    for (let i = 1; i < args.length; i += 2) {
      if (!["--json", "--input", "--request-id"].includes(args[i]) || options.has(args[i]) || !args[i + 1]) throw new Error("Unknown, duplicate or incomplete agents option");
      options.set(args[i], args[i + 1]);
    }
    requestId = options.get("--request-id") ?? requestId;
    if (options.has("--json") && options.has("--input")) throw new Error("Use either --json or --input");
    const path = options.get("--input");
    const input = JSON.parse(options.get("--json") ?? (path ? readFileSync(path === "-" ? 0 : path, "utf8") : "{}"));
    const reply = await callAgent(args[0], input, requestId);
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return reply.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorReply(error, requestId))}\n`);
    return 1;
  }
}

export const AGENTS_MCP_TOOLS = [
  { name: "list_bots", description: "List same-Host Bots allowed for the current run. A delegated Bot cannot delegate again.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "ask_bot", description: "Ask an allowed same-Host Bot, waiting at most 240 seconds. Busy targets return immediately. The target uses its own permissions. Retry an uncertain result with the returned requestId and unchanged input.", inputSchema: { type: "object", properties: { botId: { type: "string", minLength: 1, maxLength: 200 }, prompt: { type: "string", minLength: 1, maxLength: 100000 }, timeoutMs: { type: "integer", minimum: 1, maximum: 240000 }, requestId: { type: "string", minLength: 1, maxLength: 128, description: "Reuse the returned ID after an uncertain response." } }, required: ["botId", "prompt"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  ...(["delegate_bot", "coordinate_bots"] as const).map(name => ({ name,
    description: name === "delegate_bot"
      ? "Current team Chief only: dispatch one allowed member and return a trackable delegation immediately. It survives normal parent completion until its deadline, but not cancellation or revoked membership."
      : "Current team Chief only: dispatch selected allowed members in parallel and aggregate results within one original deadline (maximum 240 seconds), including busy and failed members.",
    inputSchema: { type: "object", properties: { teamId: { type: "string", minLength: 1, maxLength: 200 },
      ...(name === "delegate_bot" ? { botId: { type: "string", minLength: 1, maxLength: 200 } } : { botIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 10, uniqueItems: true } }),
      prompt: { type: "string", minLength: 1, maxLength: 100000 }, timeoutMs: { type: "integer", minimum: 1, maximum: 240000 },
      requestId: { type: "string", minLength: 1, maxLength: 128, description: "Reuse after an uncertain response with exactly the same input." } },
      required: ["teamId", name === "delegate_bot" ? "botId" : "botIds", "prompt"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } })),
];

/** Newline JSON-RPC stdio; stdout contains protocol messages only. */
export async function runAgentsMcp(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  let initialized = false, data = "", closed = false;
  const pending = new Map<string | number, AbortController>();
  const write = (value: unknown) => { if (!closed) output.write(`${JSON.stringify(value)}\n`); };
  const fail = (id: unknown, code: number, message: string) => write({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  const handle = async (line: string) => {
    let request: Record<string, unknown>;
    try { const parsed = JSON.parse(line); if (!record(parsed)) throw new Error(); request = parsed; }
    catch { fail(null, -32700, "Invalid JSON-RPC message"); return; }
    const id = request.id;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") { fail(id, -32600, "Invalid JSON-RPC request"); return; }
    if (id === undefined) {
      if (request.method === "notifications/cancelled" && record(request.params)) pending.get(request.params.requestId as string | number)?.abort();
      return;
    }
    if (typeof id !== "string" && typeof id !== "number") { fail(null, -32600, "Invalid request ID"); return; }
    if (pending.has(id)) { fail(id, -32600, "Request ID is already running"); return; }
    const result = (value: unknown) => write({ jsonrpc: "2.0", id, result: value });
    if (request.method === "initialize") {
      initialized = true;
      const requested = record(request.params) ? request.params.protocolVersion : undefined;
      result({ protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(requested)) ? requested : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "omnicode-agents", version: "1.0.0" } }); return;
    }
    if (!initialized) { fail(id, -32002, "Initialize the server first"); return; }
    if (request.method === "ping") { result({}); return; }
    if (request.method === "tools/list") { result({ tools: AGENTS_MCP_TOOLS }); return; }
    if (request.method !== "tools/call") { fail(id, -32601, "Method not found"); return; }
    if (pending.size >= 16) { fail(id, -32000, "Too many pending requests"); return; }
    const abort = new AbortController();
    pending.set(id, abort);
    let requestId: string = randomUUID();
    try {
      if (!record(request.params) || typeof request.params.name !== "string") throw new Error("Invalid tool parameters");
      const args = request.params.arguments ?? {};
      if (!record(args)) throw new Error("Tool arguments must be an object");
      const { requestId: retryId, ...parameters } = args;
      if (retryId !== undefined) {
        if (!["ask_bot", "delegate_bot", "coordinate_bots"].includes(request.params.name) || typeof retryId !== "string") throw new Error("Invalid request ID");
        requestId = retryId;
      }
      const reply = await callAgent(request.params.name, parameters, requestId, abort.signal);
      result({ content: [{ type: "text", text: JSON.stringify(reply) }], structuredContent: reply, ...(reply.ok ? {} : { isError: true }) });
    } catch (error) {
      const reply = errorReply(error, requestId);
      result({ content: [{ type: "text", text: JSON.stringify(reply) }], structuredContent: reply, isError: true });
    } finally { pending.delete(id); }
  };
  input.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    const finish = () => { closed = true; for (const abort of pending.values()) abort.abort(); resolve(); };
    input.on("data", (part: string) => {
      data += part;
      if (Buffer.byteLength(data, "utf8") > 1_000_000) { fail(null, -32600, "Message exceeds the input limit"); input.destroy(); finish(); return; }
      let newline: number;
      while ((newline = data.indexOf("\n")) >= 0) {
        const line = data.slice(0, newline); data = data.slice(newline + 1);
        if (line.trim()) void handle(line);
      }
    });
    input.once("end", finish);
    input.once("close", finish);
    input.once("error", error => { finish(); reject(error); });
  });
}
