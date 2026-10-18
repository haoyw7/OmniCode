// @vitest-environment happy-dom
import { act, createElement, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { startMotionClock, stopMotionClock, motionFrame } from "../../../../tests/helpers/sharedMotionClock";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { applyReducedMotion } from "../../../shared/lib/reducedMotion";

let container: HTMLDivElement;
let root: Root;
let observers: Array<{
  targets: Element[];
  resize: (entries?: unknown[]) => void;
}>;
let endObservers: Array<{
  targets: Element[];
  intersect: () => void;
  margin?: string;
}>;

function dragScrollbar(el: HTMLElement, move: () => void) {
  el.dispatchEvent(new PointerEvent("pointerdown", { button: 0 }));
  move();
  el.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
}

beforeEach(() => {
  // Follow-state assertions use immediate motion; curve cases opt in below.
  applyReducedMotion("on");
  startMotionClock();
  observers = [];
  endObservers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(readonly resize: (entries?: unknown[]) => void) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets = [];
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      targets: Element[] = [];
      margin?: string;
      constructor(readonly intersect: () => void, options?: IntersectionObserverInit) {
        this.margin = options?.rootMargin;
        endObservers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets = [];
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  applyReducedMotion("system");
  vi.unstubAllGlobals();
});

describe("subagent scrolling", () => {
  it("follows growing content to the bottom with only one live scroll window", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Investigate auth" },
      {
        id: "spawn",
        role: "tool",
        text: "Auth review",
        tool: { callId: "spawn", kind: "agent", status: "in_progress" },
        agentRun: {
          name: "Auth review",
          steps: [
            { id: "intro", kind: "message", text: "Inspecting files." },
            ...Array.from({ length: 8 }, (_, index) => ({
              id: `step-${index}`,
              kind: "tool" as const,
              text: `Read file-${index}.ts`,
              toolKind: "read",
              status: "completed",
            })),
            {
              id: "last",
              kind: "tool",
              text: "Run check",
              toolKind: "shell",
              status: "failed",
              preview: {
                kind: "read",
                output: "Last line of output",
                contentOnly: true,
              },
            },
          ],
        },
      },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Auth review\'s work"]',
    );
    expect(button).not.toBeNull();
    act(() => button!.click());
    const scroller =
      container.querySelector<HTMLDivElement>(".zen-phase-live")!;
    expect(scroller).not.toBeNull();
    expect(scroller.parentElement?.closest(".zen-phase-live")).toBeNull();
    let height = 600;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 280 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - 280));
        },
      },
    });
    const observer = observers.find((item) =>
      item.targets.includes(scroller.firstElementChild!),
    )!;
    expect(observer).toBeDefined();
    act(() => observer.resize());
    expect(top).toBe(320);
    // A row expansion or a markdown layout change resizes this inner body.
    height = 900;
    act(() => observer.resize());
    expect(top).toBe(620);
    // Reading older work must pause automatic following.
    act(() =>
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 })),
    );
    top = 300;
    height = 1000;
    act(() => observer.resize());
    expect(top).toBe(300);

    act(() => {
      top = 820;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1140;
    act(() => observer.resize());
    expect(top).toBe(860);

    // A resize can precede the scroll event from a manual upward move.
    top = 856;
    height = 1180;
    act(() => observer.resize());
    expect(top).toBe(856);

    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
      top = 900;
      scroller.dispatchEvent(new Event("scroll"));
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      top = 896;
      scroller.dispatchEvent(new Event("scroll"));
      top = 898;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1220;
    act(() => observer.resize());
    expect(top).toBe(898);
  });
});

