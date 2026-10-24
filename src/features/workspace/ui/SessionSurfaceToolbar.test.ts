import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { rememberRemoteSession } from "../../connections/model/connections";
import { delegateDesktopSession } from "../../bots/model/delegateDesktopSession";
vi.mock("../../bots/model/delegateDesktopSession", () => ({ delegateDesktopSession: vi.fn(async () => {}) }));
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "../../../../tests/helpers/sessionPresentationRoot";
import { type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionSurfaceToolbar } from "../../../app/ui/SessionSurfaceToolbar";
import { loadStatusCardsVisible } from "../../sessions/model/statusCardOrder";
import { SessionHeaderActionsContext, type SessionHeaderActions } from "../model/SessionHeaderActions";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { Session } from "../../../contracts/session";

let root: Root;
let container: HTMLDivElement;
let actions: SessionHeaderActions;
let sessions: Session[];
let visible: boolean;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  configureSharedHost(undefined, []);
  vi.mocked(delegateDesktopSession).mockClear();
  setUiLanguage("en");
  actions = {
    rename: vi.fn(),
    archive: vi.fn(),
    splitRight: vi.fn(),
    terminalAvailable: true,
    toggleTerminal: vi.fn(),
    toggleFiles: vi.fn(),
    changesOpen: false,
    toggleChanges: vi.fn(),
  };
  sessions = ["left", "right"].map(
    (id) =>
      ({
        id,
        title: `${id} chat`,
        cwd: `/${id}`,
        harness: "codex",
        providerAccountId: `account-${id}`,
        blocks: [],
        model: "codex:default",
        modelSettings: {},
        runtimeMode: "supervised",
      }) satisfies Session,
  );
  visible = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  const shared: Omit<
    ComponentProps<typeof SessionSurfaceToolbar>,
    "session"
  > = {
    panes: [{ id: "files", files: [], activeFileId: "" }],
    focusedId: "right",
    showTools: false,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    onFocus: vi.fn(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onCloseOtherFiles: vi.fn(),
    onReorderFiles: vi.fn(),
    windowControls: createElement(
      "button",
      { "data-window-controls": "" },
      "Window controls",
    ),
  };
  await act(async () =>
    root.render(
      createElement(
        SessionHeaderActionsContext.Provider,
        { value: actions },
        createElement(
          SurfaceVisibilityContext.Provider,
          { value: visible },
          ...sessions.map((session) =>
            createElement(SessionSurfaceToolbar, {
              ...shared,
              key: session.id,
              session,
            }),
          ),
        ),
      ),
    ),
  );
}

async function finishExits() {
  await act(async () => completeMotionAnimation(document.body));
}

