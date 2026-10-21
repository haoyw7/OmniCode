// @vitest-environment happy-dom
import {
  act,
  createElement,
  memo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { PaneTree } from "./PaneTree";
import * as paneResize from "../../../shared/lib/paneResize";

const paneRenders = vi.hoisted(() => ({
  session: vi.fn(),
  file: vi.fn(),
  layout: vi.fn(),
}));
vi.mock("./SessionSurfacePane", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SessionSurfacePane")>();
  return {
    SessionSurfacePane: (
      props: ComponentProps<typeof actual.SessionSurfacePane>,
    ) => {
      paneRenders.layout();
      return createElement(actual.SessionSurfacePane, props);
    },
  };
});
vi.mock("../../connections/files/ui/FilePane", () => ({
  FilePane: memo((props: { tabsTrailing?: ReactNode }) => {
    paneRenders.file(props);
    return props.tabsTrailing;
  }),
}));
vi.mock("../../sessions/ui/SessionPane", () => ({
  SessionPane: memo(
    (props: { session: Session; onOpenFile: (path: string) => void }) => {
      paneRenders.session(props);
      return createElement("button", {
        "data-session-pane": props.session.id,
        onClick: () => props.onOpenFile("src/example.ts"),
      });
    },
  ),
}));

let container: HTMLDivElement;
let root: Root;
let pendingFrame: FrameRequestCallback | undefined;
let layoutRect: DOMRect;
const resizeObservers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();

// happy-dom has no layout engine. Supply only this fixture's sizing-track
// geometry; the actual v4 hit testing, constraints and drag lifecycle still run.
function fixtureRect(element: HTMLElement): DOMRect | undefined {
  if (element.hasAttribute("data-pane-tree-layout")) return layoutRect;
  if (element.hasAttribute("data-pane-sash-group")) {
    return new DOMRect(
      layoutRect.x + parseFloat(element.style.left) / 100 * layoutRect.width,
      layoutRect.y + parseFloat(element.style.top) / 100 * layoutRect.height,
      parseFloat(element.style.width) / 100 * layoutRect.width,
      parseFloat(element.style.height) / 100 * layoutRect.height,
    );
  }
  const group = element.parentElement;
  if (!group?.hasAttribute("data-pane-sash-group")) return;
  const rect = fixtureRect(group)!;
  const row = group.style.flexDirection === "row";
  const panels = Array.from(group.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute("data-panel"),
  );
  const total = panels.reduce((sum, panel) => sum + (parseFloat(panel.style.flexGrow) || 1), 0);
  let offset = 0;
  for (const child of group.children) {
    const fraction = child instanceof HTMLElement && child.hasAttribute("data-panel")
      ? (parseFloat(child.style.flexGrow) || 1) / total : 0;
    if (child === element) return row
      ? new DOMRect(rect.x + offset * rect.width, rect.y, fraction * rect.width, rect.height)
      : new DOMRect(rect.x, rect.y + offset * rect.height, rect.width, fraction * rect.height);
    offset += fraction;
  }
}

function measureFixture() {
  act(() => {
    for (const observer of [...resizeObservers]) {
      const entries = [...observer.targets].map(target => {
        const contentRect = target.getBoundingClientRect();
        return { target, contentRect, borderBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }] } as ResizeObserverEntry;
      });
      observer.callback(entries, {} as ResizeObserver);
    }
  });
}

