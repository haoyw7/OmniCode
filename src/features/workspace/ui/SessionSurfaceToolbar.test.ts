import { completeMotionAnimation } from "../../../../tests/helpers/motionDriver";
import { configureSharedHost } from "../../connections/model/remoteProjects";
import { rememberRemoteSession } from "../../connections/model/connections";
import { delegateDesktopSession } from "../../bots/model/delegateDesktopSession";
vi.mock("../../bots/model/delegateDesktopSession", () => ({ delegateDesktopSession: vi.fn(async () => {}) }));
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionSurfaceToolbar } from "./SessionSurfaceToolbar";
import { loadStatusCardsVisible } from "../../sessions/model/statusCardOrder";
import {
  SessionHeaderActionsContext,
  type SessionHeaderActions,
} from "./SessionHeaderActions";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import {
  saveProviderAccount,
  selectProviderAccount,
} from "../../providers/model/providerAccounts";
import { clearCachedRateLimits } from "../../providers/model/rateLimitsCache";
import {
  idleRateLimits,
  unavailableRateLimits,
} from "../../providers/model/rateLimits";
import { saveShowRemainingUsage } from "../../settings/model/displayPrefs";
import { setUiLanguage } from "../../../shared/i18n/language";
import type { Session } from "../../sessions/model/session";

