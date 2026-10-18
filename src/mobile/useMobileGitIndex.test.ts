// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitDiffIndex } from "../platform/tauri/fs";
import type { MobileGitSource } from "./mobileGit";
import {
  useMobileGitIndex,
  type MobileGitIndexState,
} from "./useMobileGitIndex";

let root: Root;
let node: HTMLDivElement;
let state: MobileGitIndexState;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const index = (branch: string) =>
  ({ branch, files: [], additions: 0, deletions: 0 }) as GitDiffIndex;
function Harness({
  source,
  enabled,
  running,
}: {
  source?: MobileGitSource;
  enabled: boolean;
  running: boolean;
}) {
  state = useMobileGitIndex(source, enabled, running);
  return null;
}
const render = (source?: MobileGitSource, enabled = true, running = true) =>
  act(async () => {
    root.render(createElement(Harness, { source, enabled, running }));
  });

it("refreshes at a bounded rate, on turn completion and resume, and stops while hidden", async () => {
  const source = {
    loadIndex: vi.fn(async () => index("main")),
    loadDiff: vi.fn(),
  };
  await render(source);
  await render(source);
  expect(source.loadIndex).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(5_000));
  expect(source.loadIndex).toHaveBeenCalledTimes(2);
  await render(source, true, false);
  expect(source.loadIndex).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTime(5_000));
  expect(source.loadIndex).toHaveBeenCalledTimes(3);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(source.loadIndex).toHaveBeenCalledTimes(3);
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(source.loadIndex).toHaveBeenCalledTimes(4);
  await render(source, false);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(source.loadIndex).toHaveBeenCalledTimes(4);
});

it("deduplicates in-flight refreshes and rejects stale worktree responses", async () => {
  let finish!: (value: GitDiffIndex) => void;
  const previous = {
    loadIndex: vi.fn(
      () =>
        new Promise<GitDiffIndex>((resolve) => {
          finish = resolve;
        }),
    ),
    loadDiff: vi.fn(),
  };
  await render(previous);
  act(() => {
    state.refresh();
    state.refresh();
  });
  expect(previous.loadIndex).toHaveBeenCalledTimes(1);
  const next = {
    loadIndex: vi.fn(async () => index("worktree")),
    loadDiff: vi.fn(),
  };
  await render(next);
  await act(async () => finish(index("old")));
  expect(state.index?.branch).toBe("worktree");
});

it("keeps errors distinguishable from an empty working copy and allows retry", async () => {
  const source = {
    loadIndex: vi.fn(async () => index("main")),
    loadDiff: vi.fn(),
  };
  source.loadIndex.mockRejectedValueOnce(new Error("Offline"));
  await render(source);
  expect(state.index).toBeNull();
  expect(state.error).toBe("Offline");
  await act(async () => state.refresh());
  expect(state.index?.branch).toBe("main");
  expect(state.error).toBeNull();
});
