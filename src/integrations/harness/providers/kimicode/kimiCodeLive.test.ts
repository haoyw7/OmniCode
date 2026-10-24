import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const mock = vi.hoisted(() => ({
  line: undefined as ((line: string) => void) | undefined,
  sent: [] as {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  }[],
  setup: {} as Record<string, unknown>,
  failLoad: false,
  failAuth: false,
  holdInit: false,
  spawn: vi.fn(async () => undefined),
  kill: vi.fn(async () => undefined),
}));
vi.mock("../../core/child", () => ({
  resolveKimiCodeBinary: async () => ({ path: "/fake/kimi" }),
  spawnChild: mock.spawn,
  killChild: mock.kill,
  unwatchChild: vi.fn(),
  watchChild: (_id: string, line: (line: string) => void) => {
    mock.line = line;
  },
  writeChild: async (_id: string, line: string) => {
    const msg = JSON.parse(line);
    mock.sent.push(msg);
    if (
      !msg.method ||
      msg.method === "session/prompt" ||
      msg.method === "session/cancel" ||
      (mock.holdInit && msg.method === "initialize")
    )
      return;
    const result =
      msg.method === "initialize"
        ? { agentCapabilities: { sessionCapabilities: { resume: {} } } }
        : ["session/new", "session/resume", "session/load"].includes(msg.method)
          ? mock.setup
          : msg.method === "session/set_config_option"
            ? {
                configOptions: (
                  mock.setup.configOptions as Record<string, unknown>[]
                ).map((option) =>
                  option.id === msg.params.configId
                    ? { ...option, currentValue: msg.params.value }
                    : option,
                ),
              }
            : {};
    if (msg.method === "session/set_config_option")
      mock.setup.configOptions = result.configOptions;
    queueMicrotask(() =>
      mock.line?.(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          ...(mock.failAuth && msg.method === "session/new"
            ? { error: { code: -32000, message: "Authentication required" } }
            : mock.failLoad &&
                ["session/resume", "session/load"].includes(msg.method)
              ? {
                  error: {
                    code: -32602,
                    message: "Unknown sessionId: original",
                  },
                }
              : { result }),
        }),
      ),
    );
  },
}));
import setup from "./fixtures/session-new.json";
import {
  bindKimiCodeSession,
  cancelKimiCodeTurn,
  discoverKimiCodeModels,
  forgetKimiCodeSession,
  respondKimiCodeApproval,
  respondKimiCodeQuestion,
  sendKimiCodeTurn,
  stopKimiCodeSession,
} from "./kimiCode";

const events: HarnessEvent[] = [];
const input = (extra: Partial<SendTurnInput> = {}): SendTurnInput => ({
  sessionId: "kimi-test",
  cwd: "/repo",
  model: "kimicode:default",
  runtimeMode: "supervised",
  text: "Hello",
  onEvent: (event) => events.push(event),
  ...extra,
});
const notify = (update: unknown, sessionId = "kimi-native") =>
  mock.line!(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    }),
  );
