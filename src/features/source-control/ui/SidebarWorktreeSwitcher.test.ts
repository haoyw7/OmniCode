// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  setWorktreeFocus,
  worktreeFocus,
  type WorktreeFocus,
} from "../model/worktreeFocus";
import { SidebarWorktreeSwitcher } from "./SidebarWorktreeSwitcher";

const { branchState, worktreeState, refreshWorktrees } = vi.hoisted(() => ({
  branchState: vi.fn(),
  worktreeState: vi.fn(),
  refreshWorktrees: vi.fn(async () => true),
}));
vi.mock("../hooks/useProjectBranches", () => ({
  useProjectBranchesState: branchState,
}));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: worktreeState,
}));
const loadedWorktrees = () => ({
  data: {
    worktrees: [
      { path: "/picker", branch: "main", isMain: true },
      { path: "/picker-a", branch: "feature-a", isMain: false },
      { path: "/picker-b", branch: "feature-b", isMain: false },
    ],
  },
  refresh: refreshWorktrees,
});
let root: Root;
let container: HTMLDivElement;
const select = vi.fn<(focus?: WorktreeFocus) => void>();
const render = async (
  pending = false,
  switchError?: string,
  compact = false,
  iconOnly = false,
) => {
  await act(async () =>
    root.render(
      createElement(SidebarWorktreeSwitcher, {
        cwd: "/picker",
        onSelect: select,
        pending,
        switchError,
        compact,
        iconOnly,
      }),
    ),
  );
};
const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    '[aria-label="Switch working copy"]',
  )!;
