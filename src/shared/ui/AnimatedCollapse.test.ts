// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnimatedCollapse } from "./AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "./SurfaceVisibility";

let root: Root;
let container: HTMLDivElement;

function Child() {
  return createElement(
    "button",
    {
      "data-visible": useSurfaceVisibility(),
    },
    "Content",
  );
}
function render(
  expanded: boolean,
  parentVisible = true,
  durationMs?: number,
  motion?: "grid" | "height",
  options: Partial<ComponentProps<typeof AnimatedCollapse>> = {},
) {
  act(() =>
    root.render(
      createElement(
        SurfaceVisibilityContext.Provider,
        { value: parentVisible },
        createElement(AnimatedCollapse, {
          expanded,
          durationMs,
          motion,
          children: createElement(Child),
          ...options,
        }),
      ),
    ),
  );
}
const fold = () => container.querySelector<HTMLElement>(".zen-fold-item");
const child = () => container.querySelector("button");

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

const complete = async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
};

it("does not replay motion on mount and animates both opening and closing", async () => {
  render(false);
  expect(fold()).toBeNull();
  render(true);
  expect(fold()?.dataset.foldState).toBe("opening");
  await complete();
  expect(fold()?.dataset.foldState).toBe("open");
  render(false);
  expect(fold()?.dataset.foldState).toBe("closing");
  expect(child()).not.toBeNull();
  expect(fold()?.inert).toBe(true);
  expect(fold()?.getAttribute("aria-hidden")).toBe("true");
  expect(child()?.getAttribute("data-visible")).toBe("false");
  await complete();
  expect(child()).toBeNull();
  render(true);
  act(() => root.unmount());
  root = createRoot(container);
  render(true);
  expect(fold()?.dataset.foldState).toBe("open");
});

it("prepares asynchronous content while closed and starts opening only when ready", async () => {
  const onEntered = vi.fn();
  render(false, true, undefined, undefined, { ready: false, onEntered });
  render(true, true, undefined, undefined, { ready: false, onEntered });
  const button = child();
  await complete();
  expect(button).not.toBeNull();
  expect(fold()?.dataset.foldState).toBe("closed");
  expect(fold()?.hidden).toBe(false);
  expect(fold()?.inert).toBe(true);
  expect(fold()?.style.height).toBe("0px");
  expect(button?.getAttribute("data-visible")).toBe("false");
  expect(onEntered).not.toHaveBeenCalled();

  render(true, true, undefined, undefined, { ready: true, onEntered });
  expect(child()).toBe(button);
  expect(fold()?.dataset.foldState).toBe("opening");
  expect(fold()?.inert).toBe(false);
  await complete();
  expect(fold()?.dataset.foldState).toBe("open");
  expect(onEntered).toHaveBeenCalledOnce();
});

it("does not open when readiness arrives after cancellation", async () => {
  const onEntered = vi.fn();
  render(true, true, undefined, undefined, { ready: false, onEntered });
  render(false, true, undefined, undefined, { ready: false, onEntered });
  render(false, true, undefined, undefined, { ready: true, onEntered });
  await complete();
  expect(fold()).toBeNull();
  expect(onEntered).not.toHaveBeenCalled();
});

it("only clips overflowing descendants while opening, closing or settled closed", async () => {
  const options = { keepMounted: true };
  render(true, true, undefined, undefined, options);
  const disclosure = fold()!;
  expect(disclosure.dataset.foldState).toBe("open");
  // Reordered rows can move outside an expanded group's original bounds.
  expect(disclosure.style.overflow).toBe("");

  render(false, true, undefined, undefined, options);
  expect(disclosure.dataset.foldState).toBe("closing");
  expect(disclosure.style.overflow).toBe("hidden");
  // Reversing the close must keep clipping until the new opening finishes.
  render(true, true, undefined, undefined, options);
  expect(disclosure.dataset.foldState).toBe("opening");
  expect(disclosure.style.overflow).toBe("hidden");
  await complete();
  expect(fold()).toBe(disclosure);
  expect(disclosure.dataset.foldState).toBe("open");
  expect(disclosure.style.overflow).toBe("");

  render(false, true, undefined, undefined, options);
  expect(disclosure.style.overflow).toBe("hidden");
  await complete();
  expect(disclosure.dataset.foldState).toBe("closed");
  expect(disclosure.hidden).toBe(true);
  expect(disclosure.style.overflow).toBe("hidden");
  render(true, true, undefined, undefined, options);
  expect(disclosure.dataset.foldState).toBe("opening");
  expect(disclosure.style.overflow).toBe("hidden");
  await complete();
  expect(fold()).toBe(disclosure);
  expect(disclosure.dataset.foldState).toBe("open");
  expect(disclosure.style.overflow).toBe("");
});

it.each([false, true])("cancels obsolete completion on rapid reversal (retained: %s)", async (keepMounted) => {
  const options = { keepMounted };
  render(true, true, undefined, undefined, options);
  render(false, true, undefined, undefined, options);
  render(true, true, undefined, undefined, options);
  expect(fold()?.inert).toBe(false);
  expect(child()?.getAttribute("data-visible")).toBe("true");
  await complete();
  expect(fold()?.dataset.foldState).toBe("open");
  expect(fold()?.style.overflow).toBe("");
  expect(child()).not.toBeNull();
});

