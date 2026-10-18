import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
import { AttachmentChip } from "../../features/sessions/ui/AttachmentChip";
import { dismissImageLightbox, ImageLightbox } from "./ImageLightbox";
import { SurfaceVisibilityContext } from "./SurfaceVisibility";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

it("dismisses only the foremost image and unregisters every closed preview", () => {
  const chip = (name: string) =>
    createElement(AttachmentChip, {
      attachment: {
        id: name,
        name,
        kind: "image",
        mimeType: "image/png",
        size: 42,
        previewUrl: `blob:${name}`,
      },
    });
  act(() =>
    root.render(
      createElement(Fragment, null, chip("first.png"), chip("second.png")),
    ),
  );
  for (const name of ["first.png", "second.png"]) {
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          `[aria-label="Open ${name} full screen"]`,
        )!
        .click(),
    );
  }
  expect(document.querySelectorAll(".image-lightbox")).toHaveLength(2);
  act(() => expect(dismissImageLightbox()).toBe(true));
  act(() => document.querySelectorAll('.image-lightbox[aria-hidden="true"]').forEach(completeMotionAnimation));
  expect(document.querySelectorAll(".image-lightbox")).toHaveLength(1);
  expect(
    document.querySelector(".image-lightbox img")?.getAttribute("alt"),
  ).toBe("first.png");
  act(() =>
    document.querySelector<HTMLButtonElement>(".image-lightbox-close")!.click(),
  );
  expect(dismissImageLightbox()).toBe(false);
});

