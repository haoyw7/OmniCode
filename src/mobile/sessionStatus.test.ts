// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSessionStatus } from "./MobileSessionStatus";
import { setUiLanguage } from "../shared/i18n/language";
import type { HostSession } from "../features/connections/model/protocol";
import type { GitDiffIndex } from "../platform/tauri/fs";
import type { MobileGitSource } from "./mobileGit";

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
function render(session: Partial<HostSession["session"]> = {}, gitSource?: MobileGitSource) {
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
        gitSource,
        hostName: "Workstation",
        hostStatus: { state: "connected" },
        anchor: { current: trigger },
        onClose: vi.fn(),
      }),
    ),
  );
}

describe("mobile session status", () => {
  it("shows the thread, working copy and used context", () => {
    setUiLanguage("zh-CN");
    render({
      providerSessionId: "thread-1",
      cwd: "/project",
      executionCwd: "/project/.worktrees/feature",
      linkedWorktree: true,
      branch: "feature",
      context: { used: 140_000, window: 660_000 },
    });
    const text = node.textContent ?? "";
    expect(text).toContain("远程会话已开启");
    expect(text).toContain("对话线程");
    expect(text).toContain("thread-1");
    expect(text).toContain("/project/.worktrees/feature");
    expect(text).toContain("工作树");
    expect(text).toContain("feature");
    expect(text).toContain("已用 21%");
    expect(text).toContain("140k / 660k tokens");
  });

  it("falls back to the OmniCode session ID and copies it", async () => {
    setUiLanguage("en");
    render();
    const text = node.textContent ?? "";
    expect(text).toContain("Session ID");
    expect(text).toContain("Context—");
    await act(async () => {
      node.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!.click();
    });
    expect(clipboard.copyText).toHaveBeenCalledWith("session");
  });

  it("does not infer a worktree from a different execution directory", () => {
    render({ executionCwd: "/project/subdir", branch: "main" });
    const fields = [...node.querySelectorAll(".mobile-status-field")].map(field => field.textContent);
    expect(fields).toContain("Directory/project/subdir");
    expect(fields).toContain("Branchmain");
    expect(fields.some(field => field?.startsWith("Worktree"))).toBe(false);
  });

  it.each([
    ["main", "abc1234567", "main"],
    [null, "abc1234567", "Detached abc1234"],
    [null, null, undefined],
  ] as const)("reads the current Git branch (%s, %s)", async (branch, head, expected) => {
    const gitSource = {
      loadIndex: vi.fn(async () => ({ branch, head, files: [], additions: 0, deletions: 0 }) as GitDiffIndex),
      loadDiff: vi.fn(),
    };
    await act(async () => render({ branch: "previous-branch" }, gitSource));
    await vi.waitFor(async () => {
      await act(async () => {});
      const field = [...node.querySelectorAll(".mobile-status-field")].find(field =>
        field.querySelector("strong")?.textContent === "Branch");
      expect(field?.querySelector(".mobile-status-field-value")?.textContent).toBe(expected);
    });
    expect(node.textContent).not.toContain("Worktree");
  });
});
