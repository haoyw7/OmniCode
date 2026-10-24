import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../../../contracts/harness";
import type { SendTurnInput } from "../../core/types";

const transport = vi.hoisted(() => ({
  line: undefined as ((line: string) => void) | undefined,
  exit: undefined as ((code: number, error?: string) => void) | undefined,
  handle: undefined as ((frame: any) => void) | undefined,
  sent: [] as any[],
  kill: vi.fn(async () => {}),
  unwatch: vi.fn(),
  headless: true,
  save: vi.fn(),
  remove: vi.fn(async () => {}),
  root: "",
}));
vi.mock("../../core/child", () => ({
  selectedChildMachine: () => "local",
  prepareDeepseekBridge: async () => ({
    path: "/fake/dsh",
    args: ["--profile", "omnicode-v1"],
  }),
  spawnChild: async () => {},
  killChild: transport.kill,
  unwatchChild: transport.unwatch,
  watchChild: (
    _id: string,
    line: typeof transport.line,
    exit: typeof transport.exit,
  ) => {
    transport.line = line;
    transport.exit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    const frame = JSON.parse(line);
    transport.sent.push(frame);
    transport.handle?.(frame);
  },
  hasHeadlessChildBackend: () => transport.headless,
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  saveGeneratedImage: transport.save,
  deleteGeneratedImages: transport.remove,
}));

import { sendDeepseekTurn, cancelDeepseekTurn, stopDeepseekBackgroundTask, stopDeepseekSession, forgetDeepseekSession, respondDeepseekApproval, respondDeepseekQuestion, keepDeepseekQuestionOpen } from "./deepseek";

const reply = (id: number, result: unknown) =>
  transport.line!(JSON.stringify({ jsonrpc: "2.0", id, result }));
const notify = (
  kind: string,
  data: object,
  runId = "run",
  sessionId = transport.root,
) =>
  transport.line!(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/event",
      params: { sessionId, sourceSessionId: sessionId, runId, kind, data },
    }),
  );
const request = (id: number, method: string, params: object) =>
  transport.line!(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: { sessionId: transport.root, ...params },
    }),
  );
const events: HarnessEvent[] = [];
const input = (extra: Partial<SendTurnInput> = {}): SendTurnInput => ({
  sessionId: "ui",
  cwd: "/repo",
  model: "deepseek:default",
  runtimeMode: "supervised",
  text: "Work",
  onEvent: (event) => events.push(event),
  ...extra,
});
const sent = (method: string) =>
  transport.sent.find((frame) => frame.method === method);

beforeEach(() => {
  transport.sent.length = 0;
  events.length = 0;
  vi.clearAllMocks();
  transport.headless = true;
  transport.handle = (frame) => {
    if (frame.method === "initialize")
      reply(frame.id, { protocolVersion: 1, runtimeVersion: "0.2.1-rc.2", capabilities: { multiplex: true } });
    else if (
      frame.method === "session/new" ||
      frame.method === "session/resume"
    )
      reply(frame.id, { sessionId: transport.root = frame.params.sessionId });
    else if (
      frame.method === "session/prompt" ||
      frame.method === "question/answer"
    )
      reply(frame.id, { runId: "run" });
    else if (frame.method)
      reply(
        frame.id,
        frame.method === "question/claim" ? { claimed: true } : {},
      );
  };
});
afterEach(async () => {
  await forgetDeepseekSession("ui");
});

