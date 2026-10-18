// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { KEYBOARD_EVENT, installKeyboardMotion } from "./keyboardMotion";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { MobileSheet, type MobileSheetPoint } from "./MobileSheet";
import { backMobileSheet } from "./mobileSheetBack";
import * as popover from "../shared/lib/popover";
import { applyReducedMotion } from "../shared/lib/reducedMotion";

let root: Root;
let node: HTMLDivElement;
let trigger: HTMLButtonElement;
let frames: Map<number, FrameRequestCallback>;
let disposeKeyboard: (() => void) | undefined;
async function frame(milliseconds = 16) {
  await act(async () => {
    motionFrame(milliseconds);
    for (let i=0; i<4; i++) await Promise.resolve();
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(performance.now()));
  });
}
async function progress(milliseconds = 600) { for (let elapsed=0; elapsed<milliseconds; elapsed+=16) await frame(Math.min(16,milliseconds-elapsed)); }
beforeEach(() => {
  startMotionClock();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  trigger = document.createElement("button");
  document.body.append(node, trigger);
  root = createRoot(node);
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      return this.classList.contains("mobile-sheet")
        ? new DOMRect(0, 0, 220, 260)
        : new DOMRect(40, 200, 260, 44);
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  disposeKeyboard?.();
  disposeKeyboard = undefined;
  node.remove();
  stopMotionClock();
  trigger.remove();
  applyReducedMotion("system");
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function render(
  anchorPoint?: MobileSheetPoint,
  open = true,
  overlapAnchor = false,
  constrainWidthToAnchor = false,
) {
  act(() =>
    root.render(
      createElement(
        MobileSheet,
        {
          title: "Session actions",
          open,
          overlapAnchor,
          constrainWidthToAnchor,
          placement: "anchor",
          anchor: { current: trigger },
          anchorPoint,
          width: 220,
          align: anchorPoint ? "start" : "end",
          onClose: () => {},
        },
        "Actions",
      ),
    ),
  );
  return node.querySelector<HTMLElement>(".mobile-sheet")!;
}

it.each(["bottom", "anchor", "dialog"] as const)("settles a reduced-motion %s sheet by the first paint and removes it on close", async (placement) => {
  applyReducedMotion("on");
  const exited = vi.fn();
  const show = (open: boolean) => act(() => root.render(createElement(MobileSheet, {
    title: "Reduced sheet", placement, open, anchor: { current: trigger },
    onClose: () => {}, onExited: exited, children: "Content",
  })));
  show(false);
  show(true);
  await frame(0);
  const sheet = node.querySelector<HTMLElement>(".mobile-sheet")!;
  const backdrop = node.querySelector<HTMLElement>(".mobile-sheet-backdrop")!;
  expect(backdrop.dataset.foldState).toBe("open");
  expect(backdrop.style.opacity).toBe("");
  if (placement !== "anchor") expect(node.querySelector<HTMLElement>(".mobile-sheet-scrim")!.style.opacity).toBe("1");
  expect(sheet.style.transform).toBe(placement === "bottom" ? "none" : "scale(1)");
  if (placement !== "bottom") expect(sheet.style.opacity).toBe("1");
  show(false);
  expect(node.querySelector(".mobile-sheet")).toBeNull();
  expect(exited).toHaveBeenCalledOnce();
});

it("sends native Back only to the top sheet and skips it while closing", async () => {
  vi.useFakeTimers();
  const parent = vi.fn();
  const child = vi.fn();
  const show = (open: boolean) => act(() => root.render(createElement(MobileSheet, {
    title: "Parent", onClose: parent,
    children: createElement(MobileSheet, { title: "Child", open, onClose: child, children: "Details" }),
  })));
  show(true);
  act(() => { expect(backMobileSheet()).toBe(true); });
  expect(child).toHaveBeenCalledOnce();
  expect(parent).not.toHaveBeenCalled();
  show(false);
  expect(node.querySelector('[data-fold-state="closing"][inert]')).not.toBeNull();
  act(() => { expect(backMobileSheet()).toBe(true); });
  expect(parent).toHaveBeenCalledOnce();
  expect(child).toHaveBeenCalledOnce();
});

it("defers menu creation while closed and retains it through a reversible close", async () => {
  vi.useFakeTimers();
  const content = vi.fn(() => createElement("button", null, "Deferred action"));
  const show = (open: boolean) => act(() => root.render(createElement(MobileSheet, {
    title: "Actions", open, onClose: () => {}, children: content,
  })));
  show(false);
  show(false);
  expect(content).not.toHaveBeenCalled();
  show(true);
  await frame();
  const button = node.querySelector(".mobile-sheet-content button");
  expect(button?.textContent).toBe("Deferred action");
  show(false);
  expect(node.querySelector(".mobile-sheet-content button")).toBe(button);
  expect(node.querySelector<HTMLElement>(".mobile-sheet-backdrop")!.inert).toBe(true);
  show(true);
  await frame();
  expect(node.querySelector(".mobile-sheet-content button")).toBe(button);
  expect(node.querySelector<HTMLElement>(".mobile-sheet-backdrop")!.inert).toBe(false);
  show(false);
  await progress(1000);
  expect(node.querySelector(".mobile-sheet")).toBeNull();
  content.mockClear();
  show(false);
  expect(content).not.toHaveBeenCalled();
});

describe("mobile popover position", async () => {
  it("opens at the long-press coordinates instead of the conversation row edge", async () => {
    const sheet = render({ x: 72, y: 180 });
    expect(sheet.style.left).toBe("72px");
    expect(sheet.style.top).toBe("180px");
    expect(sheet.style.bottom).toBe("");
  });
  it("shifts left and opens above a press near the bottom right screen edge", async () => {
    const sheet = render({
      x: window.innerWidth - 5,
      y: window.innerHeight - 24,
    });
    expect(sheet.style.left).toBe(`${window.innerWidth - 220 - 16}px`);
    expect(sheet.style.bottom).toBe("24px");
    expect(sheet.style.top).toBe("");
  });
  it("keeps existing button-anchored popovers in their original position", async () => {
    const sheet = render();
    expect(sheet.style.left).toBe("80px");
    expect(sheet.style.top).toBe("252px");
  });
  it("animates to a composer's transform endpoint with one measurement, then corrects after layout settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    disposeKeyboard = installKeyboardMotion();
    const keyboard = (height: number, duration: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
      detail: { height, viewport: window.innerHeight, duration, easing: "linear" },
    })));
    keyboard(300, 0);
    const dock = document.createElement("div");
    dock.className = "mobile-composer-dock";
    node.appendChild(dock);
    dock.appendChild(trigger);
    const bounds = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 400, 44, 44));
    const sheet = render();
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(16, 132, 220, 260));
    const computedStyle = getComputedStyle;
    vi.stubGlobal("getComputedStyle", (element: Element) => element === dock
      ? { transform: "matrix(1, 0, 0, 1, 0, -300)" } : computedStyle(element));
    const transition = {
      transitionProperty: "transform", playState: "running", currentTime: 0, playbackRate: 1,
      effect: { getKeyframes: () => [{ transform: "translateY(-300px)" }, { transform: "translateY(0px)" }],
        getComputedTiming: () => ({ endTime: 200 }) },
    };
    dock.getAnimations = () => [transition] as unknown as Animation[];
    bounds.mockClear();
    keyboard(0, 200);
    expect(bounds).toHaveBeenCalledOnce();
    expect(sheet.style.bottom).toBe(`${window.innerHeight - 700 + 8}px`);
    for (const top of [480, 580, 680]) {
      bounds.mockReturnValue(new DOMRect(40, top, 44, 44));
      act(() => window.dispatchEvent(new Event("resize")));
      act(() => window.dispatchEvent(new Event("scroll")));
      await frame();
    }
    expect(bounds).toHaveBeenCalledOnce();
    transition.playState = "finished";
    bounds.mockReturnValue(new DOMRect(40, 704, 44, 44));
    await progress(200);
    await frame();
    expect(bounds).toHaveBeenCalledTimes(2);
    expect(sheet.style.bottom).toBe(`${window.innerHeight - 704 + 8}px`);

  });
  it("leaves point-anchored menus fixed when their originating button moves", async () => {

    const sheet = render({ x: 72, y: 180 });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 400, 44, 44));
    act(() => window.dispatchEvent(new Event("resize")));
    await frame();
    expect(sheet.style.left).toBe("72px");
    expect(sheet.style.top).toBe("180px");

  });
  it("overlaps a top title trigger at its exact top, including inside the usual popup padding", async () => {
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      new DOMRect(40, 10, 260, 44),
    );
    const sheet = render(undefined, true, true);
    expect(sheet.style.left).toBe("80px");
    expect(sheet.style.top).toBe("10px");
    expect(sheet.style.bottom).toBe("");
  });
  it("fits a narrow header trigger and recalculates the width when the viewport changes", async () => {
    const bounds = vi
      .spyOn(trigger, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(72, 10, 176, 48));
    const sheet = render(undefined, true, true, true);
    expect(sheet.style.width).toBe("176px");
    expect(sheet.style.left).toBe("72px");
    bounds.mockReturnValue(new DOMRect(72, 10, 296, 48));
    act(() => window.dispatchEvent(new Event("resize")));
    await frame();
    expect(sheet.style.width).toBe("220px");
    expect(sheet.style.left).toBe("148px");
    expect(sheet.style.top).toBe("10px");
  });
  it("returns keyboard focus to the conversation row after a point-anchored menu closes", async () => {
    const sheet = render({ x: 72, y: 180 });
    expect(document.activeElement).toBe(sheet);
    act(() => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });
  it("keeps a controlled popover inert until closing finishes and handles reversal", async () => {
    vi.useFakeTimers();
    render(undefined, false);
    expect(node.querySelector(".mobile-sheet")).toBeNull();
    const sheet = render(undefined, true);
    expect(
      sheet.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
    ).toBe("opening");
    expect(document.activeElement).toBe(sheet);
    render(undefined, false);
    expect(
      sheet.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
    ).toBe("closing");
    expect(sheet.closest(".mobile-sheet-backdrop")?.hasAttribute("inert")).toBe(
      true,
    );
    expect(document.activeElement).toBe(trigger);
    render(undefined, true);
    await progress(210);
    expect(node.querySelector(".mobile-sheet")).toBe(sheet);
    expect(
      sheet.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
    ).toBe("open");
    render(undefined, false);
    await progress(120);
    expect(node.querySelector(".mobile-sheet")).toBe(sheet);
    expect(
      sheet.closest(".mobile-sheet-backdrop")?.getAttribute("data-fold-state"),
    ).toBe("closing");
    await progress(100);
    expect(node.querySelector(".mobile-sheet")).toBeNull();
  });
  it("closes a controlled popover immediately with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    render(undefined, false);
    render(undefined, true);
    expect(
      node
        .querySelector(".mobile-sheet-backdrop")
        ?.getAttribute("data-fold-state"),
    ).toBe("open");
    render(undefined, false);
    expect(node.querySelector(".mobile-sheet")).toBeNull();
  });

  it("animates from the resolved anchor side and reverses from its Motion values", async () => {
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 700, 260, 44));
    render(undefined, false);
    const sheet = render(undefined, true);
    expect(sheet.dataset.anchorSide).toBe("top");
    expect(sheet.style.transformOrigin).toBe("right bottom");
    await progress(64);
    const partial = sheet.style.transform;
    render(undefined, false);
    expect(sheet.closest(".mobile-sheet-backdrop")?.hasAttribute("inert")).toBe(true);
    await progress(32);
    expect(sheet.style.transform).not.toBe(partial);
    render(undefined, true);
    expect(node.querySelector(".mobile-sheet")).toBe(sheet);
    await progress();
    expect(sheet.style.transform).toBe("scale(1)");
    expect(sheet.style.opacity).toBe("1");
    expect(sheet.closest<HTMLElement>(".mobile-sheet-backdrop")?.dataset.foldState).toBe("open");
  });

  it("keeps placement fixed while its visual bounds scale during opening", async () => {
    const sheet = render({ x: 72, y: 180 });
    const before = { left: sheet.style.left, top: sheet.style.top, maxHeight: sheet.style.maxHeight };
    Object.defineProperties(sheet, {
      offsetWidth: { value: 220 },
      offsetHeight: { value: 260 },
    });
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 213, 252));
    act(() => window.dispatchEvent(new Event("resize")));
    await frame();
    expect({ left: sheet.style.left, top: sheet.style.top, maxHeight: sheet.style.maxHeight }).toEqual(before);
  });
});


