// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { useSurfaceVisibility } from "../shared/ui/SurfaceVisibility";
import { MobilePageOverlay, MobilePageTransition, mobileRouteDirection, type MobileRoute } from "./MobilePageTransition";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { useMobilePageState } from "./mobilePageState";
import { applyReducedMotion } from "../shared/lib/reducedMotion";

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  applyReducedMotion("system");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const route = (key: string, section: MobileRoute["section"] = "home", depth = 0): MobileRoute => ({ key, section, depth });
function Page({ name }: { name: string }) {
  const visible = useSurfaceVisibility();
  const [count, setCount] = useState(0);
  const [expanded, setExpanded] = useMobilePageState("expanded", false);
  return createElement("main", { className: "mobile-home-scroll", "data-visible": visible },
    createElement("button", { onClick: () => setCount((value) => value + 1) }, `${name}:${count}`),
    createElement("button", { "data-expand": true, onClick: () => setExpanded(!expanded) }, String(expanded)),
  );
}
const render = (key: string, name = key, visible = true) => act(() => root.render(
  createElement(MobilePageTransition, { route: route(key), visible, children: createElement(Page, { name }) }),
));
const current = () => node.querySelector<HTMLElement>('[data-page-active="true"]')!;
const finish = async () => {
  await act(async () => {
    for (let frame = 0; frame < 40; frame++) { motionFrame(); await Promise.resolve(); }
  });
};

describe("mobile page transitions", async () => {
  it("starts without motion, then freezes an inert outgoing page until exit completes", async () => {
    render("home");
    expect(current().hasAttribute("data-page-motion")).toBe(false);
    render("chat", "loading");
    const outgoing = node.querySelector<HTMLElement>('[data-page-active="false"]')!;
    expect(outgoing.textContent).toContain("home");
    expect(outgoing.hasAttribute("inert")).toBe(true);
    expect(outgoing.getAttribute("aria-hidden")).toBe("true");
    expect(outgoing.querySelector("main")?.dataset.visible).toBe("false");
    render("chat", "loaded");
    expect(outgoing.textContent).toContain("home");
    expect(current().textContent).toContain("loaded");
    await finish();
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
  });

  it("keeps the same page instance for loading, streaming, and draft edits", async () => {
    render("chat", "loading");
    const layer = current();
    const button = layer.querySelector("button")!;
    act(() => button.click());
    render("chat", "streaming");
    expect(current()).toBe(layer);
    expect(current().querySelector("button")).toBe(button);
    expect(button.textContent).toBe("streaming:1");
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
  });

  it("reverses to the retained page without resetting its local state", async () => {
    render("home");
    const home = current();
    act(() => home.querySelector("button")!.click());
    render("chat");
    render("home");
    expect(current()).toBe(home);
    expect(current().textContent).toContain("home:1");
    await finish();
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
    expect(current().hasAttribute("inert")).toBe(false);
  });

  it("bounds rapid navigation to two layers and ignores an older exit completion", async () => {
    render("home");
    render("project");
    render("chat");
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(2);
    expect(node.textContent).not.toContain("home:");
    await finish();
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
    expect(current().textContent).toContain("chat:");
  });

  it("restores list expansion and scroll offsets after the old DOM was released", async () => {
    render("home");
    const home = current().querySelector("main")!;
    act(() => home.querySelector<HTMLButtonElement>("[data-expand]")!.click());
    home.scrollTop = 420;
    home.dispatchEvent(new Event("scroll"));
    render("chat");
    await finish();
    render("home");
    expect(current().querySelector("main")).not.toBe(home);
    expect(current().querySelector("main")!.scrollTop).toBe(420);
    expect(current().querySelector("[data-expand]")!.textContent).toBe("true");
  });

  it("makes the covered page invisible without replacing it", async () => {
    render("chat");
    const page = current();
    render("chat", "chat", false);
    expect(current()).toBe(page);
    expect(page.hasAttribute("inert")).toBe(true);
    expect(page.querySelector("main")!.dataset.visible).toBe("false");
    render("chat");
    expect(page.querySelector("main")!.dataset.visible).toBe("true");
  });

  it("skips retained exits when reduced motion is enabled", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    render("home");
    render("chat");
    expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
    expect(current().hasAttribute("data-page-motion")).toBe(false);
  });

  it("settles reduced-motion forward and backward navigation by the first paint", () => {
    applyReducedMotion("on");
    render("home");
    for (const key of ["chat", "home"]) {
      render(key);
      act(() => motionFrame(0));
      expect(node.querySelectorAll(".mobile-page-layer")).toHaveLength(1);
      expect(current().textContent).toContain(`${key}:`);
      expect(current().style.transform).toBe("none");
      expect(current().style.opacity).toBe("1");
      expect(current().hasAttribute("data-page-motion")).toBe(false);
      expect(current().hasAttribute("inert")).toBe(false);
    }
  });

  it("uses hierarchy for page direction and a fade for siblings", async () => {
    expect(mobileRouteDirection(route("root"), route("project", "home", 2))).toBe(1);
    expect(mobileRouteDirection(route("chat", "chat"), route("root"))).toBe(-1);
    expect(mobileRouteDirection(route("a", "chat"), route("b", "chat"))).toBe(0);
    expect(mobileRouteDirection(route("root", "settings"), route("appearance", "settings", 1))).toBe(1);
    expect(mobileRouteDirection(route("glass", "settings", 2), route("appearance", "settings", 1))).toBe(-1);
  });

  it.each([
    { key: "root", depth: 0 },
    { key: "all", depth: 1 },
    { key: "project", depth: 2 },
  ])("pushes chat forward from the $key list and returns back to it", ({ key, depth }) => {
    const home = route(`home:${key}`, "home", depth);
    const chat = route("chat:session", "chat", 3);
    expect(mobileRouteDirection(home, chat)).toBe(1);
    expect(mobileRouteDirection(chat, home)).toBe(-1);
  });

  it("keeps home/chat direction even when section depths differ from the current hierarchy", async () => {
    const project = route("home:project", "home", 2);
    const chat = route("chat:session", "chat", 0);
    expect(mobileRouteDirection(project, chat)).toBe(1);
    expect(mobileRouteDirection(chat, project)).toBe(-1);
  });

  it("uses home depth for ancestors and leaves same-depth siblings neutral", async () => {
    const root = route("home:root");
    const all = route("home:all", "home", 1);
    const project = route("home:project", "home", 2);
    expect(mobileRouteDirection(root, all)).toBe(1);
    expect(mobileRouteDirection(all, project)).toBe(1);
    expect(mobileRouteDirection(project, all)).toBe(-1);
    expect(mobileRouteDirection(all, root)).toBe(-1);
    expect(mobileRouteDirection(project, route("home:other", "home", 2))).toBe(0);
  });
});

