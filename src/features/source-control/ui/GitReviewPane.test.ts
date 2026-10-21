import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  gitDiffFiles,
  gitBaseDiffFiles,
  gitBaseFileDiff,
  gitCommitFiles,
  gitCommitFileDiff,
  gitFileDiff,
  gitDiscardFile,
  gitStageFile,
  gitUnstageFile,
  gitStageContents,
  revealPath,
  type GitChangedFile,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  sessionCheckpointStatus,
  type CheckpointStatus,
} from "../../sessions/model/checkpoint";
import type { ReviewLoadedDiff } from "../model/reviewDiff";
import { GitReviewPane, type GitReviewPaneProps } from "./GitReviewPane";
import { WorkingTreeDiff } from "./WorkingTreeDiff";
import { CommitDiff } from "./CommitDiff";

vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop()!,
  gitDiffFiles: vi.fn(),
  gitBaseDiffFiles: vi.fn(),
  gitBaseFileDiff: vi.fn(),
  gitCommitFiles: vi.fn(),
  gitCommitFileDiff: vi.fn(),
  gitFileDiff: vi.fn(),
  gitDiscardFile: vi.fn(async () => {}),
  gitStageFile: vi.fn(async () => {}),
  gitUnstageFile: vi.fn(async () => {}),
  gitStageContents: vi.fn(async () => {}),
  revealPath: vi.fn(async () => {}),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
}));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: vi.fn(),
}));
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn(async () => {}),
}));
vi.mock("../../sessions/model/checkpoint", () => ({
  sessionCheckpointStatus: vi.fn(),
  sessionCheckpointFileDiff: vi.fn(),
  subscribeReviewChanged: () => () => {},
}));
vi.mock("../../connections/files/ui/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
const rail = vi.hoisted(() => ({ props: undefined as undefined | Record<string, any>, renders: 0 }));
vi.mock("./GitChangesPanel", async () => {
  const { memo } = await import("react");
  return { GitChangesPanel: memo((props: Record<string, any>) => {
    rail.props = props;
    rail.renders++;
    return null;
  }) };
});
vi.mock("./BranchPicker", () => ({ BranchPicker: () => null }));
vi.mock("./ReviewDiffsWorkerPool", () => ({
  ReviewDiffsWorkerPool: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./ReviewDiffViewer", () => ({
  ReviewDiffViewer: ({
    diff,
    busy,
    onReady,
    onStageHunk,
  }: {
    diff: ReviewLoadedDiff;
    busy: boolean;
    onReady?: (ready: boolean) => void;
    onStageHunk?: (pos: number) => void;
  }) => {
    useEffect(() => { onReady?.(true); return () => onReady?.(false); }, [onReady]);
    return createElement(
      "div",
      { "data-diff-content": "" },
      diff.current,
      onStageHunk &&
        createElement(
          "button",
          {
            title: "Stage hunk",
            disabled: busy,
            onClick: () =>
              onStageHunk(
                diff.unified!.lines.find((line) => line.pos != null)!.pos!,
              ),
          },
          "Stage hunk",
        ),
    );
  },
}));

// happy-dom has no layout engine. Supply deterministic dimensions to the real
// TanStack virtualizer and manually deliver resize observations after DOM changes.
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  deliver() {
    this.callback(
      [...this.targets]
        .filter((target) => target.isConnected)
        .map((target) => ({
          target,
          contentRect: { width: 800, height: (target as HTMLElement).offsetHeight },
          borderBoxSize: [
            {
              inlineSize: 800,
              blockSize: (target as HTMLElement).offsetHeight,
            },
          ],
        })) as unknown as ResizeObserverEntry[],
      this as unknown as ResizeObserver,
    );
  }
}
/** Diffs mount a couple of frames into the open animation. */
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(350));
}
async function measure() {
  await act(async () => {
    for (const observer of observers) observer.deliver();
    await vi.advanceTimersByTimeAsync(20);
  });
}
let root: Root;
let container: HTMLDivElement;
const files: GitChangedFile[] = Array.from({ length: 30 }, (_, index) => ({
  path: `/repo/dir/file${index}.ts`,
  relative: `dir/file${index}.ts`,
  status: "modified",
  additions: 1,
  deletions: 1,
  staged: true,
  unstaged: true,
}));
const comparison = {
  ...files[0],
  original: "unchanged\nold\n",
  current: "unchanged\nnew\n",
  binary: false,
  tooLarge: false,
};
const scroller = () =>
  container.querySelector<HTMLElement>("[data-review-scroll]")!;
