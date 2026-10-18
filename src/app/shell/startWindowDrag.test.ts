// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startWindowDrag, windowDragRegion } from "./startWindowDrag";

const native = vi.hoisted(() => ({
  tauri: true,
  linux: true,
  windows: false,
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../../platform/tauri/platform", () => ({
  get IS_LINUX() {
    return native.linux;
  },
  get IS_WIN() {
    return native.windows;
  },
}));

let root: Root;
let container: HTMLDivElement;
let portal: HTMLDivElement;
let handled: boolean[];

function render(region = "deep") {
  act(() =>
    root.render(
      createElement(
        "div",
        {
          ...windowDragRegion(),
          "data-window-drag-region": region,
          onMouseDownCapture: (event) => handled.push(startWindowDrag(event)),
        },
        createElement("span", { "data-blank": "" }, "Window title"),
        createElement(
          "button",
          { "data-control": "" },
          createElement("svg", { "data-icon": "" }),
        ),
        createElement(
          "span",
          { "data-tauri-drag-region": "false", "data-disabled": "" },
          "Disabled",
        ),
        ...["input", "select", "textarea", "a", "div"].map((tag) =>
          createElement(tag, {
            key: tag,
            "data-other-control": tag,
            ...(tag === "a" ? { href: "#test" } : {}),
            ...(tag === "div" ? { contentEditable: true } : {}),
          }),
        ),
        createElement("span", { role: "tab", "data-role": "" }, "Tab"),
        createElement(
          "span",
          { tabIndex: 0, "data-tabindex": "" },
          "Focusable",
        ),
        createPortal(
          createElement("span", { "data-portal": "" }, "Portal"),
          portal,
        ),
      ),
    ),
  );
}

function press(selector = "[data-blank]", options: MouseEventInit = {}) {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
    clientX: 100,
    clientY: 24,
    ...options,
  });
  const target = document.querySelector(selector)!;
  act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.tauri = true;
  native.linux = true;
  native.windows = false;
  native.startDragging.mockReset().mockResolvedValue(undefined);
  native.toggleMaximize.mockReset().mockResolvedValue(undefined);
  handled = [];
  container = document.createElement("div");
  portal = document.createElement("div");
  document.body.append(container, portal);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  portal.remove();
  vi.unstubAllGlobals();
});

it.each(["Linux", "Windows"])(
  "starts immediately on %s even while the native command is pending",
  (platform) => {
    native.linux = platform === "Linux";
    native.windows = platform === "Windows";
    native.startDragging.mockReturnValue(new Promise(() => {}));
    render();
    const event = press();
    expect(native.startDragging).toHaveBeenCalledExactlyOnceWith();
    expect(handled).toEqual([true]);
    expect(event.defaultPrevented).toBe(true);
  },
);

it("stops the same press before a document drag listener can start it again", () => {
  render();
  const fallbackDrag = vi.fn();
  document.addEventListener("mousedown", fallbackDrag);
  try {
    press();
    expect(fallbackDrag).not.toHaveBeenCalled();
    expect(native.startDragging).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener("mousedown", fallbackDrag);
  }
});

it("does not turn a Linux edge resize into a move through either drag handler", () => {
  render();
  const fallback = vi.fn();
  document.addEventListener("mousedown", fallback);
  try {
    for (const [clientX, clientY] of [[2, 24], [100, 2], [window.innerWidth - 2, 24]]) {
      press("[data-blank]", { clientX, clientY });
    }
    expect(native.startDragging).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  } finally { document.removeEventListener("mousedown", fallback); }
});

it.each([{ detail: 0 }, { button: 1 }, { button: 2 }])(
  "ignores non-user clicks and non-primary buttons: %j",
  (options) => {
    render();
    const event = press(undefined, options);
    expect(handled).toEqual([false]);
    expect(event.defaultPrevented).toBe(false);
    expect(native.startDragging).not.toHaveBeenCalled();
  },
);

it.each(["browser", "macOS"])("does not take over in %s", (environment) => {
  if (environment === "browser") native.tauri = false;
  else native.linux = false;
  render();
  expect(press().defaultPrevented).toBe(false);
  expect(native.startDragging).not.toHaveBeenCalled();
});

it("preserves real controls, including SVG targets inside buttons and disabled drag descendants", () => {
  render();
  const selectors = [
    "[data-icon]",
    "[data-disabled]",
    "[data-role]",
    "[data-tabindex]",
    ...["input", "select", "textarea", "a", "div"].map(
      (tag) => `[data-other-control='${tag}']`,
    ),
  ];
  for (const selector of selectors)
    expect(press(selector).defaultPrevented).toBe(false);
  expect(handled).toEqual(selectors.map(() => false));
  expect(native.startDragging).not.toHaveBeenCalled();
});

it("ignores portal events that bubble through React but originate outside the drag region DOM", () => {
  render();
  expect(press("[data-portal]").defaultPrevented).toBe(false);
  expect(handled).toEqual([false]);
  expect(native.startDragging).not.toHaveBeenCalled();
});

it("only handles an explicitly declared app drag region", () => {
  render("true");
  expect(press().defaultPrevented).toBe(false);
  expect(native.startDragging).not.toHaveBeenCalled();
});

it("does not mistake a focusable pane outside the declared drag region for a header control", () => {
  container.tabIndex = 0;
  render();
  expect(press().defaultPrevented).toBe(true);
  expect(native.startDragging).toHaveBeenCalledOnce();
});

it("handles native rejection without leaving an unhandled promise", async () => {
  native.startDragging.mockRejectedValue(new Error("native move unavailable"));
  render();
  press();
  await act(async () => {});
  expect(native.startDragging).toHaveBeenCalledOnce();
});


it("declares a single gesture owner and delegates double-click maximization once", () => {
  render();
  const region = container.firstElementChild!;
  expect(region.getAttribute("data-tauri-drag-region")).toBe("false");
  const fallback = vi.fn();
  document.addEventListener("mousedown", fallback);
  try {
    expect(press(undefined, { detail: 2 }).defaultPrevented).toBe(true);
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
    expect(native.startDragging).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    press("[data-icon]", { detail: 2 });
    press(undefined, { detail: 2, clientX: 2 });
    expect(native.toggleMaximize).toHaveBeenCalledOnce();
  } finally { document.removeEventListener("mousedown", fallback); }
});
