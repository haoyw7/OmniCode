// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { useAgentAppBridge } from "./useAgentAppBridge";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../features/orchestration/model/orchestration", () => ({
  orchestrator: { run: () => undefined },
}));
vi.mock("../../features/sessions/data/sessionStore", () => ({
  getSession: async () => null,
  listSessionsByProject: async () => [],
}));

type Options = Parameters<typeof useAgentAppBridge>[0];
type Request = {
  id: string;
  namespace: string;
  sessionId: string;
  requestId: string;
  action: string;
  input: Record<string, unknown>;
};

let root: Root;
let container: HTMLDivElement;
let listener: (event: { payload: Request }) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.unlisten.mockReset();
  mocks.listen.mockReset().mockImplementation(async (_event, handler) => {
    listener = handler;
    return mocks.unlisten;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function fixture(): Options {
  const source = { ...newSession("codex", "/repo"), id: "source" };
  const target = { ...newSession("codex", "/repo"), id: "target" };
  return {
    sessionsRef: { current: [source, target] },
    launchQuickSession: vi.fn(async () => {}),
    ensureOpenSession: vi.fn(async () => target),
    submitSession: vi.fn(() => true),
    onSaveDraft: vi.fn(() => true),
  };
}

function Harness(props: Options) {
  useAgentAppBridge(props);
  return null;
}

async function render(props: Options) {
  await act(async () => root.render(createElement(Harness, props)));
}

function send(
  id: string,
  requestId = "request",
  action = "sessions.send",
  prompt = "Continue",
) {
  listener({
    payload: {
      id,
      requestId,
      action,
      namespace: "app",
      sessionId: "source",
      input: { sessionId: "target", prompt },
    },
  });
}

function reply(id: string) {
  return mocks.invoke.mock.calls.find(
    ([command, args]) => command === "control_reply" && args.id === id,
  )?.[1].response;
}

describe("workspace agent app bridge", () => {
  it("uses current submission and draft handlers without replacing its native listener", async () => {
    const initial = fixture();
    await render(initial);
    const current = { ...fixture(), sessionsRef: initial.sessionsRef };
    await render(current);

    send("send");
    await vi.waitFor(() => expect(reply("send")?.ok).toBe(true));
    send("draft", "draft-request", "sessions.draft");
    await vi.waitFor(() => expect(reply("draft")?.ok).toBe(true));

    expect(initial.submitSession).not.toHaveBeenCalled();
    expect(initial.onSaveDraft).not.toHaveBeenCalled();
    expect(current.submitSession).toHaveBeenCalledWith(
      "target",
      "Continue",
      [],
      {
        appRequestId: "app-source-request",
      },
    );
    expect(current.onSaveDraft).toHaveBeenCalledWith(
      "target",
      "Continue",
      [],
      "app-source-draft-request",
    );
    expect(current.ensureOpenSession).toHaveBeenCalledTimes(2);
    expect(mocks.listen).toHaveBeenCalledTimes(1);
  });

  it("deduplicates in-flight deliveries and rejects reuse with different input", async () => {
    const options = fixture();
    let accept!: (value: boolean) => void;
    options.submitSession = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    await render(options);
    send("first");
    send("duplicate");
    await vi.waitFor(() =>
      expect(options.submitSession).toHaveBeenCalledTimes(1),
    );
    send("conflict", "request", "sessions.send", "Different input");
    await vi.waitFor(() =>
      expect(reply("conflict")).toMatchObject({ ok: false }),
    );
    expect(reply("first")).toBeUndefined();

    accept(true);
    await vi.waitFor(() => {
      expect(reply("first")?.ok).toBe(true);
      expect(reply("duplicate")).toEqual(reply("first"));
    });
    expect(options.submitSession).toHaveBeenCalledTimes(1);
  });

  it("allows a failed delivery to retry with the same request id", async () => {
    const options = fixture();
    const submit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await render({ ...options, submitSession: submit });
    send("failed");
    await vi.waitFor(() => expect(reply("failed")?.ok).toBe(false));
    send("retry");
    await vi.waitFor(() => expect(reply("retry")?.ok).toBe(true));
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("releases a native subscription that resolves after unmount", async () => {
    let complete!: (unlisten: () => void) => void;
    mocks.listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          complete = resolve;
        }),
    );
    await render(fixture());
    await act(async () => root.unmount());
    expect(mocks.unlisten).not.toHaveBeenCalled();
    complete(mocks.unlisten);
    await vi.waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
  });
});