const listHeight = () =>
  Number.parseFloat(scroller().querySelector<HTMLElement>("[data-review-content] > div")!.style.height);
const card = (index: number) =>
  container.querySelector<HTMLElement>(
    `[data-review-file="dir/file${index}.ts"]`,
  )!;
async function click(title: string, within: ParentNode = container) {
  await act(async () =>
    within
      .querySelector<HTMLButtonElement>(
        `button[title="${title}"], button[aria-label^="${title}:"]`,
      )!
      .click(),
  );
}
/** Choose an entry in the review options menu. */
async function menu(label: string) {
  const trigger = container.querySelector<HTMLButtonElement>("[data-review-options]")!;
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  const item = [...document.querySelectorAll<HTMLElement>("[role^=\"menuitem\"]")]
    .find((node) => node.textContent === label);
  expect(item, label).toBeDefined();
  await act(async () => item!.click());
}
async function openFileMenu(index: number, keyboard = false) {
  await act(async () => {
    const button =
      card(index).querySelector<HTMLButtonElement>("header button")!;
    button.focus();
    button.dispatchEvent(
      keyboard
        ? new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          })
        : new MouseEvent("contextmenu", {
            clientX: 10,
            clientY: 20,
            bubbles: true,
            cancelable: true,
          }),
    );
  });
}
async function fileAction(title: string, index = 0) {
  await openFileMenu(index);
  await click(
    title,
    document.querySelector('[role="menu"][aria-label="File actions"]')!,
  );
  await act(async () => vi.advanceTimersByTimeAsync(200));
}
async function select(source: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  const option = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((node) => node.textContent === source)!;
  await act(async () => option.click());
}
async function render(props: Partial<GitReviewPaneProps> = {}) {
  await act(async () =>
    root.render(
      createElement(GitReviewPane, {
        cwd: "/repo",
        ...props,
      }),
    ),
  );
  // Browsers emit scroll after scrollToIndex; happy-dom only updates scrollTop.
  await act(async () => scroller().dispatchEvent(new Event("scroll")));
  await measure();
}
beforeEach(() => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      defaultRoot: "/repo-worktrees",
      worktrees: [{
        path: "/repo",
        branch: "main",
        head: "abc",
        isMain: true,
        locked: false,
        prunable: false,
        missing: false,
        dirty: false,
        unpushed: 0,
        sessionIds: [],
      }],
    },
    refresh: vi.fn(async () => true),
  });
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  observers.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("overscroll-contain")) return 64;
      if (this.hasAttribute("data-index"))
        return this.querySelector(".zen-fold-item") ? 332 : 32;
      return 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    100_000,
  );
  vi.mocked(gitDiffFiles).mockResolvedValue({ files } as GitDiffIndex);
  vi.mocked(gitFileDiff).mockResolvedValue(comparison);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("virtualizes cards, supports multiple expansions, and removes offscreen expanded heights on collapse all", async () => {
  await render();
  expect(container.querySelectorAll("[data-review-file]").length).toBeLessThan(
    files.length,
  );
  expect(gitFileDiff).not.toHaveBeenCalled();
  await click("Expand file", card(0));
  await click("Expand file", card(1));
  await settle();
  await measure();
  expect(card(0).querySelector("[data-diff-content]")).not.toBeNull();
  expect(card(1).querySelector("[data-diff-content]")).not.toBeNull();
  expect(listHeight()).toBe(32 * files.length + 600);
  await act(async () => {
    scroller().scrollTop = 1200;
    scroller().dispatchEvent(new Event("scroll"));
  });
  expect(card(0)).toBeNull();
  expect(card(1)).toBeNull();
  await menu("Collapse all files");
  expect(listHeight()).toBe(32 * files.length);
  await act(async () => {
    scroller().scrollTop = 0;
    scroller().dispatchEvent(new Event("scroll"));
  });
  const loadsBefore = vi.mocked(gitFileDiff).mock.calls.length;
  await menu("Expand all files");
  // Rows are re-estimated at their expanded size in the same render, so only the
  // cards near the viewport mount and load instead of every collapsed row in view.
  expect(listHeight()).toBeGreaterThan(32 * files.length * 2);
  expect(
    container.querySelectorAll("[data-review-file]").length,
  ).toBeLessThanOrEqual(3);
  expect(
    vi.mocked(gitFileDiff).mock.calls.length - loadsBefore,
  ).toBeLessThanOrEqual(3);
  await settle();
  await measure();
  expect(
    container.querySelectorAll("[data-diff-content]").length,
  ).toBeGreaterThan(1);
  await menu("Collapse all files");
  expect(container.querySelector("[data-diff-content]")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(350));
  await act(async () => container.querySelectorAll('[data-fold-state="closing"]').forEach(completeMotionAnimation));
  await measure();
  expect(container.querySelector("[data-diff-content]")).toBeNull();
  expect(listHeight()).toBe(32 * files.length);
});