beforeEach(() => {
  layoutRect = new DOMRect(100, 100, 1000, 800);
  resizeObservers.clear();
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return fixtureRect(this) ?? originalRect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function () {
    return fixtureRect(this)?.width ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function () {
    return fixtureRect(this)?.height ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function () {
    return (fixtureRect(this)?.x ?? 0) - (this.parentElement && fixtureRect(this.parentElement)?.x || 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function () {
    return (fixtureRect(this)?.y ?? 0) - (this.parentElement && fixtureRect(this.parentElement)?.y || 0);
  });
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { resizeObservers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { resizeObservers.delete(this); }
  });
  paneRenders.session.mockClear();
  paneRenders.file.mockClear();
  paneRenders.layout.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    pendingFrame = undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  pendingFrame = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(
  dir: "right" | "down",
  patch: Partial<ComponentProps<typeof PaneTree>> = {},
) {
  const noop = vi.fn();
  const onRatio = vi.fn();
  let props: ComponentProps<typeof PaneTree> = {
    visible: true,
    layout: {
      type: "split",
      id: "split",
      dir,
      children: [
        { type: "leaf", id: "first" },
        { type: "leaf", id: "second" },
      ],
      sizes: [0.5, 0.5],
    },
    sessions: [],
    editorPanes: [],
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: "first",
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onCloseOtherFiles: noop,
    onReorderFiles: noop,
    onFileDirtyChange: noop,
    onFileErrorCountChange: noop,
    onRatio,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: noop,
    onDeleteQueuedMessage: noop,
    onReorderQueuedMessage: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
    onMovePane: noop,
    ...patch,
  };
  act(() => root.render(createElement(PaneTree, props)));
  measureFixture();
  // happy-dom does not implement ARIAMixin's reflected ariaDisabled property.
  for (const item of container.querySelectorAll<HTMLElement>('[role="separator"]')) {
    Object.defineProperty(item, "ariaDisabled", { get: () => item.getAttribute("aria-disabled") });
  }
  const separator = container.querySelector<HTMLElement>('[role="separator"]')!;
  const handle = separator;
  const capture = new Set<number>();
  handle.setPointerCapture = (id) => capture.add(id);
  handle.hasPointerCapture = (id) => capture.has(id);
  handle.releasePointerCapture = (id) => capture.delete(id);
  return {
    onRatio,
    separator,
    handle,
    capture,
    rerender(patch: Partial<ComponentProps<typeof PaneTree>>) {
      props = { ...props, ...patch };
      act(() => root.render(createElement(PaneTree, props)));
    },
  };
}

function pointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerType: "mouse",
        pointerId,
        clientX,
        clientY,
      }),
    ),
  );
}

