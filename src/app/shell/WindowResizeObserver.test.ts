// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WindowResizeObserver } from "./WindowResizeObserver";
import { isPaneResizing } from "../../shared/lib/paneResize";

const environment = vi.hoisted(() => ({ tauri: true, linux: true, windows: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => environment.tauri }));
vi.mock("../../platform/tauri/platform", () => ({
  get IS_LINUX() { return environment.linux; },
  get IS_WIN() { return environment.windows; },
}));

afterEach(() => vi.unstubAllGlobals());

it.each(["Linux", "Windows", "browser"])(
  "schedules page resizing independently of resize handles in %s",
  (platform) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    environment.tauri = platform !== "browser";
    environment.linux = platform !== "Windows";
    environment.windows = platform === "Windows";
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(WindowResizeObserver)));
      window.dispatchEvent(new Event("resize"));
      expect(isPaneResizing()).toBe(environment.tauri);
      expect(container.childElementCount).toBe(0);
    } finally { act(() => root.unmount()); }
    expect(isPaneResizing()).toBe(false);
    expect(document.documentElement.classList.contains("is-native-window-resizing")).toBe(false);
    window.dispatchEvent(new Event("resize"));
    expect(isPaneResizing()).toBe(false);
  },
);
