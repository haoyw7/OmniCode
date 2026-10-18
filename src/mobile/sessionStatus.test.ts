// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSessionStatus } from "./MobileSessionStatus";
import { setUiLanguage } from "../shared/i18n/language";
import type { HostSession } from "../features/connections/model/protocol";

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async () => {}) }));
vi.mock("./transcriptPlatform", () => ({
  mobileTranscriptPlatform: clipboard,
}));
let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  setUiLanguage("en");
});
function render(session: Partial<HostSession["session"]> = {}) {
  const snapshot: HostSession = {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 1,
    session: {
      id: "session",
      title: "Conversation",
      cwd: "/project",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [],
      ...session,
    },
  };
  const trigger = document.createElement("button");
  node.append(trigger);
  act(() =>
    root.render(
      createElement(MobileSessionStatus, {
        snapshot,
        hostName: "Workstation",
        hostStatus: { state: "connected" },
        anchor: { current: trigger },
        onClose: vi.fn(),
      }),
    ),
  );
}

describe("mobile session status", () => {
  it("shows the thread, working copy and remaining context", () => {
    setUiLanguage("zh-CN");
    render({
      providerSessionId: "thread-1",
      cwd: "/project",
      executionCwd: "/project/.worktrees/feature",
      branch: "feature",
      context: { used: 140_000, window: 660_000 },
    });
    const text = node.textContent ?? "";
    expect(text).toContain("远程会话已开启");
    expect(text).toContain("对话线程");
    expect(text).toContain("thread-1");
    expect(text).toContain("/project/.worktrees/feature");
    expect(text).toContain("feature");
    expect(text).toContain("剩余 79%（已用 140K / 660K）");
  });

  it("falls back to the OmniCode session ID and copies it", async () => {
    setUiLanguage("en");
    render();
    const text = node.textContent ?? "";
    expect(text).toContain("Session ID");
    expect(text).toContain("ContextNot reported by this agent yet");
    await act(async () => {
      node.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click();
    });
    expect(clipboard.copyText).toHaveBeenCalledWith("session");
  });
});
