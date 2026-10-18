import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionTitle } from "../../features/sessions/model/session";
import { formatReminderTime } from "../../features/sessions/model/sessionReminders";
import { Sidebar } from "./Sidebar";
import { loadSessionFolders } from "../../features/sessions/model/sessionFolders";
import { useProjectDiffStats } from "../../features/source-control/hooks/useProjectDiffStats";
import { copyText } from "../../platform/tauri/clipboard";
import { SIDEBAR_WIDTH_DEFAULT } from "../../features/settings/model/appearance";

// Keep native services out of these menu/input interaction tests.
vi.mock("../../features/source-control/ui/SidebarWorktreeSwitcher", () => ({ SidebarWorktreeSwitcher: () => null }));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("../../features/connections/files/ui/FileTree", () => ({ FileTree: () => null }));
vi.mock("../../platform/tauri/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

function render() {
  root.render(createElement(Sidebar, props));
}

function card(): HTMLElement {
  return container.querySelector('[data-session-card="session-1"]')!;
}

function renameInput(): HTMLInputElement {
  return container.querySelector("input:not([placeholder])")!;
}

function pressKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

function typeTitle(input: HTMLInputElement, title: string) {
  // Use the native setter so React sees a user change, not its own value write.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function startRename() {
  act(() => {
    card().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const rename = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ).find((item) => item.textContent?.startsWith("Rename"))!;
  expect(rename.disabled).toBe(false);
  act(() => rename.click());
  return renameInput();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(copyText).mockReset().mockResolvedValue(undefined);
  vi.mocked(useProjectDiffStats).mockReturnValue(null);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  props = {
    cwd: "/workspace/project",
    open: true,
    sessions: [
      {
        id: "session-1",
        cwd: "/workspace/project",
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        title: formatSessionTitle("codex", "Original conversation"),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    busySessionIds: new Set(["session-1"]),
    approvalSessionIds: new Set(),
    activeSessionId: "session-1",
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn((id: string, title: string) => {
      props = {
        ...props,
        sessions: props.sessions.map((session) =>
          session.id === id
            ? { ...session, title: formatSessionTitle(session.harness, title) }
            : session,
        ),
      };
      render();
    }),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sidebar session filters", () => {
  function filterButton() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter sessions"]',
    )!;
  }

  function filterMenu() {
    return document.querySelector('[role="menu"][aria-label="Filter sessions"]');
  }

  function clickFilter() {
    const icon = filterButton().querySelector("svg")!;
    // A real pointerdown commits outside dismissal before the later click.
    act(() =>
      icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    act(() => {
      icon.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("closes on a second pointer click on the filter trigger and can reopen", async () => {
    await act(async () => render());
    clickFilter();
    expect(filterMenu()).not.toBeNull();
    expect(filterButton().getAttribute("aria-expanded")).toBe("true");
    clickFilter();
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(filterMenu()).toBeNull();
    expect(filterButton().getAttribute("aria-expanded")).toBe("false");
    clickFilter();
    expect(filterMenu()).not.toBeNull();
  });

  it("keeps filter changes open while outside clicks and Escape still dismiss", async () => {
    await act(async () => render());
    clickFilter();
    const today = [...filterMenu()!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Today")!;
    act(() => today.click());
    expect(filterMenu()).not.toBeNull();
    expect(today.getAttribute("aria-checked")).toBe("true");
    act(() =>
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(filterMenu()).toBeNull();
    clickFilter();
    expect(pressKey(filterButton(), "Escape").defaultPrevented).toBe(true);
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(filterMenu()).toBeNull();
  });
});

describe("sidebar session multiselection", () => {
  it.each(["ctrlKey", "metaKey"] as const)(
    "resets the %s anchor after acting on another session's context menu",
    (modifier) => {
      props.sessions = [1, 2, 3, 4].map((n) => ({
        ...props.sessions[0],
        id: `session-${n}`,
        updatedAt: 100 - n,
      }));
      props.onPinSession = vi.fn();
      act(() => render());
      act(() =>
        container
          .querySelector('[data-session-card="session-3"]')!
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              [modifier]: true,
            }),
          ),
      );
      act(() =>
        container
          .querySelector('[data-session-card="session-2"]')!
          .dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
            }),
          ),
      );
      const pin = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((item) => item.textContent === "Pin")!;
      act(() => pin.click());
      expect(props.onPinSession).toHaveBeenCalledWith("session-2", true);
      expect(
        container.querySelectorAll('[data-session-selected="true"]'),
      ).toHaveLength(0);

      act(() =>
        container
          .querySelector('[data-session-card="session-4"]')!
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              shiftKey: true,
            }),
          ),
      );
      expect(
        Array.from(
          container.querySelectorAll('[data-session-selected="true"]'),
          (el) => el.getAttribute("data-session-card"),
        ),
      ).toEqual(["session-1", "session-2", "session-3", "session-4"]);
      expect(props.onSelectSession).not.toHaveBeenCalled();
    },
  );

  it("starts a range at the active session when pagination hides the anchor", () => {
    props.sessions = Array.from({ length: 80 }, (_, index) => ({
      ...props.sessions[0],
      id: `session-${index + 1}`,
      updatedAt: 100 - index,
    }));
    props.activeSessionId = "session-80";
    act(() => render());
    // Explicitly reveal the eighth batch before selecting its last row.
    for (let page = 1; page < 8; page++) {
      act(() => container.querySelector<HTMLButtonElement>('[data-session-list-toggle]')!.click());
    }
    act(() =>
      container
        .querySelector<HTMLElement>('[data-session-card="session-40"]')!
        .click(),
    );

    // Switching panes does not discard the last plain-click anchor.
    props.activeSessionId = "session-1";
    act(() => render());
    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search conversations..."]',
    )!;
    // All sessions still match, but the list returns to its first page.
    typeTitle(search, "Original conversation");
    expect(
      container.querySelector('[data-session-card="session-40"]'),
    ).toBeNull();
    expect(container.querySelectorAll("[data-session-card]")).toHaveLength(32);

    act(() =>
      container.querySelector('[data-session-card="session-3"]')!.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          shiftKey: true,
        }),
      ),
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-session-selected="true"]'),
        (el) => el.getAttribute("data-session-card"),
      ),
    ).toEqual(["session-1", "session-2", "session-3"]);
    expect(props.onSelectSession).toHaveBeenCalledTimes(1);
    expect(props.onSelectSession).toHaveBeenCalledWith("session-40");
  });

  it.each(["ctrlKey", "metaKey"] as const)(
    "starts the next range at the active session after %s clears the last selection",
    (modifier) => {
      props.sessions = [1, 2, 3, 4].map((n) => ({
        ...props.sessions[0],
        id: `session-${n}`,
        updatedAt: 100 - n,
      }));
      act(() => render());
      const thirdCard = container.querySelector<HTMLElement>(
        '[data-session-card="session-3"]',
      )!;
      for (let click = 0; click < 2; click++) {
        act(() =>
          thirdCard.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              [modifier]: true,
            }),
          ),
        );
        expect(
          container.querySelectorAll('[data-session-selected="true"]'),
        ).toHaveLength(click === 0 ? 1 : 0);
      }
      act(() =>
        container
          .querySelector('[data-session-card="session-4"]')!
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              shiftKey: true,
            }),
          ),
      );
      expect(
        Array.from(
          container.querySelectorAll('[data-session-selected="true"]'),
          (el) => el.getAttribute("data-session-card"),
        ),
      ).toEqual(["session-1", "session-2", "session-3", "session-4"]);
      expect(props.onSelectSession).not.toHaveBeenCalled();
    },
  );

  it("clears the previous session focus when Ctrl-clicking another session", () => {
    props.sessions = [1, 2].map((n) => ({
      ...props.sessions[0],
      id: `session-${n}`,
      updatedAt: 100 - n,
    }));
    props.onDeleteSession = vi.fn();
    act(() => render());
    const firstTitle = card().querySelector<HTMLElement>(
      "[data-session-select]",
    )!;
    const secondTitle = container.querySelector<HTMLElement>(
      '[data-session-select="session-2"]',
    )!;
    act(() => firstTitle.focus());
    act(() => {
      secondTitle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }),
      );
      secondTitle.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          ctrlKey: true,
        }),
      );
    });
    expect(card().getAttribute("data-session-selected")).toBeNull();
    expect(
      secondTitle
        .closest("[data-session-card]")!
        .getAttribute("data-session-selected"),
    ).toBe("true");
    expect(props.onSelectSession).not.toHaveBeenCalled();
    pressKey(document.activeElement as HTMLElement, "Delete");
    expect(props.onDeleteSession).not.toHaveBeenCalled();
    pressKey(document.activeElement as HTMLElement, "F2");
    expect(renameInput()).toBeNull();
    expect(document.activeElement).not.toBe(firstTitle);
    expect(document.activeElement).not.toBe(secondTitle);
  });

  it("keeps Shift-click selection free of title focus while preserving keyboard focus", () => {
    act(() => render());
    const title = card().querySelector<HTMLElement>("[data-session-select]")!;
    act(() => title.focus());
    expect(document.activeElement).toBe(title);
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      button: 0,
    });
    act(() => title.dispatchEvent(mouseDown));
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(title);
    act(() =>
      title.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          shiftKey: true,
        }),
      ),
    );
    expect(card().getAttribute("data-session-selected")).toBe("true");
    expect(props.onSelectSession).not.toHaveBeenCalled();
    act(() => title.focus());
    expect(document.activeElement).toBe(title);
    pressKey(title, "Enter");
    expect(props.onSelectSession).toHaveBeenCalledWith("session-1");
  });

  it("selects the visible range from a plain click with Shift-click", () => {
    props.sessions = [1, 2, 3, 4].map((n) => ({
      ...props.sessions[0],
      id: `session-${n}`,
      updatedAt: 100 - n,
    }));
    act(() => render());
    act(() => card().click());
    act(() =>
      container
        .querySelector('[data-session-card="session-3"]')!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: true }),
        ),
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-session-selected="true"]'),
        (el) => el.getAttribute("data-session-card"),
      ),
    ).toEqual(["session-1", "session-2", "session-3"]);
    expect(props.onSelectSession).toHaveBeenCalledTimes(1);
  });

  it("keeps multiselection without offering folder actions", () => {
    props.sessions = [1, 2, 3].map((n) => ({
      ...props.sessions[0],
      id: `session-${n}`,
      updatedAt: 100 - n,
    }));
    act(() => render());
    for (const id of ["session-1", "session-3"]) {
      act(() =>
        container
          .querySelector(`[data-session-card="${id}"]`)!
          .dispatchEvent(
            new MouseEvent("click", { bubbles: true, ctrlKey: true }),
          ),
      );
    }
    expect(props.onSelectSession).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-session-selected="true"]'),
    ).toHaveLength(2);
    act(() =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const newFolder = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "New folder")!;
    expect(newFolder).toBeUndefined();
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Add to");
    expect(loadSessionFolders(props.cwd)).toEqual([]);
  });
});