it("places keyboard motions only at their boundaries and cancels obsolete corrections on reversal", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  disposeKeyboard = installKeyboardMotion();
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  render();
  bounds.mockClear();
  const keyboard = (height: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 800, duration: 120, easing: "linear" },
  })));
  keyboard(300);
  expect(bounds).toHaveBeenCalledOnce();
  await progress(60);
  await frame();
  keyboard(0); // Reverse before the previous Motion completion.
  expect(bounds).toHaveBeenCalledTimes(2);
  await frame();
  await frame();
  await frame();
  expect(bounds).toHaveBeenCalledTimes(2);
  await progress(120);
  await frame();
  expect(bounds).toHaveBeenCalledTimes(3);

});

it("uses the shorter remaining native transition when a composer reverses", async () => {
  disposeKeyboard = installKeyboardMotion();
  const dock = document.createElement("div");
  dock.className = "mobile-composer-dock";
  node.appendChild(dock);
  dock.appendChild(trigger);
  const sheet = render();
  await progress(300);
  const computedStyle = getComputedStyle;
  vi.stubGlobal("getComputedStyle", (element: Element) => element === dock
    ? { transform: "matrix(1, 0, 0, 1, 0, -100)" } : computedStyle(element));
  dock.getAnimations = () => [{
    transitionProperty: "transform", playState: "running", currentTime: 10, playbackRate: 1,
    effect: { getKeyframes: () => [{ transform: "translateY(-100px)", easing: "ease-out" }, { transform: "translateY(0px)" }],
      getComputedTiming: () => ({ endTime: 80 }) },
  }] as unknown as Animation[];
  act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height: 0, viewport: 800, duration: 240, easing: "linear" },
  })));
  await frame(0);
  const initial = sheet.style.translate;
  await progress(80);
  expect(sheet.style.translate).not.toBe(initial);
  expect(sheet.style.translate).toBe("0px 0px");
});

