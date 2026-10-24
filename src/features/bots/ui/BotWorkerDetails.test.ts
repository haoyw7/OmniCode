// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BotWorkerDetails } from "./BotWorkerDetails";
import { BotWorkerTranscriptContext, type BotWorkerTranscriptProps } from "./BotWorkerPresentation";
import type { HostSession } from "../../../contracts/protocol";
import type { BotRpc } from "../model/botRpc";

const target = { environmentId: "host", projectId: "project", sessionId: "worker" };
const snapshot: HostSession = {
  projectId: "project", revision: 1, status: "running", updatedAt: 1,
  session: { id: "worker", title: "Worker", cwd: "/repo", harness: "codex", model: "model",
    modelSettings: {}, runtimeMode: "supervised", orchestrationLeadId: "lead",
    blocks: [{ id: "reply", role: "assistant", text: "Worker output" }] },
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("passes the validated Host snapshot to the client renderer and stops polling when hidden", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const rpc = vi.fn(async () => snapshot);
  const renderTranscript = vi.fn(({ snapshot, visible }: BotWorkerTranscriptProps) =>
    createElement("div", { "data-visible": visible }, snapshot.session.blocks[0].text));
  const node = document.createElement("div");
  const root = createRoot(node);
  const render = (active: boolean) => act(async () => root.render(
    createElement(BotWorkerTranscriptContext.Provider, { value: renderTranscript },
      createElement(BotWorkerDetails, { target, rpc: rpc as BotRpc, active, onClose: () => {} }))));
  try {
    await render(true);
    expect(rpc).toHaveBeenCalledWith("sessions.get", { sessionId: "worker" });
    expect(node.textContent).toContain("Worker output");
    expect(renderTranscript.mock.lastCall?.[0]).toEqual({ snapshot, visible: true });
    await render(false);
    expect(renderTranscript.mock.lastCall?.[0].visible).toBe(false);
    await act(async () => vi.advanceTimersByTime(6000));
    expect(rpc).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  { ...snapshot, projectId: "other-project" },
  { ...snapshot, session: { ...snapshot.session, orchestrationLeadId: undefined } },
])("does not hand an unrelated or non-worker session to the presentation slot", async (value) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const renderTranscript = vi.fn(() => null);
  const node = document.createElement("div");
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(BotWorkerTranscriptContext.Provider,
      { value: renderTranscript }, createElement(BotWorkerDetails, {
        target, rpc: vi.fn(async () => value) as BotRpc, active: true, onClose: () => {},
      }))));
    expect(renderTranscript).not.toHaveBeenCalled();
    expect(node.querySelector('[role="alert"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
