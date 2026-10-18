import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostControl } from "../control";
import { callAgent, runAgentsCli } from "./agents-mcp";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function service(handle: ConstructorParameters<typeof HostControl>[0]) {
  const control = new HostControl(handle, { namespace: "assistant", actions: ["agents.list_bots", "agents.ask_bot", "agents.delegate_bot", "agents.coordinate_bots"] });
  await control.ready;
  control.enable("trusted-brain");
  const environment = control.environment("trusted-brain");
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  return { control, environment };
}

it("CLI polls one durable request through running states without extending its deadline", async () => {
  const deadlineAt = Date.now() + 240_000;
  const handle = vi.fn(async (_brain, _request, _action, input) => ({ id: "delegation", status: handle.mock.calls.length < 3 ? "running" : "completed", deadlineAt, result: "done", prompt: input.prompt }));
  const { control, environment } = await service(handle);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    expect(await runAgentsCli(["ask_bot", "--request-id", "stable-request", "--json", '{"botId":"target","prompt":"hello"}'])).toBe(0);
    expect(handle).toHaveBeenCalledTimes(3);
    expect(handle.mock.calls.every(([brain, id, action, input]) => brain === "trusted-brain" && id === "stable-request" && action === "agents.ask_bot" && JSON.stringify(input) === '{"botId":"target","prompt":"hello"}')).toBe(true);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ ok: true, requestId: "stable-request", result: { status: "completed", deadlineAt } });
    expect(lines.join("")).not.toContain(environment.MONOCODE_CONTROL_TOKEN);
  } finally { await control.close(); }
});

it("refuses forged source fields and unbounded waits before contacting Host", async () => {
  const handle = vi.fn(async () => ({}));
  const { control } = await service(handle);
  try {
    for (const extra of [{ sourceBotId: "forged" }, { source: {} }, { timeoutMs: 240001 }, { timeoutMs: 0 }])
      await expect(callAgent("ask_bot", { botId: "target", prompt: "hello", ...extra }, "same")).rejects.toThrow();
    expect(handle).not.toHaveBeenCalled();
  } finally { await control.close(); }
});

it("returns busy immediately and preserves a revoked request ID for explicit retry", async () => {
  const handle = vi.fn(async () => ({ id: "delegation", status: "busy" }));
  const { control, environment } = await service(handle);
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { lines.push(String(chunk)); return true; });
  try {
    expect(await runAgentsCli(["ask_bot", "--request-id", "same", "--json", '{"botId":"target","prompt":"hello"}'])).toBe(0);
    expect(handle).toHaveBeenCalledTimes(1);
    control.disable("trusted-brain");
    expect(await runAgentsCli(["ask_bot", "--request-id", "same", "--json", '{"botId":"target","prompt":"hello"}'])).toBe(1);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ ok: false, requestId: "same", error: "Connection revoked or unauthorized" });
    expect(lines.join("")).not.toContain(environment.MONOCODE_CONTROL_TOKEN);
  } finally { await control.close(); }
});

it("does not restart a deadline supplied by an earlier submit", async () => {
  const handle = vi.fn(async () => ({ id: "delegation", status: "running", deadlineAt: Date.now() - 1 }));
  const { control } = await service(handle);
  try {
    await expect(callAgent("ask_bot", { botId: "target", prompt: "hello" }, "old-request")).rejects.toThrow("deadline");
    expect(handle).toHaveBeenCalledTimes(1);
  } finally { await control.close(); }
});