it("reverses keyboard travel from the visible popup and stops following it when closed", async () => {
  disposeKeyboard = installKeyboardMotion();
  const sheet = render();
  vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(80, 252, 220, 260));
  const keyboard = (height: number) => act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height, viewport: 800, duration: 200, easing: "linear" },
  })));
  keyboard(300);
  await progress(48);
  vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(80, 234, 220, 228));
  keyboard(0);
  await frame(0);
  expect(sheet.style.translate).toBe("0px -18px");
  render(undefined, false);
  await progress();
  expect(node.querySelector(".mobile-sheet")).toBeNull();
});

it("uses settled placement without keyboard travel when reduced motion is requested", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  disposeKeyboard = installKeyboardMotion();
  const sheet = render();
  act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height: 300, viewport: 800, duration: 200, easing: "linear" },
  })));
  expect(sheet.style.maxHeight).toBe("232px");
  await progress(0);
  await frame();
  await frame();
  await frame();

});

it("waits for an in-flight keyboard motion when opened midway and cancels measurement on close", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  disposeKeyboard = installKeyboardMotion();
  act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height: 300, viewport: 800, duration: 120, easing: "linear" },
  })));
  now = 40;
  await progress(40);
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  render();
  expect(bounds).toHaveBeenCalledOnce();
  await frame();
  expect(bounds).toHaveBeenCalledOnce();
  await progress(40);
  expect(bounds).toHaveBeenCalledOnce();
  render(undefined, false);
  await frame();
  expect(bounds).toHaveBeenCalledOnce();

  render();
  act(() => root.render(null));
  bounds.mockClear();
  await progress(200);
  await frame();
  await frame();
  await frame();
  expect(bounds).not.toHaveBeenCalled();
});