describe("image zoom gestures", () => {
  let image: HTMLImageElement;
  let stage: HTMLDivElement;
  let dialog: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let reduced: boolean;
  let resize: () => void;
  let stageSize: { width: number; height: number };
  let imageSize: { width: number; height: number };
  let bounds: ReturnType<typeof vi.spyOn>;
  const close = vi.fn();

  beforeEach(() => {
    close.mockClear();
    now = 0;
    reduced = false;
    stageSize = { width: 400, height: 300 };
    imageSize = { width: 400, height: 300 };
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(window, "matchMedia").mockImplementation(
      () => ({ matches: reduced }) as MediaQueryList,
    );
    bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(
        () => new DOMRect(0, 0, stageSize.width, stageSize.height),
      );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      () => imageSize.width,
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      () => imageSize.height,
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = () => callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    act(() =>
      root.render(
        createElement(ImageLightbox, {
          src: "blob:photo",
          alt: "photo",
          onClose: close,
        }),
      ),
    );
    image = document.querySelector<HTMLImageElement>(".image-lightbox img")!;
    stage = document.querySelector<HTMLDivElement>(".image-lightbox-stage")!;
    dialog = document.querySelector<HTMLDivElement>(".image-lightbox")!;
  });

  function pointer(
    type: string,
    x: number,
    y = 150,
    id = 1,
    target: Element = image,
    pointerType = "touch",
  ) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType,
      pointerId: id,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "timeStamp", { value: now });
    act(() => target.dispatchEvent(event));
  }
  function frame(time = now + 16) {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(now)));
  }
  function view() {
    const values =
      /translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0\) scale\(([-\d.e]+)\)/.exec(
        image.style.transform,
      )!;
    return {
      x: Number(values[1]),
      y: Number(values[2]),
      scale: Number(values[3]),
    };
  }
  function tap(x = 200, y = 150) {
    pointer("pointerdown", x, y);
    now += 30;
    pointer("pointerup", x, y);
    now += 30;
  }
  function doubleClick(x = 200, y = 150) {
    act(() =>
      image.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      ),
    );
  }
  function pinch() {
    pointer("pointerdown", 100);
    pointer("pointerdown", 300, 150, 2);
    pointer("pointermove", 0);
    pointer("pointermove", 400, 150, 2);
    frame();
  }

  it("keeps the image point under the pinch center and coalesces moves without reading layout", () => {
    pointer("pointerdown", 100);
    pointer("pointerdown", 200, 150, 2);
    const measured = bounds.mock.calls.length;
    pointer("pointermove", 50);
    pointer("pointermove", 250, 150, 2);
    expect(frames.size).toBe(1);
    expect(view()).toEqual({ scale: 1, x: 0, y: 0 });
    frame();
    expect(view().scale).toBeCloseTo(2);
    expect(view().x).toBeCloseTo(50);
    expect(view().y).toBe(0);
    expect(bounds.mock.calls.length).toBe(measured);
  });

  it("continues smoothly with one finger and responds immediately when reversing at a pan edge", () => {
    pinch();
    expect(view()).toEqual({ scale: 2, x: 0, y: 0 });
    pointer("pointerup", 400, 150, 2);
    pointer("pointermove", 900);
    frame();
    expect(view().x).toBe(200);
    pointer("pointermove", 890);
    frame();
    expect(view().x).toBe(190);
    expect(image.style.cursor).toBe("grabbing");
    pointer("pointerup", 890);
    frame();
    expect(image.style.cursor).toBe("grab");
  });

  it("starts zooming back immediately after reaching the maximum pinch scale", () => {
    pointer("pointerdown", 150);
    pointer("pointerdown", 250, 150, 2);
    pointer("pointermove", -50);
    pointer("pointermove", 650, 150, 2);
    frame();
    expect(view().scale).toBe(5);
    pointer("pointermove", 640, 150, 2);
    frame();
    expect(view().scale).toBeCloseTo((5 * 690) / 700);
  });

  it("animates double-tap zoom and reset, ignoring a browser's duplicate touch double-click", () => {
    tap(150);
    tap(150);
    frame();
    expect(view().scale).toBeGreaterThan(1);
    expect(view().scale).toBeLessThan(2.5);
    doubleClick(150);
    frame(now + 200);
    expect(view()).toEqual({ scale: 2.5, x: 75, y: 0 });
    tap(150);
    tap(150);
    frame(now + 200);
    expect(view()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(frames.size).toBe(0);
  });

  it("lets a drag interrupt zoom at its visible position and filters small tap jitter", () => {
    doubleClick();
    frame(50);
    const partial = view();
    expect(partial.scale).toBeGreaterThan(1);
    expect(partial.scale).toBeLessThan(2.5);
    pointer("pointerdown", 200);
    pointer("pointermove", 204);
    frame(100);
    expect(view()).toEqual(partial);
    pointer("pointermove", 230);
    frame(120);
    expect(view().scale).toBe(partial.scale);
    expect(view().x).toBe(30);
  });

  it("respects reduced motion and centers images that are smaller than the stage", () => {
    reduced = true;
    imageSize = { width: 100, height: 80 };
    act(() => resize());
    doubleClick(100, 100);
    frame();
    expect(view()).toEqual({ scale: 2.5, x: 0, y: 0 });
    expect(frames.size).toBe(0);
    doubleClick(100, 100);
    frame();
    expect(view()).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("clamps and rebases an active drag when the viewport resizes", () => {
    pinch();
    pointer("pointerup", 400, 150, 2);
    pointer("pointermove", 900);
    frame();
    stageSize = { width: 700, height: 300 };
    act(() => resize());
    frame();
    expect(view().x).toBe(50);
    pointer("pointermove", 890);
    frame();
    expect(view().x).toBe(40);
  });

  it("uses fractional image dimensions for pan bounds and recenters exactly when resetting", () => {
    stageSize.width = 399.6;
    image.style.width = "399.6px";
    image.style.height = "300px";
    act(() => resize());
    pinch();
    pointer("pointerup", 400, 150, 2);
    pointer("pointermove", 900);
    frame();
    expect(view().x).toBeCloseTo(199.8);
    pointer("pointerup", 900);
    reduced = true;
    tap();
    tap();
    frame();
    expect(view()).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("zooms at the mouse wheel position without scrolling its owner", () => {
    const parentWheel = vi.fn();
    document.body.addEventListener("wheel", parentWheel);
    try {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -Math.log(2) / 0.002,
      });
      // happy-dom's WheelEvent extends UIEvent and omits MouseEvent coordinates.
      Object.defineProperties(event, {
        clientX: { value: 150 },
        clientY: { value: 150 },
      });
      act(() => stage.dispatchEvent(event));
      frame();
      expect(event.defaultPrevented).toBe(true);
      expect(parentWheel).not.toHaveBeenCalled();
      expect(view().scale).toBeCloseTo(2);
      expect(view().x).toBeCloseTo(50);
    } finally {
      document.body.removeEventListener("wheel", parentWheel);
    }
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "ignores the click after %s and accepts a fresh backdrop tap",
    (end) => {
      pointer("pointerdown", 200, 150, 1, stage);
      pointer(end, 200, 150, 1, dialog);
      act(() => dialog.click());
      expect(close).not.toHaveBeenCalled();
      pointer("pointerdown", 200, 150, 2, stage);
      pointer("pointerup", 200, 150, 2, dialog);
      act(() => dialog.click());
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("keeps gesture clicks from closing the image while leaving its close button usable", () => {
    pinch();
    pointer("pointerup", 0);
    pointer("pointerup", 400, 150, 2);
    act(() => dialog.click());
    expect(close).not.toHaveBeenCalled();
    const button = dialog.querySelector<HTMLButtonElement>(
      ".image-lightbox-close",
    )!;
    pointer("pointerdown", 0, 0, 3, button);
    act(() => button.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels motion and resets the view on source changes and hiding", () => {
    doubleClick();
    frame(50);
    expect(frames.size).toBe(1);
    act(() =>
      root.render(
        createElement(ImageLightbox, {
          src: "blob:other",
          alt: "other",
          onClose: close,
        }),
      ),
    );
    expect(view()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(frames.size).toBe(0);
    pointer("pointerdown", 200);
    pointer("pointerup", 200);
    doubleClick();
    act(() =>
      root.render(
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: false },
          createElement(ImageLightbox, {
            src: "blob:other",
            alt: "other",
            onClose: close,
          }),
        ),
      ),
    );
    expect(frames.size).toBe(0);
    expect(document.querySelector(".image-lightbox")).toBeNull();
    expect(dismissImageLightbox()).toBe(false);
  });

  it("releases active pointer captures when the preview unmounts", () => {
    const release = vi.spyOn(dialog, "releasePointerCapture");
    pointer("pointerdown", 100);
    pointer("pointerdown", 300, 150, 2);
    pointer("pointermove", 50);
    expect(frames.size).toBe(1);
    act(() => root.render(null));
    expect(frames.size).toBe(0);
    expect(release).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalledWith(2);
  });
});

it("stops intercepting Back while its owner is hidden and restores the preview with the latest close callback", () => {
  const originalClose = vi.fn();
  const latestClose = vi.fn();
  const render = (visible: boolean, onClose: () => void) =>
    act(() =>
      root.render(
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: visible },
          createElement(ImageLightbox, {
            src: "blob:photo",
            alt: "photo",
            onClose,
          }),
        ),
      ),
    );

  render(true, originalClose);
  render(false, originalClose);
  expect(document.querySelector(".image-lightbox")).toBeNull();
  expect(dismissImageLightbox()).toBe(false);
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  act(() => window.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(false);
  expect(originalClose).not.toHaveBeenCalled();

  render(true, originalClose);
  render(true, latestClose);
  expect(document.querySelector(".image-lightbox")).not.toBeNull();
  act(() => expect(dismissImageLightbox()).toBe(true));
  expect(originalClose).not.toHaveBeenCalled();
  expect(latestClose).toHaveBeenCalledOnce();
  act(() => root.render(null));
  expect(dismissImageLightbox()).toBe(false);
});