it.each([undefined, 420])(
  "opens and closes immediately with reduced motion (duration: %s)",
  (durationMs) => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
        }) as MediaQueryList,
    );
    render(false, true, durationMs);
    render(true, true, durationMs);
    expect(fold()?.dataset.foldState).toBe("open");
    expect(fold()?.style.overflow).toBe("");
    render(false, true, durationMs);
    expect(fold()).toBeNull();
  },
);

it("does not expose nested surfaces while the containing view is hidden", () => {
  render(true, false);
  expect(child()?.getAttribute("data-visible")).toBe("false");
  render(true);
  expect(child()?.getAttribute("data-visible")).toBe("true");
});

it("does not prepare lazy content until opening and retains it through closing", async () => {
  const content = vi.fn(() => createElement(Child));
  const renderLazy = (expanded: boolean) =>
    act(() =>
      root.render(
        createElement(AnimatedCollapse, { expanded, children: content }),
      ),
    );
  renderLazy(false);
  expect(content).not.toHaveBeenCalled();
  renderLazy(true);
  expect(child()).not.toBeNull();
  renderLazy(false);
  expect(fold()?.dataset.foldState).toBe("closing");
  expect(child()?.getAttribute("data-visible")).toBe("false");
  await complete();
  expect(child()).toBeNull();
  content.mockClear();
  renderLazy(false);
  expect(content).not.toHaveBeenCalled();
});

it("retains state after first opening, hides settled content and defers hidden updates", async () => {
  const mount = vi.fn();
  const unmount = vi.fn();
  function StatefulChild({ label }: { label: string }) {
    const [count, setCount] = useState(0);
    const visible = useSurfaceVisibility();
    useEffect(() => {
      mount();
      return unmount;
    }, []);
    return createElement(
      "button",
      {
        "data-visible": visible,
        onClick: () => setCount((value) => value + 1),
      },
      `${label}: ${count}`,
    );
  }
  const prepare = vi.fn((label: string) => createElement(StatefulChild, { label }));
  const retained = (expanded: boolean, label: string, parentVisible = true) =>
    render(expanded, parentVisible, undefined, undefined, {
      keepMounted: true,
      children: () => prepare(label),
    });
  retained(false, "First");
  expect(prepare).not.toHaveBeenCalled();
  expect(fold()).toBeNull();
  retained(true, "First");
  const button = child()!;
  act(() => button.click());
  expect(button.textContent).toBe("First: 1");
  retained(false, "First");
  expect(fold()?.hidden).toBe(false);
  expect(fold()?.inert).toBe(true);
  expect(button.getAttribute("data-visible")).toBe("false");
  prepare.mockClear();
  await complete();
  expect(fold()?.hidden).toBe(true);
  expect(fold()?.style.display).toBe("none");
  retained(false, "Updated");
  expect(prepare).not.toHaveBeenCalled();
  expect(child()).toBe(button);
  expect(button.textContent).toBe("First: 1");
  expect(unmount).not.toHaveBeenCalled();
  retained(true, "Updated");
  expect(child()).toBe(button);
  expect(button.textContent).toBe("Updated: 1");
  expect(fold()?.hidden).toBe(false);
  expect(fold()?.style.display).toBe("");
  expect(button.getAttribute("data-visible")).toBe("true");
  expect(mount).toHaveBeenCalledOnce();
  // An expanded disclosure also stops parent-prop work when its sidebar hides.
  retained(true, "Updated", false);
  expect(button.getAttribute("data-visible")).toBe("false");
  prepare.mockClear();
  retained(true, "Latest", false);
  expect(prepare).not.toHaveBeenCalled();
  retained(true, "Latest");
  expect(button.textContent).toBe("Latest: 1");
  expect(button.getAttribute("data-visible")).toBe("true");
});

it("retains hidden content immediately with reduced motion", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  const options = { keepMounted: true };
  render(false, true, undefined, undefined, options);
  expect(fold()).toBeNull();
  render(true, true, undefined, undefined, options);
  const button = child();
  render(false, true, undefined, undefined, options);
  expect(child()).toBe(button);
  expect(fold()?.hidden).toBe(true);
  expect(fold()?.inert).toBe(true);
  expect(fold()?.style.overflow).toBe("hidden");
  expect(child()?.getAttribute("data-visible")).toBe("false");
  render(true, true, undefined, undefined, options);
  expect(child()).toBe(button);
  expect(fold()?.dataset.foldState).toBe("open");
  expect(fold()?.hidden).toBe(false);
  expect(fold()?.style.overflow).toBe("");
});

it("notifies only after entering, not on mount or while opening", async () => {
  const onEntered = vi.fn();
  render(true, true, undefined, undefined, { onEntered });
  expect(onEntered).not.toHaveBeenCalled();
  render(false, true, undefined, undefined, { onEntered });
  await complete();
  render(true, true, undefined, undefined, { onEntered });
  expect(onEntered).not.toHaveBeenCalled();
  await complete();
  expect(onEntered).toHaveBeenCalledOnce();
  render(true, true, undefined, undefined, { onEntered });
  expect(onEntered).toHaveBeenCalledOnce();
});
