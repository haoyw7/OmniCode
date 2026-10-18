// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { startMotionClock, motionFrame, stopMotionClock } from "./motionTestClock";
import { MobileDrawer } from "./MobileDrawer";
import { lightImpact } from "./haptics";
import { applyReducedMotion } from "../shared/lib/reducedMotion";

vi.mock("./haptics", () => ({ lightImpact: vi.fn() }));

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  vi.mocked(lightImpact).mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  setUiLanguage("en");
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  applyReducedMotion("system");
});
function render(open = true, props: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const onSession = vi.fn();
  const onSessionActions = vi.fn();
  const base: HostSessionSummary = {
    id: "recent",
    title: "Recent conversation",
    projectId: "project",
    harness: "codex",
    status: "idle",
    revision: 1,
    updatedAt: 100,
  };
  act(() =>
    root.render(
      createElement(MobileDrawer, {
        open,
        onOpenChange,
        projects: [{ id: "project", name: "Project", cwd: "/project" }],
        project: { id: "project", name: "Project", cwd: "/project" },
        sessions: [
          base,
          { ...base, id: "pinned", title: "Pinned conversation", pinned: true },
          {
            ...base,
            id: "archived",
            title: "Archived conversation",
            archived: true,
          },
        ],
        loading: false,
        unreadIds: new Set<string>(),
        now: 100,
        hostName: "Host",
        hostStatus: { state: "connected" },
        loadSessions: async () => [],
        onHome: () => {},
        onAllProjects: () => {},
        onSession,
        onSessionActions,
        onNewSession: () => {},
        onSettings: () => {},
        ...props,
      }),
    ),
  );
  return { onOpenChange, onSession, onSessionActions };
}
const row = () =>
  node.querySelector<HTMLButtonElement>('[data-session-id="recent"]')!;
