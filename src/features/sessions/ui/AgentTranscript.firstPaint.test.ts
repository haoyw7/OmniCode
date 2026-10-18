// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

vi.mock("../hooks/useTranscriptLayout", () => ({
  useTranscriptLayout: () => "full",
}));
vi.mock("../hooks/useTranscriptAnchor", () => ({
  useTranscriptAnchor: () => false,
}));

let container: HTMLDivElement;
let root: Root;

function conversation(turns: number): Block[] {
  return Array.from({ length: turns }, (_, index): Block[] => [
    { id: `u${index}`, role: "user", text: `Question ${index}` },
    { id: `a${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
}

function renderedTurns() {
  return container.querySelectorAll("[data-transcript-turn]").length;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("transcript first paint", () => {
  it("paints the latest turns first and builds the window after", async () => {
    flushSync(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: conversation(30),
          visible: true,
        }),
      ),
    );
    expect(renderedTurns()).toBe(3);

    await vi.waitFor(() => expect(renderedTurns()).toBe(20));
    expect(container.textContent).toContain("Load earlier messages");
  });

  it("stays pinned to the end while the window grows above it", async () => {
    let top = 0;
    let nudged = false;
    const onScrollerChange = (scroller: HTMLDivElement | null) => {
      if (!scroller) return;
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => renderedTurns() * 100 },
        clientHeight: { get: () => 100 },
        scrollTop: {
          get: () => {
            // Inserting the opening history can reset the browser's offset
            // before the queued event from the initial bottom pin arrives.
            if (renderedTurns() > 3 && !nudged) {
              top = 0;
              nudged = true;
            }
            return top;
          },
          set: (value: number) => {
            // Materialize any insertion reset before applying this write.
            void scroller.scrollTop;
            top = Math.max(0, Math.min(value, scroller.scrollHeight - 100));
          },
        },
      });
    };
    flushSync(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: conversation(30),
          visible: true,
          onScrollerChange,
        }),
      ),
    );
    const scroller = container.querySelector<HTMLElement>(".agent-transcript");
    if (!scroller) throw new Error("missing scroller");
    expect(top).toBe(200);

    await vi.waitFor(() => expect(renderedTurns()).toBe(20));
    expect(nudged).toBe(true);
    expect(scroller.scrollTop).toBe(1900);
  });

  it("shows every turn of a short chat at once", () => {
    flushSync(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: conversation(2),
          visible: true,
        }),
      ),
    );
    expect(renderedTurns()).toBe(2);
  });

  it("holds the bottom pin when the opening window grows during a directionless wheel gesture", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let top = 0;
    const onScrollerChange = (scroller: HTMLDivElement | null) => {
      if (!scroller) return;
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => renderedTurns() * 100 },
        clientHeight: { get: () => 100 },
        scrollTop: {
          get: () => top,
          set: (value: number) => {
            top = Math.max(0, Math.min(value, scroller.scrollHeight - 100));
          },
        },
      });
    };
    flushSync(() => root.render(createElement(AgentTranscript, {
      blocks: conversation(30),
      onScrollerChange,
    })));
    expect(renderedTurns()).toBe(3);
    expect(top).toBe(200);
    const scroller = container.querySelector<HTMLElement>(".agent-transcript")!;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await act(async () => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 }));
    });
    expect(renderedTurns()).toBe(20);
    expect(top).toBe(200);
    act(() => vi.advanceTimersByTime(150));
    // Releasing the hold follows the grown window with a glide, not a snap.
    for (let frame = 0; frame < 120 && top !== 1900; frame++)
      await act(async () => {
        vi.advanceTimersByTime(16);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    expect(top).toBe(1900);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  });
});
