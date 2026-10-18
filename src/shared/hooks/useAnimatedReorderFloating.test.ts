// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, false) };
});
import { duration } from "../motion/tokens";
import {
  useAnimatedReorder,
  type ReorderExternalDrop,
} from "./useAnimatedReorder";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
    window.clearTimeout,
  );
  document.documentElement.style.setProperty(
    "--motion-reorder-duration",
    "160ms",
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.style.removeProperty("--motion-reorder-duration");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(target: EventTarget, type: string, x: number, y: number) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerId: 1,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      }),
    );
  });
}

function setup(
  externalDrop?: ReorderExternalDrop<string>,
  reducedMotion = true,
) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: reducedMotion,
  } as MediaQueryList);
  const onReorder = vi.fn();
  function List() {
    const [ids, setIds] = useState(["a", "b", "c"]);
    const reorder = useAnimatedReorder(
      ids,
      (next, moved) => {
        onReorder(next, moved);
        setIds(next);
      },
      "y",
      externalDrop,
      {
        floatingPreview: (_id, node) =>
          node.querySelector<HTMLElement>("header")!,
      },
    );
    return ids.map((id, index) =>
      createElement(
        "section",
        {
          key: id,
          "data-project-path": id,
          ref: (node: HTMLElement | null) => {
            if (node) {
              const rect = () =>
                new DOMRect(40, 20 + index * 33 - container.scrollTop, 200, 32);
              node.getBoundingClientRect = rect;
              node.querySelector<HTMLElement>("header")!.getBoundingClientRect =
                rect;
              node.setPointerCapture = () => {};
              node.hasPointerCapture = () => false;
            }
            reorder.setItemRef(id, node);
          },
        },
        createElement(
          "header",
          {
            id: `header-${id}`,
            "data-project-header": id,
            onPointerDown: (event) => reorder.onItemPointerDown(id, event),
          },
          id,
        ),
        createElement("p", null, "Expanded children"),
      ),
    );
  }
  act(() => root.render(createElement(List)));
  return {
    onReorder,
    source: container.querySelector<HTMLElement>("section")!,
  };
}

const ghostCard = () =>
  document.querySelector<HTMLElement>(".drag-ghost-card")!;
const press = (source: HTMLElement) =>
  pointer(source.querySelector("header")!, "pointerdown", 55, 36);

describe("floating reorder previews", () => {
  it("starts on horizontal movement and follows both axes beyond the list without clipping", () => {
    const { source, onReorder } = setup();
    press(source);
    pointer(window, "pointermove", 385, 36);
    const ghost = ghostCard();
    expect(ghost.style.transform).toBe("translate(370px, 20px)");
    expect(ghost.parentElement?.parentElement).toBe(document.body);
    expect(ghost.parentElement?.inert).toBe(true);
    expect(ghost.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.textContent).toBe("a");
    expect(document.querySelectorAll("#header-a")).toHaveLength(1);
    expect(document.querySelectorAll('[data-project-header="a"]')).toHaveLength(
      1,
    );
    expect(source.dataset.reorderFloating).toBe("true");
    pointer(window, "pointermove", -15, -64);
    act(() => vi.advanceTimersByTime(16));
    expect(ghost.style.transform).toBe("translate(-30px, -80px)");
    expect(source.style.transform).toBe("");
    pointer(window, "pointerup", -15, -64);
    expect(onReorder).not.toHaveBeenCalled();
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(source.dataset.reorderFloating).toBeUndefined();
  });

  it("keeps the same row preview when entering and leaving an external target", () => {
    const drop = {
      onMove: vi.fn((_id, event) => event.clientX >= 300),
      onDrop: vi.fn((_id, event) => event.clientX >= 300),
      onEnd: vi.fn(),
    } satisfies ReorderExternalDrop<string>;
    const { source, onReorder } = setup(drop);
    press(source);
    pointer(window, "pointermove", 60, 69);
    const ghost = ghostCard();
    pointer(window, "pointermove", 400, 120);
    expect(ghostCard()).toBe(ghost);
    expect(ghost.style.transform).toBe("translate(385px, 104px)");
    pointer(window, "pointermove", 70, 80);
    expect(ghostCard()).toBe(ghost);
    expect(ghost.style.transform).toBe("translate(55px, 64px)");
    pointer(window, "pointerup", 500, 150);
    expect(drop.onDrop).toHaveBeenCalledOnce();
    expect(drop.onEnd).toHaveBeenCalledOnce();
    expect(onReorder).not.toHaveBeenCalled();
    expect(document.querySelector(".drag-ghost")).toBeNull();
  });

  it("keeps the preview at the pointer while scrolling changes the destination", () => {
    const { source, onReorder } = setup();
    press(source);
    pointer(window, "pointermove", 85, 69);
    act(() => vi.advanceTimersByTime(16));
    const transform = ghostCard().style.transform;
    container.scrollTop = 33;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(16);
    });
    expect(ghostCard().style.transform).toBe(transform);
    pointer(window, "pointerup", 85, 69);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"], "a");
  });

  it("settles back into the ordered slot before restoring the real row", () => {
    const { source, onReorder } = setup(undefined, false);
    press(source);
    pointer(window, "pointermove", 400, 200);
    act(() => vi.advanceTimersByTime(16));
    pointer(window, "pointerup", 400, 200);
    expect(ghostCard().style.transform).toBe("translate(40px, 86px)");
    expect(source.dataset.reorderFloating).toBe("true");
    expect(onReorder).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(duration.panel * 1000));
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"], "a");
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(source.dataset.reorderFloating).toBeUndefined();
  });

  it.each(["Escape", "pointercancel", "blur", "unmount"])(
    "cleans up the floating row on %s without reordering",
    (reason) => {
      const { source, onReorder } = setup();
      press(source);
      pointer(window, "pointermove", 400, 200);
      act(() => {
        if (reason === "unmount") root.render(null);
        else
          window.dispatchEvent(
            reason === "Escape"
              ? new KeyboardEvent("keydown", { key: "Escape" })
              : new Event(reason),
          );
      });
      expect(document.querySelector(".drag-ghost")).toBeNull();
      expect(source.dataset.reorderFloating).toBeUndefined();
      expect(document.body.style.cursor).toBe("");
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(onReorder).not.toHaveBeenCalled();
    },
  );
});