it("keeps source control idle while files animate and updates it when the selection changes", async () => {
  await render();
  rail.renders = 0;
  await click("Expand file", card(0));
  await settle();
  await measure();
  await click("Collapse file", card(0));
  await settle();
  await measure();
  expect(rail.renders).toBe(0);

  await act(async () => rail.props!.onOpenFile(files[1].path, "unstaged"));
  await measure();
  expect(rail.renders).toBeGreaterThan(0);
  expect(rail.props?.selectedPath).toBe(files[1].path);
});

it("waits for a requested diff before expanding without changing the list height", async () => {
  let finish!: (value: typeof comparison) => void;
  vi.mocked(gitFileDiff).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render();
  const height = listHeight();
  await click("Expand file", card(0));
  await settle();
  await measure();
  expect(card(0).querySelector("header button")?.getAttribute("aria-busy")).toBe("true");
  expect(card(0).querySelector(".zen-fold-item")).toBeNull();
  expect(listHeight()).toBe(height);

  await act(async () => finish(comparison));
  expect(card(0).querySelector('[data-fold-state="opening"]')).not.toBeNull();
  expect(card(0).querySelector("[data-diff-content]")?.textContent).toContain("new");
  expect(card(0).querySelector("header button")?.hasAttribute("aria-busy")).toBe(false);
});

it("keeps a cancelled loading file closed and opens its cached result on the next click", async () => {
  let finish!: (value: typeof comparison) => void;
  vi.mocked(gitFileDiff).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render();
  await click("Expand file", card(0));
  await click("Collapse file", card(0));
  await act(async () => finish(comparison));
  expect(card(0).querySelector(".zen-fold-item")).toBeNull();
  await click("Expand file", card(0));
  expect(card(0).querySelector("[data-diff-content]")).not.toBeNull();
  expect(gitFileDiff).toHaveBeenCalledTimes(1);
});

it("opens a failed diff as an error instead of leaving a loading header", async () => {
  vi.mocked(gitFileDiff).mockRejectedValueOnce(new Error("Diff unavailable"));
  await render();
  await click("Expand file", card(0));
  expect(card(0).querySelector('[role="alert"]')?.textContent).toContain("Diff unavailable");
  expect(card(0).querySelector("header button")?.hasAttribute("aria-busy")).toBe(false);
});

it("keeps the current diff mounted and disables hunk actions during a slow refresh", async () => {
  await render();
  await click("Expand file", card(0));
  await settle();
  const body = card(0).querySelector("[data-diff-content]");
  let finish!: (value: typeof comparison) => void;
  vi.mocked(gitFileDiff).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await menu("Refresh");
  await settle();
  expect(card(0).querySelector("[data-diff-content]")).toBe(body);
  expect(card(0).querySelector('.zen-fold-item')?.getAttribute("data-fold-state")).toBe("open");
  expect(card(0).querySelector<HTMLButtonElement>('[title="Stage hunk"]')?.disabled).toBe(true);
  await act(async () => finish({ ...comparison, current: "refreshed\n" }));
  expect(card(0).querySelector("[data-diff-content]")).toBe(body);
  expect(body?.textContent).toContain("refreshed");
  expect(card(0).querySelector<HTMLButtonElement>('[title="Stage hunk"]')?.disabled).toBe(false);
});