it("corrects a point anchor after keyboard layout commits without measuring its originating button", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  disposeKeyboard = installKeyboardMotion();
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  const sheet = render({ x: 72, y: 700 });
  await progress();
  // Observe placement itself: Motion also reads the sheet bounds for drag projection.
  const measure = vi.spyOn(popover, "placePopover");
  act(() => window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, {
    detail: { height: 300, viewport: 800, duration: 100, easing: "linear" },
  })));
  expect(measure).toHaveBeenCalledOnce();
  await frame();
  expect(measure).toHaveBeenCalledOnce();
  await progress(100);
  await frame();
  await frame();
  await frame();
  expect(measure).toHaveBeenCalledTimes(2);
  expect(bounds).not.toHaveBeenCalled();
  expect(sheet.style.bottom).toBe(`${window.innerHeight - 484}px`);
});

it("suspends hidden surfaces and never restores focus into an inert route", async () => {
  const content = (visible: boolean) => createElement(SurfaceVisibilityContext.Provider, { value: visible },
    createElement(MobileSheet, { title: "Actions", onClose: () => {}, anchor: { current: trigger } }, "Body"));
  act(() => root.render(content(true)));
  const focus = vi.spyOn(trigger, "focus");
  trigger.setAttribute("inert", "");
  act(() => root.render(content(false)));
  expect(node.querySelector(".mobile-sheet")).toBeNull();
  expect(focus).not.toHaveBeenCalled();

});

