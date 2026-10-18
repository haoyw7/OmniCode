// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../shared/i18n/language";
import { WindowDragBar } from "./WindowChrome";

const native = vi.hoisted(() => ({
  mac: false,
  linux: true,
  windows: false,
  startDragging: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../../platform/tauri/platform", async (original) => ({
  ...(await original<typeof import("../../platform/tauri/platform")>()),
  get IS_MAC() {
    return native.mac;
  },
  get IS_LINUX() {
    return native.linux;
  },
  get IS_WIN() {
    return native.windows;
  },
}));

let container: HTMLDivElement;
let root: Root;
const toggleSidebar = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  setUiLanguage("en");
  native.mac = false;
  native.linux = true;
  native.windows = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function render() {
  act(() =>
    root.render(createElement(WindowDragBar, { onTogglePanel: toggleSidebar })),
  );
}
function press(target: Element) {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
    clientX: 100,
    clientY: 24,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

it.each(["Linux", "Windows"])(
  "starts native dragging from the shared blank bar on %s",
  (platform) => {
    native.linux = platform === "Linux";
    native.windows = platform === "Windows";
    render();
    const bar = container.querySelector("[data-window-drag-bar]")!;
    expect(press(bar.querySelector(":scope > div")!).defaultPrevented).toBe(true);
    expect(native.startDragging).toHaveBeenCalledOnce();
    expect(press(bar.querySelector("[data-window-leading]")!).defaultPrevented).toBe(true);
    expect(native.startDragging).toHaveBeenCalledTimes(2);
  },
);

it("keeps navigation and native window controls clickable", () => {
  render();
  const sidebar = container.querySelector<HTMLButtonElement>(
    '[data-window-navigation] button[aria-label^="Toggle Sidebar"]',
  )!;
  const minimize = container.querySelector<HTMLButtonElement>(
    '[aria-label="Minimize window"]',
  )!;
  const productIcon = container.querySelector('[data-window-navigation] img[alt="MonoCode"]')!;
  expect(productIcon.parentElement?.nextElementSibling).toBe(sidebar);
  expect(press(sidebar.querySelector("svg")!).defaultPrevented).toBe(false);
  expect(press(minimize.querySelector("svg")!).defaultPrevented).toBe(false);
  act(() => {
    sidebar.click();
    minimize.click();
  });
  expect(toggleSidebar).toHaveBeenCalledOnce();
  expect(native.minimize).toHaveBeenCalledOnce();
  expect(native.startDragging).not.toHaveBeenCalled();
});

it("retains the macOS native drag region without duplicating traffic-light controls", () => {
  native.mac = true;
  native.linux = false;
  render();
  const bar = container.querySelector("[data-window-drag-bar]")!;
  expect(bar.getAttribute("data-tauri-drag-region")).toBe("deep");
  expect(container.querySelector('[aria-label="Window controls"]')).toBeNull();
  expect(press(bar).defaultPrevented).toBe(false);
  expect(native.startDragging).not.toHaveBeenCalled();
});
