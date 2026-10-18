// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowResizeHandles } from "./WindowResizeHandles";
import { WINDOW_RESIZE_IDLE_MS } from "./windowResizeWork";

const native = vi.hoisted(() => ({
  environment: { tauri: true, linux: true, windows: false },
  getCurrentWindow: vi.fn(),
  isResizable: vi.fn(),
  isMaximized: vi.fn(),
  isFullscreen: vi.fn(),
  scaleFactor: vi.fn(),
  onResized: vi.fn(),
  startResizeDragging: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => native.environment.tauri,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: native.getCurrentWindow,
}));
vi.mock("../../platform/tauri/platform", () => ({
  get IS_LINUX() {
    return native.environment.linux;
  },
  get IS_WIN() {
    return native.environment.windows;
  },
}));

const DIRECTIONS = [
  "East",
  "North",
  "NorthEast",
  "NorthWest",
  "South",
  "SouthEast",
  "SouthWest",
  "West",
] as const;

let container: HTMLDivElement;
let root: Root;
let unmounted: boolean;
let onResized: (() => void) | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function render() {
  await act(async () => {
    root.render(createElement(WindowResizeHandles));
  });
}

function handles() {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-window-resize-direction]"),
  );
}

function handle(direction: string) {
  const element = handles().find(
    (candidate) => candidate.dataset.windowResizeDirection === direction,
  );
  expect(element).toBeDefined();
  return element!;
}

async function resizeEvent() {
  expect(onResized).toBeDefined();
  await act(async () => onResized!());
  await act(async () => vi.advanceTimersByTimeAsync(WINDOW_RESIZE_IDLE_MS));
}

async function press(direction: string, button = 0) {
  const edge = native.environment.linux ? 12 : 5;
  const corner = native.environment.linux ? 18 : 8;
  const coordinates: Record<string, [number, number]> = {
    North: [window.innerWidth / 2, edge],
    South: [window.innerWidth / 2, window.innerHeight - edge],
    East: [window.innerWidth - edge, window.innerHeight / 2],
    West: [edge, window.innerHeight / 2],
    NorthWest: [corner, corner],
    NorthEast: [window.innerWidth - corner, corner],
    SouthWest: [corner, window.innerHeight - corner],
    SouthEast: [window.innerWidth - corner, window.innerHeight - corner],
  };
  const [clientX, clientY] = coordinates[direction];
  const event = new MouseEvent("mousedown", {
    button,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    container.dispatchEvent(event);
  });
  return event;
}

