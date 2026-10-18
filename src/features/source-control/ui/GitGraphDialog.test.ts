// @vitest-environment happy-dom
import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
vi.mock("motion/react", async (original) => {
  const actual = await original<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitHistoryGraph } from "./GitHistoryGraph";
import { gitHistory, type GitHistoryCommit } from "../../../platform/tauri/fs";
import { setUiLanguage } from "../../../shared/i18n/language";
import { saveMenuBarVisible } from "../../settings/model/settings";

const { refreshTrees, listeners, startDragging } = vi.hoisted(() => ({
  refreshTrees: vi.fn(async () => true),
  listeners: new Set<() => void>(),
  startDragging: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));
vi.mock("../../../platform/tauri/platform", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/platform")>()),
  IS_LINUX: true,
  IS_WIN: false,
  IS_MAC: false,
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory: vi.fn(),
  gitCommitFiles: vi.fn(async () => []),
  subscribeGitChanged: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({
    data: { worktrees: [{ path: "/repo/tree-a", head: "abc1234" }] },
    refresh: refreshTrees,
  }),
}));

const commit: GitHistoryCommit = {
  sha: "abc1234",
  shortSha: "abc1234",
  parents: ["parent"],
  subject: "Preserve user commit text",
  author: "My Author",
  timestamp: 1_700_000_000,
  head: true,
  refs: [
    { name: "feature/raw-name", kind: "local" },
    { name: "origin/feature/raw-name", kind: "remote" },
  ],
};
let container: HTMLDivElement;
let root: Root;
const onToggleExpanded = vi.fn();
const onOpenCommit = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  listeners.clear();
  onToggleExpanded.mockClear();
  onOpenCommit.mockClear();
  refreshTrees.mockClear();
  startDragging.mockClear();
  saveMenuBarVisible(false);
  vi.mocked(gitHistory)
    .mockReset()
    .mockResolvedValue({ head: commit.sha, commits: [commit] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLanguage("en");
  saveMenuBarVisible(false);
  vi.unstubAllGlobals();
});
async function render(cwd = "/repo", enabled = true) {
  await act(async () =>
    root.render(
      createElement(GitHistoryGraph, {
        cwd,
        enabled,
        expanded: false,
        onToggleExpanded,
        onOpenCommit,
      }),
    ),
  );
}
function button(label: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
async function open() {
  await render();
  // A pointer click focuses its button in browsers; happy-dom only dispatches it.
  button("Open Git graph").focus();
  await act(async () => button("Open Git graph").click());
}

it("uses the Settings dialog shell and drags from its header without stealing button or table interaction", async () => {
  await open();
  const shell = document.querySelector<HTMLElement>("[data-app-view-dialog]")!;
  const dialog = shell.querySelector('[role="dialog"]')!;
  expect(shell.style.top).toBe("42px");
  await act(async () => saveMenuBarVisible(true));
  expect(shell.style.top).toBe("36px");
  const header = dialog.querySelector('[data-window-drag-region="deep"]')!;
  const press = (target: Element) => {
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
      // Away from the window edges, which Linux leaves to native resizing.
      clientX: 200,
      clientY: 60,
    });
    act(() => target.dispatchEvent(event));
    return event;
  };
  expect(press(header.querySelector("span")!).defaultPrevented).toBe(true);
  expect(startDragging).toHaveBeenCalledOnce();
  startDragging.mockClear();
  for (const target of [
    button("Refresh Git graph").querySelector("svg")!,
    button("Close").querySelector("svg")!,
    dialog.querySelector("tbody td")!,
  ]) {
    expect(press(target).defaultPrevented).toBe(false);
  }
  expect(startDragging).not.toHaveBeenCalled();
  await act(async () => button("Refresh Git graph").click());
  expect(refreshTrees).toHaveBeenCalledOnce();
  await act(async () => button("Close").click());
  await act(async () => completeMotionAnimation(document.body));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("opens the complete graph from a collapsed sidebar, localizes labels, and opens commit details", async () => {
  await open();
  expect(onToggleExpanded).not.toHaveBeenCalled();
  expect(gitHistory).toHaveBeenCalledExactlyOnceWith("/repo", 50, true, 0);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("origin/feature/raw-name");
  expect(dialog.textContent).toContain("HEAD");
  expect(
    dialog.querySelector('[title="Worktree: /repo/tree-a"]'),
  ).not.toBeNull();
  expect(dialog.querySelectorAll("th").length).toBe(5);
  await act(async () => setUiLanguage("zh-CN"));
  expect(dialog.textContent).toContain("Git 图谱");
  expect(dialog.textContent).toContain("日期");
  expect(dialog.textContent).toContain("My Author");
  expect(dialog.textContent).toContain("Preserve user commit text");
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>("tbody button")!.click(),
  );
  expect(onOpenCommit).toHaveBeenCalledExactlyOnceWith(commit, true);
  await act(async () => completeMotionAnimation(document.body));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button("打开 Git 图谱"));
});

it("refreshes both history and worktrees while retaining usable rows after a failure", async () => {
  await open();
  vi.mocked(gitHistory).mockRejectedValueOnce(new Error("offline"));
  await act(async () => button("Refresh Git graph").click());
  expect(refreshTrees).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "offline",
  );
  expect(document.querySelector("tbody")?.textContent).toContain(
    commit.subject,
  );
  vi.mocked(gitHistory).mockResolvedValueOnce({ head: null, commits: [] });
  await act(async () => button("Refresh Git graph").click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "No commits yet",
  );
});