const fetches = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
  opencode: vi.fn(),
  pi: vi.fn(),
}));
vi.mock("../../providers/model/piUsage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/model/piUsage")>()),
  fetchPiUsage: fetches.pi,
}));
vi.mock("../../providers/model/rateLimitsFetch", () => ({
  fetchCodexRateLimits: fetches.codex,
  fetchClaudeRateLimits: fetches.claude,
  fetchOpencodeGoRateLimits: fetches.opencode,
  consumeCodexRateLimitResetCredit: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let actions: SessionHeaderActions;
let sessions: Session[];
let visible: boolean;

const quota = (usedPercent: number) => ({
  ...idleRateLimits("codex"),
  status: "ok" as const,
  session: { usedPercent, windowMinutes: 300, resetsAt: null },
  updatedAt: Date.now(),
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  configureSharedHost(undefined, []);
  vi.mocked(delegateDesktopSession).mockClear();
  setUiLanguage("en");
  clearCachedRateLimits();
  saveProviderAccount({
    provider: "codex",
    id: "account-left",
    label: "Left account",
  });
  saveProviderAccount({
    provider: "codex",
    id: "account-right",
    label: "Right account",
  });
  selectProviderAccount("codex", "/left", "account-right");
  selectProviderAccount("codex", "/right", "account-right");
  fetches.codex
    .mockReset()
    .mockImplementation(async (id) => quota(id === "account-left" ? 17 : 44));
  fetches.claude
    .mockReset()
    .mockResolvedValue(unavailableRateLimits("claude", "not signed in"));
  fetches.opencode
    .mockReset()
    .mockResolvedValue(unavailableRateLimits("opencode", "not connected"));
  fetches.pi
    .mockReset()
    .mockResolvedValue({ ...quota(23), provider: "claude" });
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

const usageRow = () =>
  document.querySelector<HTMLElement>("[data-session-usage]")!;
const usageChip = () =>
  usageRow().querySelector<HTMLButtonElement>('[aria-label$="usage details"]')!;
const usageDetails = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Usage details"]',
  );

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
  expect(container.querySelector('[data-session-surface-tabs="right"] [data-session-tool-toggle="status"]')).toBeNull();
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

it("shows this pane's account usage in the menu and opens its details in place", async () => {
  await render();
  await open();
  expect(fetches.codex).toHaveBeenCalledExactlyOnceWith("account-left");
  expect(usageRow().textContent).toContain("Left account");
  expect(usageRow().textContent).toContain("17%");
  await act(async () =>
    usageRow()
      .querySelector<HTMLButtonElement>('[aria-label="Refresh usage"]')!
      .click(),
  );
  expect(fetches.codex).toHaveBeenLastCalledWith("account-left");
  expect(fetches.codex).toHaveBeenCalledTimes(2);
  await act(async () => usageChip().click());
  await finishExits();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  const dialog = usageDetails()!;
  expect(dialog.textContent).toContain("Left account");
  expect(dialog.textContent).toContain("17% used");
  expect(dialog.textContent).not.toContain("44%");
  act(() =>
    dialog
      .querySelector<HTMLButtonElement>("[data-session-usage-back]")!
      .click(),
  );
  await finishExits();
  expect(usageDetails()).toBeNull();
  await finishExits();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => usageChip().click());
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  await finishExits();
  expect(usageDetails()).toBeNull();
  await finishExits();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
});

it("falls back to the owning project's account and follows usage display preferences", async () => {
  sessions[0] = { ...sessions[0], providerAccountId: undefined };
  selectProviderAccount("codex", "/left", "account-left");
  await render();
  await open();
  expect(fetches.codex).toHaveBeenCalledExactlyOnceWith("account-left");
  expect(usageRow().textContent).toContain("17%");
  act(() => saveShowRemainingUsage(true));
  expect(usageRow().textContent).toContain("83%");
});

it("uses the owning harness and reports disconnected/removed accounts without another account's fetch", async () => {
  sessions[0] = {
    ...sessions[0],
    harness: "claude",
    providerAccountId: "default",
  };
  await render();
  await open();
  expect(fetches.claude).toHaveBeenCalledExactlyOnceWith("default");
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(usageChip().getAttribute("aria-label")).toContain("Claude Code");
  expect(usageRow().textContent).toContain("not connected");
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  sessions[0] = {
    ...sessions[0],
    harness: "codex",
    providerAccountId: "account-removed",
  };
  await render();
  await open();
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(usageRow().textContent).toContain("not connected");
  await act(async () => usageChip().click());
  // The footer's removed-account flow moved with it: sign in or switch.
  expect(usageDetails()?.textContent).toContain("Removed account");
  expect(usageDetails()?.textContent).toContain("Sign in to Codex");
});

it("uses the menu session's Pi model and saved OAuth usage without querying a Codex/Claude profile", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  sessions[0] = {
    ...sessions[0],
    harness: "pi",
    model: "pi:anthropic/claude-sonnet-4-6",
  };
  await render();
  await open();
  expect(fetches.pi).toHaveBeenCalledExactlyOnceWith("anthropic");
  expect(fetches.codex).not.toHaveBeenCalled();
  expect(fetches.claude).not.toHaveBeenCalled();
  expect(usageChip().getAttribute("aria-label")).toContain("Pi · Anthropic");
  expect(usageRow().textContent).toContain("23%");
  await act(async () =>
    usageRow()
      .querySelector<HTMLButtonElement>('[aria-label="Refresh Pi usage"]')!
      .click(),
  );
  expect(fetches.pi).toHaveBeenCalledTimes(2);
  await act(async () => usageChip().click());
  expect(usageDetails()?.textContent).toContain("Pi's saved OAuth account");
});

it("switches the owning conversation's account from the in-menu details", async () => {
  actions.selectProviderAccount = vi.fn();
  await render();
  await open();
  await act(async () => usageChip().click());
  await act(async () =>
    usageDetails()!
      .querySelector<HTMLButtonElement>('[aria-label^="Switch"]')!
      .click(),
  );
  const right = usageDetails()!.querySelector<HTMLButtonElement>(
    '[aria-label="Right account"]',
  )!;
  await act(async () => right.click());
  expect(actions.selectProviderAccount).toHaveBeenCalledExactlyOnceWith(
    "left",
    "codex",
    "account-right",
  );
  await finishExits();
  expect(usageDetails()).toBeNull();
  await finishExits();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
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
  expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2);
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

it("suppresses menu/details/rename portals when hidden and keeps title double-click rename", async () => {
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
  await open();
  await act(async () => usageChip().click());
  await finishExits();
  expect(usageDetails()).not.toBeNull();
  visible = false;
  await render();
  await finishExits();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  visible = true;
  await render();
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

it("localizes app-owned menu labels while keeping session and account names", async () => {
  setUiLanguage("zh-CN");
  await render();
  const menu = await open();
  expect(
    container
      .querySelector('[data-session-overflow-menu="left"]')
      ?.getAttribute("aria-label"),
  ).toBe("更多操作");
  expect(menu.textContent).toContain("重命名");
  expect(usageRow().querySelector('[aria-label$="用量详情"]')).not.toBeNull();
  expect(usageRow().querySelector('[aria-label="刷新用量"]')).not.toBeNull();
  expect(menu.textContent).toContain("Left account");
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