describe("workspace split resize handles", () => {
  it("lets tools cover a lone conversation while its rendered minimum stays fixed", () => {
    const { handle, separator, onRatio } = render("right", {
      sessions: [{ id: "first", title: "Chat", cwd: "/project", blocks: [] } as unknown as Session],
    });
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 200, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("10");
    const chat = container.querySelector<HTMLElement>('[data-pane-id="first"]')!;
    expect(chat.style.minWidth).toBe("var(--desktop-conversation-min-width)");
    pointer(handle, "pointerup", 200, 500);
    expect(onRatio).toHaveBeenCalledExactlyOnceWith("split", 0, expect.closeTo(0.1));
  });

  it("keeps side-by-side chats inside their slots and their divider movable when narrow", () => {
    const { handle, separator } = render("right", {
      sessions: ["first", "second"].map(
        (id) => ({ id, title: id, cwd: "/project", blocks: [] }) as unknown as Session,
      ),
    });
    for (const id of ["first", "second"]) {
      const chat = container.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
      expect(chat.style.minWidth).toBe("");
      expect(chat.hasAttribute("data-pane-chat")).toBe(true);
    }
    const tree = container.querySelector<HTMLElement>("[data-pane-tree-layout]")!;
    expect(tree.hasAttribute("data-chat-tiles")).toBe(true);
    // Two 420px chats cannot fit 600px; the compact minimum keeps them draggable.
    layoutRect = new DOMRect(100, 100, 600, 800);
    measureFixture();
    pointer(handle, "pointerdown", 400, 500);
    pointer(handle, "pointermove", 0, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("40");
    pointer(handle, "pointermove", 900, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("60");
    pointer(handle, "pointerup", 900, 500);
  });

  it("keeps chat and editor subtrees memoized throughout sash resizing", () => {
    const { handle } = render("right", {
      sessions: [
        {
          id: "first",
          title: "Chat",
          cwd: "/project",
          blocks: [],
        } as unknown as Session,
      ],
      editorPanes: [
        {
          id: "second",
          activeFileId: "file",
          files: [{ id: "file", path: "/project/example.ts", cwd: "/project" }],
        },
      ],
      onOpenSessionFile: vi.fn(),
    });
    expect(paneRenders.session).toHaveBeenCalledTimes(1);
    expect(paneRenders.file).toHaveBeenCalledTimes(1);
    expect(paneRenders.layout).toHaveBeenCalledTimes(2);
    pointer(handle, "pointerdown", 600, 500);
    for (let frame = 1; frame <= 10; frame += 1) {
      pointer(handle, "pointermove", 600 + frame * 10, 500);
      act(() => pendingFrame?.(frame));
    }
    pointer(handle, "pointerup", 700, 500);
    expect(paneRenders.session).toHaveBeenCalledTimes(1);
    expect(paneRenders.file).toHaveBeenCalledTimes(1);
    expect(paneRenders.layout).toHaveBeenCalledTimes(2);
  });

  it("clamps both ends of a tool split and permits an immediate reversal and second drag", () => {
    const { handle, separator, onRatio } = render("right");
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 50, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("28");
    pointer(handle, "pointermove", 1500, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("72");
    pointer(handle, "pointermove", 650, 500);
    pointer(handle, "pointerup", 650, 500);
    expect(onRatio).toHaveBeenLastCalledWith("split", 0, 0.55);
    pointer(handle, "pointerdown", 650, 500);
    pointer(handle, "pointermove", 50, 500);
    pointer(handle, "pointerup", 50, 500);
    expect(onRatio).toHaveBeenLastCalledWith("split", 0, 0.28);
  });

  it("uses the latest file handlers and keeps the source session after focus and session changes", () => {
    const first = {
      id: "first",
      title: "First",
      cwd: "/project",
      blocks: [],
    } as unknown as Session;
    const second = {
      id: "second",
      title: "Second",
      cwd: "/project",
      blocks: [],
    } as unknown as Session;
    const original = vi.fn();
    const latest = vi.fn();
    const fallback = vi.fn();
    const { rerender } = render("right", {
      sessions: [first, second],
      onOpenSessionFile: original,
      onOpenFile: fallback,
    });
    const open = (id: string) =>
      act(() =>
        container
          .querySelector(`[data-session-pane="${id}"]`)!
          .dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
    rerender({ onOpenSessionFile: latest });
    expect(paneRenders.session).toHaveBeenCalledTimes(2);
    rerender({ focusedId: "second" });
    open("first");
    open("second");
    expect(latest.mock.calls).toEqual([
      ["src/example.ts", "first"],
      ["src/example.ts", "second"],
    ]);
    expect(original).not.toHaveBeenCalled();
    rerender({ sessions: [second] });
    rerender({ sessions: [first, second], onOpenSessionFile: undefined });
    open("first");
    expect(fallback).toHaveBeenCalledExactlyOnceWith("src/example.ts");
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it.each(["right", "down"] as const)(
    "previews and commits a %s grid split with transitions disabled until release",
    (dir) => {
      const { onRatio, separator, handle, capture } = render(dir, {
        sessions: [{ id: "first", title: "Chat", cwd: "/project", blocks: [] } as unknown as Session],
      });
      const grid = container.querySelector<HTMLElement>("[data-pane-tree-layout]")!;
      const previousCursor = document.body.style.cursor;
      expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
      expect(separator.getAttribute("aria-orientation")).toBe(
        dir === "right" ? "vertical" : "horizontal",
      );
      const measure = vi.spyOn(separator, "getBoundingClientRect");
      pointer(handle, "pointerdown", 600, 500);
      expect(capture.has(1)).toBe(true);
      expect(grid.style.transitionProperty).toBe("none");
      const startMeasurements = measure.mock.calls.length;
      expect(startMeasurements).toBeGreaterThan(0);
      pointer(document, "pointermove", 750, 620);
      expect(measure).toHaveBeenCalledTimes(startMeasurements);
      expect(onRatio).not.toHaveBeenCalled();
      expect(separator.getAttribute("aria-valuenow")).toBe("65");
      expect(dir === "right" ? grid.style.gridTemplateColumns : grid.style.gridTemplateRows)
        .toBe("minmax(0, 0.65fr) minmax(0, 0.35fr)");
      expect(grid.style.transitionProperty).toBe("none");
      pointer(handle, "pointerup", 750, 620);
      expect(onRatio).toHaveBeenCalledExactlyOnceWith("split", 0, 0.65);
      expect(capture.has(1)).toBe(false);
      expect(grid.style.transitionProperty).toBe("");
      expect(document.body.style.cursor).toBe(previousCursor);
    },
  );

  it.each(["right", "down"] as const)(
    "moves a %s divider by only the pointer delta when grabbed at the target's far edge",
    (dir) => {
      const { onRatio, handle } = render(dir);
      const row = dir === "right";
      pointer(handle, "pointerdown", row ? 604 : 600, row ? 500 : 504);
      pointer(handle, "pointermove", row ? 605 : 600, row ? 500 : 505);
      act(() => pendingFrame?.(0));

      const pane = container.querySelector<HTMLElement>(
        '[data-pane-id="first"]',
      )!;
      const span = row ? 1000 : 800;
      expect(
        parseFloat(row ? pane.style.width : pane.style.height),
      ).toBeCloseTo(50 + 100 / span);

      pointer(handle, "pointerup", row ? 605 : 600, row ? 500 : 505);
      expect(onRatio).toHaveBeenCalledExactlyOnceWith(
        "split",
        0,
        0.5 + 1 / span,
      );
    },
  );

  it("restores the original ratio on Escape", () => {
    const { onRatio, separator, handle, capture } = render("right");
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 750, 500);
    act(() => pendingFrame?.(0));
    expect(separator.getAttribute("aria-valuenow")).toBe("65");
    pointer(handle, "pointermove", 800, 500);
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
    expect(pendingFrame).toBeUndefined();
    expect(onRatio).not.toHaveBeenCalled();
    expect(capture.has(1)).toBe(false);
  });

  it("immediately paints a diff/assistant horizontal split and commits the final move without rendering its panes", () => {
    const { handle, separator, onRatio } = render("down", {
      editorPanes: ["first", "second"].map((id, index) => ({
        id,
        activeFileId: id,
        files: [
          { id, path: index ? "app:assistant" : "changes", cwd: "/project" },
        ],
      })),
    });
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 600, 560);
    pointer(document, "pointermove", 600, 620);
    expect(separator.getAttribute("aria-valuenow")).toBe("65");
    expect(onRatio).not.toHaveBeenCalled();
    act(() => pendingFrame?.(0));
    expect(separator.getAttribute("aria-valuenow")).toBe("65");
    pointer(handle, "pointermove", 600, 660);
    pointer(handle, "pointermove", 600, 700);
    pointer(handle, "pointerup", 600, 700);
    expect(onRatio).toHaveBeenCalledExactlyOnceWith("split", 0, 0.75);
    expect(separator.getAttribute("aria-valuenow")).toBe("75");
    expect(
      container.querySelector<HTMLElement>('[data-pane-id="first"]')!.style
        .height,
    ).toBe("75%");
    expect(pendingFrame).toBeUndefined();
    expect(paneRenders.layout).toHaveBeenCalledTimes(2);
    expect(paneRenders.file).toHaveBeenCalledTimes(2);
  });

  it("keeps the preview across a streaming render and uses the latest commit callback", () => {
    const { handle, separator, rerender } = render("right");
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 750, 500);
    act(() => pendingFrame?.(0));
    const latestCommit = vi.fn();
    rerender({ onRatio: latestCommit });
    expect(separator.getAttribute("aria-valuenow")).toBe("65");
    pointer(handle, "pointermove", 800, 500);
    pointer(handle, "pointerup", 800, 500);
    expect(latestCommit).toHaveBeenCalledExactlyOnceWith("split", 0, 0.7);
  });

  it("updates nested grid tracks, pane placements and neighbouring dividers together", () => {
    const { handle, separator } = render("right", {
      sessions: [
        {
          id: "first",
          title: "Chat",
          cwd: "/project",
          blocks: [],
        } as unknown as Session,
      ],
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        sizes: [0.5, 0.5],
        children: [
          { type: "leaf", id: "first" },
          {
            type: "split",
            id: "nested",
            dir: "down",
            sizes: [0.5, 0.5],
            children: [
              { type: "leaf", id: "second" },
              { type: "leaf", id: "third" },
            ],
          },
        ],
      },
    });
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 750, 500);
    act(() => pendingFrame?.(0));
    const grid = container.querySelector<HTMLElement>(
      "[data-pane-tree-layout]",
    )!;
    expect(grid.style.gridTemplateColumns).toBe(
      "minmax(0, 0.65fr) minmax(0, 0.35fr)",
    );
    expect(
      container.querySelector<HTMLElement>('[data-pane-id="first"]')!.style
        .gridRow,
    ).toBe("1 / 3");
    const nested = container.querySelector<HTMLElement>(
      '[data-pane-sash-group="nested:0"]',
    )!;
    expect(nested.style.left).toBe("65%");
    expect(nested.style.width).toBe("35%");
    expect(separator.getBoundingClientRect().left).toBe(750);
    pointer(handle, "pointercancel", 750, 500);
    expect(grid.style.gridTemplateColumns).toBe(
      "minmax(0, 0.5fr) minmax(0, 0.5fr)",
    );
    expect(grid.style.transitionProperty).toBe("");
  });

  it("ignores other pointers and cancels pending work when capture is lost or the layout unmounts", () => {
    const { handle, separator, capture, onRatio } = render("right");
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 800, 500, 2);
    pointer(handle, "pointerup", 800, 500, 2);
    expect(capture.has(1)).toBe(true);
    expect(pendingFrame).toBeUndefined();
    pointer(handle, "pointermove", 750, 500);
    act(() => pendingFrame?.(0));
    pointer(handle, "lostpointercapture", 750, 500);
    expect(separator.getAttribute("aria-valuenow")).toBe("50");
    expect(onRatio).not.toHaveBeenCalled();
    pointer(handle, "pointerdown", 600, 500);
    pointer(handle, "pointermove", 750, 500);
    act(() => root.render(null));
    expect(pendingFrame).toBeUndefined();
    expect(capture.size).toBe(0);
    expect(onRatio).not.toHaveBeenCalled();
  });

});