describe("sidebar waiting status", () => {
  it("shows input for questions, approval for permissions, and resumes working after an answer", () => {
    props.approvalSessionIds = new Set(["session-1"]);
    props.questionSessionIds = new Set(["session-1"]);
    act(() => render());
    expect(card().textContent).toContain("Needs input");
    expect(card().textContent).not.toContain("Need approval");
    expect(card().textContent).not.toContain("Working...");

    props.questionSessionIds = new Set();
    act(() => render());
    expect(card().textContent).toContain("Need approval");
    expect(card().textContent).not.toContain("Needs input");

    props.questionSessionIds = new Set(["session-1"]);
    act(() => render());
    expect(card().textContent).toContain("Needs input");
    props.questionSessionIds = new Set();
    props.approvalSessionIds = new Set();
    act(() => render());
    expect(card().textContent).toContain("Working...");
    expect(card().textContent).not.toContain("Needs input");
    expect(card().textContent).not.toContain("Need approval");
  });
});

describe("sidebar session IDs", () => {
  function openCopyIdMenu(sessionId: string) {
    act(() => {
      container
        .querySelector(`[data-session-card="${sessionId}"]`)!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
    });
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => !item.closest("[inert]") && item.textContent === "Copy session ID")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    act(() => trigger.click());
    return Array.from(document.querySelectorAll<HTMLElement>(
      '[role="menu"][aria-label="Copy session ID"]',
    )).find((menu) => !menu.closest("[inert]"))!;
  }

  it("copies either ID from the right-clicked session", async () => {
    props.sessions = [
      { ...props.sessions[0], providerSessionId: "harness-session-1" },
      {
        ...props.sessions[0],
        id: "session-2",
        providerSessionId: "harness-session-2",
        updatedAt: props.sessions[0].updatedAt - 1,
      },
    ];
    act(() => render());
    const harnessMenu = openCopyIdMenu("session-2");
    const copyHarnessId = Array.from(
      harnessMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Harness session ID")!;
    expect(copyHarnessId.disabled).toBe(false);
    await act(async () => copyHarnessId.click());
    expect(copyText).toHaveBeenNthCalledWith(1, "harness-session-2");

    const monocodeMenu = openCopyIdMenu("session-2");
    const copyMonoCodeId = Array.from(
      monocodeMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "OmniCode session ID")!;
    expect(copyMonoCodeId.disabled).toBe(false);
    await act(async () => copyMonoCodeId.click());
    expect(copyText).toHaveBeenNthCalledWith(2, "session-2");
  });

  it("keeps the MonoCode ID available before the harness supplies an ID", async () => {
    act(() => render());
    const copyMenu = openCopyIdMenu("session-1");
    const copyHarnessId = Array.from(
      copyMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Harness session ID")!;
    const copyMonoCodeId = Array.from(
      copyMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "OmniCode session ID")!;
    expect(copyHarnessId.disabled).toBe(true);
    expect(copyMonoCodeId.disabled).toBe(false);
    await act(async () => copyMonoCodeId.click());
    expect(copyText).toHaveBeenCalledExactlyOnceWith("session-1");
  });
});

describe("sidebar session rename", () => {
  it.each(["idle", "working", "needs approval"])(
    "renames from the menu and restores navigation (status=%s)",
    (status) => {
      if (status === "idle") props.busySessionIds = new Set();
      if (status === "needs approval") {
        props.approvalSessionIds = new Set(["session-1"]);
      }
      act(() => render());
      const input = startRename();

      expect(input.disabled).toBe(false);
      expect(document.activeElement === input).toBe(true);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      typeTitle(input, "  Renamed conversation  ");
      expect(pressKey(input, "Enter").defaultPrevented).toBe(true);

      expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith(
        "session-1",
        "Renamed conversation",
      );
      expect(renameInput()).toBeNull();
      expect(card().textContent).toContain("Renamed conversation");
      act(() => card().click());
      expect(props.onSelectSession).toHaveBeenCalledWith("session-1");
    },
  );

  it("allows F2 to rename a working conversation", () => {
    act(() => render());
    pressKey(card().querySelector("[data-session-select]")!, "F2");
    const input = renameInput();
    expect(input.disabled).toBe(false);
    expect(document.activeElement === input).toBe(true);
    typeTitle(input, "Keyboard rename");
    pressKey(input, "Enter");
    expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "Keyboard rename",
    );
  });

  it("prefetches after a deliberate hover and immediately on press", () => {
    vi.useFakeTimers();
    props.onPrefetchSession = vi.fn();
    act(() => render());

    act(() => {
      card().dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(119);
    });
    expect(props.onPrefetchSession).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(props.onPrefetchSession).toHaveBeenCalledExactlyOnceWith(
      "session-1",
    );

    act(() => {
      card().dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      card().dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(120);
    });
    expect(props.onPrefetchSession).toHaveBeenCalledTimes(1);

    act(() => {
      card().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(props.onPrefetchSession).toHaveBeenCalledTimes(2);
  });

  it("cancels with Escape while the agent is working", () => {
    act(() => render());
    const input = startRename();
    expect(document.activeElement === input).toBe(true);
    typeTitle(input, "Discard this name");
    expect(pressKey(input, "Escape").defaultPrevented).toBe(true);
    expect(props.onRenameSession).not.toHaveBeenCalled();
    expect(renameInput()).toBeNull();
    expect(card().textContent).toContain("Original conversation");
  });

  it("commits once on blur while the agent is working", () => {
    act(() => render());
    const input = startRename();
    expect(document.activeElement === input).toBe(true);
    typeTitle(input, "  Saved on blur  ");
    act(() => input.blur());
    expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "Saved on blur",
    );
    expect(renameInput()).toBeNull();
  });

  it("cancels an empty name without trapping the conversation in the editor", () => {
    act(() => render());
    const input = startRename();
    expect(document.activeElement === input).toBe(true);
    typeTitle(input, "   ");
    pressKey(input, "Enter");
    expect(props.onRenameSession).not.toHaveBeenCalled();
    expect(renameInput()).toBeNull();
    expect(card().textContent).toContain("Original conversation");
  });

  it("keeps an in-progress rename editable when a turn starts", () => {
    props.busySessionIds = new Set();
    act(() => render());
    const input = startRename();
    typeTitle(input, "My draft title");

    props = { ...props, busySessionIds: new Set(["session-1"]) };
    act(() => render());
    expect(renameInput()).toBe(input);
    expect(input.disabled).toBe(false);
    expect(document.activeElement === input).toBe(true);
    expect(input.value).toBe("My draft title");
    pressKey(input, "Enter");
    expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "My draft title",
    );
  });
});