it("retains the assistant for an inert exit and supports reopening", async () => {
  const show = (open: boolean) => act(() => root.render(createElement(MobilePageOverlay,
    { open, children: createElement(Page, { name: "assistant" }) })));
  show(false);
  expect(node.querySelector("main")).toBeNull();
  show(true);
  const page = node.querySelector("main");
  show(false);
  expect(node.querySelector("main")).toBe(page);
  expect(node.querySelector(".mobile-page-overlay")!.hasAttribute("inert")).toBe(true);
  show(true);
  await finish();
  expect(node.querySelector("main")).toBe(page);
  show(false);
  await finish();
  expect(node.querySelector("main")).toBeNull();
});
it.each([false, true])("retains an opened overlay after closing when requested (reduced motion: %s)", async (reduced) => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: reduced } as MediaQueryList);
  const show = (open: boolean) => act(() => root.render(createElement(MobilePageOverlay,
    { open, keepMounted: true, children: createElement(Page, { name: "assistant" }) })));
  show(false);
  expect(node.querySelector("main")).toBeNull();
  show(true);
  const page = node.querySelector("main")!;
  act(() => page.querySelector("button")!.click());
  show(false);
  if (!reduced) expect(node.querySelector<HTMLElement>(".mobile-page-overlay")!.hidden).toBe(false);
  await finish();
  const layer = node.querySelector<HTMLElement>(".mobile-page-overlay")!;
  expect(layer.hidden).toBe(true);
  expect(layer.hasAttribute("inert")).toBe(true);
  expect(page.dataset.visible).toBe("false");
  show(true);
  expect(layer.hidden).toBe(false);
  expect(layer.hasAttribute("inert")).toBe(false);
  expect(node.querySelector("main")).toBe(page);
  expect(page.textContent).toContain("assistant:1");
  expect(page.dataset.visible).toBe("true");
});

it("freezes sheet payload on close and prevents late exits from removing a reopened sheet", async () => {
  let exited: (() => void) | undefined;
  function Sheet({ open, value, onExited }: { open?: boolean; value: string; onExited?: () => void }) {
    exited = onExited;
    return createElement("div", { "data-open": open }, value);
  }
  const show = (open: boolean, value: string) => act(() => root.render(createElement(MobileSheetPresence,
    { open, children: createElement(Sheet, { value }) })));
  show(true, "old");
  show(false, "changed");
  expect(node.textContent).toBe("old");
  const lateExit = exited!;
  show(true, "new");
  act(() => lateExit());
  expect(node.textContent).toBe("new");
  show(false, "ignored");
  act(() => exited!());
  expect(node.childElementCount).toBe(0);
});