describe("transcript scrolling", () => {
  it.each([false, true].flatMap(touchScroll => [false, true].map(reduced => ({ touchScroll, reduced }))))(
    "holds the reading position when toggling settled work (touch=$touchScroll, reduced=$reduced)",
    ({ touchScroll, reduced }) => {
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Run checks" },
        ...["one", "two"].map((id): Block => ({
          id, role: "tool", text: `Run ${id}`,
          tool: { callId: id, kind: "shell", status: "completed" },
        })),
        { id: "reply", role: "assistant", text: "Checks passed." },
      ];
      let jump: () => void = () => {};
      const showJump = vi.fn();
      act(() => root.render(createElement(AgentTranscript, {
        blocks, busy: false, touchScroll,
        onJumpToBottomReady: value => { jump = value; },
        onJumpToBottomChange: showJump,
      })));
      const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
      const end = scroller.querySelector<HTMLElement>("[data-transcript-end]")!;
      let height = 1000;
      let top = 0;
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => height },
        clientHeight: { get: () => 400 },
        scrollTop: {
          get: () => top,
          set: (value: number) => { top = Math.max(0, Math.min(value, height - 400)); },
        },
      });
      scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      end.getBoundingClientRect = () => ({ top: height - top }) as DOMRect;
      const resize = () => {
        for (const observer of [...observers])
          if (observer.targets.includes(scroller)) observer.resize();
      };
      act(resize);
      expect(top).toBe(600);
      act(() => applyReducedMotion(reduced ? "on" : "off"));

      // Late layout can already be gliding when the reader opens the work.
      height = 1040;
      act(resize);
      const readingTop = top;
      const fold = container.querySelector<HTMLButtonElement>(".desktop-work-fold-line")!;
      expect(fold.textContent).toContain("Ran 2 commands");
      act(() => fold.click());
      expect(fold.getAttribute("aria-expanded")).toBe("true");
      expect(scroller.dataset.followLatest).toBe("false");
      // Repeated animation and late-content resize frames must not repin.
      for (let frame = 0; frame < 40; frame++) {
        height += 10;
        act(resize);
        motionFrame();
        expect(top).toBe(readingTop);
      }
      expect(showJump).toHaveBeenLastCalledWith(true);

      // Rapid close/open keeps the same reading intent.
      act(() => fold.click());
      height -= 100;
      act(resize);
      act(() => fold.click());
      height += 100;
      act(resize);
      expect(top).toBe(readingTop);

      // Explicit return to the bottom restores normal following.
      act(() => applyReducedMotion("on"));
      act(() => jump());
      expect(top).toBe(height - 400);
      height += 100;
      act(resize);
      expect(top).toBe(height - 400);
      expect(scroller.dataset.followLatest).toBe("true");

      // Closing from the bottom may clamp, but must not resume on its own.
      act(() => fold.click());
      height = 1040;
      top = height - 400;
      act(() => { resize(); scroller.dispatchEvent(new Event("scroll")); });
      height += 100;
      act(resize);
      expect(top).toBe(640);
      expect(scroller.dataset.followLatest).toBe("false");
      act(() => {
        top = height - 400;
        scroller.dispatchEvent(new Event("scroll"));
      });
      height += 100;
      act(resize);
      expect(top).toBe(height - 400);
      expect(scroller.dataset.followLatest).toBe("true");
    },
  );

  it.each([false, true])("uses a bounded main-agent activity window only for sheet clients (sheet=%s)", (sheet) => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Investigate auth" },
      { id: "thinking", role: "reasoning", text: "Inspecting the implementation" },
      ...Array.from({ length: 20 }, (_, index): Block => ({
        id: `tool-${index}`, role: "tool", text: `Read file-${index}.ts`,
        tool: { callId: `tool-${index}`, kind: "read", status: "completed" },
      })),
    ];
    function Fixture() {
      const platform = useContext(TranscriptPlatformContext);
      return createElement(TranscriptPlatformContext.Provider, {
        value: { ...platform, openActivity: sheet ? () => {} : undefined },
      }, createElement(AgentTranscript, { blocks, busy: true }));
    }
    act(() => root.render(createElement(Fixture)));
    expect(container.querySelectorAll(".zen-phase-step")).toHaveLength(21);
    expect(container.querySelectorAll(".zen-phase-live")).toHaveLength(sheet ? 1 : 0);
  });

  it.each([true, false])(
    "hides the jump while the content end is above the composer without resuming following (touch=%s)",
    (touchScroll) => {
      const showJump = vi.fn();
      act(() => root.render(createElement(AgentTranscript, {
        blocks: [
          { id: "user", role: "user", text: "Explain" },
          { id: "reply", role: "assistant", text: "Short answer" },
        ],
        busy: true,
        touchScroll,
        onJumpToBottomChange: showJump,
      })));
      const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
      const end = scroller.querySelector<HTMLElement>("[data-transcript-end]")!;
      scroller.style.scrollPaddingTop = "80px";
      scroller.style.scrollPaddingBottom = "100px";
      let top = 0;
      let contentEnd = 830;
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => 1000 },
        clientHeight: { get: () => 400 },
        scrollTop: {
          get: () => top,
          set: (value: number) => { top = Math.max(0, Math.min(value, 600)); },
        },
      });
      scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      end.getBoundingClientRect = () => ({ top: contentEnd - top }) as DOMRect;
      const observer = observers.find((item) => item.targets.includes(scroller))!;
      act(() => observer.resize());
      expect(top).toBe(600);

      // Reading intent changes immediately, but the latest answer is still visible.
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
        top = 550;
        scroller.dispatchEvent(new Event("scroll"));
      });
      expect(showJump).toHaveBeenLastCalledWith(false);
      act(() => observer.resize());
      expect(top).toBe(550);

      // The anchored turn's outer size is unchanged as its reply grows.
      contentEnd = 860;
      let endObserver = endObservers.find((item) => item.targets.includes(end))!;
      expect(endObserver.margin).toBe("-80px 0px -100px 0px");
      act(() => endObserver.intersect());
      expect(showJump).toHaveBeenLastCalledWith(true);

      act(() => {
        top = 558;
        scroller.dispatchEvent(new Event("scroll"));
      });
      expect(showJump).toHaveBeenLastCalledWith(true);
      act(() => {
        // A fold makes the answer visible again while the reader remains unpinned.
        contentEnd = 830;
        endObserver.intersect();
      });
      expect(showJump).toHaveBeenLastCalledWith(false);

      // Expanding the dock occludes the end; collapsing it reveals it again.
      scroller.style.scrollPaddingBottom = "150px";
      act(() => observer.resize());
      expect(showJump).toHaveBeenLastCalledWith(true);
      expect(top).toBe(558);
      endObserver = endObservers.find((item) => item.targets.includes(end))!;
      expect(endObserver.margin).toBe("-80px 0px -150px 0px");
      scroller.style.scrollPaddingBottom = "100px";
      act(() => observer.resize());
      expect(showJump).toHaveBeenLastCalledWith(false);
    },
  );
  it("reserves the floating header inset when stretching the latest turn, including keyboard resizing", () => {
    act(() => root.render(createElement(AgentTranscript, {
      blocks: [{ id: "new-prompt", role: "user", text: "Next question" }],
      busy: true,
    })));
    const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
    const inner = scroller.firstElementChild as HTMLElement;
    scroller.style.scrollPaddingTop = "116px";
    inner.style.paddingBottom = "32px";
    let viewport = 600;
    Object.defineProperties(scroller, {
      clientHeight: { get: () => viewport },
      scrollHeight: { get: () => 1000 },
    });
    const observer = observers.find((item) => item.targets.includes(scroller))!;
    const anchor = () =>
      scroller.querySelector<HTMLElement>(".transcript-turn-anchor")!;
    act(() => observer.resize());
    expect(anchor().style.minHeight).toBe("452px");
    viewport = 300;
    act(() => observer.resize());
    expect(anchor().style.minHeight).toBe("152px");
    // Ordinary panes without a floating header retain their full anchoring area.
    scroller.style.scrollPaddingTop = "0px";
    act(() => observer.resize());
    expect(anchor().style.minHeight).toBe("268px");
    // The stretch lives on the turn, not as a property every node inherits.
    expect(scroller.style.getPropertyValue("--transcript-viewport")).toBe("");
  });
  it("follows streamed layout growth on mobile, pauses for a touch up, and resumes at the bottom", () => {
    const showJump = vi.fn();
    const ready = vi.fn();
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: [
            { id: "user", role: "user", text: "Explain" },
            { id: "reply", role: "assistant", text: "Answer" },
          ],
          busy: true,
          touchScroll: true,
          onJumpToBottomChange: showJump,
          onJumpToBottomReady: ready,
        }),
      ),
    );
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 1000;
    let viewport = 400;
    let top = 0;
    // This stream reaches the real end, with no trailing anchored blank space.
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scroller.querySelector<HTMLElement>("[data-transcript-end]")!
      .getBoundingClientRect = () => ({ top: height - top }) as DOMRect;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => viewport },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - viewport));
        },
      },
    });
    const observer = { resize: () => {
      // Native resize delivery reaches both following and Motion retargeting.
      for (const item of [...observers]) if (item.targets.includes(scroller)) item.resize();
    } };
    act(() => observer.resize());
    expect(top).toBe(600);
    // A paced Markdown render grows independently of the Host snapshot.
    height = 1080;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    act(() => observer.resize());
    expect(top).toBe(680);
    const touch = (type: string, y: number) => {
      const event = new Event(type);
      Object.defineProperty(event, "touches", { value: [{ clientY: y }] });
      scroller.dispatchEvent(event);
    };
    act(() => {
      touch("touchstart", 100);
      touch("touchmove", 130);
      top = 676;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1160;
    act(() => observer.resize());
    expect(top).toBe(676);
    expect(showJump).toHaveBeenLastCalledWith(true);
    act(() => {
      touch("touchmove", 80);
      top = 760;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1200;
    act(() => observer.resize());
    expect(top).toBe(800);
    // Opening the keyboard changes viewport height, not reading intent.
    viewport = 250;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    act(() => observer.resize());
    expect(top).toBe(950);
    act(() => {
      touch("touchmove", 150);
      top = 500;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    applyReducedMotion("off");
    startMotionClock();
    act(() => ready.mock.calls[0][0]());
    expect(showJump).toHaveBeenLastCalledWith(false);
    // Register the glide observer after the current resize delivery, avoiding
    // WebKit's ancestor-observation loop while still starting motion now.
    const glideObserver = observers.at(-1)!;
    expect(glideObserver.targets).toHaveLength(0);
    act(() => frames.shift()!(16));
    expect(glideObserver.targets).toContain(scroller);
    // The jump glides instead of snapping, and streamed growth during the
    // glide does not cut it short.
    act(() => motionFrame(100));
    expect(top).toBeGreaterThan(500);
    expect(top).toBeLessThan(950);
    height = 1300;
    act(() => observer.resize());
    expect(top).toBeLessThan(950);
    for (let time = 116; time <= 1200; time += 16)
      act(() => motionFrame(16));
    expect(top).toBe(1050);
    expect(frames).toHaveLength(0);
    expect(showJump).toHaveBeenLastCalledWith(false);
  });
  it.each([true, false].flatMap(mobile => ["first output", "large reply", "completed reply", "reduced motion", "late burst", "continuous stream", "rapid stream", "stalled frame"].map(scenario => ({ mobile, scenario }))))("follows $scenario on mobile=$mobile with a continuous curve", ({ mobile, scenario }) => {
    applyReducedMotion("off");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    startMotionClock();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const tick = (time: number) => act(() => {
      const elapsed = time - now;
      now = time;
      motionFrame(elapsed);
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(now));
    });
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Explain" },
      { id: "reply", role: "assistant", text: "Answer" },
    ];
    const render = (busy: boolean) => act(() => root.render(createElement(AgentTranscript, {
      blocks, busy, touchScroll: mobile, promptMotion: mobile ? "mobile" : undefined,
    })));
    render(true);
    const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 1000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      scrollTop: {
        get: () => top,
        set: (value: number) => { top = Math.max(0, Math.min(value, height - 400)); },
      },
    });
    expect(observers.some(item => item.targets.includes(scroller))).toBe(true);
    const observer = { resize: () => {
      // A real resize notifies the follow observer and Motion's retarget observer.
      for (const item of [...observers]) if (item.targets.includes(scroller)) item.resize();
    } };
    act(() => observer.resize());
    expect(top).toBe(600);
    if (scenario === "reduced motion") applyReducedMotion("on");
    now = 50; // The first response can arrive well before the old 600ms cutoff.
    height += scenario === "large reply" ? 800 : 80;
    if (scenario === "completed reply") render(false);
    else act(() => observer.resize());
    if (scenario === "reduced motion") {
      expect(top).toBe(height - 400);
      return;
    }
    expect(top).toBe(600);
    tick(100);
    expect(top).toBeGreaterThan(600);
    expect(top).toBeLessThan(height - 400);
    let previous = top;
    for (let time = 116; time <= 1100; time += 16) {
      const burst = scenario === "late burst" && time === 244;
      if (burst || (["continuous stream", "rapid stream"].includes(scenario) && time < 700)) {
        height += burst ? 500 : scenario === "rapid stream" ? 48 : 12;
        act(() => observer.resize());
        expect(top).toBe(previous);
      }
      tick(time);
      expect(top).toBeGreaterThanOrEqual(previous);
      // Retargeted Motion springs move toward a burst without jumping its full height.
      if (burst) expect(top - previous).toBeLessThan(500);
      // Large replies must still catch up promptly rather than crawl at a fixed speed.
      if (time === 644 && scenario === "large reply") expect(top).toBe(height - 400);
      // Sustained fast output increases tracking speed instead of accumulating
      // the roughly 330px lag of the base curve at this input rate.
      if (time === 644 && scenario === "rapid stream") expect(height - 400 - top).toBeLessThan(260);
      previous = top;
    }
    if (scenario === "stalled frame") {
      height += 500;
      act(() => observer.resize());
      tick(4000);
      // Motion resolves a spring after a suspended frame at the current destination.
      expect(top).toBe(height - 400);
    }
    for (let time = now + 16, end = now + 1200; time < end; time += 16) tick(time);
    expect(top).toBe(height - 400);
    // A reader can interrupt the next automatic movement and keep their place.
    height += 80;
    act(() => observer.resize());
    tick(now + 50);
    act(() => {
      const touch = new Event("touchstart");
      Object.defineProperty(touch, "touches", { value: [{ clientY: 100 }] });
      scroller.dispatchEvent(touch);
    });
    const stopped = top;
    tick(now + 500);
    expect(top).toBe(stopped);
  });

  it.each([false, true].flatMap(streaming => [false, true].map(widthReflow => ({ streaming, widthReflow }))))("pins viewport reflow before paint (width=$widthReflow, stream glide=$streaming)", ({ streaming, widthReflow }) => {
    applyReducedMotion("off");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    startMotionClock();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const tick = (time: number) => act(() => {
      const elapsed = time - now;
      now = time;
      motionFrame(elapsed);
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(now));
    });
    act(() => root.render(createElement(AgentTranscript, {
      blocks: [
        { id: "user", role: "user", text: "Explain" },
        { id: "reply", role: "assistant", text: "Answer" },
      ],
      busy: true,
      touchScroll: true,
      promptMotion: widthReflow ? undefined : "mobile",
    })));
    const scroller = container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 1000;
    let viewport = 500;
    let width = 850;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => viewport },
      clientWidth: { get: () => width },
      scrollTop: {
        get: () => top,
        set: (value: number) => { top = Math.max(0, Math.min(value, height - viewport)); },
      },
    });
    expect(observers.some(item => item.targets.includes(scroller))).toBe(true);
    const observer = { resize: () => {
      // A real resize notifies the follow observer and Motion's retarget observer.
      for (const item of [...observers]) if (item.targets.includes(scroller)) item.resize();
    } };
    act(() => observer.resize());
    expect(top).toBe(500);
    now = 1000;
    if (streaming) {
      height += 60;
      act(() => observer.resize());
      tick(1030);
      expect(top).toBeGreaterThan(500);
      expect(top).toBeLessThan(560);
    }
    if (widthReflow) { width = 420; height += 200; }
    else viewport = 300;
    // A scroll event can arrive before ResizeObserver reports the new size.
    act(() => scroller.dispatchEvent(new Event("scroll")));
    act(() => observer.resize());
    expect(top).toBe(height - viewport);
    tick(1100);
    expect(top).toBe(height - viewport);
    if (widthReflow) { width = 850; height -= 200; }
    else viewport = 500;
    act(() => observer.resize());
    expect(top).toBe(height - viewport);
    // Fresh stream growth still glides once the viewport has settled.
    height += 50;
    act(() => observer.resize());
    expect(top).toBe(height - viewport - 50);
    tick(1150);
    expect(top).toBeGreaterThan(height - viewport - 50);
    expect(top).toBeLessThan(height - viewport);
    for (let time = 1166; time < 2000; time += 16) tick(time);
    expect(top).toBe(height - viewport);
    // A viewport resize while reading history must keep that position.
    act(() => {
      const touch = new Event("touchstart");
      Object.defineProperty(touch, "touches", { value: [{ clientY: 100 }] });
      scroller.dispatchEvent(touch);
      top -= 200;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const readingTop = top;
    if (widthReflow) { width = 420; height += 200; }
    else viewport = 300;
    act(() => observer.resize());
    expect(top).toBe(readingTop);
  });
  it("lets a wheel up inside the bottom margin leave a streaming reply", () => {
    const blocks = (text: string): Block[] => [
      { id: "user", role: "user", text: "Explain auth" },
      { id: "reply", role: "assistant", text },
    ];
    act(() =>
      root.render(
        createElement(AgentTranscript, { blocks: blocks("One"), busy: true }),
      ),
    );
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 1000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - 400));
        },
      },
    });
    const observer = observers.find((item) => item.targets.includes(scroller))!;
    act(() => observer.resize());
    expect(top).toBe(600);

    // A trackpad's first ticks move only a few pixels.
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      top = 596;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1040;
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: blocks("One\n\nTwo"),
          busy: true,
        }),
      ),
    );
    act(() => observer.resize());
    expect(top).toBe(596);

    // Scrolling back down to the end follows the stream again.
    act(() => {
      top = 640;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1080;
    act(() => observer.resize());
    expect(top).toBe(680);
  });

  it("holds the reader's place when a turn above the view lays out", () => {
    const blocks: Block[] = Array.from({ length: 3 }, (_, index) => [
      { id: `user-${index}`, role: "user" as const, text: `Question ${index}` },
      { id: `reply-${index}`, role: "assistant" as const, text: "Answer" },
    ]).flat();
    act(() => root.render(createElement(AgentTranscript, { blocks })));
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 3000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - 400));
        },
      },
    });
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      top = 1000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const [above, reading] = scroller.querySelectorAll(".transcript-turn");
    const observer = observers.find((item) => item.targets.includes(above))!;
    expect(observer).toBeDefined();
    above.getBoundingClientRect = () => ({ top: -800 }) as DOMRect;
    let readingTop = -100;
    reading.getBoundingClientRect = () => ({ top: readingTop }) as DOMRect;
    const size = (target: Element, blockSize: number) => ({
      target,
      borderBoxSize: [{ blockSize }],
      contentRect: { height: blockSize },
    });
    // Remember the laid-out sizes before late content arrives.
    act(() => observer.resize([size(above, 240), size(reading, 240)]));
    expect(top).toBe(1000);

    // Late content changes both turns. Only the turn wholly above the view
    // moves the reader; the on-screen turn grows below the reading position.
    height = 4420;
    readingTop += 900 - 240;
    act(() => observer.resize([size(above, 900), size(reading, 1000)]));
    expect(top).toBe(1660);
  });

  it.each([[0, false], [-80, false], [-800, false], [500, false], [0, true]] as const)(
    "holds a prepended boundary through its first resize delivery without cancelling user scroll (%s px, reveal=%s)",
    (userScroll, revealInserted) => {
      const blocks: Block[] = Array.from({ length: 41 }, (_, index) => [
        { id: `user-${index}`, role: "user" as const, text: `Question ${index}` },
        { id: `reply-${index}`, role: "assistant" as const, text: "Answer" },
      ]).flat();
      let scroller: HTMLDivElement;
      let reveal: ((id: string) => boolean) | undefined;
      let top = 0;
      const heights = new Map<string, number>();
      const turns = () => [...scroller.querySelectorAll<HTMLElement>(".transcript-turn")];
      const height = (turn: HTMLElement) => heights.get(turn.dataset.transcriptTurn!) ?? 100;
      const headerHeight = () =>
        scroller.querySelectorAll(".transcript-turn").length < 41 ? 60 : 0;
      const originalRect = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this === scroller) return new DOMRect(0, 0, 600, 400);
        if (this.classList.contains("transcript-turn")) {
          const preceding = turns().slice(0, turns().indexOf(this));
          return new DOMRect(0, headerHeight() + preceding.reduce((sum, turn) => sum + height(turn), 0) - top, 600, height(this));
        }
        return originalRect.call(this);
      });
      act(() => root.render(createElement(AgentTranscript, {
        blocks,
        onRevealReady: (callback) => { reveal = callback; },
        onScrollerChange: (el) => {
          if (!el) return;
          scroller = el;
          Object.defineProperties(el, {
            clientHeight: { get: () => 400 },
            scrollHeight: { get: () => headerHeight() + turns().reduce((sum, turn) => sum + height(turn), 0) },
            scrollTop: {
              get: () => top,
              set: (value: number) => { top = Math.max(0, Math.min(value, el.scrollHeight - 400)); },
            },
          });
        },
      })));
      expect(turns()).toHaveLength(20);
      const reading = turns()[0];
      const resize = observers.find((observer) =>
        observer.targets.some((target) => target.classList.contains("transcript-turn")),
      )!;
      const entry = (turn: HTMLElement) => ({
        target: turn, borderBoxSize: [{ blockSize: height(turn) }],
        contentRect: { height: height(turn) },
      });
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
        top = 0;
        scroller.dispatchEvent(new Event("scroll"));
        resize.resize(turns().map(entry));
      });
      const readingTop = reading.getBoundingClientRect().top;
      const button = [...scroller!.querySelectorAll("button")]
        .find((el) => el.textContent === "Load earlier messages")!;
      act(() => button.click());
      expect(turns()).toHaveLength(40);
      expect(reading.getBoundingClientRect().top).toBe(readingTop);

      if (userScroll) act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: userScroll }));
        top += userScroll;
        scroller.dispatchEvent(new Event("scroll"));
      });
      // The last inserted turn is partly visible in the old header's space.
      // It grows after the prepend layout effect, before its first RO entry.
      const inserted = turns().slice(0, 20);
      if (revealInserted) act(() => {
        // A search/outline reveal may find its target already rendered by
        // the preceding prepend, then align it before the first resize entry.
        expect(reveal?.("user-20")).toBe(true);
        top += inserted[19].getBoundingClientRect().top - 42;
        scroller.dispatchEvent(new Event("scroll"));
      });
      // A large upward gesture chooses an earlier inserted turn. A resize
      // below that new reading position must not pull the reader down again.
      const nowReading = revealInserted ? inserted[19] : Math.abs(userScroll) > 400
        ? turns().find((turn) => turn.getBoundingClientRect().top >= 0)!
        : reading;
      const expectedTop = nowReading.getBoundingClientRect().top;
      heights.set("user-20", 534.4);
      // A downward scroll can leave an old turn above the reader. Its own
      // late sizing still needs normal compensation in the handoff batch.
      if (userScroll > 400) heights.set(reading.dataset.transcriptTurn!, 200);
      const delivery = [...inserted.map(entry), entry(reading)];
      act(() => resize.resize(delivery));
      expect(nowReading.getBoundingClientRect().top).toBeCloseTo(expectedTop);
      const correctedTop = top;
      act(() => resize.resize(delivery));
      expect(top).toBe(correctedTop);
    },
  );
});

