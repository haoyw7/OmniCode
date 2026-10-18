import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/fs", () => ({
  gitBranches: vi.fn(async () => ({
    current: "main",
    detached: false,
    branches: [{ name: "main", current: true, remote: null }],
  })),
  subscribeGitChanged: () => () => {},
  gitCheckout: vi.fn(),
  gitCommit: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitStageAll: vi.fn(),
  gitStash: vi.fn(),
  isCheckoutBlockedByChanges: () => false,
  notifyGitChanged: vi.fn(),
}));

import { BranchPicker } from "./BranchPicker";
import {
  gitBranches,
  gitCheckout,
  gitCreateBranch,
} from "../../../platform/tauri/fs";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.skin;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the desktop list at the current branch and keeps creation in the scrolling area", async () => {
  document.documentElement.dataset.skin = "daylight";
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "codex/current",
    detached: false,
    branches: [
      ...Array.from({ length: 30 }, (_, index) => ({
        name: `feature/${index}`,
        current: false,
        remote: null,
      })),
      { name: "codex/current", current: true, remote: null },
      { name: "release", current: false, remote: "origin" },
    ],
  });
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/desktop-long-list" })),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const search = picker.querySelector<HTMLInputElement>("input")!;
  const selected = picker.querySelector<HTMLElement>(
    '[role="option"][aria-selected="true"]',
  )!;
  expect(selected.textContent).toBe("codex/current");
  expect(selected.dataset.highlighted).toBe("true");
  expect(search.placeholder).toBe("Search branches…");
  const scroller = picker.querySelector(".branch-menu-scroll")!;
  const create = [...picker.querySelectorAll("button")].find(
    (button) => button.textContent === "New branch",
  )!;
  expect(scroller.contains(create)).toBe(true);
  expect(scroller.contains(search)).toBe(false);
  expect(picker.parentElement!.style.width).toBe("320px");
  expect(picker.parentElement!.style.maxHeight).toBe("360px");
  const calls = vi.mocked(gitCheckout).mock.calls.length;
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(vi.mocked(gitCheckout).mock.calls.length).toBe(calls);
  expect(container.querySelector("button")!.getAttribute("aria-expanded")).toBe(
    "false",
  );
});

it("filters desktop branches and restores the current keyboard row when the query clears", async () => {
  document.documentElement.dataset.skin = "daylight";
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "main",
    detached: false,
    branches: [
      { name: "feature/one", current: false, remote: null },
      { name: "main", current: true, remote: null },
      { name: "release", current: false, remote: "origin" },
    ],
  });
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/desktop-filter" })),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const search = picker.querySelector<HTMLInputElement>("input")!;
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  const query = (value: string) =>
    act(() => {
      set.call(search, value);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  query("origin");
  expect(
    picker.querySelector('[data-highlighted="true"]')!.textContent,
  ).toContain("release");
  query("");
  expect(picker.querySelector('[data-highlighted="true"]')!.textContent).toBe(
    "main",
  );
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(
    picker.querySelector('[data-highlighted="true"]')!.textContent,
  ).toContain("release");
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(gitCheckout).toHaveBeenCalledWith(
    "/desktop-filter",
    "release",
    "origin",
  );
});

it("autofocuses the branch search input only once the popover frame is visible", async () => {
  const seenVisibility: (string | undefined)[] = [];
  const nativeFocus = HTMLInputElement.prototype.focus;
  vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    const frame = this.closest("[data-popover-side]")
      ?.parentElement as HTMLElement | null;
    seenVisibility.push(frame?.style.visibility);
    return nativeFocus.call(this);
  });

  act(() =>
    root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })),
  );
  await act(async () => {});
  const button = container.querySelector("button")!;
  await act(async () => button.click());
  await act(async () => {});

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  );
  expect(input).not.toBeNull();
  // Focusing a `visibility: hidden` element is a no-op in real browsers, so
  // the popover's pre-paint measure pass must never be where focus lands.
  expect(seenVisibility).not.toContain("hidden");
  expect(document.activeElement).toBe(input);
});

