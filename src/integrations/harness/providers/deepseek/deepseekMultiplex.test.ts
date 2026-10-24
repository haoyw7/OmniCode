import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../../../contracts/harness";
import type { SendTurnInput } from "../../core/types";

const io = vi.hoisted(() => ({
  machine: "local",
  environment: "same",
  channels: new Map<string, { line: (line: string) => void; exit: (code: number) => void }>(),
  sent: [] as { process: string; frame: any }[],
  spawn: vi.fn(async () => {}),
  kill: vi.fn(async () => {}),
}));
vi.mock("../../core/child", () => ({
  selectedChildMachine: () => io.machine,
  prepareDeepseekBridge: async () => ({ path: "/dsh", args: [], runtimeKey: io.environment }),
  spawnChild: io.spawn,
  killChild: io.kill,
  watchChild: (id: string, line: (line: string) => void, exit: (code: number) => void) =>
    io.channels.set(id, { line, exit }),
  unwatchChild: (id: string) => io.channels.delete(id),
  hasHeadlessChildBackend: () => true,
  writeChild: async (id: string, line: string) => {
    const frame = JSON.parse(line);
    io.sent.push({ process: id, frame });
    if (!frame.method) return;
    const result = frame.method === "initialize"
      ? { protocolVersion: 1, runtimeVersion: "0.2.1-rc.2", capabilities: { multiplex: true } }
      : ["session/new", "session/resume"].includes(frame.method)
        ? { sessionId: frame.params.sessionId }
        : frame.method === "session/prompt" ? { runId: `run:${frame.params.sessionId}` } : {};
    io.channels.get(id)!.line(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
  },
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  saveGeneratedImage: vi.fn(), deleteGeneratedImages: vi.fn(),
}));
import { cancelDeepseekTurn, forgetDeepseekSession, sendDeepseekTurn, respondDeepseekApproval, readDeepseekRuntime } from "./deepseek";

const events = new Map<string, HarnessEvent[]>();
const input = (id: string): SendTurnInput => ({
  sessionId: id, cwd: `/workspace/${id}`, model: "deepseek:default",
  runtimeMode: id === "a" ? "supervised" : "full-access", text: id,
  onEvent: event => events.get(id)!.push(event),
});
const prompts = () => io.sent.filter(({ frame }) => frame.method === "session/prompt");
const emit = (index: number, kind: string, data: object) => {
  const { process, frame } = prompts()[index];
  io.channels.get(process)!.line(JSON.stringify({ jsonrpc: "2.0", method: "session/event",
    params: { sessionId: frame.params.sessionId, sourceSessionId: frame.params.sessionId, kind, data } }));
};
const complete = (index: number, extra: object = {}) =>
  emit(index, "run.completed", { runId: `run:${prompts()[index].frame.params.sessionId}`, ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  io.sent.length = 0;
  io.channels.clear();
  io.machine = "local";
  io.environment = "same";
  for (const id of ["a", "b", "c"]) events.set(id, []);
});
afterEach(async () => {
  await Promise.all(["a", "b", "c"].map(forgetDeepseekSession));
});

it("multiplexes concurrent workspaces, responses and approvals on one process", async () => {
  const a = sendDeepseekTurn(input("a"));
  const b = sendDeepseekTurn(input("b"));
  await vi.waitFor(() => expect(prompts()).toHaveLength(2));
  expect(io.spawn).toHaveBeenCalledOnce();
  await readDeepseekRuntime("/workspace/catalog", rpc => rpc.request("models/list"));
  expect(io.spawn).toHaveBeenCalledOnce();
  expect(io.kill).not.toHaveBeenCalled();
  expect(new Set(prompts().map(p => p.process)).size).toBe(1);
  expect(io.sent.filter(p => p.frame.method === "session/new").map(p => p.frame.params.cwd).sort())
    .toEqual(["/workspace/a", "/workspace/b"]);
  for (const [index, text] of ["only a", "only b"].entries())
    emit(index, "durable", { seq: 1, type: "assistant/message",
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text }] } } });
  await vi.waitFor(() => expect(events.get("b")).toContainEqual({ type: "message.delta", text: "only b" }));
  expect(events.get("a")).toContainEqual({ type: "message.delta", text: "only a" });
  expect(events.get("a")).not.toContainEqual({ type: "message.delta", text: "only b" });
  for (let index = 0; index < 2; index++) {
    const p = prompts()[index];
    io.channels.get(p.process)!.line(JSON.stringify({ jsonrpc: "2.0", id: 500 + index,
      method: "approval/request", params: { sessionId: p.frame.params.sessionId, callId: "same-tool", toolName: "write" } }));
  }
  await vi.waitFor(() => expect(events.get("b")!.some(e => e.type === "approval.requested")).toBe(true));
  for (const [id, decision] of [["a", "deny"], ["b", "allow"]] as const) {
    const request = events.get(id)!.find(e => e.type === "approval.requested")!;
    respondDeepseekApproval(id, (request as { requestId: number }).requestId, decision);
  }
  await vi.waitFor(() => expect(io.sent.find(p => p.frame.id === 501 && p.frame.result)?.frame.result).toEqual({ decision: "allow" }));
  expect(io.sent.find(p => p.frame.id === 500 && p.frame.result)?.frame.result).toEqual({ decision: "deny" });
  complete(0);
  await a;
  await forgetDeepseekSession("a");
  expect(io.kill).not.toHaveBeenCalled();
  complete(1);
  await b;
  await forgetDeepseekSession("b");
  expect(io.kill).toHaveBeenCalledOnce();
});

it("cancels one run without completing or killing another", async () => {
  const a = sendDeepseekTurn(input("a"));
  let bFinished = false;
  const b = sendDeepseekTurn(input("b")).then(() => { bFinished = true; });
  await vi.waitFor(() => expect(prompts()).toHaveLength(2));
  await cancelDeepseekTurn("a");
  expect(io.sent.find(p => p.frame.method === "session/cancel")?.frame.params.sessionId)
    .toBe(prompts()[0].frame.params.sessionId);
  complete(0, { cancelled: true });
  await a;
  await forgetDeepseekSession("a");
  expect(bFinished).toBe(false);
  expect(io.kill).not.toHaveBeenCalled();
  complete(1);
  await b;
});

it.each(["machine", "environment"] as const)("separates different %s contexts", async context => {
  const a = sendDeepseekTurn(input("a"));
  await vi.waitFor(() => expect(prompts()).toHaveLength(1));
  io[context] = "different";
  const b = sendDeepseekTurn(input("b"));
  await vi.waitFor(() => expect(prompts()).toHaveLength(2));
  expect(io.spawn).toHaveBeenCalledTimes(2);
  complete(0); complete(1);
  await Promise.all([a, b]);
});

it("fails every affected run on process exit, then resumes both on a fresh shared process", async () => {
  const a = sendDeepseekTurn(input("a"));
  const b = sendDeepseekTurn(input("b"));
  const rejected = Promise.all([expect(a).rejects.toThrow("process exited"), expect(b).rejects.toThrow("process exited")]);
  await vi.waitFor(() => expect(prompts()).toHaveLength(2));
  io.channels.get(prompts()[0].process)!.exit(1);
  await rejected;
  const nextA = sendDeepseekTurn(input("a"));
  const nextB = sendDeepseekTurn(input("b"));
  await vi.waitFor(() => expect(prompts()).toHaveLength(4));
  expect(io.spawn).toHaveBeenCalledTimes(2);
  expect(io.sent.filter(p => p.frame.method === "session/resume")).toHaveLength(2);
  complete(2); complete(3);
  await Promise.all([nextA, nextB]);
});