it("notifies exit once only after a previously open controlled sheet closes", async () => {
  vi.useFakeTimers();
  const onExited = vi.fn();
  const show = (open: boolean) => act(() => root.render(createElement(MobileSheet,
    { title: "Actions", open, onClose: () => {}, onExited }, "Body")));
  show(false);
  expect(onExited).not.toHaveBeenCalled();
  show(true);
  show(false);
  expect(onExited).not.toHaveBeenCalled();
  await progress(130);
  expect(onExited).toHaveBeenCalledOnce();
});


it("tracks finite ancestor motion while ignoring perpetual decorative animations", async () => {
  let remaining = 80;
  trigger.getAnimations = () => [{
    playState: "running", currentTime: 0, playbackRate: 1,
    effect: { getComputedTiming: () => ({ endTime: remaining }) },
  }] as unknown as Animation[];
  render();

  await frame();

  remaining = 0;
  await frame();

  remaining = Infinity;
  act(() => trigger.dispatchEvent(new Event("animationstart", { bubbles: true })));
  await frame();

});

function ancestorMotion(keyframes: Keyframe[], transitionProperty?: string) {
  return {
    transitionProperty, playState: "running", currentTime: 0, playbackRate: 1,
    effect: {
      getKeyframes: vi.fn(() => keyframes),
      getComputedTiming: () => ({ endTime: 80 }),
    },
  };
}

it.each(["opacity", "background-color", "--mobile-press-spread"])(
  "does not wake anchor placement for a %s transition",
  async propertyName => {
    const animation = ancestorMotion([], propertyName);
    trigger.getAnimations = () => [animation] as unknown as Animation[];
    render();

    const bounds = vi.spyOn(trigger, "getBoundingClientRect");
    bounds.mockClear();
    for (const type of ["transitionrun", "transitionend", "transitioncancel"]) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: propertyName });
      act(() => trigger.dispatchEvent(event));
      await frame();
    }
    expect(bounds).not.toHaveBeenCalled();

  },
);

it("ignores paint-only keyframes while continuing to respond to scrolling and resizing", async () => {
  const animation = ancestorMotion([
    { opacity: 0, backgroundColor: "red", offset: 0, easing: "linear" },
    { opacity: 1, backgroundColor: "blue", offset: 1, composite: "replace" },
  ]);
  trigger.getAnimations = () => [animation] as unknown as Animation[];
  const sheet = render();

  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  bounds.mockReturnValue(new DOMRect(40, 220, 260, 44));
  act(() => window.dispatchEvent(new Event("scroll")));
  await frame();
  expect(sheet.style.top).toBe("272px");

  bounds.mockReturnValue(new DOMRect(40, 240, 260, 44));
  act(() => window.dispatchEvent(new Event("resize")));
  await frame();
  expect(sheet.style.top).toBe("292px");

});

it.each(["transform", "translate", "scale", "rotate", "height", "marginLeft", "--unknown-motion"])(
  "keeps following %s keyframes even when they also animate opacity",
  async property => {
    const animation = ancestorMotion([{ opacity: 0, [property]: "0" }, { opacity: 1, [property]: "1" }]);
    trigger.getAnimations = () => [animation] as unknown as Animation[];
    const sheet = render();

    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 220, 260, 44));
    await frame();
    expect(sheet.style.top).toBe("272px");

    animation.playState = "finished";
    await frame();

  },
);