async function open(id = "left") {
  await finishExits();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[data-session-overflow-menu="${id}"]`)!
      .click(),
  );
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

// Menu items have stable action order; query by the visible label for clarity.
function pick(label: string) {
  const menuItem = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((node) => node.querySelector("span.block")?.textContent === label)!;
  expect(menuItem, label).toBeDefined();
  return menuItem;
}

it("places the sole action trigger after tools and before window controls", async () => {
  await render();
  expect(container.querySelector("[data-session-title-menu]")).toBeNull();
  for (const header of container.querySelectorAll(
    "[data-session-surface-tabs]",
  )) {
    const buttons = [...header.querySelectorAll("button")];
    const order = [
      "[data-session-tool-toggle=terminal]",
      "[data-session-tool-toggle=files]",
      "[data-session-overflow-menu]",
      "[data-window-controls]",
    ].map((selector) => buttons.indexOf(header.querySelector(selector)!));
    expect(
      order.every((index, i) => index >= 0 && (!i || index > order[i - 1])),
    ).toBe(true);
  }
});

it("toggles the status cards from a started conversation's toolbar", async () => {
  sessions[0] = { ...sessions[0], blocks: [{ id: "ask", role: "user", text: "Hi" }] };
  await render();
  expect(container.querySelector('[data-session-surface-tabs="right"] [data-session-tool-toggle="status"]')).not.toBeNull();
  const toggle = () =>
    container.querySelector<HTMLButtonElement>('[data-session-surface-tabs="left"] [data-session-tool-toggle="status"]')!;
  const header = container.querySelector('[data-session-surface-tabs="left"]')!;
  const buttons = [...header.querySelectorAll("button")];
  expect(buttons.indexOf(toggle())).toBeLessThan(buttons.indexOf(header.querySelector("[data-session-tool-toggle=terminal]")!));
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  act(() => toggle().click());
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  expect(loadStatusCardsVisible()).toBe(false);
  act(() => toggle().click());
  expect(loadStatusCardsVisible()).toBe(true);
});

it("opens the owning session's files without routing through a different focused pane", async () => {
  actions.filesSessionIds = new Set(["right", "other"]);
  await render();
  expect(container.querySelector('[data-session-tool-toggle="changes"]')).toBeNull();
  const left = container.querySelector<HTMLButtonElement>(
    '[data-session-surface-tabs="left"] [data-session-tool-toggle="files"]',
  )!;
  const right = container.querySelector<HTMLButtonElement>(
    '[data-session-surface-tabs="right"] [data-session-tool-toggle="files"]',
  )!;
  expect(left.getAttribute("aria-pressed")).toBe("false");
  expect(right.getAttribute("aria-pressed")).toBe("true");
  const focusOtherPane = vi.fn();
  document.body.addEventListener("mousedown", focusOtherPane);
  try {
    act(() => {
      left.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      left.click();
    });
  } finally {
    document.body.removeEventListener("mousedown", focusOtherPane);
  }
  expect(focusOtherPane).not.toHaveBeenCalled();
  expect(actions.toggleFiles).toHaveBeenCalledExactlyOnceWith("left");
});

it("renames, splits and archives the owning pane while another pane is focused", async () => {
  await render();
  await open();
  act(() => pick("Rename").click());
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Rename"]',
  )!;
  expect(input.value).toBe("left chat");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Renamed left");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() =>
    input
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(actions.rename).toHaveBeenCalledWith("left", "Renamed left");
  await open();
  act(() => pick("Split Right").click());
  expect(actions.splitRight).toHaveBeenCalledExactlyOnceWith("left");
  await open("right");
  act(() => pick("Archive").click());
  expect(actions.archive).toHaveBeenCalledExactlyOnceWith("right");
});

it("keeps account usage out of the session actions menu", async () => {
  await render();
  const menu = await open();
  expect(menu.querySelector("[data-session-usage]")).toBeNull();
  expect(menu.querySelector('[aria-label="Refresh usage"]')).toBeNull();
});

it("opens downward at the end, supports keyboard selection, Escape and outside dismissal", async () => {
  await render();
  const trigger = container.querySelector<HTMLElement>(
    '[data-session-overflow-menu="left"]',
  )!;
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
    new DOMRect(700, 12, 30, 30),
  );
  const menu = await open();
  expect(menu.dataset.popoverSide).toBe("bottom");
  expect(menu.parentElement?.style.left).toBe("450px");
  expect(menu.parentElement?.style.top).toBe("46px");
  expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
  expect(
    [...menu.querySelectorAll('[role="menuitem"]')].every(
      (node) => node.firstElementChild?.getAttribute("aria-hidden") === "true",
    ),
  ).toBe(true);
  act(() => {
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  act(() =>
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(actions.splitRight).toHaveBeenCalledExactlyOnceWith("left");
  await open();
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await finishExits();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await open();
  act(() =>
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  await finishExits();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("suppresses menu/rename portals when hidden and keeps title double-click rename", async () => {
  await render();
  await open();
  visible = false;
  await render();
  await finishExits();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  visible = true;
  await render();
  await finishExits();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  act(() =>
    container
      .querySelector('[data-session-chat-tab="left"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(
    document.querySelector<HTMLInputElement>('[aria-label="Rename"]')?.value,
  ).toBe("left chat");
  visible = false;
  await render();
  await finishExits();
  expect(document.querySelector('[aria-label="Rename"]')).toBeNull();
});

it("localizes app-owned menu labels while keeping session names", async () => {
  setUiLanguage("zh-CN");
  await render();
  const menu = await open();
  expect(
    container
      .querySelector('[data-session-overflow-menu="left"]')
      ?.getAttribute("aria-label"),
  ).toBe("更多操作");
  expect(menu.textContent).toContain("重命名");
  expect(menu.querySelector("[data-session-usage]")).toBeNull();
  expect(container.textContent).toContain("left chat");
});

it("hands over the conversation belonging to the selected header", async () => {
  configureSharedHost("local-host", [{ id: "left-project", cwd: "/left", name: "Left" }, { id: "right-project", cwd: "/right", name: "Right" }], "local-machine");
  rememberRemoteSession("right", "host-right", { environmentId: "local-host", projectId: "right-project" });
  await render();
  const menu = await open("right");
  const handoff = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Hand over to assistant"))!;
  expect(handoff).toBeDefined();
  await act(async () => handoff.click());
  expect(delegateDesktopSession).toHaveBeenCalledWith("/right", "host-right");
  configureSharedHost(undefined, []);
});

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
