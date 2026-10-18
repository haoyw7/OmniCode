// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelTransition } from "../../../shared/motion/tokens";
import { animate as motionAnimate } from "motion/react";
import { useComposerDockMotion } from "./useComposerDockMotion";

let container: HTMLDivElement;
let root: Root;
let motion: ReturnType<typeof useComposerDockMotion>;
vi.mock("motion/react", async (original) => ({ ...await original<typeof import("motion/react")>(), animate: vi.fn(() => ({ stop: vi.fn() })) }));
let reduce = false;

function Harness({ docked }: { docked: boolean }) {
  motion = useComposerDockMotion(docked);
  return docked
    ? createElement("div", { ref: motion.dockedRef, "data-slot": "docked" })
    : createElement("div", { ref: motion.centeredRef, "data-slot": "center" });
}

function render(docked: boolean) {
  act(() => root.render(createElement(Harness, { docked })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reduce = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.dataset.slot === "center"
          ? { top: 300, left: 100, width: 600 }
          : { top: 700, left: 50, width: 700 }
      ) as DOMRect;
    },
  );
  vi.mocked(motionAnimate).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useComposerDockMotion", () => {
  it("drops the composer straight down to the dock after a submit", () => {
    render(false);
    motion.captureLaunch();
    render(true);

    expect(motionAnimate).toHaveBeenCalledTimes(1);
    expect(motionAnimate).toHaveBeenLastCalledWith([container.firstElementChild], { x: [0, 0], y: [-400, 0] }, panelTransition);
  });

  it("does not animate when the composer docks without a submit", () => {
    render(false);
    render(true);

    expect(motionAnimate).not.toHaveBeenCalled();
  });

  it("respects reduced motion", () => {
    reduce = true;
    render(false);
    motion.captureLaunch();
    render(true);

    expect(motionAnimate).not.toHaveBeenCalled();
  });
});