function unmount() {
  act(() => root.unmount());
  unmounted = true;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.environment.tauri = true;
  native.environment.linux = false;
  native.environment.windows = true;
  native.isResizable.mockReset().mockResolvedValue(true);
  native.isMaximized.mockReset().mockResolvedValue(false);
  native.isFullscreen.mockReset().mockResolvedValue(false);
  native.scaleFactor.mockReset().mockResolvedValue(1);
  native.startResizeDragging.mockReset().mockResolvedValue(undefined);
  native.unlisten.mockReset();
  native.getCurrentWindow.mockReset().mockReturnValue(native);
  native.onResized
    .mockReset()
    .mockImplementation(async (callback: () => void) => {
      onResized = callback;
      return native.unlisten;
    });
  onResized = undefined;
  unmounted = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (!unmounted) unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native window resize handles", () => {
  it("leaves Linux edges to GTK without issuing a second resize command", async () => {
    native.environment.linux = true;
    native.environment.windows = false;
    await render();
    expect(handles()).toHaveLength(8);
    expect(native.scaleFactor).toHaveBeenCalledOnce();
    act(() => container.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, button: 0, clientX: window.innerWidth - 2, clientY: 100,
    })));
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("coalesces a burst of native resize notifications into one state query", async () => {
    await render();
    expect(native.isMaximized).toHaveBeenCalledTimes(1);
    act(() => { for (let i = 0; i < 100; i++) onResized!(); });
    expect(native.isMaximized).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(WINDOW_RESIZE_IDLE_MS));
    expect(native.isMaximized).toHaveBeenCalledTimes(2);
    expect(native.isResizable).toHaveBeenCalledTimes(2);
    expect(native.isFullscreen).toHaveBeenCalledTimes(2);
    act(() => onResized!());
    unmount();
    await vi.advanceTimersByTimeAsync(WINDOW_RESIZE_IDLE_MS);
    expect(native.isMaximized).toHaveBeenCalledTimes(2);
  });

  it.each(["Linux", "Windows"])(
    "dispatches all four edges and four corners to native resizing on %s",
    async (platform) => {
      native.environment.linux = platform === "Linux";
      native.environment.windows = platform === "Windows";
      await render();
      expect(
        handles()
          .map((element) => element.dataset.windowResizeDirection)
          .sort(),
      ).toEqual([...DIRECTIONS].sort());
      expect(
        container
          .querySelector("[data-window-resize-handles]")
          ?.getAttribute("aria-hidden"),
      ).toBe("true");
      for (const direction of DIRECTIONS) {
        expect(handle(direction).getAttribute("data-tauri-drag-region")).toBe(
          "false",
        );
        await press(direction);
      }
      expect(
        native.startResizeDragging.mock.calls.map(([direction]) => direction),
      ).toEqual(DIRECTIONS);
    },
  );

  it("ignores secondary and middle mouse buttons", async () => {
    await render();
    await press("East", 1);
    await press("NorthWest", 2);
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("prevents a resize press from also reaching document title-drag handlers", async () => {
    await render();
    const titleDrag = vi.fn();
    document.addEventListener("mousedown", titleDrag);
    try {
      const event = await press("NorthEast");
      expect(event.defaultPrevented).toBe(true);
      expect(titleDrag).not.toHaveBeenCalled();
      expect(native.startResizeDragging).toHaveBeenCalledExactlyOnceWith(
        "NorthEast",
      );
    } finally {
      document.removeEventListener("mousedown", titleDrag);
    }
  });

  it.each([
    ["fixed size", "isResizable", false],
    ["maximized", "isMaximized", true],
    ["fullscreen", "isFullscreen", true],
  ] as const)(
    "has no pointer targets while %s",
    async (_state, query, value) => {
      native[query].mockResolvedValue(value);
      await render();
      expect(handles()).toHaveLength(0);
      expect(native.startResizeDragging).not.toHaveBeenCalled();
    },
  );

  it.each(["browser", "macOS"])(
    "leaves native borders and app controls unobstructed in %s",
    async (environment) => {
      if (environment === "browser") native.environment.tauri = false;
      else { native.environment.linux = false; native.environment.windows = false; }
      await render();
      expect(handles()).toHaveLength(0);
      expect(native.getCurrentWindow).not.toHaveBeenCalled();
      expect(native.onResized).not.toHaveBeenCalled();
    },
  );

  it("removes targets when maximizing and restores them after returning to a resizable window", async () => {
    await render();
    expect(handles()).toHaveLength(8);
    native.isMaximized.mockResolvedValue(true);
    await resizeEvent();
    expect(handles()).toHaveLength(0);
    native.isMaximized.mockResolvedValue(false);
    await resizeEvent();
    expect(handles()).toHaveLength(8);
    native.isFullscreen.mockResolvedValue(true);
    await resizeEvent();
    expect(handles()).toHaveLength(0);
  });

  it("starts disabled and ignores stale state reads after a newer resize refresh", async () => {
    const initialMaximized = deferred<boolean>();
    native.isMaximized
      .mockImplementationOnce(() => initialMaximized.promise)
      .mockResolvedValue(true);
    await render();
    expect(handles()).toHaveLength(0);
    await resizeEvent();
    expect(handles()).toHaveLength(0);
    await act(async () => initialMaximized.resolve(false));
    expect(handles()).toHaveLength(0);
  });

  it("unsubscribes its native resize listener on unmount", async () => {
    await render();
    unmount();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("cleans up a listener registered after unmount and ignores pending state", async () => {
    const listener = deferred<() => void>();
    const resizable = deferred<boolean>();
    native.onResized.mockImplementationOnce(() => listener.promise);
    native.isResizable.mockImplementationOnce(() => resizable.promise);
    await render();
    unmount();
    await act(async () => {
      listener.resolve(native.unlisten);
      resizable.resolve(true);
    });
    expect(native.unlisten).toHaveBeenCalledOnce();
    expect(handles()).toHaveLength(0);
  });

  it("keeps targets disabled when native state cannot be read", async () => {
    native.isResizable.mockRejectedValue(new Error("native state unavailable"));
    await render();
    expect(handles()).toHaveLength(0);
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("handles a rejected native resize command without breaking subsequent gestures", async () => {
    native.startResizeDragging.mockRejectedValueOnce(
      new Error("resize rejected"),
    );
    await render();
    await press("SouthWest");
    await press("East");
    expect(native.startResizeDragging.mock.calls).toEqual([
      ["SouthWest"],
      ["East"],
    ]);
  });

  it("lets actual edge controls receive presses without a preceding pointermove", async () => {
    await render();
    for (const tag of ["button", "input", "select", "textarea", "a", "div"]) {
      const control = document.createElement(tag);
      if (tag === "a") control.setAttribute("href", "#test");
      if (tag === "div") control.setAttribute("contenteditable", "true");
      container.append(control);
      const received = vi.fn();
      control.addEventListener("mousedown", received);
      const event = new MouseEvent("mousedown", {
        clientX: window.innerWidth - 2,
        clientY: 12,
        bubbles: true,
        cancelable: true,
      });
      act(() => control.dispatchEvent(event));
      expect(received).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(false);
      control.remove();
    }
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it.each(["vertical", "horizontal"])(
    "passes a %s native scrollbar track press through",
    async (axis) => {
      await render();
      const scroller = document.createElement("div");
      const vertical = axis === "vertical";
      scroller.style[vertical ? "overflowY" : "overflowX"] = "auto";
      const width = vertical ? 199 : window.innerWidth;
      const height = vertical ? window.innerHeight : 199;
      const left = vertical ? window.innerWidth - 200 : 0;
      const top = vertical ? 0 : window.innerHeight - 200;
      for (const [property, value] of Object.entries({
        offsetWidth: width,
        offsetHeight: height,
        clientWidth: width - (vertical ? 12 : 0),
        clientHeight: height - (vertical ? 0 : 12),
        clientLeft: 0,
        clientTop: 0,
        scrollWidth: 2000,
        scrollHeight: 2000,
      }))
        Object.defineProperty(scroller, property, { value });
      scroller.getBoundingClientRect = () =>
        new DOMRect(left, top, width, height);
      container.append(scroller);
      const received = vi.fn();
      scroller.addEventListener("mousedown", received);
      const event = new MouseEvent("mousedown", {
        clientX: vertical ? window.innerWidth - 5 : 100,
        clientY: vertical ? 100 : window.innerHeight - 5,
        bubbles: true,
        cancelable: true,
      });
      act(() => scroller.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(received).toHaveBeenCalledOnce();
      expect(native.startResizeDragging).not.toHaveBeenCalled();
    },
  );

  it.each(["cm-editorScrollbar", "xterm", "shared"])(
    "preserves the %s custom scrollbar",
    async (kind) => {
      await render();
      const wrapper = document.createElement("div");
      wrapper.className = kind;
      if (kind === "shared") wrapper.dataset.ui = "scrollbar";
      const thumb = document.createElement("div");
      if (kind === "xterm") {
        const track = document.createElement("div");
        track.className = "scrollbar";
        wrapper.append(track);
        track.append(thumb);
      } else wrapper.append(thumb);
      container.append(wrapper);
      const received = vi.fn();
      thumb.addEventListener("mousedown", received);
      act(() =>
        thumb.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: window.innerWidth - 2,
            clientY: 100,
            bubbles: true,
          }),
        ),
      );
      expect(received).toHaveBeenCalledOnce();
      expect(native.startResizeDragging).not.toHaveBeenCalled();
    },
  );

  it("leaves ordinary content presses outside the edge unchanged", async () => {
    await render();
    const event = new MouseEvent("mousedown", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    act(() => container.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("lets internal panel resize endpoints retain their own drag gesture at the window edge", async () => {
    await render();
    for (const attribute of ["class", "data-resize-edge", "role"]) {
      const sash = document.createElement("div");
      sash.setAttribute(
        attribute,
        attribute === "class"
          ? "resize-handle"
          : attribute === "role"
            ? "separator"
            : "right",
      );
      const child = document.createElement("span");
      sash.append(child);
      container.append(sash);
      const internalResize = vi.fn();
      sash.addEventListener("mousedown", internalResize);
      act(() =>
        child.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: window.innerWidth - 2,
            clientY: 100,
            bubbles: true,
          }),
        ),
      );
      expect(internalResize).toHaveBeenCalledOnce();
      sash.remove();
    }
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("restores hover cursors on leaving the edge and removes capture handlers on maximize", async () => {
    await render();
    container.style.cursor = "crosshair";
    act(() =>
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 5,
          clientY: 100,
          buttons: 0,
          bubbles: true,
        }),
      ),
    );
    expect(container.style.cursor).toBe("ew-resize");
    act(() =>
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 100,
          clientY: 100,
          buttons: 0,
          bubbles: true,
        }),
      ),
    );
    expect(container.style.cursor).toBe("crosshair");
    act(() =>
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 5,
          clientY: 100,
          buttons: 0,
          bubbles: true,
        }),
      ),
    );
    native.isMaximized.mockResolvedValue(true);
    await resizeEvent();
    expect(container.style.cursor).toBe("crosshair");
    await press("West");
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });

  it("does not overwrite another drag's cursor when unmounting", async () => {
    await render();
    act(() =>
      container.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 5,
          clientY: 100,
          buttons: 0,
          bubbles: true,
        }),
      ),
    );
    container.style.cursor = "grabbing";
    unmount();
    expect(container.style.cursor).toBe("grabbing");
    await press("West");
    expect(native.startResizeDragging).not.toHaveBeenCalled();
  });
});


