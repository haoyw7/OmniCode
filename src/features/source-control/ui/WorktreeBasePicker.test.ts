// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../../shared/i18n/language";
import { WorktreeBasePicker } from "../../workspace/ui/WorkspacePicker";

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const branches = [
  ...Array.from({ length: 40 }, (_, index) => ({
    name: `feature/${index}`,
    remote: null,
  })),
  { name: "main", remote: null },
  { name: "main", remote: "origin" },
  { name: "release", remote: "origin" },
];
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const menu = () =>
  document.querySelector<HTMLElement>('[aria-label="Worktree base branch"]')!;
const input = () => menu().querySelector<HTMLInputElement>("input")!;
const highlighted = () =>
  menu().querySelector<HTMLButtonElement>('[data-highlighted="true"]')!;

function render(selected = "main") {
  act(() =>
    root.render(
      createElement(WorktreeBasePicker, {
        branches,
        selected,
        enabled: true,
        loading: false,
        onChange,
      }),
    ),
  );
  act(() => trigger().click());
}

function key(value: string) {
  act(() =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

function query(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function frame() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
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
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  document.documentElement.dataset.skin = "midnight";
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.documentElement.dataset.skin;
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens the desktop base picker at its selected branch after popover placement", async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  render("origin/main");
  const selected = highlighted();
  expect(selected.textContent).toBe("origin/main");
  expect(selected.getAttribute("aria-selected")).toBe("true");
  expect(menu().parentElement!.style.width).toBe("320px");
  expect(menu().parentElement!.style.maxHeight).toBe("360px");
  expect(input().placeholder).toBe("Search branches…");
  expect(input().getAttribute("aria-label")).toBe("Search base branches");
  expect(scroll).not.toHaveBeenCalled();

  await frame();
  expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
  expect(scroll.mock.contexts.at(-1)).toBe(selected);
  expect(menu().parentElement!.style.visibility).not.toBe("hidden");
  expect(document.activeElement).toBe(input());
});

it("scrolls keyboard navigation and confirms a remote base without losing its remote name", async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  render();
  await frame();
  key("ArrowDown");
  expect(highlighted().textContent).toBe("origin/main");
  await frame();
  expect(scroll.mock.contexts.at(-1)).toBe(highlighted());

  key("Enter");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("origin/main");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("resets filtering to the first result and restores the selected base when cleared or reopened", async () => {
  render();
  query("origin/");
  expect(highlighted().textContent).toBe("origin/main");
  key("ArrowDown");
  expect(highlighted().textContent).toBe("origin/release");
  query("");
  expect(highlighted().textContent).toBe("main");
  key("ArrowUp");
  expect(highlighted().textContent).toBe("feature/39");
  act(() => trigger().click());
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  act(() => trigger().click());
  expect(highlighted().textContent).toBe("main");
  await frame();
  expect(document.activeElement).toBe(input());
});

it("preserves the mobile base picker dimensions, search, and initial keyboard row", async () => {
  delete document.documentElement.dataset.skin;
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  render();
  expect(menu().parentElement!.style.width).toBe("280px");
  expect(menu().parentElement!.style.maxHeight).toBe("280px");
  expect(input().placeholder).toBe("Search base branches…");
  expect(highlighted().textContent).toBe("feature/0");
  await frame();
  expect(scroll).not.toHaveBeenCalled();
  key("ArrowDown");
  key("Enter");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("feature/1");
});