describe("DeepSeek adapter lifecycle", () => {
  it("stops one provider job without cancelling or completing the parent turn", async () => {
    let finished = false;
    const turn = sendDeepseekTurn(input()).then(() => { finished = true; });
    await vi.waitFor(() => expect(sent("session/prompt")).toBeDefined());
    notify("job", { job: { id: "bash-1", owner: transport.root, kind: "bash", label: "npm test", status: "running", startedAt: 1000 }, output: "starting\n" });
    await stopDeepseekBackgroundTask("ui", "bash-1");
    expect(sent("job/stop").params).toEqual({ sessionId: transport.root, jobId: "bash-1" });
    expect(sent("session/cancel")).toBeUndefined();
    expect(finished).toBe(false);
    notify("job", { job: { id: "bash-1", owner: transport.root, kind: "bash", label: "npm test", status: "killed", startedAt: 1000, finishedAt: 1200 } });
    notify("run.completed", { runId: "run" });
    await turn;
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", background: true, backgroundTaskId: "bash-1" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.updated", status: "cancelled", durationMs: 200 }));
  });

  it("accepts early completion, waits for the matching run and retains native resume identity", async () => {
    const normal = transport.handle;
    transport.handle = (frame) => {
      if (frame.method === "session/prompt") {
        notify("run.completed", { runId: "run" });
        reply(frame.id, { runId: "run" });
      } else normal!(frame);
    };
    const accepted = vi.fn();
    await sendDeepseekTurn(input({ onAccepted: accepted }));
    expect(accepted).toHaveBeenCalledOnce();
    await expect(
      sendDeepseekTurn(input({ cwd: "/another-repo" })),
    ).rejects.toThrow("workspace does not match");
    await stopDeepseekSession("ui");
    transport.sent.length = 0;
    transport.handle = normal;
    let finished = false;
    const next = sendDeepseekTurn(input()).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(sent("session/prompt")).toBeDefined());
    expect(sent("session/resume").params.sessionId).toBe(transport.root);
    notify("run.completed", { runId: "old" });
    await Promise.resolve();
    expect(finished).toBe(false);
    notify("run.completed", { runId: "run" }, "run", "another-session");
    await Promise.resolve();
    expect(finished).toBe(false);
    notify("run.completed", { runId: "run" });
    await next;
  });

  it("propagates runtime errors and tears down the process", async () => {
    const turn = sendDeepseekTurn(input());
    const rejected = expect(turn).rejects.toThrow("Fixture inference failed");
    await vi.waitFor(() => expect(sent("session/prompt")).toBeDefined());
    notify("run.completed", {
      runId: "run",
      error: "Fixture inference failed",
    });
    await rejected;
    expect(transport.kill).toHaveBeenCalledWith(expect.stringMatching(/^omnicode-deepseek-runtime-/));
    expect(transport.unwatch).toHaveBeenCalledWith(expect.stringMatching(/^omnicode-deepseek-runtime-/));
  });

  it("does not submit a prompt after cancellation during configuration", async () => {
    let configure: number | undefined;
    const normal = transport.handle;
    transport.handle = (frame) => {
      if (frame.method === "session/configure") configure = frame.id;
      else normal!(frame);
    };
    const turn = sendDeepseekTurn(input());
    await vi.waitFor(() => expect(configure).toBeDefined());
    await cancelDeepseekTurn("ui");
    reply(configure!, {});
    await turn;
    expect(sent("session/prompt")).toBeUndefined();
  });

  it("round-trips interactions and sends persisted late answers through the native API", async () => {
    const turn = sendDeepseekTurn(input());
    await vi.waitFor(() => expect(sent("session/prompt")).toBeDefined());
    request(501, "approval/request", { callId: "write", toolName: "write" });
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === "approval.requested")).toBe(
        true,
      ),
    );
    const approval = events.find(
      (event) => event.type === "approval.requested",
    )! as Extract<HarnessEvent, { type: "approval.requested" }>;
    respondDeepseekApproval("ui", approval.requestId, "deny");
    expect(transport.sent.find((frame) => frame.id === 501).result).toEqual({
      decision: "deny",
    });
    request(502, "question/request", {
      callId: "question",
      allowLateReply: true,
      autoResolveAt: Date.now() + 120000,
      questions: [{ id: "q", question: "Choose", options: [{ label: "One" }] }],
    });
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === "question.asked")).toBe(
        true,
      ),
    );
    const question = events.find(
      (event) => event.type === "question.asked",
    )! as Extract<HarnessEvent, { type: "question.asked" }>;
    expect(question.providerQuestionId).toBe("question");
    keepDeepseekQuestionOpen("ui", question.requestId);
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.type === "question.updated" &&
            event.autoResolveAt === undefined,
        ),
      ).toBe(true),
    );
    respondDeepseekQuestion("ui", question.requestId, {
      kind: "answered",
      answers: { q: ["One"] },
    });
    expect(
      transport.sent.find((frame) => frame.id === 502).result.answers,
    ).toEqual({ q: ["One"] });
    notify("run.completed", { runId: "run" });
    await turn;
    transport.sent.length = 0;
    const late = sendDeepseekTurn(
      input({
        questionReply: {
          requestId: "saved-call",
          reply: { kind: "answered", answers: { q: ["One"] } },
        },
      }),
    );
    await vi.waitFor(() => expect(sent("question/answer")).toBeDefined());
    expect(sent("question/answer").params).toMatchObject({
      callId: "saved-call",
      answer: { answers: { q: ["One"] } },
    });
    expect(sent("session/prompt")).toBeUndefined();
    notify("run.completed", { runId: "run" });
    await late;
  });

  it("awaits desktop image persistence and removes a save that finishes after cancellation", async () => {
    transport.headless = false;
    let save!: (value: object) => void;
    transport.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          save = resolve;
        }),
    );
    const turn = sendDeepseekTurn(input());
    await vi.waitFor(() => expect(sent("session/prompt")).toBeDefined());
    notify("image", {
      itemId: "image",
      data: "YWJj",
      name: "image.png",
      mimeType: "image/png",
    });
    await vi.waitFor(() => expect(transport.save).toHaveBeenCalledOnce());
    await cancelDeepseekTurn("ui");
    notify("run.completed", { runId: "run", cancelled: true });
    save({
      path: "/saved/image.png",
      name: "image.png",
      size: 3,
      mimeType: "image/png",
    });
    await turn;
    expect(transport.remove).toHaveBeenCalledWith(["/saved/image.png"]);
    expect(events.some((event) => event.type === "image.generated")).toBe(
      false,
    );
  });
});