it("serves MCP initialize, tools and calls in a real stdio process using only the inherited run grant", async () => {
  let asks = 0;
  let releaseHold: ((result: unknown) => void) | undefined;
  const handle = vi.fn(async (brain, requestId, action, input) => {
    if (action === "agents.list_bots") return { bots: [{ id: "allowed", name: "Allowed Bot" }] };
    if (action === "agents.delegate_bot") return { id: "background", status: "running", deadlineAt: Date.now() + 240000 };
    if (action === "agents.coordinate_bots") return { id: "coordination", status: "completed", results: [{ botId: "allowed", status: "busy" }] };
    if (input.prompt === "hold") return new Promise(resolveHold => { releaseHold = resolveHold; });
    asks++;
    return { id: "delegation", status: asks < 3 ? "running" : "completed", deadlineAt: Date.now() + 240000, result: "delegated answer", brain, requestId };
  });
  const { control, environment } = await service(handle);
  const child = spawn(process.execPath, [resolve("node_modules/vite-node/vite-node.mjs"), "--config", resolve("host/vitest.config.ts"), "--script", resolve("host/bots/__fixtures__/agents-mcp.ts")], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...environment } });
  let buffer = "", errors = "", stdout = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  child.stderr.setEncoding("utf8"); child.stderr.on("data", part => { errors += part; });
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (part: string) => {
    stdout += part;
    buffer += part;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      pending.get(message.id)?.resolve(message); pending.delete(message.id);
    }
  });
  const exit = new Promise<void>(resolveExit => child.once("exit", () => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP exited: ${errors}`)); resolveExit(); }));
  const send = (id: number, method: string, params: unknown = {}) => new Promise<any>((resolveReply, reject) => {
    pending.set(id, { resolve: resolveReply, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    expect(await send(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } })).toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const list = await send(2, "tools/list");
    expect(list.result.tools.map((tool: any) => tool.name)).toEqual(["list_bots", "ask_bot", "delegate_bot", "coordinate_bots"]);
    expect(list.result.tools[1].inputSchema.additionalProperties).toBe(false);
    expect(await send(3, "tools/call", { name: "list_bots", arguments: {} })).toMatchObject({ result: { structuredContent: { ok: true, result: { bots: [{ id: "allowed" }] } } } });
    expect(await send(4, "tools/call", { name: "ask_bot", arguments: { botId: "allowed", prompt: "hello", requestId: "stdio-retry" } })).toMatchObject({ result: { structuredContent: { ok: true, requestId: "stdio-retry", result: { status: "completed", brain: "trusted-brain", requestId: "stdio-retry" } } } });
    expect(await send(5, "tools/call", { name: "ask_bot", arguments: { botId: "allowed", prompt: "hello", sourceRunId: "forged" } })).toMatchObject({ result: { isError: true } });
    expect(handle).toHaveBeenCalledTimes(4);
    expect(handle.mock.calls.slice(1).every(([, id]) => id === "stdio-retry")).toBe(true);
    expect(await send(8, "tools/call", { name: "delegate_bot", arguments: { teamId: "team", botId: "allowed", prompt: "background", requestId: "delegate-retry" } })).toMatchObject({ result: { structuredContent: { ok: true, result: { id: "background", status: "running" } } } });
    expect(await send(9, "tools/call", { name: "coordinate_bots", arguments: { teamId: "team", botIds: ["allowed"], prompt: "aggregate", requestId: "coordinate-retry" } })).toMatchObject({ result: { structuredContent: { ok: true, result: { status: "completed", results: [{ botId: "allowed", status: "busy" }] } } } });
    expect(handle).toHaveBeenCalledTimes(6);
    const cancelled = send(6, "tools/call", { name: "ask_bot", arguments: { botId: "allowed", prompt: "hold", requestId: "cancel-retry" } });
    await vi.waitFor(() => expect(releaseHold).toBeTypeOf("function"));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 6 } })}\n`);
    expect(await cancelled).toMatchObject({ result: { isError: true, structuredContent: { requestId: "cancel-retry", error: "Control request interrupted; retry the same request ID" } } });
    releaseHold!({ status: "completed" }); releaseHold = undefined;
    const eofPending = send(7, "tools/call", { name: "ask_bot", arguments: { botId: "allowed", prompt: "hold", requestId: "eof-retry" } }).catch(error => error);
    await vi.waitFor(() => expect(releaseHold).toBeTypeOf("function"));
    child.stdin.end();
    await exit;
    expect(await eofPending).toBeInstanceOf(Error);
    expect(child.exitCode).toBe(0);
    releaseHold!({ status: "completed" });
    expect(stdout).not.toContain(environment.MONOCODE_CONTROL_TOKEN);
    expect(errors).not.toContain(environment.MONOCODE_CONTROL_TOKEN);
  } finally { child.stdin.end(); child.kill(); await exit; await control.close(); }
});

it("Chief CLI returns dispatch immediately and polls aggregate using its original request", async () => {
  let polls = 0;
  const deadlineAt = Date.now() + 240000;
  const handle = vi.fn(async (_brain, _request, action) => action === "agents.delegate_bot"
    ? { id: "background", status: "running", deadlineAt }
    : { id: "aggregate", status: ++polls < 2 ? "running" : "completed", deadlineAt, results: [] });
  const { control } = await service(handle);
  try {
    expect(await callAgent("delegate_bot", { teamId: "team", botId: "target", prompt: "Work" }, "dispatch")).toMatchObject({ result: { status: "running" } });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(await callAgent("coordinate_bots", { teamId: "team", botIds: ["target"], prompt: "Work" }, "aggregate")).toMatchObject({ result: { status: "completed", deadlineAt } });
    expect(handle.mock.calls.slice(1).every(([, request]) => request === "aggregate")).toBe(true);
    for (const action of ["delegate_bot", "coordinate_bots"]) {
      await expect(callAgent(action, { teamId: "team", ...(action === "delegate_bot" ? { botId: "target" } : { botIds: ["target"] }), prompt: "Work", source: {} }, "forged")).rejects.toThrow("fields");
    }
    expect(handle).toHaveBeenCalledTimes(3);
  } finally { await control.close(); }
});
