// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useQuickPickerMotion } from "./useQuickPickerMotion";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

type Picker = "model" | "project" | "commands" | null;
let root: Root;
let container: HTMLDivElement;
let notifyResize: () => void;
let reduced = false;
let sampledHeight: number | null = null;
function Harness({ picker }: { picker: Picker }) {
  const frame = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useQuickPickerMotion(frame, panel, picker);
  return createElement(
    "div",
    { ref: frame, "data-frame": "", "data-picker": picker ?? "" },
    picker
      ? createElement("div", { ref: panel, key: picker, "data-picker": picker })
      : null,
  );
}
function render(picker: Picker) {
  act(() => root.render(createElement(Harness, { picker })));
}

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const panelHeight =
        this.dataset.picker === "model"
          ? 400
          : this.dataset.picker === "project"
            ? 180
            : this.dataset.picker === "commands"
              ? 60
              : 0;
      return {
        height: this.hasAttribute("data-frame")
          ? (sampledHeight ?? 100 + panelHeight)
          : panelHeight,
      } as DOMRect;
    },
  );
  reduced = false;
  sampledHeight = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["model", "project", "commands"] as const)(
  "fits the native window when the %s picker changes size",
  (picker) => {
    render(null);
    render(picker);
    sampledHeight = 220;
    act(() => notifyResize());
    expect(invoke).toHaveBeenLastCalledWith("quick_composer_fit", { height: 220 });
    expect(container.querySelector<HTMLElement>("[data-frame]")?.style.height).toBe("");
  },
);
it("fits the latest picker when a resize arrives during switching", () => {
  render(null); render("model"); sampledHeight = 320;
  act(() => notifyResize());
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_fit", { height: 320 });
  sampledHeight = null; render("project"); act(() => notifyResize());
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_fit", { height: 280 });
});
it("fits immediately when reduced motion is enabled", () => {
  reduced = true; render(null); render("model"); act(() => notifyResize());
  expect(invoke).toHaveBeenLastCalledWith("quick_composer_fit", { height: 500 });
});