it("caches ancestor discovery during motion and discovers a replacement on reversal", async () => {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  parent.appendChild(trigger);
  try {
    const first = ancestorMotion([{ translate: "0 0" }, { translate: "0 20px" }]);
    const reverse = ancestorMotion([{ translate: "0 10px" }, { translate: "0 0" }]);
    let current = first;
    const getAnimations = vi.fn(() => [current] as unknown as Animation[]);
    parent.getAnimations = getAnimations;
    const sheet = render();
    const bounds = vi.spyOn(trigger, "getBoundingClientRect");
    for (const top of [210, 220, 230]) {
      bounds.mockReturnValue(new DOMRect(40, top, 260, 44));
      await frame();
      expect(sheet.style.top).toBe(`${top + 52}px`);
    }
    expect(getAnimations).toHaveBeenCalledOnce();
    expect(first.effect.getKeyframes).toHaveBeenCalledOnce();
    first.playState = "finished";
    current = reverse;
    act(() => parent.dispatchEvent(new Event("animationstart", { bubbles: true })));
    bounds.mockReturnValue(new DOMRect(40, 215, 260, 44));
    await frame();
    expect(sheet.style.top).toBe("267px");
    expect(getAnimations).toHaveBeenCalledTimes(2);
    expect(reverse.effect.getKeyframes).toHaveBeenCalledOnce();

    reverse.playState = "finished";
    bounds.mockReturnValue(new DOMRect(40, 200, 260, 44));
    await frame();
    expect(sheet.style.top).toBe("252px");

  } finally {
    document.body.appendChild(trigger);
    parent.remove();
  }
});

it("stops anchor tracking when the surface closes or becomes hidden and resumes on reopening", async () => {
  const animation = ancestorMotion([], "transform");
  trigger.getAnimations = () => [animation] as unknown as Animation[];
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  const anchor = { current: trigger };
  const show = (open: boolean, visible = true) => act(() => root.render(
    createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(MobileSheet, {
      title: "Actions", placement: "anchor", anchor, open, onClose: () => {},
    }, "Actions")),
  ));
  show(true);
  await progress(300);

  show(false);
  bounds.mockClear();
  await frame();
  expect(bounds).not.toHaveBeenCalled();

  expect(node.querySelector<HTMLElement>(".mobile-sheet-backdrop")!.inert).toBe(true);
  show(true);

  show(true, false);
  bounds.mockClear();
  await frame();
  expect(bounds).not.toHaveBeenCalled();

});

it("discovers a WAAPI successor without CSS motion events before tracking stops", async () => {
  const first = ancestorMotion([{ transform: "translateY(0)" }, { transform: "translateY(20px)" }]);
  const successor = ancestorMotion([{ translate: "0 10px" }, { translate: "0 0" }]);
  let current = first;
  const getAnimations = vi.fn(() => [current] as unknown as Animation[]);
  trigger.getAnimations = getAnimations;
  const sheet = render();
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  await frame();
  expect(getAnimations).toHaveBeenCalledOnce();
  first.playState = "idle";
  current = successor;
  bounds.mockReturnValue(new DOMRect(40, 215, 260, 44));
  await frame();
  expect(getAnimations).toHaveBeenCalledTimes(2);
  expect(sheet.style.top).toBe("267px");

  bounds.mockReturnValue(new DOMRect(40, 210, 260, 44));
  await frame();
  expect(getAnimations).toHaveBeenCalledTimes(2);
  expect(sheet.style.top).toBe("262px");
  successor.playState = "finished";
  await frame();
  expect(getAnimations).toHaveBeenCalledTimes(3);

});

it("never discovers ancestor effects for a point anchor", async () => {
  trigger.getAnimations = vi.fn(() => [ancestorMotion([], "transform")] as unknown as Animation[]);
  render({ x: 72, y: 180 });
  act(() => trigger.dispatchEvent(new Event("animationstart", { bubbles: true })));
  await frame();
  expect(trigger.getAnimations).not.toHaveBeenCalled();

});
