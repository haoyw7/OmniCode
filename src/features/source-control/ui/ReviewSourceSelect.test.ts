import { duration } from "../../../shared/motion/tokens";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../../shared/i18n/language";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import type { ReviewSource } from "../model/reviewDiff";
import { ReviewSourceSelect } from "./ReviewSourceSelect";

const commit = (sha: string, parent: string | null, subject: string) => ({
  sha,
  shortSha: sha.slice(0, 7),
  parents: parent ? [parent] : [],
  author: "wy",
  timestamp: Math.floor(Date.now() / 1000) - 3600,
  subject,
  refs: [],
  head: false,
});
vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory: vi.fn(async () => ({
    head: "c3",
    commits: [
      commit("c3", "c2", "third"),
      commit("other", "c1", "default branch only"),
      commit("c2", "c1", "second"),
      commit("c1", null, "first"),
    ],
  })),
}));

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const menu = () => document.querySelector<HTMLElement>('[role="listbox"]');
const activeValue = () =>
  document.getElementById(menu()!.getAttribute("aria-activedescendant")!)!
    .textContent;

function render(
  value: ReviewSource = "unstaged",
  visible = true,
  gitAvailable = true,
) {
  act(() =>
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: visible },
        createElement(ReviewSourceSelect, {
          cwd: "/repo",
          value,
          sessionId: "s1",
          gitAvailable,
          onChange,
        }),
      ),
    ),
  );
}
function key(target: HTMLElement, value: string) {
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
function open() {
  act(() => {
    trigger().focus();
    trigger().click();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  setUiLanguage("en");
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
  localStorage.clear();
});

it("selects with the pointer, restores focus, and disables the retained closing menu", () => {
  render();
  open();
  expect(document.activeElement).toBe(menu());
  const selected = menu()!.querySelector('[aria-selected="true"]')!;
  expect(selected.textContent).toBe("Unstaged");
  expect(selected.lastElementChild?.querySelector("svg")).not.toBeNull();
  const staged = [
    ...menu()!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((option) => option.textContent === "Staged")!;
  act(() => staged.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("staged");
  expect(document.activeElement).toBe(trigger());
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(menu()!.inert).toBe(true);
  expect(menu()!.getAttribute("aria-hidden")).toBe("true");
  act(() => staged.click());
  expect(onChange).toHaveBeenCalledTimes(1);
  render("staged");
  expect(trigger().querySelector("span")?.title).toBe("Staged");
  act(() => vi.advanceTimersByTime(duration.pop * 1000));
  expect(menu()).toBeNull();
});

it("opens from the keyboard, navigates the sources, and confirms with Enter or Space", () => {
  render();
  key(trigger(), "ArrowDown");
  expect(activeValue()).toBe("Unstaged");
  key(menu()!, "ArrowDown");
  expect(activeValue()).toBe("Staged");
  key(menu()!, "End");
  expect(activeValue()).toBe("Branch");
  key(menu()!, "Home");
  expect(activeValue()).toBe("Session changes");
  key(menu()!, "ArrowDown");
  key(menu()!, "Enter");
  expect(onChange).toHaveBeenLastCalledWith("uncommitted");
  expect(document.activeElement).toBe(trigger());
  render("staged");
  key(trigger(), "ArrowUp");
  expect(activeValue()).toBe("Staged");
  key(menu()!, "ArrowUp");
  key(menu()!, " ");
  expect(onChange).toHaveBeenLastCalledWith("unstaged");
});

it("lists the current branch's commits in a flyout and picks one from the keyboard", async () => {
  render();
  key(trigger(), "ArrowDown");
  key(menu()!, "ArrowDown");
  key(menu()!, "ArrowDown");
  expect(activeValue()).toBe("Committed");
  key(menu()!, "ArrowRight");
  await act(async () => {});
  const flyout = document.querySelectorAll<HTMLElement>('[role="listbox"]')[1];
  expect(
    [...flyout.querySelectorAll('[role="option"]')].map(
      (node) => node.firstElementChild?.textContent,
    ),
  ).toEqual(["third", "second", "first"]);
  expect(activeValue()).toContain("third");
  key(menu()!, "ArrowDown");
  key(menu()!, "Enter");
  expect(onChange).toHaveBeenLastCalledWith("commit:c2");
  render("commit:c2");
  expect(trigger().querySelector("span")?.title).toBe("Committed");
});

it("restores focus on Escape, reverses closing, and dismisses outside without stealing focus", () => {
  render();
  open();
  const surface = menu()!;
  key(surface, "Escape");
  expect(document.activeElement).toBe(trigger());
  expect(surface.inert).toBe(true);
  act(() => vi.advanceTimersByTime(70));
  open();
  expect(menu()).toBe(surface);
  expect(surface.inert).toBe(false);
  act(() => vi.advanceTimersByTime(duration.pop * 1000));
  expect(surface.inert).toBe(false);
  const outside = document.createElement("button");
  container.append(outside);
  act(() => {
    outside.focus();
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(outside);
  expect(onChange).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(duration.pop * 1000));
  expect(menu()).toBeNull();
});

it("closes immediately with reduced motion and removes menus when the pane is hidden", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as MediaQueryList);
  render();
  open();
  key(menu()!, "Escape");
  expect(menu()).toBeNull();
  open();
  render("unstaged", false);
  expect(menu()).toBeNull();
  render();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("only offers session changes outside a Git repository, including keyboard navigation", () => {
  render("session", true, false);
  open();
  expect(
    [...menu()!.querySelectorAll('[role="option"]')].map((row) => row.textContent),
  ).toEqual(["Session changes"]);
  expect(menu()!.querySelector('[role="separator"]')).toBeNull();
  key(menu()!, "End");
  expect(activeValue()).toBe("Session changes");
  key(menu()!, "Enter");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("session");
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