const option = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes(name),
  )!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus("/picker", undefined);
  select.mockReset();
  refreshWorktrees.mockClear();
  branchState.mockReturnValue({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  });
  worktreeState
    .mockReset()
    .mockImplementation((_cwd, enabled = true) =>
      enabled ? loadedWorktrees() : { refresh: refreshWorktrees },
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps an ordinary folder title without requesting Git worktrees", async () => {
  branchState.mockReturnValue({
    branches: { current: null, detached: false, branches: [] },
    settled: true,
  });
  await render();
  expect(worktreeState).toHaveBeenLastCalledWith("/picker", false);
  expect(container.textContent).toBe("picker");
  expect(trigger()).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("waits for repository discovery before requesting worktrees", async () => {
  branchState.mockReturnValue({ branches: null, settled: false });
  await render();
  expect(worktreeState).toHaveBeenLastCalledWith("/picker", false);
  expect(trigger()).toBeNull();
  branchState.mockReturnValue({
    branches: { current: "abc1234", detached: true, branches: [] },
    settled: true,
  });
  await render();
  expect(worktreeState).toHaveBeenLastCalledWith("/picker", true);
  expect(trigger()).not.toBeNull();
});

it.each([false, true])(
  "still shows a real worktree query failure (branch lookup failed=%s)",
  async (branchLookupFailed) => {
    if (branchLookupFailed)
      branchState.mockReturnValue({ branches: null, settled: true });
    worktreeState.mockReturnValue({
      error: "Permission denied",
      refresh: refreshWorktrees,
    });
    await render();
    await act(async () => trigger().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Permission denied",
    );
  },
);

it("requests a switch without publishing the destination and permits a newer selection", async () => {
  await render();
  await act(async () => trigger().click());
  await act(async () => option("feature-a").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-a",
    branch: "feature-a",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
  await render(true);
  expect(trigger().getAttribute("aria-busy")).toBe("true");
  expect(trigger().textContent).toBe("picker");
  await act(async () => trigger().click());
  await act(async () => option("feature-b").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-b",
    branch: "feature-b",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
});

it("shows a switch failure in the reopened picker", async () => {
  await render();
  await render(false, "Working copy no longer exists");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Working copy no longer exists",
  );
  expect(trigger().textContent).toBe("picker");
});

it("requests fallback from a deleted worktree once and does not retry while pending or failed", async () => {
  setWorktreeFocus("/picker", { path: "/deleted", branch: "gone" });
  await render();
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined);
  await render(true);
  await render(false, "Could not switch working copy");
  expect(select).toHaveBeenCalledTimes(1);
  expect(worktreeFocus("/picker")?.path).toBe("/deleted");
});

it("shows the current branch in compact mode even when the repository only has its main working copy", async () => {
  worktreeState.mockReturnValue({
    data: { worktrees: [{ path: "/picker", branch: "main", isMain: true }] },
    refresh: refreshWorktrees,
  });
  await render(false, undefined, true);
  expect(trigger().textContent).toBe("main");
  expect(trigger().className).toContain("h-8");
  expect(trigger().className).not.toContain("-ml-");
  await act(async () => trigger().click());
  expect(refreshWorktrees).toHaveBeenCalledOnce();
  expect(option("main").getAttribute("aria-selected")).toBe("true");
  await act(async () => option("main").click());
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("keeps a separate working-copy action beside the branch picker only when needed", async () => {
  await render(false, undefined, true, true);
  expect(trigger().textContent).toBe("");
  await act(async () => trigger().click());
  await act(async () => option("feature-a").click());
  expect(select).toHaveBeenCalledExactlyOnceWith({
    path: "/picker-a",
    branch: "feature-a",
  });

  worktreeState.mockReturnValue({
    data: { worktrees: [{ path: "/picker", branch: "main", isMain: true }] },
    refresh: refreshWorktrees,
  });
  await render(false, undefined, true, true);
  expect(trigger()).toBeNull();
});

it("shows the focused worktree branch and preserves the focus until a switch succeeds", async () => {
  setWorktreeFocus("/picker", { path: "/picker-a", branch: "feature-a" });
  await render(false, undefined, true);
  expect(trigger().textContent).toBe("feature-a");
  expect(trigger().title).toContain("/picker-a");
  await act(async () => trigger().click());
  expect(option("feature-a").getAttribute("aria-selected")).toBe("true");
  await act(async () => option("main").click());
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(worktreeFocus("/picker")?.path).toBe("/picker-a");
});

it("uses the detached focused worktree head instead of the main project's branch", async () => {
  setWorktreeFocus("/picker", { path: "/picker-a", branch: null });
  worktreeState.mockReturnValue({
    data: {
      worktrees: [
        { path: "/picker", branch: "main", isMain: true },
        {
          path: "/picker-a",
          branch: null,
          head: "abc123456789",
          isMain: false,
        },
      ],
    },
    refresh: refreshWorktrees,
  });
  await render(false, undefined, true);
  expect(trigger().textContent).toBe("Detached abc1234");
});

it("keeps the current compact branch while a switch is pending and reopens a failed switch", async () => {
  await render(false, undefined, true);
  await act(async () => trigger().click());
  await act(async () => option("feature-a").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-a",
    branch: "feature-a",
  });
  await render(true, undefined, true);
  expect(trigger().getAttribute("aria-busy")).toBe("true");
  expect(trigger().textContent).toBe("main");
  expect(worktreeFocus("/picker")).toBeUndefined();
  await render(false, "Working copy no longer exists", true);
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(trigger().textContent).toBe("main");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Working copy no longer exists",
  );
});

it("hides the compact control while discovering an ordinary folder, then exposes metadata failures", async () => {
  branchState.mockReturnValue({ branches: null, settled: false });
  await render(false, undefined, true);
  expect(trigger()).toBeNull();
  expect(container.textContent).toBe("");
  expect(worktreeState).toHaveBeenLastCalledWith("/picker", false);

  branchState.mockReturnValue({
    branches: { current: null, detached: false, branches: [] },
    settled: true,
  });
  await render(false, undefined, true);
  expect(trigger()).toBeNull();
  expect(container.textContent).toBe("");
  expect(worktreeState).toHaveBeenLastCalledWith("/picker", false);

  branchState.mockReturnValue({ branches: null, settled: true });
  worktreeState.mockReturnValue({
    error: "Permission denied",
    refresh: refreshWorktrees,
  });
  await render(false, undefined, true);
  expect(trigger().textContent).toBe("Project folder");
  await act(async () => trigger().click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Permission denied",
  );
});
