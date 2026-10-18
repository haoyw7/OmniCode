// @vitest-environment happy-dom
import { act, createElement, Fragment, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarTabId } from "../../features/settings/model/appearance";
import { SidebarTabs } from "./SidebarTabs";

let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;

function deferredPanel() {
  let resolve!: () => void;
  const gate = {
    ready: false,
    promise: new Promise<void>((accept) => {
      resolve = accept;
    }),
    release() {
      gate.ready = true;
      resolve();
    },
  };
  return gate;
}

async function renderHarness(
  gates: Partial<Record<SidebarTabId, ReturnType<typeof deferredPanel>>> = {},
) {
  const onTabChange = vi.fn();
  const panelRender = vi.fn();
  let setExternalTab!: (tab: SidebarTabId) => void;

  function Panel({ tab }: { tab: SidebarTabId }) {
    panelRender(tab);
    const gate = gates[tab];
    if (gate && !gate.ready) throw gate.promise;
    return createElement("div", { "data-current-panel": tab }, tab);
  }

  function Harness() {
    const [tab, setTab] = useState<SidebarTabId>("sessions");
    setExternalTab = setTab;
    return createElement(
      Fragment,
      null,
      createElement(SidebarTabs, {
        tab,
        onTabChange: (next) => {
          onTabChange(next);
          setTab(next);
        },
      }),
      createElement(Panel, { tab }),
    );
  }

  await act(async () => {
    // One boundary retains the committed parent/strip props until the target
    // panel is ready, while optimistic updates can render the strip itself.
    root.render(
      createElement(
        Suspense,
        { fallback: "Loading panel" },
        createElement(Harness),
      ),
    );
  });
  return { onTabChange, panelRender, setExternalTab };
}

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((element) => element.textContent === label)!;
}

function selectedLabel() {
  return container.querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent;
}

function currentPanel() {
  return container.querySelector("[data-current-panel]")?.textContent;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

function pointer(target: EventTarget, type: string, clientX: number) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX,
        clientY: 12,
      }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  document.documentElement.style.removeProperty("--motion-reorder-duration");
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

describe("sidebar tab selection feedback", () => {
  it("opens a ready panel with the selection without waiting for animation frames", async () => {
    const { onTabChange, panelRender } = await renderHarness();

    await click("Changes");
    expect(selectedLabel()).toBe("Changes");
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("changes");
    expect(panelRender).toHaveBeenCalledWith("changes");
    expect(currentPanel()).toBe("changes");
    expect(frames.size).toBe(0);
  });

  it("keeps ready panels in step with rapid clicks in both directions", async () => {
    const { onTabChange } = await renderHarness();
    await click("Changes");
    expect(selectedLabel()).toBe("Changes");
    expect(currentPanel()).toBe("changes");
    await click("Explorer");
    expect(selectedLabel()).toBe("Explorer");
    expect(currentPanel()).toBe("files");
    await click("Sessions");
    expect(selectedLabel()).toBe("Sessions");
    expect(currentPanel()).toBe("sessions");
    expect(onTabChange.mock.calls).toEqual([
      ["changes"],
      ["files"],
      ["sessions"],
    ]);
    expect(frames.size).toBe(0);
  });

  it("opens the panel immediately when motion is reduced", async () => {
    document.documentElement.dataset.reducedMotion = "on";
    const { onTabChange } = await renderHarness();
    await click("Changes");
    expect(frames.size).toBe(0);
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("changes");
    expect(currentPanel()).toBe("changes");
  });

  it("selects the requested tab before its suspended parent update commits", async () => {
    const files = deferredPanel();
    const { onTabChange, panelRender } = await renderHarness({ files });

    await click("Explorer");

    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("files");
    expect(panelRender).toHaveBeenCalledWith("files");
    expect(currentPanel()).toBe("sessions");
    expect(selectedLabel()).toBe("Explorer");
    expect(
      container.querySelector<HTMLElement>('[role="tablist"]')!.style
        .getPropertyValue("--sidebar-active-tab"),
    ).toBe("1");

    await act(async () => files.release());
    expect(currentPanel()).toBe("files");
    expect(selectedLabel()).toBe("Explorer");
  });

  it("keeps the latest rapid selection when earlier panels finish later", async () => {
    const files = deferredPanel();
    const changes = deferredPanel();
    const { onTabChange } = await renderHarness({ files, changes });

    await click("Explorer");
    expect(selectedLabel()).toBe("Explorer");
    await click("Changes");
    expect(selectedLabel()).toBe("Changes");
    await click("Sessions");
    expect(selectedLabel()).toBe("Sessions");
    expect(currentPanel()).toBe("sessions");
    expect(onTabChange.mock.calls).toEqual([
      ["files"],
      ["changes"],
      ["sessions"],
    ]);

    await act(async () => {
      changes.release();
      files.release();
    });
    expect(selectedLabel()).toBe("Sessions");
    expect(currentPanel()).toBe("sessions");
  });

  it("accepts an external controlled selection over a pending click", async () => {
    const files = deferredPanel();
    const { setExternalTab, onTabChange } = await renderHarness({ files });

    await click("Explorer");
    expect(selectedLabel()).toBe("Explorer");
    await act(async () => setExternalTab("changes"));
    expect(currentPanel()).toBe("changes");
    expect(selectedLabel()).toBe("Changes");

    await act(async () => files.release());
    expect(currentPanel()).toBe("changes");
    expect(selectedLabel()).toBe("Changes");
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("files");
  });

  it("reorders without selecting the dragged tab and permits a fresh click", async () => {
    const { onTabChange } = await renderHarness();
    document.documentElement.dataset.reducedMotion = "on";
    const wrappers = container.querySelectorAll<HTMLElement>(".workspace-tab");
    wrappers.forEach((node, index) => {
      node.getBoundingClientRect = () => new DOMRect(index * 100, 0, 100, 24);
      const captured = new Set<number>();
      node.setPointerCapture = (id) => {
        captured.add(id);
      };
      node.hasPointerCapture = (id) => captured.has(id);
      node.releasePointerCapture = (id) => {
        captured.delete(id);
      };
    });

    pointer(button("Explorer"), "pointerdown", 150);
    pointer(window, "pointermove", 250);
    pointer(window, "pointerup", 250);
    await click("Explorer");

    expect(onTabChange).not.toHaveBeenCalled();
    expect(selectedLabel()).toBe("Sessions");
    expect(
      JSON.parse(localStorage.getItem("monocode.sidebarTabOrder")!),
    ).toEqual(["sessions", "changes", "files"]);

    pointer(button("Explorer"), "pointerdown", 250);
    pointer(window, "pointerup", 250);
    await click("Explorer");
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith("files");
    expect(selectedLabel()).toBe("Explorer");
  });
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
