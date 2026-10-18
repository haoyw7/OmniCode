// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { PromptOutline } from "./PromptOutline";
import { beginPaneResize } from "../../../shared/lib/paneResize";

let scope: HTMLDivElement;
let scroller: HTMLDivElement;
let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  frames = new Map();
  let frameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  scope = document.createElement("div");
  scroller = document.createElement("div");
  scroller.className = "agent-transcript";
  container = document.createElement("div");
  scope.append(scroller, container);
  document.body.append(scope);
  root = createRoot(container);
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 600, 400),
  );
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 3000 },
  });
  scroller.scrollTop = 500;
});

afterEach(() => {
  act(() => root.unmount());
  scope.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type PromptGeometry = {
  id: string;
  turn: [top: number, bottom: number];
  prompt: [top: number, bottom: number];
};

function mountOutline(geometry: PromptGeometry[]) {
  const inner = document.createElement("div");
  scroller.append(inner);
  const reads = geometry.map(({ id, turn, prompt }) => {
    const turnElement = document.createElement("div");
    turnElement.className = "transcript-turn";
    const anchor = document.createElement("div");
    anchor.dataset.promptAnchor = id;
    turnElement.append(anchor);
    inner.append(turnElement);
    return {
      turn: vi.spyOn(turnElement, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, turn[0], 600, turn[1] - turn[0]),
      ),
      prompt: vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, prompt[0], 600, prompt[1] - prompt[0]),
      ),
    };
  });
  const blocks: Block[] = geometry.map(({ id }) => ({
    id,
    role: "user",
    text: id,
  }));
  act(() => root.render(createElement(PromptOutline, {
    blocks,
    scope: { current: scope },
    scroller,
  })));
  flushFrame();
  return reads;
}

function flushFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

function activeId() {
  return container.querySelector<HTMLElement>(
    '[data-prompt-bar][aria-current="true"]',
  )?.dataset.promptBar;
}

describe("PromptOutline measurement", () => {
  it("defers queued and new geometry reads during resizing, then updates on release", () => {
    const reads = mountOutline([
      { id: "first", turn: [150, 400], prompt: [200, 240] },
      { id: "second", turn: [300, 600], prompt: [320, 360] },
    ]);
    expect(activeId()).toBe("first");
    const viewport = vi.mocked(scroller.getBoundingClientRect);
    viewport.mockClear();
    act(() => scroller.dispatchEvent(new Event("scroll")));
    const endResize = beginPaneResize();
    try {
      // A frame queued before pointerdown must not measure mid-drag either.
      flushFrame();
      reads[0].turn.mockReturnValue(new DOMRect(0, -500, 600, 250));
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
        scroller.dispatchEvent(new Event("scroll"));
      });
      flushFrame();
      expect(viewport).not.toHaveBeenCalled();
      expect(activeId()).toBe("first");
    } finally {
      endResize();
    }
    flushFrame();
    expect(viewport).toHaveBeenCalledOnce();
    expect(activeId()).toBe("second");
  });

  it("uses the actual prompt band and stops at the first visible prompt in DOM order", () => {
    const reads = mountOutline([
      // Its reply fills the viewport, but the prompt itself is above it.
      { id: "reply", turn: [0, 900], prompt: [0, 40] },
      // A sticky/transformed row can differ from the top of its turn.
      { id: "first-inside", turn: [40, 950], prompt: [300, 340] },
      // Being visually higher does not beat an earlier DOM-order match.
      { id: "later-inside", turn: [120, 500], prompt: [150, 190] },
      { id: "below", turn: [700, 900], prompt: [700, 740] },
    ]);

    expect(activeId()).toBe("first-inside");
    expect(reads[0].prompt).toHaveBeenCalledOnce();
    expect(reads[1].prompt).toHaveBeenCalledOnce();
    expect(reads[2].turn).not.toHaveBeenCalled();
    expect(reads[3].turn).not.toHaveBeenCalled();

    for (const read of reads) {
      read.turn.mockClear();
      read.prompt.mockClear();
    }
    // Scroll notifications still use the existing one-frame coalescing.
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
      scroller.dispatchEvent(new Event("scroll"));
    });
    flushFrame();
    expect(activeId()).toBe("first-inside");
    expect(reads[0].turn).toHaveBeenCalledOnce();
    expect(reads[1].turn).toHaveBeenCalledOnce();
    expect(reads[2].turn).not.toHaveBeenCalled();
  });

  it("continues past a below-viewport turn to find a later DOM-order match", () => {
    const reads = mountOutline([
      { id: "below-first", turn: [700, 900], prompt: [700, 740] },
      { id: "above", turn: [0, 60], prompt: [0, 40] },
      { id: "inside", turn: [180, 420], prompt: [200, 240] },
      { id: "unread", turn: [600, 850], prompt: [600, 640] },
    ]);

    expect(activeId()).toBe("inside");
    expect(reads[0].turn).toHaveBeenCalledOnce();
    expect(reads[1].turn).toHaveBeenCalledOnce();
    expect(reads[2].prompt).toHaveBeenCalledOnce();
    expect(reads[3].turn).not.toHaveBeenCalled();
  });

  it("keeps the last above-viewport fallback after scanning every non-monotonic band", () => {
    const reads = mountOutline([
      { id: "above-first", turn: [0, 80], prompt: [0, 40] },
      { id: "below", turn: [700, 900], prompt: [700, 740] },
      // A band ending exactly at the viewport top is above, not inside.
      { id: "last-above", turn: [-100, 100], prompt: [-100, -60] },
    ]);

    expect(activeId()).toBe("last-above");
    for (const read of reads) expect(read.turn).toHaveBeenCalledOnce();
  });

  it("keeps the near-bottom shortcut without reading any prompt geometry", () => {
    scroller.scrollTop = 2584;
    const reads = mountOutline([
      { id: "inside", turn: [150, 400], prompt: [200, 240] },
      { id: "last", turn: [700, 900], prompt: [700, 740] },
    ]);

    expect(activeId()).toBe("last");
    for (const read of reads) {
      expect(read.turn).not.toHaveBeenCalled();
      expect(read.prompt).not.toHaveBeenCalled();
    }
  });
});