it.each([{ scale: 1, dpr: 1, nativeX: 2, extraX: 12 }, { scale: 2, dpr: 2, nativeX: 8, extraX: 14 }, { scale: 3, dpr: 3, nativeX: 12, extraX: 20 }])(
  "extends the Linux rim without duplicating the native gesture at scale $scale",
  async ({ scale, dpr, nativeX, extraX }) => {
    native.environment.linux = true;
    native.environment.windows = false;
    native.scaleFactor.mockResolvedValue(scale);
    vi.stubGlobal("devicePixelRatio", dpr);
    await render();
    const down = (target: Element, x: number) => act(() => target.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 100,
    })));
    down(container, nativeX);
    expect(native.startResizeDragging).not.toHaveBeenCalled();
    down(container, extraX);
    expect(native.startResizeDragging).toHaveBeenCalledExactlyOnceWith("West");
    const button = document.createElement("button");
    const clicked = vi.fn();
    button.addEventListener("mousedown", clicked);
    container.append(button);
    down(button, extraX);
    expect(clicked).toHaveBeenCalledOnce();
    expect(native.startResizeDragging).toHaveBeenCalledTimes(1);
  },
);

it("recalculates the native rim after webview zoom without a native resize", async () => {
  native.environment.linux = true;
  native.environment.windows = false;
  native.scaleFactor.mockResolvedValue(2);
  vi.stubGlobal("devicePixelRatio", 2);
  await render();
  const down = () => act(() => container.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, button: 0, clientX: 7, clientY: 100,
  })));
  down();
  expect(native.startResizeDragging).not.toHaveBeenCalled();
  vi.stubGlobal("devicePixelRatio", 4);
  down();
  expect(native.startResizeDragging).toHaveBeenCalledExactlyOnceWith("West");
});
