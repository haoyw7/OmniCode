import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../../../contracts/harness";
import type { SendTurnInput } from "../../core/types";

const io = vi.hoisted(() => ({
  watchers: new Map<string, { line: (line: string) => void; exit: (code: number) => void }>(),
  sent: [] as { id: string; value: Record<string, any> }[],
  write: vi.fn(), kill: vi.fn(), spawn: vi.fn(), resolve: vi.fn(), accounts: vi.fn(), save: vi.fn(), remove: vi.fn(),
  headless: true,
}));
vi.mock("../../core/child", () => ({
  readWorkBuddyAccounts: io.accounts,
  readWorkBuddyCatalog: vi.fn(),
  resolveWorkBuddyBinary: io.resolve,
  childUsesSelectedMachine: () => true,
  hasHeadlessChildBackend: () => io.headless,
  spawnChild: io.spawn,
  watchChild: (id: string, line: (line: string) => void, exit: (code: number) => void) => io.watchers.set(id, { line, exit }),
  unwatchChild: (id: string) => io.watchers.delete(id),
  killChild: async (id: string) => { io.kill(id); io.watchers.delete(id); },
  writeChild: async (id: string, line: string) => {
    const value = JSON.parse(line);
    io.sent.push({ id, value });
    if (value.request_id === "omnicode-initialize") io.watchers.get(id)!.line(JSON.stringify({
      type: "control_response", response: { subtype: "success", request_id: value.request_id },
    }));
    await io.write(id, value);
  },
}));
vi.mock("../../../../platform/tauri/fs", () => ({ saveGeneratedImage: io.save, deleteGeneratedImages: io.remove }));
const { workbuddyAdapter: adapter } = await import("./workbuddyAdapter");
const accounts = [
  { id: "wb-cn-user", edition: "cn", label: "WorkBuddy China", readOnly: true },
  { id: "wb-global-user", edition: "global", label: "WorkBuddy International", readOnly: true },
];
const events: HarnessEvent[] = [];
const id = "wb-test";
const input: SendTurnInput = { sessionId: id, cwd: "/project", model: "workbuddy:cn:auto", text: "hello",
  providerAccountId: accounts[0].id, runtimeMode: "supervised", onEvent: event => events.push(event) };