describe("sidebar reorder affordances", () => {
  it("keeps the default cursor on tabs and flattens legacy folders", () => {
    props.sessions = [
      props.sessions[0],
      {
        ...props.sessions[0],
        id: "session-2",
        title: formatSessionTitle("codex", "Second conversation"),
      },
    ];
    localStorage.setItem(
      "monocode.sessionFolders",
      JSON.stringify({
        "/workspace/project": [
          {
            id: "folder-1",
            name: "Folder one",
            sessionIds: ["session-1"],
            collapsed: false,
          },
          {
            id: "folder-2",
            name: "Folder two",
            sessionIds: ["session-2"],
            collapsed: false,
          },
        ],
      }),
    );

    act(() => render());

    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab.className).not.toContain("cursor-grab");
      expect(tab.parentElement?.className).not.toContain("cursor-grab");
    }
    expect(container.querySelector("[data-session-folder]")).toBeNull();
    expect(container.querySelectorAll("[data-session-card]")).toHaveLength(2);
  });
});

describe("sidebar new session rows", () => {
  it("animates inserted sessions while retaining existing row nodes", async () => {
    const animate = vi.spyOn(HTMLElement.prototype, "animate");
    // StrictMode replays setup; AutoAnimate still owns one controller per parent.
    const renderList = () => root.render(createElement(StrictMode, null, createElement(Sidebar, props)));
    await act(async () => renderList());
    const existing = card();
    props = { ...props, sessions: [
      { ...props.sessions[0], id: "session-2", updatedAt: props.sessions[0].updatedAt + 1 },
      ...props.sessions,
    ] };
    await act(async () => { renderList(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const inserted = container.querySelector<HTMLElement>('[data-session-card="session-2"]')!;
    expect(inserted).not.toBeNull();
    expect(card()).toBe(existing);
    expect(animate.mock.contexts.some((element) => element.contains(inserted))).toBe(true);
    props = { ...props, sessions: [...props.sessions].reverse() };
    await act(async () => renderList());
    expect(card()).toBe(existing);
    expect(container.querySelector('[data-session-card="session-2"]')).toBe(inserted);
  });
});

describe("sidebar pinned sessions", () => {
  it("renders them as a collapsible folder-style group without a divider", () => {
    props.sessions = [
      { ...props.sessions[0], pinned: true },
      {
        ...props.sessions[0],
        id: "session-2",
        title: formatSessionTitle("codex", "Unpinned conversation"),
        updatedAt: props.sessions[0].updatedAt - 1,
      },
    ];
    act(() => render());

    const group = container.querySelector<HTMLElement>(
      "[data-pinned-sessions]",
    )!;
    const toggle = group.querySelector<HTMLButtonElement>(
      'button[title="Pinned"]',
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      group.querySelector('[data-session-card="session-1"]'),
    ).not.toBeNull();
    expect(container.querySelector("li[aria-hidden]")).toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const fold = group.querySelector<HTMLElement>(".zen-fold-item")!;
    expect(fold.dataset.foldState).toBe("closing");
    expect(fold.inert).toBe(true);
    act(() => completeMotionAnimation(fold));
    expect(fold.hidden).toBe(true);
    expect(group.querySelector('[data-session-card="session-1"]')).not.toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem("monocode.pinnedSessionsCollapsed") ?? "{}",
      ),
    ).toEqual({ "/workspace/project": true });
  });
});

describe("sidebar orchestration card", () => {
  it.each([false, true])(
    "keeps agents inside a distinct lead card (pinned=%s)",
    (pinned) => {
      props.onArchiveSession = vi.fn();
      props.linkedSessionUpdateIds = new Set(["session-1"]);
      const lead = {
        ...props.sessions[0],
        model: "codex:gpt-5.6-sol",
        pinned,
        linkedWorkItem: {
          kind: "pr" as const,
          repo: "acme/app",
          number: 42,
          url: "https://github.com/acme/app/pull/42",
        },
        orchestration: {
          status: "active" as const,
          live: true,
          tasks: [
            {
              sessionId: "worker-a",
              title: "Build settings",
              harness: "codex" as const,
              model: "codex:worker-a",
              status: "running" as const,
            },
            {
              sessionId: "worker-b",
              title: "Review changes",
              harness: "claude" as const,
              model: "claude:worker-b",
              status: "running" as const,
              needsInput: true,
            },
            {
              sessionId: "worker-c",
              title: "Check types",
              harness: "codex" as const,
              model: "codex:worker-c",
              status: "completed" as const,
            },
          ],
        },
      };
      props.sessions = [
        lead,
        { ...props.sessions[0], id: "unrelated" },
        {
          ...props.sessions[0],
          id: "worker-a",
          orchestrationLeadId: lead.id,
        },
      ];
      act(() => render());
      expect(container.querySelectorAll("[data-session-card]")).toHaveLength(2);
      expect(card().dataset.orchestrationCard).toBe("true");
      // The lead card carries the sidebar's ordinary active treatment.
      expect(card().className).toContain("bg-selection");
      // The lead names its own model, like every agent row beneath it.
      expect(card().textContent).toContain("GPT-5.6-Sol");
      expect(card().textContent).not.toContain("Orchestrator");
      const orchestrationIcon = card().querySelector<HTMLButtonElement>(
        "[data-orchestration-icon]",
      );
      expect(orchestrationIcon).not.toBeNull();
      expect(orchestrationIcon?.tagName).toBe("BUTTON");
      expect(orchestrationIcon?.classList.contains("opacity-0")).toBe(false);
      expect(
        orchestrationIcon?.querySelector("svg")?.classList.contains("size-3"),
      ).toBe(true);
      expect(orchestrationIcon?.hasAttribute("title")).toBe(false);
      expect(
        card().querySelector("[data-session-select] [data-orchestration-icon]"),
      ).toBeNull();
      expect(card().textContent).toContain("3 agents");
      expect(card().textContent).toContain("1/3 done");
      expect(card().textContent).toContain("Build settings");
      expect(card().textContent).toContain("Needs input");
      expect(
        card().querySelector('[aria-label="Linked work item updated"]'),
      ).not.toBeNull();
      const archive = card().querySelector<HTMLButtonElement>(
        '[aria-label^="Archive "]',
      )!;
      const pullRequest = card().querySelector('[aria-label="Open PR #42"]');
      expect(card().querySelectorAll('[aria-label^="Archive "]')).toHaveLength(
        1,
      );
      expect(card().lastElementChild?.contains(orchestrationIcon)).toBe(true);
      expect(card().lastElementChild?.contains(pullRequest)).toBe(true);
      expect(archive.nextElementSibling).toBe(pullRequest);
      expect(orchestrationIcon?.parentElement?.lastElementChild).toBe(
        orchestrationIcon,
      );
      act(() => archive.click());
      expect(props.onArchiveSession).toHaveBeenCalledExactlyOnceWith(
        lead.id,
        true,
      );
      expect(props.onSelectSession).not.toHaveBeenCalled();
      // A collapsed row stays one line; the model rides along in the tooltip.
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-a"] button')
          ?.getAttribute("title"),
      ).toContain("codex:worker-a");
      expect(
        card().querySelectorAll("[data-orchestration-agent]"),
      ).toHaveLength(3);
      const normal = container.querySelector<HTMLElement>(
        '[data-session-card="unrelated"]',
      )!;
      expect(normal.hasAttribute("data-orchestration-card")).toBe(false);
      expect(normal.querySelector("[data-orchestration-agent]")).toBeNull();
      // Working the agents list is not a request to open the lead's tab: the
      // row expands in place and the card stays where it is.
      const agentRow = card().querySelector<HTMLButtonElement>(
        '[data-orchestration-agent="worker-a"] button',
      )!;
      expect(card().hasAttribute("role")).toBe(false);
      for (const action of card().querySelectorAll('button, [role="button"]')) {
        expect(
          action.parentElement?.closest('button, [role="button"]'),
        ).toBeNull();
      }
      const selection = card().querySelector<HTMLElement>(
        "[data-session-select]",
      )!;
      act(() => selection.focus());
      expect(document.activeElement).toBe(selection);
      expect(pressKey(selection, "Enter").defaultPrevented).toBe(true);
      expect(props.onSelectSession).toHaveBeenCalledWith(lead.id);
      vi.mocked(props.onSelectSession).mockClear();
      expect(pressKey(agentRow, "Enter").defaultPrevented).toBe(false);
      expect(props.onSelectSession).not.toHaveBeenCalled();
      const wasOpen = agentRow.getAttribute("aria-expanded");
      act(() => agentRow.click());
      expect(props.onSelectSession).not.toHaveBeenCalled();
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-a"] button')
          ?.getAttribute("aria-expanded"),
      ).not.toBe(wasOpen);
      // A blocked agent stays expanded while it needs the lead's attention.
      expect(
        card()
          .querySelector('[data-orchestration-agent="worker-b"] button')
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
      props.approvalSessionIds = new Set([lead.id]);
      act(() => render());
      expect(card().className).toContain("border-dashed");
      expect(card().textContent).toContain("Needs input");
    },
  );

  it("matches an ordinary card at rest and expands when opened or working", () => {
    props.sessions = [
      {
        ...props.sessions[0],
        orchestration: {
          status: "active",
          tasks: [
            {
              sessionId: "worker",
              title: "Review changes",
              harness: "codex",
              model: "codex:test",
              status: "completed",
            },
          ],
        },
      },
    ];
    props.activeSessionId = "another-session";
    props.busySessionIds = new Set();
    act(() => render());

    expect(card().classList.contains("py-2")).toBe(true);
    expect(card().classList.contains("py-2.5")).toBe(false);
    expect(card().classList.contains("bg-content/5")).toBe(false);
    expect(card().querySelector("[data-orchestration-icon]")).not.toBeNull();
    expect(card().querySelector("[data-orchestration-agent]")).toBeNull();

    props.activeSessionId = "session-1";
    act(() => render());
    expect(card().classList.contains("pt-2")).toBe(true);
    expect(card().classList.contains("pb-2.5")).toBe(true);
    expect(card().classList.contains("py-2.5")).toBe(false);
    expect(
      card().querySelector('[data-orchestration-agent="worker"]'),
    ).not.toBeNull();

    props.activeSessionId = "another-session";
    props.busySessionIds = new Set(["session-1"]);
    act(() => render());
    expect(card().classList.contains("pt-2")).toBe(true);
    expect(card().classList.contains("pb-2.5")).toBe(true);
    expect(
      card().querySelector('[data-orchestration-agent="worker"]'),
    ).not.toBeNull();
  });

  it("opens the custom subagent tooltip immediately on hover", () => {
    props.busySessionIds = new Set();
    props.sessions[0].orchestration = {
      status: "active",
      live: true,
      tasks: [
        {
          sessionId: "worker-a",
          title: "Review changes",
          harness: "codex",
          model: "codex:test",
          status: "running",
        },
        {
          sessionId: "worker-b",
          title: "Check types",
          harness: "claude",
          model: "claude:test",
          status: "completed",
        },
      ],
    };
    act(() => render());
    const trigger = card().querySelector<HTMLButtonElement>(
      "[data-orchestration-icon]",
    )!;

    act(() =>
      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip).not.toBeNull();
    expect(tooltip.inert).toBe(false);
    expect(tooltip.textContent).toContain("1/2 done");
    expect(tooltip.textContent).toContain("Review changes");
    expect(tooltip.textContent).toContain("Working");
    expect(tooltip.textContent).toContain("Check types");
    expect(tooltip.textContent).toContain("Done");

    act(() =>
      trigger.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("renders saved worker details without claiming the workers are running", () => {
    props.busySessionIds = new Set();
    props.sessions[0].orchestration = {
      status: "active",
      tasks: [
        {
          sessionId: "worker",
          title: "Saved task",
          harness: "codex",
          model: "codex:test",
          status: "running",
        },
      ],
    };
    act(() => render());
    expect(card().textContent).toContain("Saved task");
    expect(card().textContent).toContain("Saved");
    expect(card().textContent).not.toContain("Working");
    expect(card().querySelector(".motion-safe\\:animate-pulse")).toBeNull();
  });
});

describe("sidebar automation card", () => {
  it("shows a bolt on sessions started by an automation", () => {
    props.busySessionIds = new Set();
    props.sessions[0].automationId = "automation-1";
    act(() => render());
    const icon = card().querySelector("[data-automation-icon]");
    expect(icon).not.toBeNull();
    expect(icon?.tagName).toBe("SPAN");
    expect(icon?.getAttribute("aria-label")).toBe("Started by an automation");
    expect(card().querySelector("[data-orchestration-icon]")).toBeNull();
    expect(
      card().querySelector("[data-session-select] [data-automation-icon]"),
    ).toBeNull();
  });
});

describe("sidebar linked work item updates", () => {
  it("opens a linked item beside the session that owns it", () => {
    props.busySessionIds = new Set();
    props.onOpenInboxItem = vi.fn();
    const linkedWorkItem = {
      kind: "pr" as const,
      repo: "acme/app",
      number: 42,
      url: "https://github.com/acme/app/pull/42",
    };
    props.sessions = [{ ...props.sessions[0], linkedWorkItem }];
    act(() => render());

    const pullRequest = card().querySelector<HTMLButtonElement>(
      '[aria-label="Open PR #42"]',
    )!;
    expect(pullRequest.title).toContain("beside this session");
    act(() => pullRequest.click());
    expect(props.onOpenInboxItem).toHaveBeenCalledExactlyOnceWith(
      linkedWorkItem,
      "session-1",
    );
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("uses the footer for the linked issue or PR instead of a second harness icon", () => {
    props.busySessionIds = new Set();
    props.onArchiveSession = vi.fn();
    props.sessions = [
      {
        ...props.sessions[0],
        branch: "feature/session-card",
        repo: "acme/app",
        linkedWorkItem: {
          kind: "pr",
          repo: "acme/app",
          number: 42,
          url: "https://github.com/acme/app/pull/42",
        },
      },
    ];
    act(() => render());

    const rows = card().children;
    const archive = card().querySelector('[aria-label^="Archive "]');
    const pullRequest = card().querySelector('[aria-label="Open PR #42"]');
    expect(card().querySelectorAll('img[alt=""]')).toHaveLength(1);
    expect(rows.item(rows.length - 1)?.contains(pullRequest)).toBe(true);
    expect(archive?.parentElement).toBe(pullRequest?.parentElement);
    expect(archive?.nextElementSibling).toBe(pullRequest);
  });

  it("renders an unread dot without changing session order", () => {
    props.busySessionIds = new Set();
    props.activeSessionId = undefined;
    props.sessions = [
      {
        ...props.sessions[0],
        id: "session-2",
        title: formatSessionTitle("codex", "Newer conversation"),
        updatedAt: 200,
      },
      {
        ...props.sessions[0],
        id: "session-1",
        title: formatSessionTitle("codex", "Updated PR conversation"),
        updatedAt: 100,
        linkedWorkItem: {
          kind: "pr",
          repo: "acme/app",
          number: 42,
          url: "https://github.com/acme/app/pull/42",
        },
      },
    ];
    props.linkedSessionUpdateIds = new Set(["session-1"]);
    act(() => render());

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-session-card]"),
      ).map((row) => row.dataset.sessionCard),
    ).toEqual(["session-2", "session-1"]);
    expect(
      card().querySelector('[aria-label="Linked work item updated"]'),
    ).not.toBeNull();
  });
});

describe("sidebar session GitHub links", () => {
  function openLinkDialog() {
    act(() =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const link = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Link GitHub issue or PR…")!;
    expect(link).toBeDefined();
    act(() => link.click());
    return document.querySelector<HTMLInputElement>(
      'input[aria-label="GitHub issue or pull request URL"]',
    )!;
  }

  it("manually links a session from its context menu", () => {
    props.onSetSessionLinkedWorkItem = vi.fn();
    act(() => render());
    const input = openLinkDialog();
    typeTitle(
      input,
      "https://github.com/acme/widgets/issues/27?notification=1",
    );
    const submit = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Link",
    )!;
    act(() => submit.click());

    expect(props.onSetSessionLinkedWorkItem).toHaveBeenCalledWith("session-1", {
      kind: "issue",
      repo: "acme/widgets",
      number: 27,
      url: "https://github.com/acme/widgets/issues/27",
    });
    act(() => completeMotionAnimation(document.querySelector('[role="dialog"]')?.closest(".fixed.inset-0")));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open when the URL is not a GitHub work item", () => {
    props.onSetSessionLinkedWorkItem = vi.fn();
    act(() => render());
    const input = openLinkDialog();
    typeTitle(input, "https://example.com/issues/27");
    const submit = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Link",
    )!;
    act(() => submit.click());

    expect(props.onSetSessionLinkedWorkItem).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "valid GitHub issue or pull request URL",
    );
  });

  it("edits or removes an existing link", () => {
    props.sessions[0] = {
      ...props.sessions[0],
      linkedWorkItem: {
        kind: "pr",
        repo: "acme/widgets",
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
      },
    };
    props.onSetSessionLinkedWorkItem = vi.fn();
    act(() => render());
    act(() =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const edit = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Edit GitHub issue or PR link…")!;
    act(() => edit.click());

    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="GitHub issue or pull request URL"]',
      )?.value,
    ).toBe("https://github.com/acme/widgets/pull/42");
    const remove = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove link",
    )!;
    act(() => remove.click());
    expect(props.onSetSessionLinkedWorkItem).toHaveBeenCalledWith(
      "session-1",
      undefined,
    );
  });
});