it("retains the card and scroll position during refresh and reloads its invalidated diff", async () => {
  await render();
  await click("Expand file", card(0));
  await settle();
  const existing = card(0);
  scroller().scrollTop = 50;
  let finish!: (value: GitDiffIndex) => void;
  vi.mocked(gitDiffFiles).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(gitFileDiff).mockResolvedValueOnce({
    ...comparison,
    current: "refreshed\n",
  });
  await menu("Refresh");
  expect(card(0)).toBe(existing);
  expect(scroller().scrollTop).toBe(50);
  expect(card(0).textContent).toContain("refreshed");
  expect(gitFileDiff).toHaveBeenCalledTimes(2);
  await act(async () => finish({ files } as GitDiffIndex));
  expect(card(0)).toBe(existing);
});

it("uses OmniCode file operations and stages the chunk's document position", async () => {
  await render();
  await fileAction("Stage file");
  expect(gitStageFile).toHaveBeenCalledWith("/repo", files[0].relative);
  await fileAction("Discard changes");
  expect(gitDiscardFile).toHaveBeenCalledWith("/repo", files[0].relative);
  await click("Expand file", card(0));
  await settle();
  await click("Stage hunk", card(0));
  expect(gitStageContents).toHaveBeenCalledWith(
    "/repo",
    files[0].relative,
    comparison.current,
  );
  await select("Staged");
  await fileAction("Unstage file");
  expect(gitUnstageFile).toHaveBeenCalledWith("/repo", files[0].relative);
  expect(card(0).querySelector('[title="Stage hunk"]')).toBeNull();
  expect(card(0).querySelector('[title="Discard changes"]')).toBeNull();
  for (const [label, operation, expected] of [
    ["Copy absolute path", copyText, files[0].path],
    ["Copy relative path", copyText, files[0].relative],
    ["Reveal in file manager", revealPath, files[0].path],
  ] as const) {
    await openFileMenu(0);
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((node) => node.textContent === label)!;
    await act(async () => item.click());
    expect(operation).toHaveBeenLastCalledWith(expected);
    await act(async () => vi.advanceTimersByTimeAsync(200));
  }
});

it("initializes from the tab's staged source and expands and scrolls to the focused file", async () => {
  await act(async () =>
    root.render(
      createElement(WorkingTreeDiff, {
        cwd: "/repo",
        focusKind: "staged",
        focusPath: files[25].path,
      }),
    ),
  );
  await act(async () => scroller().dispatchEvent(new Event("scroll")));
  await measure();
  expect(gitFileDiff).toHaveBeenCalledWith(
    "/repo",
    files[25].relative,
    "staged",
  );
  expect(card(25).querySelector("[data-diff-content]")).not.toBeNull();
  expect(scroller().scrollTop).toBeGreaterThan(0);
});

it("carries source control beside working-tree reviews and opens its files in place", async () => {
  await render();
  const aside = container.querySelector<HTMLElement>('aside[aria-label="Source control"]')!;
  expect(aside.inert).toBe(false);
  expect(rail.props?.enabled).toBe(true);
  await act(async () => rail.props!.onOpenFile(files[25].path, "staged"));
  await act(async () => scroller().dispatchEvent(new Event("scroll")));
  await measure();
  expect(gitFileDiff).toHaveBeenCalledWith("/repo", files[25].relative, "staged");
  expect(card(25).querySelector("[data-diff-content]")).not.toBeNull();
  expect(rail.props?.selectedKind).toBe("staged");

  const toggle = container.querySelector<HTMLButtonElement>("[data-review-rail-toggle]")!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(aside.inert).toBe(true);
  expect(container.querySelector(".review-body")?.getAttribute("data-fold-state")).toBe("closing");
  expect(rail.props?.enabled).toBe(false);
  await act(async () => toggle.click());
  expect(aside.inert).toBe(false);
});