it("uses the interface typeface for branch names and search", async () => {
  act(() =>
    root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const search = picker.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const branchName = picker.querySelector<HTMLElement>('[role="option"] span')!;

  expect(search.className).toContain("font-sans");
  expect(branchName.className).not.toContain("font-mono");
  expect(branchName.className).toContain("font-medium");
});

it("asks for a branch name before creating from the fixed action", async () => {
  act(() =>
    root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const create = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "New branch",
  )!;
  const list = picker.querySelector('[role="listbox"][aria-label="Branches"]')!;
  expect(list.contains(create)).toBe(false);
  expect(create.parentElement?.className).toContain("border-t");
  expect(create.parentElement?.className).toContain("shrink-0");
  expect(create.parentElement).toBe(picker.lastElementChild);
  expect(create.className).toContain("hover:bg-content/5");

  await act(async () => create.click());
  expect(gitCreateBranch).not.toHaveBeenCalled();

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Branch name"]',
  )!;
  expect(input).not.toBeNull();
  await act(async () => {});
  expect(document.activeElement).toBe(input);

  const submit = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Create branch")!;
  expect(submit.disabled).toBe(true);

  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, "feature/picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(submit.disabled).toBe(false);

  await act(async () => submit.click());
  expect(gitCreateBranch).toHaveBeenCalledWith("/repo", "feature/picker");
});

it("updates the branch creation row with the entered name", async () => {
  act(() =>
    root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, "feature/picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const create = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Create and checkout feature/picker",
  );
  expect(create).not.toBeUndefined();
  expect(create?.parentElement?.className).toContain("border-t");
});

it("checks out the highlighted matching branch when Enter is pressed", async () => {
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "main",
    detached: false,
    branches: [
      { name: "main", current: true, remote: null },
      { name: "feature/picker", current: false, remote: null },
    ],
  });
  act(() =>
    root.render(
      createElement(BranchPicker, {
        cwd: "/repo-enter-existing",
        branch: "main",
      }),
    ),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, "picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const highlighted =
    picker.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(highlighted.textContent).toContain("feature/picker");
  expect(
    [...picker.querySelectorAll<HTMLButtonElement>("button")].some(
      (button) => button.textContent === "Create and checkout picker",
    ),
  ).toBe(true);

  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

  expect(gitCheckout).toHaveBeenCalledWith(
    "/repo-enter-existing",
    "feature/picker",
    null,
  );
  expect(gitCreateBranch).not.toHaveBeenCalledWith(
    "/repo-enter-existing",
    "picker",
  );
});

it("starts a fresh branch-name draft when the create dialog reopens before its exit completes", async () => {
  await act(async () =>
    root.render(
      createElement(BranchPicker, { cwd: "/draft-reopen", branch: "main" }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  const live = <T extends Element>(selector: string) =>
    [...document.querySelectorAll<T>(selector)].find(
      (node) => !node.closest("[inert]"),
    )!;
  const openCreate = async () => {
    await act(async () => trigger.click());
    const picker = live<HTMLElement>("[data-branch-picker]");
    const create = [
      ...picker.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "New branch")!;
    await act(async () => create.click());
  };
  await openCreate();
  await act(async () => completeMotionAnimation(document.body));
  const original = live<HTMLInputElement>('input[aria-label="Branch name"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(original, "unsaved/draft");
    original.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const cancel = [
    ...live<HTMLElement>('[role="dialog"]').querySelectorAll<HTMLButtonElement>(
      "button",
    ),
  ].find((button) => button.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(original.isConnected).toBe(true);
  expect(original.closest<HTMLElement>('[role="dialog"]')?.inert).toBe(true);
  await openCreate();
  const reopened = live<HTMLInputElement>('input[aria-label="Branch name"]');
  expect(reopened).not.toBe(original);
  expect(reopened.value).toBe("");
  expect(original.value).toBe("unsaved/draft");
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } =
    await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
