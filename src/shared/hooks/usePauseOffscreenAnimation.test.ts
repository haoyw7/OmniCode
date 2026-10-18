// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import { applyReducedMotion } from "../lib/reducedMotion";
import { SurfaceVisibilityContext } from "../ui/SurfaceVisibility";
import { usePauseOffscreenAnimation } from "./usePauseOffscreenAnimation";

let root: Root;
let container: HTMLDivElement;
let hidden: boolean;
let reduced: boolean;
let media: EventTarget;

class Observer {
  static all: Observer[] = [];
  element: Element | undefined;
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    Observer.all.push(this);
  }
  observe(element: Element) {
    this.element = element;
  }
  disconnect() {
    this.disconnected = true;
  }
  publish(intersecting: boolean) {
    this.callback(
      [
        {
          target: this.element,
          isIntersecting: intersecting,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

function Decoration({ id = "a" }: { id?: string }) {
  const ref = usePauseOffscreenAnimation<HTMLDivElement>();
  return createElement("div", { ref, key: id, "data-decoration": true });
}

function render(visible = true, strict = false) {
  const content = createElement(
    SurfaceVisibilityContext.Provider,
    { value: visible },
    createElement(Decoration),
    createElement(TerminalSpinner),
  );
  act(() =>
    root.render(strict ? createElement(StrictMode, null, content) : content),
  );
}

function spinnerState() {
  return container.querySelector<HTMLSpanElement>(".terminal-spinner")!.style.animationPlayState;
}
function paused() {
  return container
    .querySelector("[data-decoration]")!
    .hasAttribute("data-animation-paused");
}
function intersect(value: boolean) {
  act(() =>
    Observer.all
      .filter((o) => !o.disconnected)
      .forEach((o) => o.publish(value)),
  );
}
function visibility(value: boolean) {
  hidden = !value;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", Observer);
  Observer.all = [];
  hidden = false;
  reduced = false;
  media = new EventTarget();
  Object.defineProperty(media, "matches", { get: () => reduced });
  vi.spyOn(window, "matchMedia").mockReturnValue(media as MediaQueryList);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("decorative animation activity", () => {
  it("pauses an offscreen spinner's CSS loop and resumes it when visible", () => {
    render();
    expect(spinnerState()).toBe("running");
    expect(paused()).toBe(false);

    intersect(false);
    expect(paused()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("paused");

    intersect(true);
    intersect(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(paused()).toBe(false);
    expect(spinnerState()).toBe("running");
  });

  it("does not register observers or timers for a hidden retained surface", () => {
    render(false);
    expect(Observer.all).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(paused()).toBe(true);
    expect(spinnerState()).toBe("paused");

    render(true);
    expect(Observer.all).toHaveLength(2);
    expect(spinnerState()).toBe("running");
    render(false);
    expect(Observer.all.every((o) => o.disconnected)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("paused");
    render(true);
    expect(spinnerState()).toBe("running");
  });

  it("keeps offscreen activity paused when the document returns", () => {
    render();
    visibility(false);
    expect(paused()).toBe(true);
    expect(spinnerState()).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
    intersect(false);
    visibility(true);
    expect(paused()).toBe(true);
    expect(spinnerState()).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
    intersect(true);
    expect(paused()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("running");
  });

  it("honours live OS motion changes and the application override", () => {
    reduced = true;
    render();
    expect(paused()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("paused");

    act(() => applyReducedMotion("off"));
    expect(paused()).toBe(false);
    expect(spinnerState()).toBe("running");
    act(() => applyReducedMotion("on"));
    expect(paused()).toBe(true);
    expect(spinnerState()).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
    reduced = false;
    act(() => media.dispatchEvent(new Event("change")));
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("paused");
    act(() => applyReducedMotion("system"));
    expect(paused()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("running");
    reduced = true;
    act(() => media.dispatchEvent(new Event("change")));
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("paused");
  });

  it("releases the old observer when a ref moves to another element", () => {
    act(() => root.render(createElement(Decoration, { id: "old" })));
    const previous = Observer.all[0]!;
    intersect(false);
    act(() => root.render(createElement(Decoration, { id: "new" })));
    expect(previous.disconnected).toBe(true);
    expect(previous.element!.hasAttribute("data-animation-paused")).toBe(false);
    expect(Observer.all).toHaveLength(2);
    expect(Observer.all[1]!.element).not.toBe(previous.element);
    intersect(false);
    expect(paused()).toBe(true);
  });

  it("retains CSS activity through StrictMode ref replay and releases it on unmount", () => {
    render(true, true);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinnerState()).toBe("running");
    const spinner = container.querySelector<HTMLSpanElement>(".terminal-spinner")!;
    act(() => root.render(null));
    expect(Observer.all.every((o) => o.disconnected)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(spinner.style.animationPlayState).toBe("paused");
    visibility(false);
    visibility(true);
    act(() => applyReducedMotion("off"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