function touch(type: string, y = 100, x = 100, target: Element = row()) {
  const event = new PointerEvent(type, {bubbles: true, pointerId: 1, isPrimary: true, pointerType: "touch", button: 0, clientX:x, clientY:y});
  Object.defineProperties(event, {pageX: {value:x}, pageY:{value:y}});
  act(() => { target.dispatchEvent(event); });
}
function frame() { act(() => { vi.advanceTimersByTime(16); motionFrame(); }); }
async function settle() {
  await act(async () => { for(let i=0;i<60;i++) { motionFrame(); await Promise.resolve(); }
    for (const element of node.querySelectorAll("*")) for (const animation of element.getAnimations()) animation.finish();
    await Promise.resolve(); });
}
function touchMove(target: Element) {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event.defaultPrevented;
}
function captureOn(panel: HTMLElement) {
  const captured = new Set<number>();
  panel.setPointerCapture = vi.fn((id) => { captured.add(id); });
  panel.hasPointerCapture = (id) => captured.has(id);
  panel.releasePointerCapture = vi.fn((id) => { captured.delete(id); });
  return captured;
}
describe("mobile sidebar sessions", async () => {
  it("settles reduced-motion open and close on the first paint", () => {
    applyReducedMotion("on");
    render();
    act(() => motionFrame(1));
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    Object.defineProperty(panel, "offsetWidth", { value: 300 });
    render(false);
    act(() => motionFrame(1));
    expect(panel.style.transform).toBe("translateX(-300px)");
    expect(panel.parentElement!.dataset.settledClosed).toBe("true");
    render(true);
    act(() => motionFrame(1));
    expect(panel.style.transform).toBe("none");
    expect(panel.parentElement!.dataset.settledClosed).toBeUndefined();
  });
  it("pauses retained spinners without pausing the drawer's closing transition", async () => {
    const props = { sessions: [{
      id: "running", title: "Working", projectId: "project", harness: "codex", status: "running", revision: 1, updatedAt: 100,
    }] };
    render(false, props);
    const spinner = node.querySelector(".mobile-spin")!;
    const layer = node.querySelector<HTMLElement>(".mobile-drawer-backdrop")!;
    expect(spinner.hasAttribute("data-animation-paused")).toBe(true);
    render(true, props);
    expect(spinner.hasAttribute("data-animation-paused")).toBe(false);
    render(true, { ...props, foreground: false });
    expect(spinner.hasAttribute("data-animation-paused")).toBe(true);
    render(true, props);
    expect(spinner.hasAttribute("data-animation-paused")).toBe(false);
    render(false, props);
    expect(spinner.hasAttribute("data-animation-paused")).toBe(true);
    expect(layer.dataset.settledClosed).toBeUndefined();
    expect(layer.hasAttribute("data-animation-paused")).toBe(false);
  });

  it("keeps the glass layer through closing and a rapid reversal, then releases it", async () => {
    render(false);
    const layer = node.querySelector<HTMLElement>(".mobile-drawer-backdrop")!;
    expect(layer.dataset.settledClosed).toBe("true");
    render(true);
    expect(layer.dataset.settledClosed).toBeUndefined();
    render(false);
    act(() => vi.advanceTimersByTime(100));
    expect(layer.dataset.settledClosed).toBeUndefined();
    render(true);
    await settle();
    expect(layer.dataset.settledClosed).toBeUndefined();
    render(false);
    expect(layer.dataset.settledClosed).toBeUndefined();
    await settle();
    expect(layer.dataset.settledClosed).toBe("true");
  });

  it("finishes closing and ignores pulls while its owning page is inactive", async () => {
    render();
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    Object.defineProperty(panel, "offsetWidth", { value: 300 });
    touch("pointerdown", 100, 250);
    touch("pointermove", 100, 100);
    // Happy DOM snapshots listeners during dispatch; deliver the position to
    // the Motion pan listener installed when the drawer claims the gesture.
    touch("pointermove", 100, 100);
    frame();
    expect(panel.style.transform).toBe("translateX(-150px)");
    const { onOpenChange } = render(true, { active: false });
    expect(node.querySelector(".mobile-drawer")).toBe(panel);
    await settle();
    expect(panel.style.transform).toBe("translateX(-300px)");
    expect(panel.parentElement!.dataset.open).toBe("false");
    expect(panel.parentElement!.hasAttribute("inert")).toBe(true);
    const chat = document.createElement("main");
    chat.className = "mobile-chat";
    document.body.append(chat);
    touch("pointerdown", 100, 20, chat);
    touch("pointermove", 100, 250, chat);
    touch("pointerup", 100, 250, chat);
    chat.remove();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("lists pinned conversations first and hides archives", async () => {
    render();
    expect(
      [
        ...node.querySelectorAll(
          ".mobile-drawer-group .mobile-session-row strong",
        ),
      ].map((el) => el.textContent),
    ).toEqual(["Pinned conversation", "Recent conversation"]);
    expect(node.textContent).not.toContain("Archived conversation");
  });
  it("opens a conversation on a short tap", async () => {
    const { onSession, onSessionActions } = render();
    touch("pointerdown");
    act(() => vi.advanceTimersByTime(200));
    touch("pointerup");
    act(() => row().click());
    act(() => vi.advanceTimersByTime(500));
    expect(onSession).toHaveBeenCalledWith("recent", {
      id: "project",
      name: "Project",
      cwd: "/project",
    });
    expect(onSessionActions).not.toHaveBeenCalled();
    expect(lightImpact).not.toHaveBeenCalled();
  });
  it("opens actions on a hold and suppresses the release tap, then accepts a fresh tap", async () => {
    const { onSession, onSessionActions } = render();
    touch("pointerdown");
    act(() => vi.advanceTimersByTime(450));
    expect(onSessionActions).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "recent" }), row(), {
      x: 100,
      y: 100,
    });
    expect(lightImpact).toHaveBeenCalledOnce();
    touch("pointerup");
    act(() => row().click());
    expect(onSession).not.toHaveBeenCalled();
    expect(lightImpact).toHaveBeenCalledOnce();
    touch("pointerdown");
    touch("pointerup");
    act(() => row().click());
    expect(onSession).toHaveBeenCalledOnce();
  });
  it("opens actions for a pinned conversation from another project", async () => {
    const other = { id: "other", name: "Other", cwd: "/other" };
    const pinned: HostSessionSummary = {
      id: "other-pinned",
      title: "Other pinned",
      projectId: other.id,
      harness: "codex",
      status: "idle",
      revision: 1,
      updatedAt: 100,
      pinned: true,
    };
    const { onSessionActions } = render(true, {
      projects: [{ id: "project", name: "Project", cwd: "/project" }, other],
      cachedSessions: (id: string) => id === other.id ? [pinned] : undefined,
    });
    const target = node.querySelector('[data-session-id="other-pinned"]')!;
    touch("pointerdown", 100, 100, target);
    act(() => vi.advanceTimersByTime(450));
    expect(onSessionActions).toHaveBeenCalledExactlyOnceWith(pinned, target, { x: 100, y: 100 });
    await act(async () => {});
  });

  it("leaves scroll gestures to the list without opening actions or navigating", async () => {
    const { onSession, onSessionActions } = render();
    touch("pointerdown");
    touch("pointermove", 160);
    act(() => vi.advanceTimersByTime(500));
    touch("pointerup", 160);
    act(() => row().click());
    expect(onSessionActions).not.toHaveBeenCalled();
    expect(onSession).not.toHaveBeenCalled();
  });
  it("cancels a hold when the touch is cancelled or the drawer unmounts", async () => {
    const { onSessionActions } = render();
    touch("pointerdown");
    touch("pointercancel");
    act(() => vi.advanceTimersByTime(500));
    expect(onSessionActions).not.toHaveBeenCalled();
    touch("pointerdown");
    act(() => root.render(null));
    act(() => vi.advanceTimersByTime(500));
    expect(onSessionActions).not.toHaveBeenCalled();
  });
  it("offers the same actions from a context menu without opening the conversation", async () => {
    const { onSession, onSessionActions } = render();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 72,
      clientY: 112,
    });
    act(() => row().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onSessionActions).toHaveBeenCalledWith(expect.objectContaining({ id: "recent" }), row(), {
      x: 72,
      y: 112,
    });
    expect(onSession).not.toHaveBeenCalled();
  });
  it("closes when the open panel is pushed from a session row, without opening it", async () => {
    const { onOpenChange, onSession } = render();
    touch("pointerdown");
    touch("pointermove", 100, 60);
    touch("pointermove", 100, 20);
    touch("pointerup", 100, 20);
    act(() => row().click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(lightImpact).toHaveBeenCalledOnce();
    expect(onSession).not.toHaveBeenCalled();
  });
  it("closes from a push that starts anywhere on screen, outside the drawer", async () => {
    const { onOpenChange } = render();
    Object.defineProperty(node.querySelector(".mobile-drawer"), "offsetWidth", {
      value: 300,
    });
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    touch("pointerdown", 100, 360, elsewhere);
    touch("pointermove", 100, 300, elsewhere);
    touch("pointermove", 100, 150, elsewhere);
    touch("pointerup", 100, 150, elsewhere);
    elsewhere.remove();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("follows a push that reverses mid-gesture and stays open", async () => {
    const { onOpenChange } = render();
    Object.defineProperty(node.querySelector(".mobile-drawer"), "offsetWidth", {
      value: 300,
    });
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    touch("pointerdown", 100, 250);
    touch("pointermove", 100, 200);
    touch("pointermove", 100, 100);
    frame();
    expect(panel.style.transform).toBe("translateX(-150px)");
    act(() => vi.advanceTimersByTime(100));
    touch("pointermove", 100, 230);
    frame();
    expect(panel.style.transform).toBe("translateX(-20px)");
    touch("pointerup", 100, 230);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(lightImpact).not.toHaveBeenCalled();
  });
  it("coalesces Motion drag updates and returns to the open stop after cancellation", async () => {
    const { onOpenChange } = render();
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    touch("pointerdown", 100, 250);
    touch("pointermove", 100, 200);
    touch("pointermove", 100, 100);
    frame();
    expect(panel.style.transform).toBe("translateX(-150px)");
    touch("pointermove", 100, 230);
    touch("pointercancel", 0, 0);
    await settle();
    expect(panel.style.transform).toBe("none");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("discards a pending drag frame when a covering surface takes ownership", async () => {
    render();
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    Object.defineProperty(panel, "offsetWidth", { value: 300 });
    touch("pointerdown", 100, 250);
    touch("pointermove", 100, 100);
    render(true, { covered: true });
    frame();
    await settle();
    expect(panel.style.transform).toBe("none");
    expect(panel.parentElement!.dataset.dragging).toBeUndefined();
  });
  it("hands the settled position back to the stylesheet when a drag ends", async () => {
    render();
    Object.defineProperty(node.querySelector(".mobile-drawer"), "offsetWidth", {
      value: 300,
    });
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    const backdrop = node.querySelector<HTMLElement>(
      ".mobile-drawer-backdrop",
    )!;
    const progress = () =>
      backdrop.style.getPropertyValue("--mobile-drawer-progress");
    expect(progress()).toBe("1");
    touch("pointerdown", 100, 250);
    touch("pointermove", 100, 200);
    touch("pointermove", 100, 100);
    frame();
    expect(backdrop.dataset.dragging).toBe("true");
    expect(progress()).toBe("0.5");
    act(() => vi.advanceTimersByTime(100));
    touch("pointermove", 100, 240);
    touch("pointerup", 100, 240);
    expect(backdrop.dataset.dragging).toBeUndefined();
    await settle();
    expect(panel.style.transform).toBe("none");
    expect(progress()).toBe("1");
  });
  it("keeps the browser from claiming a touch the drawer is dragging", async () => {
    render();
    const move = () => {
      const event = new Event("touchmove", { bubbles: true, cancelable: true });
      act(() => row().dispatchEvent(event));
      return event.defaultPrevented;
    };
    touch("pointerdown");
    expect(move()).toBe(false);
    touch("pointermove", 100, 60);
    expect(move()).toBe(true);
    touch("pointerup", 100, 60);
    expect(move()).toBe(false);
  });
  it("finishes a drag when a session refresh replaces the original touch target", async () => {
    const summary: HostSessionSummary = {
      id: "recent", title: "Recent conversation", projectId: "project", harness: "codex",
      status: "idle", revision: 1, updatedAt: 100,
    };
    const onOpenChange = vi.fn();
    render(true, { sessions: [summary], onOpenChange });
    const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
    Object.defineProperty(panel, "offsetWidth", { value: 300 });
    const captured = captureOn(panel);
    const target = row().querySelector("small > span")!;
    touch("pointerdown", 100, 250, target);
    touch("pointermove", 100, 200, target);
    expect(captured.has(1)).toBe(true);

    render(true, { sessions: [{ ...summary, status: "running", revision: 2 }], onOpenChange });
    expect(target.isConnected).toBe(false);
    expect(row().querySelector(".mobile-spin")).not.toBeNull();
    // Native Touch Events remain on this detached span. Pointer capture only
    // routes Pointer Events, so it cannot replace this preventDefault path.
    expect(touchMove(target)).toBe(true);
    touch("pointermove", 100, 20, panel);
    touch("pointerup", 100, 20, panel);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(captured.size).toBe(0);
    expect(touchMove(target)).toBe(false);
  });
  it.each(["pointerup", "pointercancel", "tap", "scroll", "covered", "inactive", "unmount", "longpress"])(
    "releases the original touch target and pointer capture after %s",
    (exit) => {
      render();
      const panel = node.querySelector<HTMLElement>(".mobile-drawer")!;
      const captured = captureOn(panel);
      const target = row().querySelector("small > span")!;
      touch("pointerdown", 100, 250, target);
      if (!["tap", "scroll", "longpress"].includes(exit)) {
        touch("pointermove", 100, 200, target);
        expect(captured.has(1)).toBe(true);
      }
      if (exit === "scroll") touch("pointermove", 160, 250, target);
      else if (exit === "covered") render(true, { covered: true });
      else if (exit === "inactive") render(true, { active: false });
      else if (exit === "unmount") act(() => root.render(null));
      else if (exit === "longpress") act(() => vi.advanceTimersByTime(450));
      else touch(exit === "tap" ? "pointerup" : exit, 100, 200, panel);
      expect(captured.size).toBe(0);

      render();
      target.remove();
      // A later drag must not reactivate a leaked listener on the old target.
      touch("pointerdown", 100, 250);
      touch("pointermove", 100, 200);
      expect(touchMove(row())).toBe(true);
      expect(touchMove(target)).toBe(false);
      touch("pointercancel", 100, 200);
    },
  );
  it("leaves pushes on a sheet above the drawer alone", async () => {
    const { onOpenChange } = render();
    const sheet = document.createElement("div");
    sheet.className = "mobile-sheet-backdrop";
    document.body.append(sheet);
    touch("pointerdown", 100, 300, sheet);
    touch("pointermove", 100, 100, sheet);
    touch("pointerup", 100, 100, sheet);
    sheet.remove();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("opens when the conversation is pulled from a button", async () => {
    const { onOpenChange } = render(false);
    Object.defineProperty(node.querySelector(".mobile-drawer"), "offsetWidth", {
      value: 300,
    });
    const chat = document.createElement("main");
    chat.className = "mobile-chat";
    const tool = document.createElement("button");
    const clicked = vi.fn();
    tool.addEventListener("click", clicked);
    chat.append(tool);
    document.body.append(chat);
    touch("pointerdown", 100, 20, tool);
    touch("pointermove", 100, 80, tool);
    touch("pointermove", 100, 200, tool);
    touch("pointerup", 100, 200, tool);
    act(() => tool.click());
    chat.remove();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(lightImpact).toHaveBeenCalledOnce();
    expect(clicked).not.toHaveBeenCalled();
  });
  it("leaves pulls that start in a text field alone", async () => {
    const { onOpenChange } = render(false);
    const chat = document.createElement("main");
    chat.className = "mobile-chat";
    const field = document.createElement("textarea");
    chat.append(field);
    document.body.append(chat);
    touch("pointerdown", 100, 20, field);
    touch("pointermove", 100, 200, field);
    touch("pointerup", 100, 200, field);
    chat.remove();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
describe("mobile sidebar recents", async () => {
  const projects = [
    { id: "android", name: "Android", cwd: "/mnt/data/Android" },
    { id: "codex", name: "monocode", cwd: "/home/wy/Documents/Codex/monocode" },
    { id: "project", name: "monocode", cwd: "/projects/monocode" },
  ];
  const project = projects[2];
  const ids = (area = ".mobile-drawer-sessions") =>
    [...node.querySelectorAll(`${area} .mobile-session-row`)].map((item) =>
      item.getAttribute("data-session-id"),
    );
  const pinnedIds = () => ids('[aria-label="Pinned"]');
  const recentIds = () => ids('[aria-label="Recents"]');
  const session = (
    projectId: string,
    updatedAt: number,
    extra: Partial<HostSessionSummary> = {},
  ): HostSessionSummary => ({
    id: `${projectId}-chat`,
    title: `${projectId} chat`,
    projectId,
    harness: "codex",
    status: "idle",
    revision: 1,
    updatedAt,
    ...extra,
  });

  it("keeps the mounted hidden list unchanged and uses the latest rows and actions on reopening", async () => {
    const onOpenChange = vi.fn();
    const loadSessions = vi.fn(async () => []);
    const onSession = vi.fn();
    const props = { onOpenChange, loadSessions, projects: [project], project };
    render(false, { ...props, sessions: [session(project.id, 1, { title: "Old title" })] });
    const panel = node.querySelector(".mobile-drawer");
    const sessions = [session(project.id, 2, { title: "Latest title" })];
    render(false, { ...props, sessions, onSession, now: 200 });
    expect(node.textContent).toContain("Old title");
    expect(node.textContent).not.toContain("Latest title");
    render(true, { ...props, sessions, onSession, now: 200 });
    expect(node.querySelector(".mobile-drawer")).toBe(panel);
    expect(node.textContent).toContain("Latest title");
    act(() => node.querySelector<HTMLButtonElement>('[data-session-id="project-chat"]')!.click());
    expect(onSession).toHaveBeenCalledExactlyOnceWith("project-chat", project);
  });

  it("does not render session rows again for unchanged background refreshes", async () => {
    const title = vi.fn(() => "Cached conversation");
    const item = session("android", 100);
    Object.defineProperty(item, "title", { get: title });
    const history = [item];
    const loadSessions = vi.fn(async () => history);
    await act(async () => render(true, {
      projects: [projects[0]], project: undefined, sessions: [], loadSessions,
      cachedSessions: () => history,
    }));
    title.mockClear();
    loadSessions.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(loadSessions).toHaveBeenCalledTimes(2);
    expect(title).not.toHaveBeenCalled();
  });

  it("keeps pinned rows in place as background activity changes and still updates their content", async () => {
    let history = [
      session("android", 200, { id: "first-pin", pinned: true }),
      session("android", 100, { id: "second-pin", pinned: true }),
      session("android", 50, { id: "recent" }),
    ];
    const loadSessions = vi.fn(async () => structuredClone(history));
    const props = { projects: [projects[0]], project: undefined, sessions: [], loadSessions };
    await act(async () => render(true, props));
    expect(pinnedIds()).toEqual(["first-pin", "second-pin"]);
    const second = node.querySelector('[data-session-id="second-pin"]');
    const changes = vi.fn();
    const observer = new MutationObserver(changes);
    observer.observe(second!.parentElement!, { childList: true });
    try {
      history = history.map((item) => item.id === "second-pin"
        ? { ...item, updatedAt: 300, revision: 2, title: "Waiting for approval", needsInput: true }
        : item);
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(pinnedIds()).toEqual(["first-pin", "second-pin"]);
      expect(node.querySelector('[data-session-id="second-pin"]')).toBe(second);
      expect(second?.textContent).toContain("Waiting for approval");
      expect(second?.textContent).toContain("Needs input");
      expect(changes).not.toHaveBeenCalled();

      history = history.map((item) => item.id === "first-pin" ? { ...item, updatedAt: 400 } : item);
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(pinnedIds()).toEqual(["first-pin", "second-pin"]);
      expect(changes).not.toHaveBeenCalled();
    } finally { observer.disconnect(); }
  });

  it("places newly pinned rows first and removes unpinned or archived rows from the pin order", () => {
    const first = session(project.id, 200, { id: "first-pin", pinned: true });
    const second = session(project.id, 100, { id: "second-pin", pinned: true });
    const recent = session(project.id, 50, { id: "recent" });
    const props = { projects: [project], project };
    render(true, { ...props, sessions: [first, second, recent] });
    render(true, { ...props, sessions: [first, second, { ...recent, pinned: true }] });
    expect(pinnedIds()).toEqual(["recent", "first-pin", "second-pin"]);
    render(true, { ...props, sessions: [{ ...first, pinned: false }, { ...second, archived: true }, { ...recent, pinned: true }] });
    expect(pinnedIds()).toEqual(["recent"]);
    expect(recentIds()).toEqual(["first-pin"]);
    render(true, { ...props, sessions: [first, { ...second, archived: true }, { ...recent, pinned: true }] });
    expect(pinnedIds()).toEqual(["first-pin", "recent"]);
  });
  it.each([false, true])("shows pending input before running for a pinned=%s conversation and clears it after responding", (pinned) => {
    const waiting = session(project.id, 100, { status: "running", needsInput: true, pinned });
    const props = { projects: [project], project, sessions: [waiting], unreadIds: new Set([waiting.id]) };
    const { onSession } = render(true, props);
    const row = () => node.querySelector<HTMLButtonElement>(`[data-session-id="${waiting.id}"]`)!;
    expect(row().textContent).toContain("Needs input");
    expect(row().querySelector(".mobile-spin")).toBeNull();
    expect(row().querySelector('[aria-label="Unread reply"]')).not.toBeNull();
    act(() => row().click());
    expect(onSession).toHaveBeenCalledExactlyOnceWith(waiting.id, project);
    act(() => setUiLanguage("zh-CN"));
    expect(row().textContent).toContain("需要输入");

    render(true, { ...props, sessions: [{ ...waiting, needsInput: false }] });
    expect(row().textContent).not.toContain("需要输入");
    expect(row().hasAttribute("data-needs-input")).toBe(false);
    expect(row().querySelector(".mobile-spin")).not.toBeNull();

    render(true, { ...props, sessions: [{ ...waiting, needsInput: false, status: "idle" }] });
    expect(row().querySelector(".mobile-spin")).toBeNull();
    expect(row().querySelector(".mobile-session-attention")).toBeNull();
  });
  it("uses cached activity on first open and refreshes the order when reopened", async () => {
    const cache = new Map(projects.map((owner, index) => [owner.id, [session(owner.id, index * 100)]]));
    const cachedSessions = (id: string) => cache.get(id);
    const loadSessions = vi.fn(() => new Promise<HostSessionSummary[]>(() => {}));
    const props = { projects, project: undefined, sessions: [], cachedSessions, loadSessions };
    render(true, props);
    expect(recentIds()).toEqual(["project-chat", "codex-chat", "android-chat"]);
    expect(node.querySelector(".mobile-drawer-group-status")).toBeNull();
    render(false, props);
    cache.set("android", [session("android", 500)]);
    render(true, props);
    expect(recentIds()).toEqual(["android-chat", "project-chat", "codex-chat"]);
  });
  it("holds uncached history in loading state until it arrives", async () => {
    const responses = new Map<string, (sessions: HostSessionSummary[]) => void>();
    const loadSessions = (id: string) => new Promise<HostSessionSummary[]>((done) => { responses.set(id, done); });
    await act(async () => render(true, { projects, project, sessions: [], loadSessions }));
    expect(recentIds()).toHaveLength(0);
    expect(node.querySelector('.mobile-drawer-sessions .mobile-loading[role="status"]')).not.toBeNull();
    await act(async () => {
      responses.get("android")!([session("android", 10)]);
      responses.get("codex")!([session("codex", 100)]);
    });
    expect(recentIds()).toEqual(["codex-chat", "android-chat"]);
    expect(node.querySelector('.mobile-drawer-sessions .mobile-loading[role="status"]')).toBeNull();
  });
  it("lists pins from every project above recents, names their projects and hides archives", async () => {
    const loadSessions = vi.fn(async (id: string) =>
      id === "android"
        ? [session(id, 90), session(id, 1_000, { id: "archived", archived: true })]
        : [session(id, 200, { pinned: true })],
    );
    await act(async () => render(true, { projects, project, loadSessions }));
    expect(pinnedIds()).toEqual(["codex-chat", "pinned"]);
    expect(recentIds()).toEqual(["recent", "android-chat"]);
    expect(node.querySelector('[data-session-id="archived"]')).toBeNull();
    expect(
      node.querySelector('[data-session-id="android-chat"] .mobile-drawer-session-project')?.textContent,
    ).toBe("Android");
  });
  it("opens another project's conversation in that project and offers its actions", async () => {
    const loadSessions = vi.fn(async (id: string) => [session(id, 500)]);
    const { onSession, onSessionActions } = render(true, { projects, project, loadSessions });
    await act(async () => {});
    const other = node.querySelector<HTMLButtonElement>('[data-session-id="android-chat"]')!;
    expect(other.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => other.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onSessionActions).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "android-chat", projectId: "android" }), other, undefined);
    act(() => vi.advanceTimersByTime(500));
    act(() => other.click());
    expect(onSession).toHaveBeenCalledExactlyOnceWith("android-chat", projects[0]);
  });
  it("refreshes other projects, preserves history on failure and stops polling while closed", async () => {
    let recent = 20;
    let failed = false;
    const loadSessions = vi.fn(async (id: string) => {
      if (failed) throw new Error("Offline");
      return [session(id, id === "android" ? recent : 50)];
    });
    const props = { projects, project: undefined, sessions: [], loadSessions };
    await act(async () => render(false, props));
    expect(loadSessions).not.toHaveBeenCalled();
    await act(async () => render(true, props));
    expect(recentIds()[2]).toBe("android-chat");
    recent = 100;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(recentIds()[0]).toBe("android-chat");
    failed = true;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(recentIds()[0]).toBe("android-chat");
    await act(async () => render(false, props));
    loadSessions.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(loadSessions).not.toHaveBeenCalled();
    failed = false;
    await act(async () => render(true, props));
    expect(loadSessions).toHaveBeenCalledTimes(3);
    await act(async () => render(true, { ...props, foreground: false }));
    loadSessions.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(loadSessions).not.toHaveBeenCalled();
  });
  it("offers a retry for a project whose history never loaded", async () => {
    let failed = true;
    const loadSessions = vi.fn(async (id: string) => {
      if (failed) throw new Error("Offline");
      return [session(id, 10)];
    });
    await act(async () => render(true, { projects: [projects[0]], project: undefined, sessions: [], loadSessions }));
    const retry = node.querySelector<HTMLButtonElement>("button.mobile-drawer-group-status")!;
    expect(retry.textContent).toContain("Android");
    failed = false;
    await act(async () => retry.click());
    await settle();
    expect(recentIds()).toEqual(["android-chat"]);
    expect(node.querySelector("button.mobile-drawer-group-status")).toBeNull();
  });
  it("shares an in-flight history request on reopening and refreshes at the next interval", async () => {
    let resolveOld!: (sessions: HostSessionSummary[]) => void;
    const old = new Promise<HostSessionSummary[]>((resolve) => {
      resolveOld = resolve;
    });
    const loadSessions = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce([session("android", 100)]);
    const props = { projects: [projects[0]], project: undefined, sessions: [], loadSessions };
    await act(async () => render(true, props));
    await act(async () => render(false, props));
    await act(async () => render(true, props));
    expect(loadSessions).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolveOld([session("android", 50, { title: "First response" })]),
    );
    expect(node.querySelector('[data-session-id="android-chat"] strong')?.textContent).toBe("First response");
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(loadSessions).toHaveBeenCalledTimes(2);
    expect(
      node.querySelector('[data-session-id="android-chat"] strong')?.textContent,
    ).toBe("android chat");
  });
  it("shows twenty recent conversations until Show more", async () => {
    const base = {
      projectId: "project",
      harness: "codex" as const,
      status: "idle" as const,
      revision: 1,
    };
    const sessions = Array.from({ length: 24 }, (_, index) => ({
      ...base,
      id: `chat-${index}`,
      title: `Chat ${index}`,
      updatedAt: 100 - index,
    }));
    render(true, { sessions, sessionId: "chat-7" });
    expect(recentIds()).toHaveLength(20);
    act(() =>
      node.querySelector<HTMLButtonElement>(".mobile-drawer-more")!.click(),
    );
    expect(recentIds()).toHaveLength(24);
    expect(node.querySelector(".mobile-drawer-more")?.textContent).toBe(
      "Show less",
    );
  });
  it("keeps Assistant, Sessions and new conversation visible and reveals Projects under More", async () => {
    const onAssistant = vi.fn();
    const onHome = vi.fn();
    const onAllProjects = vi.fn();
    const onNewSession = vi.fn();
    await act(async () =>
      render(true, { projects, project, onAssistant, assistantName: "My helper", onHome, onAllProjects, onNewSession }),
    );
    expect(node.querySelector(".mobile-drawer-project-link")).toBeNull();
    expect(node.querySelector(".mobile-drawer-all-projects")).toBeNull();
    expect(node.querySelector(".mobile-drawer-open-project")).toBeNull();
    const assistant = node.querySelector<HTMLButtonElement>(".mobile-drawer-assistant")!;
    expect(assistant.textContent).toBe("My helper");
    act(() => assistant.click());
    expect(onAssistant).toHaveBeenCalledOnce();
    act(() =>
      [...node.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Sessions")!
        .click(),
    );
    expect(onHome).toHaveBeenCalledOnce();
    act(() =>
      node.querySelector<HTMLButtonElement>(".mobile-drawer-new")!.click(),
    );
    expect(onNewSession).toHaveBeenLastCalledWith(project);
    const more = node.querySelector<HTMLButtonElement>(".mobile-drawer-more-toggle")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const disclosure = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(disclosure.querySelector(".mobile-drawer-all-projects")).not.toBeNull();
    const allProjects = node.querySelector<HTMLButtonElement>(".mobile-drawer-all-projects")!;
    act(() => allProjects.click());
    expect(onAllProjects).toHaveBeenCalledOnce();
    expect(node.textContent).not.toContain("Open project");
    await settle();
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // Closing actions remain mounted for the animation but cannot be focused.
    expect(allProjects.closest("[inert]")).not.toBeNull();
    await settle();
    expect(node.querySelector(".mobile-drawer-all-projects")).toBeNull();
  });
});

it("shows the assistant unread count with its custom name and hides the badge after reading", async () => {
  const props = { onAssistant: vi.fn(), assistantName: "My helper" };
  const badge = () => node.querySelector(".mobile-drawer-assistant-badge");
  const assistant = () => node.querySelector(".mobile-drawer-assistant")!;
  render(true, { ...props, assistantUnreadCount: 3 });
  expect(badge()?.textContent).toBe("3");
  expect(assistant().getAttribute("aria-label")).toBe("My helper, 3 unread messages");
  render(true, { ...props, assistantUnreadCount: 120 });
  expect(badge()?.textContent).toBe("99+");
  act(() => setUiLanguage("zh-CN"));
  expect(assistant().getAttribute("aria-label")).toBe("My helper，120 条未读消息");
  render(true, props);
  expect(badge()).toBeNull();
  expect(assistant().textContent).toBe("My helper");
});

it("shows the Notes entry only when supplied by a capable Host", async () => {
  render();
  act(() => node.querySelector<HTMLButtonElement>(".mobile-drawer-more-toggle")!.click());
  const notes = () => [...node.querySelectorAll<HTMLButtonElement>(".mobile-drawer-item")].find((button) => button.textContent === "Notes");
  expect(notes()).toBeUndefined();
  const onNotes = vi.fn();
  render(true, { onNotes });
  act(() => notes()!.click());
  expect(onNotes).toHaveBeenCalledOnce();
});