it("folds source control away in a narrow review without forgetting the reader's choice", async () => {
  const body = () => container.querySelector<HTMLElement>(".review-body")!;
  await render();
  const pane = container.querySelector<HTMLElement>("[data-git-review-pane]")!;
  const aside = container.querySelector<HTMLElement>('aside[aria-label="Source control"]')!;
  const toggle = container.querySelector<HTMLButtonElement>("[data-review-rail-toggle]")!;
  const resizePane = (width: number) =>
    act(async () => {
      for (const observer of observers) {
        if (!observer.targets.has(pane)) continue;
        (observer as unknown as { callback: ResizeObserverCallback }).callback(
          [{ target: pane, contentRect: { width } } as unknown as ResizeObserverEntry],
          observer as unknown as ResizeObserver,
        );
      }
    });
  expect(aside.inert).toBe(false);

  await resizePane(400);
  expect(aside.inert).toBe(true);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  // Folding from the width animates, like the toggle does.
  expect(body().getAttribute("data-fold-state")).toBe("closing");
  // The toggle still opens it while the review stays narrow.
  await act(async () => toggle.click());
  expect(aside.inert).toBe(false);
  expect(body().getAttribute("data-fold-state")).toBe("opening");

  await resizePane(1000);
  expect(aside.inert).toBe(false);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
});

it("keeps source control beside a session review in a repository, but not beside a commit", async () => {
  vi.mocked(sessionCheckpointStatus).mockResolvedValue({ files: [] } as unknown as CheckpointStatus);
  await render({ sessionId: "session", initialSource: "session" });
  expect(container.querySelector('aside[aria-label="Source control"]')).not.toBeNull();
  vi.mocked(gitCommitFiles).mockResolvedValue([files[0]]);
  await render({ commit: "abc1234" });
  expect(container.querySelector("aside")).toBeNull();
  expect(container.querySelector("[data-review-rail-toggle]")).toBeNull();
});

it("jumps to a changed file picked from the search panel", async () => {
  await render();
  await click("Search changed files");
  const search = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  expect(document.querySelector('[data-ui="select-overflow"]')?.textContent).toBe(
    "18 more files. Keep typing to narrow.",
  );
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(search, "file25");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(1);
  expect(options[0].textContent).toContain("file25.ts");
  expect(options[0].textContent).toContain("dir");
  await act(async () => options[0].click());
  await act(async () => scroller().dispatchEvent(new Event("scroll")));
  await measure();
  // The review keeps every file and opens the picked one in place.
  expect(container.querySelectorAll("[data-review-file]").length).toBeGreaterThan(1);
  expect(gitFileDiff).toHaveBeenCalledWith("/repo", files[25].relative, "unstaged");
  expect(card(25).querySelector("[data-diff-content]")).not.toBeNull();
  expect(scroller().scrollTop).toBeGreaterThan(0);
});

it("remembers diff view options from the options menu", async () => {
  await render();
  await menu("Side by side");
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
    .find((node) => node.textContent === "Side by side");
  expect(item?.getAttribute("aria-checked")).toBe("true");
  expect(JSON.parse(localStorage.getItem("omnicode.reviewViewOptions.v1")!)).toMatchObject({
    sideBySide: true,
    wordWrap: true,
    highlightWords: true,
  });
});

it("offers session checkpoints only on a session tab and keeps Undo/Keep outside the pane", async () => {
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  expect(
    [...document.querySelectorAll('[role="option"]')].map(
      (node) => node.textContent,
    ),
  ).toEqual(["Uncommitted", "Unstaged", "Staged", "Committed", "Branch"]);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  vi.mocked(sessionCheckpointStatus).mockResolvedValue({
    files,
  } as unknown as CheckpointStatus);
  await render({ sessionId: "s1" });
  await select("Session changes");
  expect(sessionCheckpointStatus).toHaveBeenLastCalledWith("s1", "/repo");
  expect(card(0).querySelector('[title="Stage file"]')).toBeNull();
  expect(container.textContent).not.toMatch(/Undo|Keep/);
});

