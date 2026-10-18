// @vitest-environment happy-dom
import { act, createElement, Suspense, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "../../../shared/i18n/language";
import { lazySurface } from "../../../shared/ui/lazySurface";
import {
  AppViewHost,
  AppViewRendererContext,
  type AppViewRenderer,
} from "./AppViewHost";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLanguage("en");
  vi.unstubAllGlobals();
});

function render(renderView: AppViewRenderer, visible: boolean, focused = true) {
  act(() => root.render(createElement(
    AppViewRendererContext.Provider,
    { value: renderView },
    createElement(AppViewHost, { kind: "search", visible, focused }),
  )));
}

describe("AppViewHost", () => {
  it("keeps the shell visible during an urgent first activation of a lazy view", async () => {
    const LoadedView = () => createElement("main", null, "Search content");
    let resolve!: (module: { default: typeof LoadedView }) => void;
    const pending = new Promise<{ default: typeof LoadedView }>((done) => {
      resolve = done;
    });
    const load = vi.fn(() => pending);
    // App's lazy views rely on their parent's boundary rather than owning one.
    const LazyView = lazySurface(load, { suspense: false });
    const renderer: AppViewRenderer = () => createElement(LazyView);
    const draw = (visible: boolean) => root.render(createElement(
      Suspense,
      { fallback: createElement("div", { "data-blank-shell": true }, "blank shell") },
      createElement("div", { "data-shell": true },
        createElement("header", null, "Shell navigation"),
        createElement(AppViewRendererContext.Provider, { value: renderer },
          createElement(AppViewHost, { kind: "search", visible, focused: true }),
        ),
      ),
    ));

    await act(async () => draw(false));
    const shell = container.querySelector<HTMLElement>("[data-shell]")!;
    expect(load).not.toHaveBeenCalled();

    // Do not use startTransition: ordinary tab activation must also protect chrome.
    await act(async () => draw(true));
    expect(load).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-shell]")).toBe(shell);
    expect(shell.style.display).not.toBe("none");
    expect(container.querySelector("[data-blank-shell]")).toBeNull();
    const status = shell.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("Loading…");

    act(() => setUiLanguage("zh-CN"));
    expect(status.textContent).toBe("正在加载…");
    expect(shell.style.display).not.toBe("none");

    await act(async () => resolve({ default: LoadedView }));
    expect(shell.querySelector('[role="status"]')).toBeNull();
    expect(shell.querySelector("main")!.textContent).toBe("Search content");
    expect(container.querySelector("[data-blank-shell]")).toBeNull();
    expect(shell.style.display).not.toBe("none");
  });

  it("waits for first visibility and distinguishes focus from visibility", () => {
    const renderer = vi.fn((_kind, active) => createElement("div", null, String(active)));
    render(renderer, false);
    expect(renderer).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
    render(renderer, true, false);
    expect(renderer).toHaveBeenLastCalledWith("search", false);
    render(renderer, true, true);
    expect(renderer).toHaveBeenLastCalledWith("search", true);
  });

  it("freezes renderer updates while hidden and resumes with current props", () => {
    const before = vi.fn((_kind, active) => createElement("div", null, `old:${active}`));
    const after = vi.fn((_kind, active) => createElement("div", null, `new:${active}`));
    render(before, true);
    render(before, false);
    expect(before).toHaveBeenCalledTimes(2);
    expect(before).toHaveBeenLastCalledWith("search", false);
    render(after, false);
    expect(after).not.toHaveBeenCalled();
    expect(container.textContent).toBe("old:false");
    render(after, true);
    expect(after).toHaveBeenLastCalledWith("search", true);
    expect(container.textContent).toBe("new:true");
  });

  it("keeps local state, scroll position and its mounted instance across tab switches", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function View({ active }: { active: boolean }) {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return createElement("div", { "data-scroller": true },
        createElement("button", {
          "data-active": active,
          onClick: () => setCount((value) => value + 1),
        }, String(count)),
      );
    }
    const renderer: AppViewRenderer = (_kind, active) => createElement(View, { active });
    render(renderer, true);
    const button = container.querySelector("button")!;
    const scroller = container.querySelector<HTMLElement>("[data-scroller]")!;
    act(() => button.click());
    // This checks DOM retention; layout/scrollable height is verified in a browser.
    scroller.scrollTop = 120;
    expect(button.textContent).toBe("1");
    render(renderer, false);
    render((_kind, active) => createElement(View, { active }), false);
    render(renderer, true);
    expect(container.querySelector("button")).toBe(button);
    expect(container.querySelector("[data-scroller]")).toBe(scroller);
    expect(scroller.scrollTop).toBe(120);
    expect(button.textContent).toBe("1");
    expect(button.dataset.active).toBe("true");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });
});
