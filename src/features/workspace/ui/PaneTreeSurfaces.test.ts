// @vitest-environment happy-dom
import { completeMotionAnimation, motionTestDriver } from "../../../../tests/helpers/motionDriver";
import { duration } from "../../../shared/motion/tokens";
vi.mock("motion/react", async (importOriginal) => { const actual = await importOriginal<typeof import("motion/react")>(); return { ...actual, ...motionTestDriver(actual, true) }; });
import {
  act,
  createElement,
  useEffect,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { layoutLeaves, type EditorPane, type LayoutNode } from "../model/layout";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { isPaneResizing } from "../../../shared/lib/paneResize";
import { PaneTree } from "./PaneTree";
import {
  SessionHeaderActionsContext,
  type SessionHeaderActions,
} from "./SessionHeaderActions";

const lifetime = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("../../connections/files/ui/FilePane", () => ({
  FilePane: ({
    pane,
    visible,
    showTabs,
    tabsTrailing,
    tabsLeading,
  }: {
    pane: EditorPane;
    visible: boolean;
    showTabs: boolean;
    tabsTrailing?: ReactNode;
    tabsLeading?: ReactNode;
  }) => {
    useEffect(() => {
      lifetime.mounts += 1;
      return () => {
        lifetime.unmounts += 1;
      };
    }, []);
    return createElement(
      "div",
      {
        "data-file-pane": pane.id,
        "data-visible": visible,
        "data-portals-visible": useSurfaceVisibility(),
        "data-show-tabs": showTabs,
      },
      createElement("input", { defaultValue: "terminal/editor local state" }),
      showTabs ? tabsLeading : undefined,
      showTabs ? tabsTrailing : undefined,
    );
  },
}));
vi.mock("../../sessions/ui/SessionPane", () => ({
  SessionPane: ({
    session,
    visible,
    onOpenFile,
    renderHeader,
    inSplit,
  }: {
    session: Session;
    visible: boolean;
    onOpenFile: (path: string) => void;
    renderHeader?: (session: Session) => ReactNode;
    inSplit: boolean;
  }) =>
    createElement(
      "div",
      {
        "data-session-pane": session.id,
        "data-visible": visible,
        "data-portals-visible": useSurfaceVisibility(),
      },
      renderHeader
        ? renderHeader(session)
        : inSplit
          ? createElement("div", { "data-legacy-heading": "" }, session.title)
          : null,
      createElement(
        "button",
        {
          "data-open-session-file": "",
          onClick: () => onOpenFile("src/example.ts"),
        },
        "Open session file",
      ),
    ),
}));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof PaneTree>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  lifetime.mounts = 0;
  lifetime.unmounts = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = vi.fn();
  props = {
    visible: true,
    layout: {
      type: "split",
      id: "split",
      dir: "right",
      children: [
        { type: "leaf", id: "chat" },
        { type: "leaf", id: "tools" },
      ],
      sizes: [0.6, 0.4],
    },
    sessions: [
      {
        id: "chat",
        title: "My session",
        cwd: "/project",
        blocks: [],
      } as unknown as Session,
    ],
    editorPanes: [
      {
        id: "tools",
        activeFileId: "file",
        files: [
          { id: "file", path: "/project/example.ts", cwd: "/project" },
          { id: "terminal", path: "Terminal", cwd: "/project", terminal: true },
        ],
      },
    ],
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: "tools",
    surfaceMode: "split",
    composerFocused: false,
    recents: [],
    onFocus: vi.fn(),
    onClose: noop,
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onCloseOtherFiles: noop,
    onReorderFiles: noop,
    onFileDirtyChange: noop,
    onFileErrorCountChange: noop,
    onRatio: noop,
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
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: vi.fn(),
    onOpenSessionFile: vi.fn(),
    onOpenDiff: noop,
    onOpenPlan: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
    onMovePane: noop,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(
  patch: Partial<typeof props> = {},
  headerActions: SessionHeaderActions | null = null,
) {
  props = { ...props, ...patch };
  act(() =>
    root.render(
      createElement(
        SessionHeaderActionsContext.Provider,
        { value: headerActions },
        createElement(PaneTree, props),
      ),
    ),
  );
}
const layout = () =>
  container.querySelector<HTMLElement>("[data-pane-tree-layout]")!;
const pane = (id: string) =>
  container.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
const click = (element: Element) =>
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const settleGrid = () => act(() => completeMotionAnimation(layout()));

describe("session surface layout", () => {
  const headerActions = (): SessionHeaderActions => ({
    rename: vi.fn(),
    archive: vi.fn(),
    splitRight: vi.fn(),
    terminalAvailable: false,
    toggleTerminal: vi.fn(),
    changesOpen: false,
    toggleChanges: vi.fn(),
  });

  it("fits new right panels without remounting editors or replacing a later manual ratio", () => {
    render();
    const editor = pane("tools").querySelector<HTMLInputElement>("input")!;
    editor.value = "unsaved editor state";
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    const fit = vi.fn();
    const columns: LayoutNode = {
      type: "split", id: "columns", dir: "right",
      children: ["chat", "tools", "review"].map(id => ({ type: "leaf", id })),
      sizes: [0.5, 0.25, 0.25],
    };
    render({ layout: columns, onFitLayout: fit, editorPanes: [
      ...props.editorPanes,
      { id: "review", activeFileId: "diff", files: [{ id: "diff", path: "/project", cwd: "/project", changes: true, review: true }] },
    ] });
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0][0]).toBe(columns);
    const fitted = fit.mock.calls[0][1] as LayoutNode;
    const leaves = layoutLeaves(fitted);
    expect(leaves[1].rect.x).toBe(leaves[2].rect.x);
    expect(leaves[1].rect.y).toBeLessThan(leaves[2].rect.y);
    render({ layout: fitted });
    expect(pane("tools").querySelector("input")).toBe(editor);
    expect(editor.value).toBe("unsaved editor state");
    expect(lifetime.unmounts).toBe(0);
    render({ layout: { ...fitted, sizes: [0.75, 0.25] } as LayoutNode });
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("keeps manual tool directions while still repairing widths and retaining editors", () => {
    render();
    const editor = pane("tools").querySelector<HTMLInputElement>("input")!;
    editor.value = "manual layout draft";
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    const fit = vi.fn();
    const columns: LayoutNode = {
      type: "split", id: "columns", dir: "right",
      children: ["chat", "tools", "review"].map(id => ({ type: "leaf", id })),
      sizes: [0.5, 0.25, 0.25],
    };
    render({ layout: columns, autoArrangeTools: false, onFitLayout: fit, editorPanes: [
      ...props.editorPanes,
      { id: "review", activeFileId: "diff", files: [{ id: "diff", path: "/project", cwd: "/project", changes: true, review: true }] },
    ] });
    expect(fit).toHaveBeenCalledTimes(1);
    expect(layoutLeaves(fit.mock.calls[0][1]).every(pane => pane.rect.y === 0)).toBe(true);
    fit.mockClear();
    width.mockReturnValue(1200);
    render({ layout: { ...columns, sizes: [0.8, 0.1, 0.1] } });
    expect(fit).toHaveBeenCalledTimes(1);
    const leaves = layoutLeaves(fit.mock.calls[0][1]);
    expect(leaves.every(pane => pane.rect.y === 0)).toBe(true);
    expect(leaves[2].rect.x).toBeGreaterThan(leaves[1].rect.x);
    expect(leaves[1].rect.w * 1200).toBeGreaterThanOrEqual(280);
    expect(pane("tools").querySelector("input")).toBe(editor);
    expect(editor.value).toBe("manual layout draft");
    expect(lifetime.unmounts).toBe(0);
  });

  it("hides the owning top bar's menu when its workspace tab is hidden", () => {
    const actions = headerActions();
    props.sessions = [{ ...props.sessions[0], harness: "grok" }];
    render({}, actions);
    click(container.querySelector('[data-session-overflow-menu="chat"]')!);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    render({ visible: false }, actions);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    render({ visible: true }, actions);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("promotes only one visible split chat's header without replacing the conversation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    try {
      render();
      const conversation = pane("chat");
      render({ sessionHeaderHost: host });
      expect(host.querySelectorAll("[data-session-surface-tabs]")).toHaveLength(1);
      expect(conversation.querySelector("[data-session-surface-tabs]")).toBeNull();
      expect(pane("chat")).toBe(conversation);
      render({ visible: false });
      expect(host.childElementCount).toBe(0);
      render({ visible: true, sessionHeaderHost: null });
      expect(conversation.querySelector("[data-session-surface-tabs]")).not.toBeNull();
      expect(pane("chat")).toBe(conversation);
    } finally {
      host.remove();
    }
  });

  it("keeps full view's tool toggles in the top bar and its tabs in the pane", () => {
    const host = document.createElement("div");
    document.body.append(host);
    try {
      render({ surfaceMode: "unified", sessionHeaderHost: host }, headerActions());
      expect(host.querySelector('[data-session-header-tools="chat"] [data-session-overflow-menu="chat"]')).not.toBeNull();
      expect(host.querySelector("[data-session-surface-tabs]")).toBeNull();
      const tabs = container.querySelector('[data-session-surface-tabs="chat"]')!;
      expect(tabs).not.toBeNull();
      expect(tabs.querySelector("[data-session-tool-toggle]")).toBeNull();
      expect(tabs.querySelector("[data-session-overflow-menu]")).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("routes each split chat's overflow actions to that chat", () => {
    const actions = headerActions();
    render(
      {
        sessions: [
          { ...props.sessions[0], harness: "grok" },
          {
            ...props.sessions[0],
            id: "other-chat",
            title: "Other chat",
            harness: "grok",
          },
        ],
        layout: {
          type: "split",
          id: "chats",
          dir: "right",
          sizes: [0.5, 0.5],
          children: [
            { type: "leaf", id: "chat" },
            { type: "leaf", id: "other-chat" },
          ],
        },
        editorPanes: [],
        sessionHeaderHost: document.createElement("div"),
        focusedId: "other-chat",
      },
      actions,
    );
    expect(
      container.querySelectorAll("[data-session-overflow-menu]"),
    ).toHaveLength(2);
    click(container.querySelector('[data-session-overflow-menu="chat"]')!);
    click(document.querySelectorAll('[role="menuitem"]')[1]);
    expect(actions.splitRight).toHaveBeenCalledExactlyOnceWith("chat");
    click(
      container.querySelector('[data-session-overflow-menu="other-chat"]')!,
    );
    click([...document.querySelectorAll('[role="menuitem"]')].at(-1)!);
    expect(actions.archive).toHaveBeenCalledExactlyOnceWith("other-chat");
  });

  it("hides the close control for a sole chat even with tool panes open", () => {
    render();
    expect(
      container.querySelectorAll("[data-session-surface-tabs]"),
    ).toHaveLength(1);
    expect(container.querySelector("[data-legacy-heading]")).toBeNull();
    expect(
      container.querySelector('[aria-label="Drag to reorder pane"]'),
    ).not.toBeNull();
    const chatTab = container.querySelector("[data-session-chat-tab]")!;
    const close = chatTab.parentElement!.querySelector<HTMLButtonElement>(
      '[aria-label="Close My session"]',
    );
    expect(close).toBeNull();
    expect(chatTab.hasAttribute("data-closable")).toBe(false);

    render({ surfaceMode: "unified" });
    expect(
      container.querySelectorAll("[data-session-surface-tabs]"),
    ).toHaveLength(1);
    expect(container.querySelector('[aria-label="Close My session"]')).toBeNull();
    expect(container.querySelector("[data-legacy-heading]")).toBeNull();

    render({ layout: { type: "leaf", id: "chat" }, editorPanes: [] });
    expect(container.querySelector('[aria-label="Close My session"]')).toBeNull();
  });

  it("keeps a persistent Chat tab and owned tool selection across split/full views", () => {
    render();
    expect(
      container.querySelector("[data-session-chat-tab]")?.textContent,
    ).toBe("My session");
    // The full/split toggle lives in the window top bar, not a pane header.
    expect(container.querySelector("[data-surface-mode-toggle]")).toBeNull();

    render({ surfaceMode: "unified" });
    settleGrid();
    expect(
      container.querySelector("[data-session-chat-tab]")?.textContent,
    ).toBe("My session");
    expect(
      container
        .querySelector('[data-file-pane="tools"]')
        ?.getAttribute("data-show-tabs"),
    ).toBe("false");
    click(
      container.querySelector('[data-file-tab-id="terminal"] [role="tab"]')!,
    );
    expect(props.onSelectFile).toHaveBeenCalledWith("tools", "terminal");
    click(container.querySelector("[data-session-chat-tab]")!);
    expect(props.onFocus).toHaveBeenCalledWith("chat");
    render({ focusedId: "chat" });
    expect(
      container
        .querySelector("[data-session-chat-tab]")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-file-tab-id="file"] [role="tab"]')
        ?.getAttribute("aria-selected"),
    ).toBe("false");
    render({ sessions: [{ ...props.sessions[0], title: "" }] });
    expect(
      container.querySelector("[data-session-chat-tab]")?.textContent,
    ).toBe("Chat");
  });

  it.each(["right", "down"] as const)("switches shared terminal tabs without interpolating %s grid tracks", (dir) => {
    const terminalPane = (id: string): EditorPane => ({
      id,
      activeFileId: `${id}-terminal`,
      files: [{ id: `${id}-terminal`, path: "Terminal", cwd: "/project", terminal: true }],
    });
    render({
      surfaceMode: "unified",
      focusedId: "first",
      layout: {
        type: "split",
        id: "split",
        dir,
        children: [
          { type: "leaf", id: "chat" },
          { type: "leaf", id: "first" },
          { type: "leaf", id: "second" },
        ],
        sizes: [0.4, 0.3, 0.3],
      },
      editorPanes: [terminalPane("first"), terminalPane("second")],
    });
    settleGrid();
    const inputs = [...container.querySelectorAll("input")];
    // A non-zero duration must not turn a tab selection into a pane resize.
    layout().style.transitionDuration = "0.34s";
    for (const id of ["second", "first", "second"]) {
      render({ focusedId: id });
      expect(layout().style.transitionProperty).toBe("none");
      expect(isPaneResizing()).toBe(false);
      const tracks = dir === "right"
        ? layout().style.gridTemplateColumns
        : layout().style.gridTemplateRows;
      expect(tracks).toBe(id === "first"
        ? "minmax(0, 0fr) minmax(0, 1fr) minmax(0, 0fr)"
        : "minmax(0, 0fr) minmax(0, 0fr) minmax(0, 1fr)");
      expect(pane(id).inert).toBe(false);
      expect(pane(id === "first" ? "second" : "first").inert).toBe(true);
    }
    expect([...container.querySelectorAll("input")]).toEqual(inputs);
    expect(lifetime).toEqual({ mounts: 2, unmounts: 0 });

    render({ surfaceMode: "split" });
    expect(layout().style.transitionProperty).toBe("");
    expect(isPaneResizing()).toBe(true);
    settleGrid();
    expect(isPaneResizing()).toBe(false);
  });

  it("animates both directions with zero tracks and keeps hidden surfaces mounted and inert", () => {
    render();
    const editorInput = container.querySelector<HTMLInputElement>("input")!;
    editorInput.value = "retained PTY/editor state";
    render({ surfaceMode: "unified", focusedId: "chat" });
    expect(layout().classList.contains("animated-collapse-size")).toBe(true);
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) minmax(0, 0fr)",
    );
    expect(pane("tools").dataset.foldState).toBe("closing");
    expect(pane("tools").inert).toBe(true);
    expect(pane("tools").getAttribute("aria-hidden")).toBe("true");
    expect(
      container
        .querySelector("[data-file-pane]")
        ?.getAttribute("data-portals-visible"),
    ).toBe("false");
    act(() => vi.advanceTimersByTime(350));
    expect(pane("tools").dataset.foldState).toBe("closed");
    expect(container.querySelector("input")).toBe(editorInput);
    expect(editorInput.value).toBe("retained PTY/editor state");
    expect(lifetime).toEqual({ mounts: 1, unmounts: 0 });
    render({ surfaceMode: "split" });
    expect(pane("tools").dataset.foldState).toBe("opening");
    expect(pane("tools").inert).toBe(false);
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0.6fr) minmax(0, 0.4fr)",
    );
    expect(
      container
        .querySelector("[data-file-pane]")
        ?.getAttribute("data-portals-visible"),
    ).toBe("true");
  });

  it("cancels closing on rapid reversal and handles reduced motion immediately", () => {
    render();
    render({ surfaceMode: "unified", focusedId: "chat" });
    act(() => vi.advanceTimersByTime(200));
    render({ surfaceMode: "split" });
    act(() => vi.advanceTimersByTime(duration.panel * 1000 / 2));
    expect(pane("tools").dataset.foldState).toBe("opening");
    expect(pane("tools").inert).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(pane("tools").dataset.foldState).toBe("open");

    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {},
        }) as MediaQueryList,
    );
    render({ surfaceMode: "unified", focusedId: "chat" });
    expect(pane("tools").dataset.foldState).toBe("closed");
    render({ surfaceMode: "split" });
    expect(pane("tools").dataset.foldState).toBe("open");
  });

  it("keeps Chat as the sole session header when no tools exist and routes files from the source session", () => {
    render({
      layout: { type: "leaf", id: "chat" },
      editorPanes: [],
      focusedId: "chat",
    });
    expect(container.querySelector("[data-session-chat-tab]")).not.toBeNull();
    expect(container.querySelector("[data-surface-mode-toggle]")).toBeNull();
    click(container.querySelector("[data-open-session-file]")!);
    expect(props.onOpenSessionFile).toHaveBeenCalledWith(
      "src/example.ts",
      "chat",
    );
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });

  it("preserves generic multi-chat split layouts even when a stored preference is unified", () => {
    render({
      surfaceMode: "unified",
      sessions: [
        ...props.sessions,
        {
          id: "tools",
          title: "Other chat",
          cwd: "/project",
          blocks: [],
        } as unknown as Session,
      ],
      editorPanes: [],
    });
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(container.querySelectorAll("[data-session-chat-tab]")).toHaveLength(
      2,
    );
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
    expect(pane("chat").inert).toBe(false);
    expect(pane("tools").inert).toBe(false);
    const close = container.querySelector('[aria-label="Close My session"]')!;
    expect(close).not.toBeNull();
    expect(container.querySelector('[aria-label="Close Other chat"]')).not.toBeNull();
    click(close);
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("chat");
    expect(props.onFocus).not.toHaveBeenCalled();

    render({ layout: { type: "leaf", id: "chat" }, focusedId: "chat" });
    expect(container.querySelector('[aria-label="Close My session"]')).toBeNull();
    expect(container.querySelector('[data-session-chat-tab]')?.hasAttribute("data-closable")).toBe(false);
  });

  it("collapses and restores nested tool panes with stable tracks and per-pane motion", () => {
    render({
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        sizes: [0.6, 0.4],
        children: [
          { type: "leaf", id: "chat" },
          {
            type: "split",
            id: "vertical",
            dir: "down",
            sizes: [0.5, 0.5],
            children: [
              { type: "leaf", id: "tools" },
              { type: "leaf", id: "page" },
            ],
          },
        ],
      },
      editorPanes: [
        ...props.editorPanes,
        {
          id: "page",
          activeFileId: "notes",
          files: [
            {
              id: "notes",
              path: "app:notes",
              cwd: "~",
              appView: { kind: "notes" },
            },
          ],
        },
      ],
    });
    const before = [...container.querySelectorAll("[data-file-pane]")];
    expect(pane("chat").style.gridRow).toBe("1 / 3");
    render({ surfaceMode: "unified", focusedId: "page" });
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0fr) minmax(0, 1fr)",
    );
    expect(layout().style.gridTemplateRows).toBe(
      "minmax(0, 0fr) minmax(0, 1fr)",
    );
    expect(pane("chat").dataset.foldState).toBe("closing");
    expect(pane("tools").dataset.foldState).toBe("closing");
    expect(pane("chat").inert).toBe(true);
    expect(pane("tools").inert).toBe(true);
    expect(pane("page").inert).toBe(false);
    act(() => vi.advanceTimersByTime(350));
    render({ surfaceMode: "split" });
    expect(pane("chat").dataset.foldState).toBe("opening");
    expect(pane("tools").dataset.foldState).toBe("opening");
    expect([...container.querySelectorAll("[data-file-pane]")]).toEqual(before);
    expect(lifetime).toEqual({ mounts: 2, unmounts: 0 });
  });

  it("disables grid transitions during direct resizing and restores them on release", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = undefined;
    });
    render();
    layout().getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800);
    const handle = container.querySelector('[role="separator"]')!
      .firstElementChild as HTMLElement;
    const capture = new Set<number>();
    handle.setPointerCapture = (id) => capture.add(id);
    handle.hasPointerCapture = (id) => capture.has(id);
    handle.releasePointerCapture = (id) => capture.delete(id);
    const pointer = (type: string, x: number) =>
      act(() =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: x,
            clientY: 300,
          }),
        ),
      );
    pointer("pointerdown", 600);
    expect(layout().style.transitionProperty).toBe("none");
    pointer("pointermove", 650);
    act(() => frame?.(0));
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0.65fr) minmax(0, 0.35fr)",
    );
    expect(layout().style.transitionProperty).toBe("none");
    pointer("pointerup", 650);
    expect(layout().style.transitionProperty).toBe("");
    expect(props.onRatio).toHaveBeenCalledWith("split", 0, 0.65);
  });

  it("grows the card before switching full-view chrome and restores split tracks on exit", () => {
    render();
    const editorInput = container.querySelector("input");
    layout().style.transitionDuration = "0.34s";
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0fr) minmax(0, 1fr)",
    );
    expect(pane("tools").querySelector("[data-card-maximize]")).not.toBeNull();
    expect(isPaneResizing()).toBe(true);

    settleGrid();
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0fr) minmax(0, 1fr)",
    );
    expect(isPaneResizing()).toBe(false);
    expect(container.querySelector("input")).toBe(editorInput);

    render({ surfaceMode: "split" });
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0.6fr) minmax(0, 0.4fr)",
    );
    expect(isPaneResizing()).toBe(true);
    settleGrid();
    expect(isPaneResizing()).toBe(false);
    expect(lifetime).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("skips full-view motion for a settled maximized card and restores that card on exit", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    click(pane("tools").querySelector("[data-card-maximize]")!);
    settleGrid();
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
    render({ surfaceMode: "split" });
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 0fr) minmax(0, 1fr)",
    );
    expect(isPaneResizing()).toBe(false);
  });

  it("waits for an in-flight maximize before switching full-view chrome", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    click(pane("tools").querySelector("[data-card-maximize]")!);
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(isPaneResizing()).toBe(true);
    settleGrid();
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
  });

  it("cancels pending full-view chrome on reversal and completes re-entry without an end event", () => {
    render();
    layout().style.transitionDuration = "340ms";
    render({ surfaceMode: "unified" });
    act(() => vi.advanceTimersByTime(100));
    render({ surfaceMode: "split" });
    act(() => vi.advanceTimersByTime(440));
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(isPaneResizing()).toBe(false);
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("split");
    act(() => vi.advanceTimersByTime(440));
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
  });

  it("switches full-view chrome immediately when grid transitions are disabled", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
  });

  it("honors reduced motion without holding terminal refits", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {},
        }) as MediaQueryList,
    );
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(pane("chat").dataset.foldState).toBe("closed");
    expect(isPaneResizing()).toBe(false);
    render({ surfaceMode: "split" });
    expect(pane("chat").dataset.foldState).toBe("open");
    expect(isPaneResizing()).toBe(false);
  });

  it("does not wait for grid motion when only the chat exists", () => {
    render({
      layout: { type: "leaf", id: "chat" },
      editorPanes: [],
      focusedId: "chat",
    });
    layout().style.transitionDuration = "0.34s";
    render({ surfaceMode: "unified" });
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
  });

  it("restarts the chrome fallback when selection changes during full-view entry", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    render({ surfaceMode: "unified" });
    act(() => vi.advanceTimersByTime(duration.panel * 1000 / 2));
    render({ focusedId: "chat" });
    act(() => vi.advanceTimersByTime(duration.panel * 1000 / 2 - 1));
    expect(layout().dataset.surfaceMode).toBe("split");
    expect(isPaneResizing()).toBe(true);
    expect(layout().style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) minmax(0, 0fr)",
    );
    act(() => vi.advanceTimersByTime(duration.panel * 1000 / 2 + 1));
    expect(layout().dataset.surfaceMode).toBe("unified");
    expect(isPaneResizing()).toBe(false);
  });

  it("holds terminal refits while a card maximize moves the grid tracks", () => {
    render();
    layout().style.transitionDuration = "0.34s";
    click(pane("tools").querySelector("[data-card-maximize]")!);
    expect(isPaneResizing()).toBe(true);
    settleGrid();
    expect(isPaneResizing()).toBe(false);
    // Reversing mid-motion keeps holding until the restore settles.
    click(pane("tools").querySelector("[data-card-maximize]")!);
    click(pane("tools").querySelector("[data-card-maximize]")!);
    expect(isPaneResizing()).toBe(true);
    settleGrid();
    expect(isPaneResizing()).toBe(false);
  });

  it("puts each column's header on the top row and hands window chrome to the corner panes", () => {
    const minimize = vi.fn();
    const controls = createElement(
      "div",
      {
        role: "group",
        "aria-label": "Window controls",
        "data-native-controls": "",
      },
      createElement(
        "button",
        { onClick: minimize, "aria-label": "Minimize window" },
        "Minimize",
      ),
    );
    render({ windowControls: controls, reserveWindowNavigationSpace: true });
    // Split view: the chat header lives in the chat column, not above the
    // whole layout, and owns the top-left navigation clearance.
    const header = container.querySelector("[data-session-surface-tabs]")!;
    expect(header.closest('[data-pane-id="chat"]')).not.toBeNull();
    expect(
      header.querySelector("[data-window-navigation-space]"),
    ).not.toBeNull();
    expect(container.querySelectorAll("[data-native-controls]")).toHaveLength(
      1,
    );
    // The top-right card carries the window controls after its maximize toggle.
    const nativeControls = container.querySelector("[data-native-controls]")!;
    expect(nativeControls.closest('[data-pane-id="tools"]')).not.toBeNull();
    click(nativeControls.querySelector('[aria-label="Minimize window"]')!);
    expect(minimize).toHaveBeenCalledOnce();
    // A maximized card takes over both corners; restoring hands them back.
    click(pane("tools").querySelector("[data-card-maximize]")!);
    expect(
      pane("tools").querySelector("[data-window-navigation-space]"),
    ).not.toBeNull();
    expect(container.querySelectorAll("[data-native-controls]")).toHaveLength(
      1,
    );
    click(pane("tools").querySelector("[data-card-maximize]")!);
    expect(
      pane("tools").querySelector("[data-window-navigation-space]"),
    ).toBeNull();
    expect(
      pane("chat").querySelector("[data-window-navigation-space]"),
    ).not.toBeNull();
    render({ surfaceMode: "unified" });
    expect(container.querySelectorAll("[data-native-controls]")).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll("[data-window-navigation-space]"),
    ).toHaveLength(1);
    render({
      surfaceMode: "split",
      layout: { type: "leaf", id: "chat" },
      editorPanes: [],
    });
    expect(container.querySelectorAll("[data-native-controls]")).toHaveLength(
      1,
    );
    expect(container.querySelector("[data-surface-mode-toggle]")).toBeNull();
  });
});