it("ignores an older refresh response and dismisses on Escape or repository changes", async () => {
  await open();
  let resolveOld!: (value: {
    head: string | null;
    commits: GitHistoryCommit[];
  }) => void;
  vi.mocked(gitHistory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  await act(async () => {
    for (const listener of listeners) listener();
  });
  vi.mocked(gitHistory).mockResolvedValueOnce({ head: null, commits: [] });
  await act(async () => {
    for (const listener of listeners) listener();
  });
  await act(async () => resolveOld({ head: commit.sha, commits: [commit] }));
  expect(document.querySelector("tbody")?.textContent).not.toContain(
    commit.subject,
  );
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () => completeMotionAnimation(document.body));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button("Open Git graph"));
  await act(async () => button("Open Git graph").click());
  await render("/another-repo");
  await act(async () => completeMotionAnimation(document.body));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("/repo", false);
  expect(button("Open Git graph").disabled).toBe(true);
});

function history(count: number, prefix = "page") {
  return Array.from({ length: count }, (_, index): GitHistoryCommit => ({
    ...commit,
    sha: `${prefix}-${index}`,
    shortSha: `${prefix}-${index}`,
    subject: `${prefix} commit ${index}`,
    head: index === 0,
    refs: index === 0 ? commit.refs : [],
    parents: index + 1 < count ? [`${prefix}-${index + 1}`] : [],
  }));
}

async function scrollHistory(remaining = 0, times = 1) {
  const scroller = document.querySelector<HTMLElement>("[aria-busy]")!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 5000 },
    scrollTop: { configurable: true, value: 4500 - remaining },
  });
  await act(async () => {
    for (let index = 0; index < times; index++) {
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  });
}

it("loads 50 commits at a time, coalesces scroll events, and continues past 500 until history ends", async () => {
  const commits = history(521);
  vi.mocked(gitHistory).mockImplementation(
    async (_cwd, limit, _allRefs, skip = 0) => ({
      head: commits[0].sha,
      commits: commits.slice(skip, skip + limit!),
    }),
  );
  await open();
  expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(gitHistory).toHaveBeenCalledExactlyOnceWith("/repo", 50, true, 0);
  await scrollHistory(1000);
  expect(gitHistory).toHaveBeenCalledTimes(1);
  await scrollHistory(100, 3);
  expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
  expect(gitHistory).toHaveBeenCalledTimes(2);
  for (let offset = 100; offset <= 500; offset += 50) {
    await scrollHistory();
    expect(gitHistory).toHaveBeenLastCalledWith("/repo", 50, true, offset);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(
      Math.min(offset + 50, 521),
    );
  }
  const subjects = Array.from(document.querySelectorAll("tbody button")).map(
    (button) => button.textContent,
  );
  expect(subjects).toEqual(commits.map((commit) => commit.subject));
  expect(document.querySelector("tbody")?.textContent).toContain(
    "page commit 520",
  );
  await scrollHistory();
  expect(gitHistory).toHaveBeenCalledTimes(11);
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});

it("retains rows after a page failure and retries the same offset without duplicates", async () => {
  const commits = history(60);
  vi.mocked(gitHistory)
    .mockResolvedValueOnce({
      head: commits[0].sha,
      commits: commits.slice(0, 50),
    })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      head: commits[0].sha,
      commits: commits.slice(50),
    });
  await open();
  await scrollHistory();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "offline",
  );
  expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
  await scrollHistory();
  expect(gitHistory).toHaveBeenCalledTimes(2);
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Load more commits")!
      .click();
  });
  expect(gitHistory).toHaveBeenLastCalledWith("/repo", 50, true, 50);
  expect(document.querySelectorAll("tbody tr")).toHaveLength(60);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("refreshes the loaded depth and ignores a page that completes after the refresh", async () => {
  const commits = history(150);
  vi.mocked(gitHistory).mockImplementation(
    async (_cwd, limit, _allRefs, skip = 0) => ({
      head: commits[0].sha,
      commits: commits.slice(skip, skip + limit!),
    }),
  );
  await open();
  await scrollHistory();
  let resolvePage!: (value: Awaited<ReturnType<typeof gitHistory>>) => void;
  vi.mocked(gitHistory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
  );
  await scrollHistory();
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => button("Refresh Git graph").click());
  expect(gitHistory).toHaveBeenNthCalledWith(4, "/repo", 50, true, 0);
  expect(gitHistory).toHaveBeenNthCalledWith(5, "/repo", 50, true, 50);
  await act(async () =>
    resolvePage({ head: commits[0].sha, commits: commits.slice(100) }),
  );
  expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
  expect(document.querySelector("tbody")?.textContent).not.toContain(
    "page commit 100",
  );
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});

it("restarts pagination when HEAD changes and stops if an older host repeats a page", async () => {
  const initial = history(50, "initial");
  const next = history(60, "new");
  vi.mocked(gitHistory)
    .mockResolvedValueOnce({ head: initial[0].sha, commits: initial })
    .mockResolvedValueOnce({ head: next[0].sha, commits: next.slice(50) })
    .mockResolvedValue({ head: next[0].sha, commits: next.slice(0, 50) });
  await open();
  await scrollHistory();
  expect(gitHistory).toHaveBeenLastCalledWith("/repo", 50, true, 0);
  expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
  expect(document.querySelector("tbody")?.textContent).toContain(
    "new commit 0",
  );
  expect(document.querySelector("tbody")?.textContent).not.toContain(
    "initial commit",
  );
  await scrollHistory();
  expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
  const calls = vi.mocked(gitHistory).mock.calls.length;
  await scrollHistory();
  expect(gitHistory).toHaveBeenCalledTimes(calls);
});