it("defers tool reflow during a dock resize and fits the final measured width on release", () => {
  let resizing = false;
  let settled = () => {};
  // Drive the external dock's lifecycle independently of the fixture's Motion
  // animations, whose animation frames are intentionally paused in this file.
  vi.spyOn(paneResize, "isPaneResizing").mockImplementation(() => resizing);
  vi.spyOn(paneResize, "onPaneResizeSettled").mockImplementation(callback => {
    settled = callback;
    return () => { settled = () => {}; };
  });
  const observations: { target: Element; callback: ResizeObserverCallback }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { observations.push({ target, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
  const onFitLayout = vi.fn();
  render("right", {
    sessions: [{ id: "first", title: "Chat", cwd: "/project", blocks: [] } as unknown as Session],
    layout: { type: "split", id: "split", dir: "right", sizes: [0.5, 0.25, 0.25], children: [
      { type: "leaf", id: "first" }, { type: "leaf", id: "second" }, { type: "leaf", id: "third" },
    ] },
    onFitLayout,
  });
  const measure = (width: number) => act(() => {
    for (const observation of observations.filter(item => item.target.hasAttribute("data-pane-tree-layout"))) {
      observation.callback([
        { target: observation.target, contentRect: { width } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    }
  });
  expect(observations.some(item => item.target.hasAttribute("data-pane-tree-layout"))).toBe(true);
  measure(1200);
  expect(onFitLayout).not.toHaveBeenCalled();
  resizing = true;
  try {
    measure(800);
    measure(700);
    expect(onFitLayout).not.toHaveBeenCalled();
  } finally { resizing = false; act(settled); }
  expect(onFitLayout).toHaveBeenCalledOnce();
  expect(onFitLayout.mock.calls[0][1].children[1].dir).toBe("down");
});