describe.each([false, true])(
  "transcript scroll stability (touch=%s)",
  (touchScroll) => {
    function mountScroller(promptMotion?: "mobile") {
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Explain auth" },
        { id: "reply", role: "assistant", text: "One", streaming: true },
      ];
      act(() =>
        root.render(
          createElement(AgentTranscript, { blocks, busy: true, touchScroll, promptMotion }),
        ),
      );
      const scroller =
        container.querySelector<HTMLDivElement>(".agent-transcript")!;
      const geometry = { height: 1000, viewport: 400, top: 0 };
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => geometry.height },
        clientHeight: { get: () => geometry.viewport },
        scrollTop: {
          configurable: true,
          get: () => geometry.top,
          set: (value: number) => {
            geometry.top = Math.max(
              0,
              Math.min(value, geometry.height - geometry.viewport),
            );
          },
        },
      });
      const observer = observers.find((item) =>
        item.targets.includes(scroller),
      )!;
      act(() => observer.resize());
      expect(geometry.top).toBe(600);
      return { scroller, geometry, observer, blocks };
    }

    it("holds following across directionless wheel events, then resumes after the gesture", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const { scroller, geometry, observer } = mountScroller();
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 }));
        geometry.height = 1100;
        observer.resize();
      });
      expect(geometry.top).toBe(600);

      act(() => {
        vi.advanceTimersByTime(100);
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 }));
        vi.advanceTimersByTime(100);
        observer.resize();
      });
      expect(geometry.top).toBe(600);
      act(() => vi.advanceTimersByTime(50));
      expect(geometry.top).toBe(700);
    });

    it("lets an upward gesture release the pin after its directionless opening", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const { scroller, geometry, observer } = mountScroller();
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 }));
        geometry.height = 1100;
        observer.resize();
        vi.advanceTimersByTime(50);
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        geometry.top = 596;
        scroller.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(100);
      });
      expect(geometry.top).toBe(596);
      geometry.height = 1200;
      act(() => observer.resize());
      expect(geometry.top).toBe(596);
    });

    it("keeps a small downward reversal near the end from resuming following", () => {
      const { scroller, geometry, observer } = mountScroller();
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        geometry.top = 590;
        scroller.dispatchEvent(new Event("scroll"));
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 2 }));
        geometry.top = 592;
        scroller.dispatchEvent(new Event("scroll"));
      });
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(592);
    });

    it.each([true, false])(
      "restores the reader's follow state after parking resets the offset (following=%s)",
      (following) => {
        const { scroller, geometry, blocks } = mountScroller();
        if (!following) {
          act(() => {
            scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
            geometry.top = 400;
            scroller.dispatchEvent(new Event("scroll"));
          });
        }
        act(() => root.render(createElement(AgentTranscript, {
          blocks, busy: true, touchScroll, visible: false, parked: true,
        })));
        geometry.top = 0;
        geometry.height = 1200;
        act(() => root.render(createElement(AgentTranscript, {
          blocks, busy: true, touchScroll, visible: true, parked: false,
        })));
        expect(geometry.top).toBe(following ? 800 : 600);
        act(() => scroller.dispatchEvent(new Event("scroll")));
        expect(geometry.top).toBe(following ? 800 : 600);
      },
    );

    // Touch input pauses following from touchmove before the scroll lands.
    it.runIf(!touchScroll).each(["resize", "stream update"])(
      "respects an upward move before its scroll event arrives during a %s",
      (change) => {
        const { scroller, geometry, observer, blocks } = mountScroller();
        // The browser moves first; a streaming commit or resize can run before
        // its asynchronous scroll event is dispatched.
        geometry.top = 560;
        geometry.height = 1100;
        act(() => {
          if (change === "resize") observer.resize();
          else
            root.render(
              createElement(AgentTranscript, {
                blocks: [blocks[0], { ...blocks[1], text: "One\n\nTwo" }],
                busy: true,
                touchScroll,
              }),
            );
        });
        expect(geometry.top).toBe(560);

        act(() => scroller.dispatchEvent(new Event("scroll")));
        geometry.height = 1200;
        act(() => observer.resize());
        expect(geometry.top).toBe(560);
      },
    );

    it("keeps following when a queued scroll event lands after content grows", () => {
      const { scroller, geometry, observer } = mountScroller();
      geometry.height = 1100;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      act(() => observer.resize());
      expect(geometry.top).toBe(700);
    });

    it.each(["scroll event", "resize", "stream update"])(
      "resumes after reaching the old bottom before a growing %s",
      (change) => {
        const { scroller, geometry, observer, blocks } = mountScroller();
        act(() => dragScrollbar(scroller, () => {
          geometry.top = 400;
        }));
        expect(scroller.dataset.followLatest).toBe("false");
        // Scrolling reaches the end, but output arrives before its event.
        geometry.top = 600;
        geometry.height = 1100;
        act(() => {
          if (change === "stream update") {
            root.render(createElement(AgentTranscript, {
              blocks: [blocks[0], { ...blocks[1], text: "One\n\nTwo" }],
              busy: true,
              touchScroll,
            }));
          } else {
            if (change === "scroll event")
              scroller.dispatchEvent(new Event("scroll"));
            observer.resize();
          }
        });
        expect(geometry.top).toBe(700);
        act(() => scroller.dispatchEvent(new Event("scroll")));
        geometry.height = 1200;
        act(() => observer.resize());
        expect(geometry.top).toBe(800);
      },
    );

    it("does not resume before reaching the old bottom during output growth", () => {
      const { scroller, geometry, observer } = mountScroller();
      act(() => dragScrollbar(scroller, () => {
        geometry.top = 400;
      }));
      geometry.top = 590;
      geometry.height = 1100;
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
        observer.resize();
      });
      expect(geometry.top).toBe(590);
    });

    it("pauses following for a scrollbar move inside the bottom margin", () => {
      const { scroller, geometry, observer } = mountScroller();
      act(() => dragScrollbar(scroller, () => { geometry.top = 596; }));
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(596);
    });

    it.runIf(touchScroll).each([false, true])("requires reading intent for unsolicited result scrolling on desktop, retaining mobile behavior (mobile=%s)", (mobile) => {
      const { scroller, geometry, observer } = mountScroller(mobile ? "mobile" : undefined);
      // A result replaces/reflows content while leaving the total height the
      // same. No wheel, touch, key or scrollbar gesture occurred.
      geometry.top = 560;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      expect(scroller.dataset.followLatest).toBe(String(!mobile));
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(mobile ? 560 : 700);
    });

    it("keeps following when a zoomed offset settles back by a sub-pixel", () => {
      const { scroller, geometry, observer } = mountScroller();
      geometry.top = 599.6;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(700);
    });

    it.each(["viewport grows", "content shrinks"])(
      "keeps following when the browser clamps to the bottom as %s",
      (change) => {
        const { scroller, geometry, observer } = mountScroller();
        if (change === "viewport grows") geometry.viewport = 440;
        else geometry.height = 960;
        geometry.top = 560;
        act(() => scroller.dispatchEvent(new Event("scroll")));
        act(() => observer.resize());
        geometry.viewport = 400;
        geometry.height = 1000;
        act(() => observer.resize());
        expect(geometry.top).toBe(600);
      },
    );

    it.each([true, false])("preserves following=%s when a folded tool's scroll clamp arrives after its resize", (following) => {
      const { scroller, geometry, observer } = mountScroller();
      if (!following) act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        geometry.top = 596;
        scroller.dispatchEvent(new Event("scroll"));
      });
      // A WebView can expose the new scroll range before its asynchronous
      // scroll offset catches up. Even the pin write can settle later.
      Object.defineProperty(scroller, "scrollTop", {
        configurable: true,
        get: () => geometry.top,
        set: () => {},
      });
      geometry.height = 960;
      act(() => observer.resize());
      Object.defineProperty(scroller, "scrollTop", {
        configurable: true,
        get: () => geometry.top,
        set: (value: number) => {
          geometry.top = Math.max(0, Math.min(value, geometry.height - geometry.viewport));
        },
      });
      geometry.top = 560;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      expect(scroller.dataset.followLatest).toBe(String(following));
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(following ? 700 : 560);
    });

    it("keeps following paused when a resize clamps a reader to the bottom", () => {
      const { scroller, geometry, observer } = mountScroller();
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        geometry.top = 596;
        scroller.dispatchEvent(new Event("scroll"));
      });
      geometry.viewport = 440;
      geometry.top = 560;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      act(() => observer.resize());
      geometry.viewport = 400;
      act(() => observer.resize());
      expect(geometry.top).toBe(560);
    });

    it("does not resume following when a paused wheel's queued pin event arrives", () => {
      const { scroller, geometry, observer } = mountScroller();
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        scroller.dispatchEvent(new Event("scroll"));
      });
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(600);
    });

    it("keeps following when a wheel gesture is consumed by a code scroller", () => {
      const { scroller, geometry, observer } = mountScroller();
      const code = document.createElement("pre");
      code.style.overflowY = "auto";
      Object.defineProperties(code, {
        scrollHeight: { value: 900 },
        clientHeight: { value: 200 },
        scrollTop: { value: 400, writable: true },
      });
      scroller.append(code);
      act(() =>
        code.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
        ),
      );
      geometry.height = 1100;
      act(() => observer.resize());
      expect(geometry.top).toBe(700);

      code.scrollTop = 0;
      act(() =>
        code.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
        ),
      );
      geometry.height = 1200;
      act(() => observer.resize());
      expect(geometry.top).toBe(700);
    });

    function mountAnchorScroller(height: number, startTop: number) {
      const blocks: Block[] = Array.from({ length: 3 }, (_, index) => [
        {
          id: `user-${index}`,
          role: "user" as const,
          text: `Question ${index}`,
        },
        { id: `reply-${index}`, role: "assistant" as const, text: "Answer" },
      ]).flat();
      act(() =>
        root.render(createElement(AgentTranscript, { blocks, touchScroll })),
      );
      const scroller =
        container.querySelector<HTMLDivElement>(".agent-transcript")!;
      const geometry = { height, top: startTop };
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => geometry.height },
        clientHeight: { get: () => 400 },
        scrollTop: {
          get: () => geometry.top,
          set: (value: number) => {
            geometry.top = Math.max(0, Math.min(value, geometry.height - 400));
          },
        },
      });
      act(() => {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
        scroller.dispatchEvent(new Event("scroll"));
      });
      const [first, second] = scroller.querySelectorAll(".transcript-turn");
      const observer = observers.find((item) => item.targets.includes(first))!;
      const size = (target: Element, blockSize: number) => ({
        target,
        borderBoxSize: [{ blockSize }],
        contentRect: { height: blockSize },
      });
      act(() => observer.resize([size(first, 240), size(second, 240)]));
      return { scroller, geometry, first, second, observer, size };
    }

    it("anchors multiple turns using their position before an out-of-order resize batch", () => {
      const { geometry, first, second, observer, size } = mountAnchorScroller(
        4000,
        1000,
      );
      first.getBoundingClientRect = () => ({ top: -1000 }) as DOMRect;
      second.getBoundingClientRect = () => ({ top: -90 }) as DOMRect;
      act(() => observer.resize([size(second, 500), size(first, 900)]));
      expect(geometry.top).toBe(1920);
    });

    it("does not mistake a programmatic anchor adjustment for a scroll toward the end", () => {
      const { scroller, geometry, first, observer, size } = mountAnchorScroller(
        2000,
        1328,
      );
      // A late turn expansion can fit inside the latest turn's reserved space,
      // leaving the overall transcript height unchanged.
      first.getBoundingClientRect = () => ({ top: -1000 }) as DOMRect;
      act(() => {
        scroller.dispatchEvent(new Event("touchend"));
        observer.resize([size(first, 500)]);
      });
      expect(geometry.top).toBe(1588);
      act(() => scroller.dispatchEvent(new Event("scroll")));
      geometry.height = 2100;
      const layoutObserver = observers.find((item) =>
        item.targets.includes(scroller),
      )!;
      act(() => layoutObserver.resize());
      expect(geometry.top).toBe(1588);
    });
  },
);