it("opens file actions from the keyboard without expanding and restores focus on Escape", async () => {
  await render();
  await openFileMenu(0, true);
  expect(
    document.querySelector('[role="menu"][aria-label="File actions"]'),
  ).not.toBeNull();
  expect(
    card(0).querySelector("header button")?.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(gitFileDiff).not.toHaveBeenCalled();
  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="File actions"]',
  )!;
  await act(async () =>
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(document.activeElement?.textContent).toBe("Stage file");
  await act(async () =>
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  expect(document.activeElement?.textContent).toBe("Reveal in file manager");
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(card(0).querySelector("header button"));
  expect(
    document
      .querySelector('[role="menu"][aria-label="File actions"]')
      ?.closest("[inert]"),
  ).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(
    document.querySelector('[role="menu"][aria-label="File actions"]'),
  ).toBeNull();
});

it("shows uncommitted totals from the file list before any diff is expanded", async () => {
  vi.mocked(gitBaseDiffFiles).mockResolvedValue({
    base: "HEAD",
    files: [
      { ...files[0], additions: 8, deletions: 3 },
      { ...files[1], additions: 5, deletions: 2 },
    ],
  });
  await render({ initialSource: "uncommitted" });
  const totals = container.querySelector('button[aria-haspopup="listbox"]')!;
  expect(totals.textContent).toBe("Uncommitted+13-5");
  expect(gitBaseDiffFiles).toHaveBeenCalledWith("/repo", "head");
  expect(gitBaseFileDiff).not.toHaveBeenCalled();
});

it("renders a fixed commit with the shared diff, preserves folding on refresh, and switches snapshots", async () => {
  vi.mocked(gitCommitFiles).mockResolvedValue([files[0]]);
  vi.mocked(gitCommitFileDiff).mockImplementation(async (_cwd, sha) => ({
    ...comparison,
    current: `${sha}\n`,
  }));
  const openCommit = async (sha: string) => {
    await act(async () =>
      root.render(createElement(CommitDiff, { cwd: "/repo", sha })),
    );
    await settle();
    await measure();
  };
  await openCommit("abc1234");
  expect(gitCommitFiles).toHaveBeenCalledWith("/repo", "abc1234");
  expect(gitCommitFileDiff).toHaveBeenCalledWith("/repo", "abc1234", files[0].relative);
  expect(card(0).querySelector("[data-diff-content]")?.textContent).toBe("abc1234\n");
  expect(container.querySelector('[aria-haspopup="listbox"]')).toBeNull();
  expect(gitFileDiff).not.toHaveBeenCalled();
  await openFileMenu(0);
  expect(document.querySelector('[role="menu"]')?.textContent).not.toMatch(/Stage|Unstage|Discard/);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await menu("Collapse all files");
  await settle();
  await menu("Refresh");
  expect(card(0).querySelector("header button")?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => container.querySelectorAll('[data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(card(0).querySelector("[data-diff-content]")).toBeNull();
  await openCommit("def5678");
  expect(gitCommitFileDiff).toHaveBeenLastCalledWith("/repo", "def5678", files[0].relative);
  expect(card(0).querySelector("[data-diff-content]")?.textContent).toBe("def5678\n");
});

it("loads only mounted commit diffs while opening a large commit", async () => {
  vi.mocked(gitCommitFiles).mockResolvedValue(files);
  vi.mocked(gitCommitFileDiff).mockResolvedValue(comparison);
  await act(async () =>
    root.render(createElement(CommitDiff, { cwd: "/repo", sha: "large-commit" })),
  );
  await settle();
  await measure();
  expect(card(0).querySelector("[data-diff-content]")).not.toBeNull();
  expect(vi.mocked(gitCommitFileDiff).mock.calls.length).toBeGreaterThan(0);
  expect(vi.mocked(gitCommitFileDiff).mock.calls.length).toBeLessThan(files.length);
  expect(container.querySelectorAll("[data-review-file]").length).toBeLessThan(files.length);
});

it("keeps checkpoint review available without Git and hides Git-only sources", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    error: "not a git repository",
    refresh: vi.fn(async () => false),
  });
  vi.mocked(sessionCheckpointStatus).mockResolvedValue({
    files,
  } as unknown as CheckpointStatus);
  await render({ sessionId: "s1", initialSource: "staged" });
  expect(sessionCheckpointStatus).toHaveBeenLastCalledWith("s1", "/repo");
  expect(gitDiffFiles).not.toHaveBeenCalled();
  expect(card(0).querySelector('[title="Stage file"]')).toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      .click(),
  );
  expect(
    [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent),
  ).toEqual(["Session changes"]);
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