describe("sidebar session reminders", () => {
  function openReminderMenu() {
    act(() =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Remind me")!;
    act(() =>
      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    return document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Remind me"]',
    )!;
  }

  it("schedules the selected session from the hover submenu", () => {
    props.onSetReminders = vi.fn();
    act(() => render());
    const submenu = openReminderMenu();
    const preset = Array.from(
      submenu.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent?.startsWith("In 3 hours"))!;
    const before = Date.now();
    act(() => preset.click());
    const [ids, dueAt] = vi.mocked(props.onSetReminders).mock.calls[0];
    expect(ids).toEqual(["session-1"]);
    expect(dueAt).toBeGreaterThanOrEqual(before + 3 * 60 * 60 * 1000);
    expect(dueAt).toBeLessThanOrEqual(Date.now() + 3 * 60 * 60 * 1000);
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("groups reminders first without a card clock and offers cancellation first", () => {
    props.onSetReminders = vi.fn();
    props.onCancelReminders = vi.fn();
    props.reminders = [
      {
        sessionId: "session-1",
        dueAt: Date.now() + 3600_000,
        firedAt: null,
        title: "Original conversation",
        harness: "codex",
        cwd: props.cwd,
      },
    ];
    props.sessions = [
      { ...props.sessions[0], pinned: true },
      { ...props.sessions[0], id: "session-2", pinned: true },
    ];
    act(() => render());
    const group = container.querySelector<HTMLElement>(
      "[data-reminder-sessions]",
    )!;
    expect(group.parentElement!.firstElementChild).toBe(group);
    expect(group.querySelector('[data-session-card="session-1"]')).toBe(card());
    expect(
      container.querySelectorAll('[data-session-card="session-1"]'),
    ).toHaveLength(1);
    expect(group.hasAttribute("data-session-folder")).toBe(false);
    expect(
      group.querySelector('button[title="Reminders"]')!.className,
    ).not.toContain("cursor-grab");
    expect(card().querySelector('[aria-label^="Reminder:"]')).toBeNull();
    act(() =>
      card().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const cancel = document.querySelector<HTMLButtonElement>(
      '[aria-label="Session actions"] [role="menuitem"]',
    )!;
    expect(cancel.textContent).toBe(
      `Cancel reminder${formatReminderTime(props.reminders[0].dueAt)}`,
    );
    act(() => cancel.click());
    expect(props.onCancelReminders).toHaveBeenCalledExactlyOnceWith([
      "session-1",
    ]);
    expect(props.onSetReminders).not.toHaveBeenCalled();
    props.reminders = [];
    act(() => render());
    expect(container.querySelector("[data-reminder-sessions]")).toBeNull();
    expect(
      container.querySelector(
        '[data-pinned-sessions] [data-session-card="session-1"]',
      ),
    ).toBe(card());
  });
});

it("labels preserved sessions as having no branch selected", () => {
  props.sessions = [
    {
      ...props.sessions[0],
      branch: "old-feature",
      repo: "project",
      worktreeRemoved: true,
    },
  ];
  act(render);
  expect(card().textContent).toContain("No branch selected");
  expect(card().textContent).not.toContain("old-feature");
  props.sessions = [
    { ...props.sessions[0], branch: "main", worktreeRemoved: undefined },
  ];
  act(render);
  expect(card().textContent).not.toContain("No branch selected");
  expect(card().textContent).toContain("project/main");
});


describe("single sidebar layout and width", () => {
  it("removes the fallback chrome row when controls move to the menu bar", () => {
    props.onToggleSidebar = vi.fn();
    props.onGoToFile = vi.fn();
    act(render);
    const fallbackRow = container.querySelector("aside")!.firstElementChild!;
    expect(fallbackRow.classList.contains("h-10")).toBe(true);
    expect(fallbackRow.querySelector("[data-window-navigation-space]")).not.toBeNull();
    const toggle = fallbackRow.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Sidebar (Ctrl+B)"]',
    )!;
    act(() => toggle.click());
    expect(props.onToggleSidebar).toHaveBeenCalledOnce();
    expect(fallbackRow.nextElementSibling!.classList.contains("h-8")).toBe(true);

    props.chromeInMenuBar = true;
    act(render);
    const workspaceRow = container.querySelector("aside")!.firstElementChild!;
    expect(workspaceRow.classList.contains("h-8")).toBe(true);
    expect(workspaceRow.querySelector('button[aria-label^="Quick Open"]')).not.toBeNull();
    expect(workspaceRow.nextElementSibling!.getAttribute("role")).toBe("tablist");
    expect(container.querySelector("[data-window-navigation-space]")).toBeNull();
    expect(container.querySelector('button[aria-label^="Toggle Sidebar"]')).toBeNull();
    expect(card()).not.toBeNull();

    props.chromeInMenuBar = false;
    act(render);
    expect(container.querySelectorAll("[data-window-navigation-space]")).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label^="Toggle Sidebar"]')).toHaveLength(1);
  });

  it("keeps exactly one panel with Sessions, Explorer and Changes", async () => {
    act(render);
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect([...container.querySelectorAll('[role="tablist"] [role="tab"]')].map(tab => tab.textContent)).toEqual(["Sessions", "Explorer", "Changes"]);
    expect(container.querySelector("nav")).toBeNull();
    props.open = false;
    act(render);
    const shell = container.querySelector<HTMLElement>("[data-sidebar-transition]")!;
    expect(shell.hasAttribute("inert")).toBe(true);
    // The width animation settles the fold when its playback promise resolves.
    await act(async () => completeMotionAnimation(shell));
    expect(container.querySelector("aside")!.closest("[hidden]")).not.toBeNull();
    props.open = true;
    act(render);
    expect(card()).not.toBeNull();
  });

  it("reads the saved width only on mount, not on sidebar updates or reopening", () => {
    const read = vi.spyOn(localStorage, "getItem");
    act(render);
    const widthReads = () => read.mock.calls.filter(([key]) => key === "monocode.sidebarWidth").length;
    expect(widthReads()).toBe(1);
    props = { ...props, pending: true };
    act(render);
    props = { ...props, open: false };
    act(render);
    props = { ...props, open: true };
    act(render);
    expect(widthReads()).toBe(1);
  });

  it("keeps content during collapse, hides its portal and reuses the list after reopening", async () => {
    vi.useFakeTimers();
    localStorage.setItem("monocode.sidebarWidth", "390");
    act(render);
    const aside = container.querySelector("aside");
    act(() => card().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    props.open = false;
    act(render);
    const shell = container.querySelector<HTMLElement>("[data-sidebar-transition]")!;
    expect(shell.style.width).toBe("0px");
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    expect(shell.hasAttribute("inert")).toBe(true);
    expect(container.querySelector("aside")).toBe(aside);
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(container.querySelector("aside")).toBe(aside);
    expect(aside!.closest("[hidden]")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(container.querySelector("aside")).toBe(aside);
    expect(aside!.closest("[hidden]")).not.toBeNull();
    expect(localStorage.getItem("monocode.sidebarWidth")).toBe("390");
    props.open = true;
    act(render);
    expect(container.querySelector("aside")).toBe(aside);
    expect(aside!.closest("[hidden]")).toBeNull();
    // Retained surfaces follow the same visibility contract as parked tabs.
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("reverses collapse without letting the old timeout remove the reopened sidebar", () => {
    vi.useFakeTimers();
    act(render);
    const aside = container.querySelector("aside");
    props.open = false;
    act(render);
    act(() => vi.advanceTimersByTime(50));
    props.open = true;
    act(render);
    const shell = container.querySelector<HTMLElement>("[data-sidebar-transition]")!;
    expect(shell.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`);
    expect(shell.hasAttribute("inert")).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector("aside")).toBe(aside);
  });

  it("collapses immediately when reduced motion is requested", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList);
    act(render);
    props.open = false;
    act(render);
    expect(container.querySelector("aside")!.closest("[hidden]")).not.toBeNull();
    expect(container.querySelector<HTMLElement>("[data-sidebar-transition]")!.style.width).toBe("0px");
  });

  it("finishes a live resize before collapse and restores its saved width", () => {
    const resizedWidth = SIDEBAR_WIDTH_DEFAULT + 130;
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("innerWidth", 1500);
    act(render);
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize sidebar"]')!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: SIDEBAR_WIDTH_DEFAULT, bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: resizedWidth }));
    });
    act(() => frame?.(0));
    const shell = container.querySelector<HTMLElement>("[data-sidebar-transition]")!;
    // While resizing, CSS reads the live width from this property; Motion owns the resting width.
    expect(shell.style.getPropertyValue("--sidebar-resize-width")).toBe(`${resizedWidth}px`);
    expect(shell.dataset.resizing).toBe("true");
    props.open = false;
    act(render);
    expect(shell.style.width).toBe("0px");
    expect(localStorage.getItem("monocode.sidebarWidth")).toBe(String(resizedWidth));
    expect(document.documentElement.classList.contains("is-resizing")).toBe(false);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 500 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 500 }));
    });
    expect(localStorage.getItem("monocode.sidebarWidth")).toBe(String(resizedWidth));
    props.open = true;
    act(render);
    expect(shell.style.width).toBe(`${resizedWidth}px`);
    expect(container.querySelector<HTMLElement>("aside")!.style.width).toBe(`${resizedWidth}px`);
  });

  it("commits resize width, restores it after remount and resets on double click", () => {
    const resizedWidth = SIDEBAR_WIDTH_DEFAULT + 130;
    vi.stubGlobal("innerWidth", 1500);
    act(render);
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize sidebar"]')!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: SIDEBAR_WIDTH_DEFAULT, bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: resizedWidth }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: resizedWidth }));
    });
    expect(localStorage.getItem("monocode.sidebarWidth")).toBe(String(resizedWidth));
    expect(container.querySelector("aside")!.style.width).toBe(`${resizedWidth}px`);
    act(() => root.unmount());
    root = createRoot(container);
    act(render);
    expect(container.querySelector("aside")!.style.width).toBe(`${resizedWidth}px`);
    act(() => container.querySelector('[aria-label="Resize sidebar"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(container.querySelector("aside")!.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`);
    expect(localStorage.getItem("monocode.sidebarWidth")).toBe(String(SIDEBAR_WIDTH_DEFAULT));
  });
});