const reverseRequest = (id: string, method: string, params: unknown) =>
  mock.line!(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
async function waitFor(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true));
}
async function promptReady() {
  await waitFor(() => mock.sent.some((msg) => msg.method === "session/prompt"));
}
function finish() {
  const request = mock.sent.findLast((msg) => msg.method === "session/prompt")!;
  mock.line!(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { stopReason: "end_turn" },
    }),
  );
}
const permission = (kind = "execute") => ({
  sessionId: "kimi-native",
  toolCall: { toolCallId: "tool-1", title: "Bash", kind },
  options: [
    { optionId: "approve_once", name: "Approve once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
});

describe("Kimi Code live adapter", () => {
  beforeEach(() => {
    mock.sent.length = 0;
    events.length = 0;
    mock.setup = structuredClone(setup);
    mock.failLoad = false;
    mock.failAuth = false;
    mock.holdInit = false;
    mock.spawn.mockClear();
    mock.kill.mockClear();
  });
  afterEach(async () => {
    await forgetKimiCodeSession("kimi-test");
  });

  it("preserves the CLI authentication error and adds the terminal login action", async () => {
    mock.failAuth = true;
    await expect(sendKimiCodeTurn(input())).rejects.toThrow(
      "Authentication required\n\nRun `kimi login`",
    );
    expect(
      mock.sent.some((message) => message.method === "session/prompt"),
    ).toBe(false);
  });

  it("always asks the user to review a native plan", async () => {
    const turn = sendKimiCodeTurn(
      input({ intent: "plan", runtimeMode: "full-access" }),
    );
    await promptReady();
    reverseRequest("plan-review", "session/request_permission", {
      sessionId: "kimi-native",
      toolCall: {
        toolCallId: "exit-plan",
        title: "ExitPlanMode",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Plan from Kimi" },
          },
        ],
      },
      options: [
        { optionId: "plan_approve", name: "Approve", kind: "allow_once" },
        { optionId: "plan_revise", name: "Revise", kind: "reject_once" },
      ],
    });
    const question = events.find((event) => event.type === "question.asked");
    if (question?.type !== "question.asked")
      throw new Error("missing plan review");
    respondKimiCodeQuestion("kimi-test", question.requestId, {
      kind: "answered",
      answers: { q0: ["plan_approve"] },
    });
    await waitFor(() =>
      mock.sent.some((message) => message.id === "plan-review"),
    );
    expect(
      mock.sent.find((message) => message.id === "plan-review")?.result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "plan_approve" } });
    finish();
    await turn;
  });

  it("starts ACP, sends images, routes stream/tool events and reuses the warm session", async () => {
    const turn = sendKimiCodeTurn(
      input({
        attachments: [
          {
            id: "image",
            name: "screen.png",
            kind: "image",
            mimeType: "image/png",
            size: 3,
            data: "AAAA",
          },
        ],
      }),
    );
    await promptReady();
    expect(mock.spawn).toHaveBeenCalledWith(
      "kimi-test",
      "/fake/kimi",
      ["acp"],
      "/repo",
      undefined,
      "kimicode",
    );
    expect(
      mock.sent.find((msg) => msg.method === "session/prompt")?.params?.prompt,
    ).toContainEqual({ type: "image", mimeType: "image/png", data: "AAAA" });
    notify(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ignore wrong session" },
      },
      "another",
    );
    notify({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello from Kimi" },
    });
    notify({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Thinking" },
    });
    notify({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read",
      kind: "read",
      status: "completed",
    });
    finish();
    await turn;
    expect(events).toContainEqual({
      type: "message.delta",
      text: "Hello from Kimi",
    });
    expect(events).not.toContainEqual({
      type: "message.delta",
      text: "ignore wrong session",
    });
    expect(
      events.some(
        (event) => event.type === "tool.updated" && event.callId === "tool-1",
      ),
    ).toBe(true);
    const next = sendKimiCodeTurn(input({ text: "Again" }));
    await waitFor(
      () =>
        mock.sent.filter((msg) => msg.method === "session/prompt").length === 2,
    );
    finish();
    await next;
    expect(mock.spawn).toHaveBeenCalledTimes(1);
  });
  it("sets model and thinking through advertised config options, then enters plan mode", async () => {
    const turn = sendKimiCodeTurn(
      input({
        model: "kimicode:custom/other",
        modelSettings: { thinking: "high" },
        intent: "plan",
      }),
    );
    await promptReady();
    expect(
      mock.sent
        .filter((msg) => msg.method === "session/set_config_option")
        .map((msg) => msg.params),
    ).toEqual([
      { sessionId: "kimi-native", configId: "model", value: "custom/other" },
      { sessionId: "kimi-native", configId: "thinking", value: "high" },
    ]);
    expect(
      mock.sent.find((msg) => msg.method === "session/set_mode")?.params
        ?.modeId,
    ).toBe("plan");
    reverseRequest(
      "plan-permission",
      "session/request_permission",
      permission(),
    );
    await waitFor(() =>
      mock.sent.some(
        (msg) => msg.id === "plan-permission" && msg.result != null,
      ),
    );
    expect(
      mock.sent.find((msg) => msg.id === "plan-permission")?.result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "reject" } });
    finish();
    await turn;
  });
  it("round trips opaque approval request ids and never auto-approves commands in edit-only mode", async () => {
    const turn = sendKimiCodeTurn(input({ runtimeMode: "auto-accept-edits" }));
    await promptReady();
    reverseRequest(
      "opaque-request",
      "session/request_permission",
      permission(),
    );
    const approval = events.find(
      (event) => event.type === "approval.requested",
    );
    expect(approval?.type).toBe("approval.requested");
    if (approval?.type !== "approval.requested")
      throw new Error("missing approval");
    respondKimiCodeApproval("kimi-test", approval.requestId, "allow");
    await waitFor(() => mock.sent.some((msg) => msg.id === "opaque-request"));
    expect(
      mock.sent.find((msg) => msg.id === "opaque-request")?.result,
    ).toEqual({ outcome: { outcome: "selected", optionId: "approve_once" } });
    finish();
    await turn;
  });
  it("asks questions even with full access and returns native form values", async () => {
    const turn = sendKimiCodeTurn(input({ runtimeMode: "full-access" }));
    await promptReady();
    reverseRequest("question-id", "elicitation/create", {
      sessionId: "kimi-native",
      mode: "form",
      message: "Choose",
      requestedSchema: {
        properties: {
          q0: { type: "string", oneOf: [{ const: "yes", title: "Yes" }] },
        },
      },
    });
    const question = events.find((event) => event.type === "question.asked");
    if (question?.type !== "question.asked")
      throw new Error("missing question");
    respondKimiCodeQuestion("kimi-test", question.requestId, {
      kind: "answered",
      answers: { q0: ["yes"] },
    });
    await waitFor(() => mock.sent.some((msg) => msg.id === "question-id"));
    expect(mock.sent.find((msg) => msg.id === "question-id")?.result).toEqual({
      action: "accept",
      content: { q0: "yes" },
    });
    finish();
    await turn;
  });
  it("resumes parked sessions without replaying history or creating a replacement", async () => {
    bindKimiCodeSession("kimi-test", "original", "/repo");
    mock.failLoad = true;
    await expect(sendKimiCodeTurn(input())).rejects.toThrow(
      "Unknown sessionId",
    );
    expect(mock.sent.some((msg) => msg.method === "session/new")).toBe(false);
    expect(
      mock.sent.find((msg) => msg.method === "session/resume")?.params
        ?.sessionId,
    ).toBe("original");
    mock.sent.length = 0;
    mock.failLoad = false;
    const turn = sendKimiCodeTurn(input());
    await promptReady();
    finish();
    await turn;
    await stopKimiCodeSession("kimi-test");
    mock.sent.length = 0;
    const next = sendKimiCodeTurn(input());
    await promptReady();
    expect(
      mock.sent.find((msg) => msg.method === "session/resume")?.params
        ?.sessionId,
    ).toBe("original");
    finish();
    await next;
  });
  it("cancels a waiting question and recycles the child without losing resume state", async () => {
    const turn = sendKimiCodeTurn(input());
    await promptReady();
    reverseRequest("q-cancel", "elicitation/create", {
      sessionId: "kimi-native",
      mode: "form",
      message: "Name",
      requestedSchema: { properties: { q0: { type: "string" } } },
    });
    await cancelKimiCodeTurn("kimi-test");
    await turn;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "question.resolved",
        decision: "cancelled",
      }),
    );
    expect(mock.kill).toHaveBeenCalledWith("kimi-test");
    mock.sent.length = 0;
    const next = sendKimiCodeTurn(input());
    await promptReady();
    expect(
      mock.sent.find((msg) => msg.method === "session/resume")?.params
        ?.sessionId,
    ).toBe("kimi-native");
    finish();
    await next;
  });
  it("can cancel during initialization", async () => {
    mock.holdInit = true;
    const turn = sendKimiCodeTurn(input());
    await waitFor(() => mock.sent.some((msg) => msg.method === "initialize"));
    await cancelKimiCodeTurn("kimi-test");
    await turn;
    expect(mock.sent.some((msg) => msg.method === "session/prompt")).toBe(
      false,
    );
  });
  it("discovers models through an isolated probe and cleans up the child", async () => {
    expect(await discoverKimiCodeModels("/repo")).toHaveLength(2);
    expect(mock.kill).toHaveBeenCalledWith(
      expect.stringMatching(/^omnicode-kimi-probe-/),
    );
  });
});