const emit = (value: Record<string, any>) => io.watchers.get(id)!.line(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function start(overrides: Partial<SendTurnInput> = {}) {
  const turn = adapter.sendTurn({ ...input, ...overrides });
  await flush();
  return { turn };
}
const result = () => emit({ type: "result", duration_api_ms: 1, result: "done" });
beforeEach(() => {
  events.length = 0; io.sent.length = 0;
  vi.clearAllMocks();
  io.accounts.mockResolvedValue(accounts);
  io.write.mockResolvedValue(undefined); io.spawn.mockResolvedValue(undefined);
  io.resolve.mockResolvedValue({ path: "/workbuddy.exe" });
  io.remove.mockResolvedValue(undefined); io.headless = true;
});
afterEach(async () => { await adapter.forgetSession(id); vi.useRealTimers(); });

describe("WorkBuddy adapter lifecycle", () => {
  it("cancels startup while execution-side account metadata is still loading", async () => {
    let loaded!: (value: typeof accounts) => void;
    io.accounts.mockImplementation(() => new Promise(resolve => { loaded = resolve; }));
    const first = await start();
    const rejected = expect(first.turn).rejects.toThrow("session stopped");
    await adapter.stopSession(id); loaded(accounts); await rejected;
    expect(io.resolve).not.toHaveBeenCalled();
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it("cancels startup before binary resolution without launching a late child", async () => {
    let resolved!: (binary: { path: string }) => void;
    io.resolve.mockImplementation(() => new Promise(resolve => { resolved = resolve; }));
    const first = await start();
    const rejected = expect(first.turn).rejects.toThrow("session stopped");
    await expect(adapter.sendTurn(input)).rejects.toThrow("already running");
    await adapter.cancelTurn(id);
    resolved({ path: "/workbuddy.exe" }); await rejected;
    expect(io.spawn).not.toHaveBeenCalled();
  });

  it("reaps a child when startup finishes after the session was stopped", async () => {
    let spawned!: () => void;
    io.spawn.mockImplementation(() => new Promise<void>(resolve => { spawned = resolve; }));
    const first = await start();
    const rejected = expect(first.turn).rejects.toThrow("session stopped");
    await adapter.stopSession(id); spawned(); await rejected;
    expect(io.kill).toHaveBeenCalledTimes(2);
    expect(io.watchers.size).toBe(0);
    expect(io.sent).toEqual([]);
  });

  it("deduplicates streamed text, skips native replay and ignores child terminal events", async () => {
    const { turn } = await start();
    emit({ type: "system", session_id: "native-parent" });
    emit({ type: "assistant", __timestamp: "2000-01-01T00:00:00Z", message: { content: [{ type: "text", text: "old text" }] } });
    emit({ type: "result", parent_tool_use_id: "child", session_id: "native-child", result: "child done" });
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } });
    emit({ type: "assistant", message: { content: [{ type: "text", text: "Hello world" }] } });
    result(); await turn;
    expect(events.filter(e => e.type === "message.delta").map(e => e.text).join("")).toBe("Hello world");
    expect(events.filter(e => e.type === "session.providerBound")).toEqual([
      { type: "session.providerBound", providerSessionId: "native-parent", providerAccountId: accounts[0].id },
    ]);
  });

  it("returns tool permissions and custom question answers with original native request IDs", async () => {
    const { turn } = await start();
    emit({ type: "control_request", request_id: "perm_allow", request: { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "/project/a", content: "new" } } });
    const approval = events.find(e => e.type === "approval.requested")!;
    if (approval.type !== "approval.requested") throw new Error("Missing approval");
    adapter.respondApproval(id, approval.requestId, "allow");
    emit({ type: "control_request", request_id: "perm_question", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Choice?", options: [{ label: "A" }] }] } } });
    const question = events.find(e => e.type === "question.asked")!;
    if (question.type !== "question.asked") throw new Error("Missing question");
    adapter.respondQuestion!(id, question.requestId, { kind: "answered", answers: { "Choice?": ["__custom__"] }, custom: { "Choice?": "custom value" } });
    expect(io.sent.map(row => row.value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ response: expect.objectContaining({ request_id: "perm_allow", response: { allowed: true, updatedInput: { file_path: "/project/a", content: "new" } } }) }),
      expect.objectContaining({ response: expect.objectContaining({ request_id: "perm_question", response: expect.objectContaining({ allowed: true, updatedInput: expect.objectContaining({ answers: { "Choice?": "custom value" } }) }) }) }),
    ]));
    result(); await turn;
  });

  it("preserves a denied result that arrives before the assistant tool declaration", async () => {
    const { turn } = await start();
    emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "denied", is_error: true, content: "User declined tool execution." }] } });
    emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "denied", name: "Write", input: { file_path: "/project/denied.txt", content: "blocked" } }] } });
    result(); await turn;
    expect(events.filter(e => e.type === "tool.started" || e.type === "tool.updated")).toMatchObject([
      { type: "tool.started", callId: "denied", title: "Write" },
      { type: "tool.updated", callId: "denied", status: "failed", detail: "User declined tool execution." },
    ]);
  });

  it("finishes a denied turn with zero API duration even when no assistant tool ID is supplied", async () => {
    const { turn } = await start();
    emit({ type: "control_request", request_id: "deny-no-id", request: { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "/project/denied.txt" } } });
    const approval = events.find(e => e.type === "approval.requested")!;
    if (approval.type !== "approval.requested") throw new Error("Missing approval");
    adapter.respondApproval(id, approval.requestId, "deny");
    emit({ type: "result", duration_api_ms: 0, result: "" }); await turn;
    expect(events.some(e => e.type === "approval.resolved" && e.decision === "deny")).toBe(true);
  });

  it("resumes the original conversation and refuses account or region replacement", async () => {
    const first = await start(); emit({ type: "system", session_id: "native-1" }); result(); await first.turn;
    await adapter.stopSession(id);
    const resumed = await start();
    expect(io.spawn.mock.calls.at(-1)![2]).toEqual(expect.arrayContaining(["--resume", "native-1"]));
    result(); await resumed.turn;
    await expect(adapter.sendTurn({ ...input, model: "workbuddy:global:fast-model", providerAccountId: accounts[1].id })).rejects.toThrow("another account");
    io.accounts.mockResolvedValue([accounts[1]]);
    await expect(adapter.sendTurn(input)).rejects.toThrow("no longer available");
  });

  it("clears cancellation fallback even when the result precedes the interrupt write acknowledgement", async () => {
    vi.useFakeTimers();
    const first = await start();
    let acknowledge!: () => void;
    io.write.mockImplementation((_id, value) => {
      if (value.request?.subtype !== "interrupt") return;
      result();
      return new Promise<void>(resolve => { acknowledge = resolve; });
    });
    const cancelling = adapter.cancelTurn(id);
    await first.turn;
    const next = await start();
    acknowledge(); await cancelling;
    await vi.advanceTimersByTimeAsync(2100);
    expect(io.kill).not.toHaveBeenCalled();
    result(); await next.turn;
  });

  it("denies unresolved questions when cancelled and resolves them in the UI", async () => {
    const { turn } = await start();
    emit({ type: "control_request", request_id: "pending", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Wait?", options: [] }] } } });
    await adapter.cancelTurn(id);
    expect(io.sent.some(row => row.value.response?.request_id === "pending" && row.value.response.response.allowed === false)).toBe(true);
    expect(events.some(e => e.type === "question.resolved" && e.decision === "cancelled")).toBe(true);
    result(); await turn;
  });

  it("waits for desktop image persistence and deletes a late asset after stop", async () => {
    io.headless = false;
    let saved!: (asset: { path: string; mimeType: string; size: number }) => void;
    io.save.mockImplementation(() => new Promise(resolve => { saved = resolve; }));
    const first = await start();
    emit({ type: "omnicode_image", omnicode_generated_images: [{ itemId: "img:0", data: "bytes", name: "image.webp", mimeType: "image/webp" }] });
    result(); await flush();
    expect(events.some(e => e.type === "image.generated")).toBe(false);
    await adapter.stopSession(id); await first.turn;
    const next = await start();
    saved({ path: "/saved/image.webp", mimeType: "image/webp", size: 12 }); await flush();
    expect(io.remove).toHaveBeenCalledWith(["/saved/image.webp"]);
    expect(events.some(e => e.type === "image.generated")).toBe(false);
    result(); await next.turn;
  });

  it("leaves headless image persistence to Host and preserves the MIME type", async () => {
    const { turn } = await start();
    emit({ type: "omnicode_image", omnicode_generated_images: [{ itemId: "img:0", data: "bytes", name: "image.jpg", mimeType: "image/jpeg" }] });
    result(); await turn;
    expect(events).toContainEqual({ type: "image.generated", itemId: "img:0", data: "bytes", name: "image.jpg", mimeType: "image/jpeg" });
    expect(io.save).not.toHaveBeenCalled();
  });

  it("restarts after an error so refreshed desktop credentials are read on the next send", async () => {
    const first = await start();
    const rejected = expect(first.turn).rejects.toThrow("Login expired");
    emit({ type: "result", is_error: true, result: "Login expired" }); await rejected;
    const next = await start();
    expect(io.spawn).toHaveBeenCalledTimes(2);
    result(); await next.turn;
  });
});
