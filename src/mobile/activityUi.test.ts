import { advanceMotionTimers, startMotionClock, stopMotionClock } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MobileApp } from "./MobileApp";
import type { HostSessionSummary } from "../features/connections/model/protocol";
import type { SessionReference } from "../features/bots/model/botView";
import { setUiLanguage } from "../shared/i18n/language";

const mocked = vi.hoisted(() => ({
  summaries: [] as HostSessionSummary[],
  permission: "granted",
  notify: vi.fn(),
  openSettings: vi.fn(async () => {}),
  session: vi.fn(),
  status: { state: "connected" as const },
  updateSession: vi.fn(),
  native: false,
  nativeUnread: undefined as ((result: { environmentId: string; unreadIds: string[] }) => void) | undefined,
}));
vi.mock("./client", () => ({
  MobileClient: class {
    connection = {
      endpoint: "http://computer:3774",
      token: "test-token",
      environmentId: "host",
      name: "Computer",
    };
    getConnectionStatus = () => mocked.status;
    hasCapability = () => false;
    subscribeConnectionStatus = () => () => {};
    restore = async () => true;
    pending = async () => undefined;
    savedConnections = async () => [];
    switchTo = async () => undefined;
    verify = async () => {};
    projects = async () => [
      { id: "project", name: "Project", cwd: "/project" },
      { id: "other-project", name: "Other", cwd: "/other" },
    ];
    sessions = async (projectId: string) =>
      mocked.summaries.filter((row) => row.projectId === projectId);
    models = async () => ({ models: {}, errors: {} });
    activity = async () => ({
      environmentId: "host",
      sessions: mocked.summaries,
    });
    session = mocked.session;
    rpc = async (method: string, params?: { sessionId?: string }) => {
      if (method === "projects.list") return this.projects();
      if (method === "sessions.get") return mocked.session(params?.sessionId);
      return null;
    };
    cachedModels = () => undefined;
    cachedSession = () => undefined;
    sessionPreviews = async () => undefined;
    updateSession = mocked.updateSession;
  },
}));
vi.mock("./MobileAppUpdates", () => ({
  useMobileAppUpdates: () => ({}),
  MobileAppUpdates: () => null,
}));
vi.mock("./MobileTranscript", () => ({
  MobileTranscript: () => createElement("div", { "data-transcript": true }),
}));
vi.mock("./MobileAssistant", () => ({
  MobileAssistant: ({ onOpen }: { onOpen: (ref: SessionReference) => Promise<void> }) =>
    createElement("button", {
      "data-assistant-open": true,
      onClick: () => onOpen({ environmentId: "host", projectId: "other-project", sessionId: "two" }),
    }, "Open conversation"),
}));
vi.mock("./notifications", () => ({
  nativeActivityNotifications: () => mocked.native,
  MobileNotifications: {
    addListener: async (event: string, callback: typeof mocked.nativeUnread) => {
      if (event === "unread") mocked.nativeUnread = callback;
      return { remove: async () => {} };
    },
    state: async () => ({ environmentId: "host", unreadIds: [] }),
    consumeOpen: async () => ({}),
    setVisible: async () => ({ environmentId: "host", unreadIds: [] }),
    observe: async () => ({ environmentId: "host", unreadIds: [] }),
    start: async () => {},
    stop: async () => {},
    openSettings: mocked.openSettings,
  },
  mobileNotificationPermission: async () => mocked.permission,
  mobileNotificationTexts: () => ({}),
  showBrowserActivityNotification: mocked.notify,
}));

let root: Root;
let node: HTMLDivElement;
function summary(id = "one", projectId = "project"): HostSessionSummary {
  return {
    id,
    projectId,
    title: id === "one" ? "First conversation" : "Other conversation",
    harness: "codex",
    status: "idle",
    revision: 10,
    updatedAt: 100,
    lastReplyRevision: 8,
    lastCompletedRunId: "old",
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  startMotionClock();
  localStorage.clear();
  setUiLanguage("en");
  mocked.permission = "granted";
  mocked.native = false;
  mocked.nativeUnread = undefined;
  mocked.notify.mockClear();
  mocked.openSettings.mockClear();
  mocked.summaries = [summary(), summary("two", "other-project")];
  mocked.updateSession.mockReset().mockImplementation(async (_projectId: string, id: string, patch: object) => {
    mocked.summaries = mocked.summaries.map(row => row.id === id ? { ...row, ...patch, revision: row.revision + 1 } : row);
    return mocked.summaries.find(row => row.id === id);
  });
  mocked.session.mockReset().mockImplementation(async (id: string) => {
    const row = mocked.summaries.find((session) => session.id === id)!;
    return {
      ...row,
      session: {
        id,
        cwd: row.projectId === "project" ? "/project" : "/other",
        title: row.title,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "supervised",
        blocks: [],
      },
    };
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  stopMotionClock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
// AutoAnimate uses real WAAPI; finish retained list removals after the UI settles.
async function finishListAnimations() {
  await advanceMotionTimers(300);
}
// Departing pages remain in DOM briefly but cannot be selected by the user.
const activePage = () => node.querySelector<HTMLElement>('[data-page-active="true"]')!;
async function openMenu() {
  await act(async () => {
    node.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')!.click();
  });
}
async function swipeOpenDrawer() {
  Object.defineProperty(node.querySelector(".mobile-drawer")!, "offsetWidth", { value: 300, configurable: true });
  const surface = node.querySelector(".mobile-chat")!;
  for (const [type, x] of [["pointerdown", 20], ["pointermove", 60], ["pointermove", 240], ["pointerup", 240]] as const) {
    await act(async () => surface.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: 300,
    })));
  }
  expect(node.querySelector(".mobile-drawer-backdrop")!.getAttribute("data-open")).toBe("true");
  await advanceMotionTimers(400);
}
// Start a blank chat from Home before exercising the conversation drawer.
/** The drawer keeps Projects in its collapsed More section. */
async function openAllProjects() {
  const more = node.querySelector<HTMLButtonElement>(".mobile-drawer-more-toggle")!;
  if (more.getAttribute("aria-expanded") !== "true") await act(async () => more.click());
  await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-all-projects")!.click());
}
/** Projects live behind the drawer's Projects page. */
async function goToProject(cwd: string) {
  await act(async () => node.querySelector<HTMLButtonElement>('header [aria-label="Menu"]')!.click());
  await openAllProjects();
  await act(async () => activePage().querySelector<HTMLButtonElement>(`.mobile-home-project[title="${cwd}"]`)!.click());
}
async function clickProject() {
  await act(async () => {
    root.render(createElement(MobileApp));
  });
  await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
  await openMenu();
}
async function updateReply(id = "one") {
  mocked.summaries = mocked.summaries.map((row) =>
    row.id === id
      ? {
          ...row,
          revision: 20,
          lastReplyRevision: 20,
          lastCompletedRunId: "new",
        }
      : row,
  );
  await act(async () => {
    await advanceMotionTimers(3_000);
  });
}
describe("mobile header search", () => {
  const visibleIds = () => [...activePage().querySelectorAll(".mobile-home [data-session-id]")]
    .map((row) => row.getAttribute("data-session-id"));
  const searchButton = (label = "Search conversations") =>
    activePage().querySelector<HTMLButtonElement>(`.mobile-home-search[aria-label="${label}"]`) ??
    node.querySelector<HTMLButtonElement>(`header button[aria-label="${label}"]`)!;
  const input = () => node.querySelector<HTMLInputElement>("header .mobile-header-search input")!;
  const typeQuery = async (query: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), query);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await finishListAnimations();
  };

  it("replaces the leading header controls, filters all projects and restores the list and focus on close", async () => {
    await act(async () => root.render(createElement(MobileApp)));
    expect(visibleIds()).toEqual(["one", "two"]);
    const trigger = searchButton();
    await act(async () => trigger.click());
    expect(document.activeElement).toBe(input());
    expect(activePage().querySelector(".mobile-home input")).toBeNull();
    expect(node.querySelector('header button[aria-label="Menu"]')!.hasAttribute("inert")).toBe(true);
    expect(node.querySelector("header .mobile-header-title")!.getAttribute("aria-hidden")).toBe("true");
    await typeQuery(" First ");
    expect(visibleIds()).toEqual(["one"]);
    await typeQuery("Other");
    expect(visibleIds()).toEqual(["two"]);
    await act(async () => searchButton("Close search").click());
    expect(document.activeElement).toBe(trigger);
    expect(node.querySelector(".mobile-header-search")!.getAttribute("data-fold-state")).toBe("closing");
    expect(node.querySelector(".mobile-header-search")!.hasAttribute("inert")).toBe(true);
    expect(node.querySelector('header button[aria-label="Menu"]')!.hasAttribute("inert")).toBe(false);
    await finishListAnimations();
    expect(visibleIds()).toEqual(["one", "two"]);
    await advanceMotionTimers(350);
    expect(node.querySelector(".mobile-header-search")).toBeNull();
    await act(async () => trigger.click());
    expect(input().value).toBe("");
  });

  it.each([".mobile-home-filter", ".mobile-home-new", '.mobile-home [data-session-id="one"]'])("consumes outside touch on %s without invoking its action", async (selector) => {
    await act(async () => root.render(createElement(MobileApp)));
    await act(async () => searchButton().click());
    const target = node.querySelector<HTMLButtonElement>(selector)!;
    const callsBeforeDismiss = mocked.session.mock.calls.length;
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, button: 0 });
    await act(async () => target.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    await advanceMotionTimers(500);
    expect(node.querySelector('.mobile-session-actions')).toBeNull();
    await act(async () => {
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch" }));
      target.click();
    });
    expect(mocked.session.mock.calls.length).toBe(callsBeforeDismiss);
    expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("home");
    expect(activePage().querySelector(".mobile-home-recent")).not.toBeNull();
    expect(node.querySelector(".mobile-header-search")!.getAttribute("data-fold-state")).toBe("closing");
    await advanceMotionTimers(350);
    expect(node.querySelector(".mobile-header-search")).toBeNull();
  });

  it("keeps project search scoped, supports rapid reversal and localizes keyboard dismissal", async () => {
    await act(async () => root.render(createElement(MobileApp)));
    await goToProject("/project");
    expect(node.querySelector('header button[aria-label="Search conversations"]')).not.toBeNull();
    expect(node.querySelector("header .mobile-header-title")!.tagName).toBe("DIV");
    expect(node.querySelector(".mobile-project-header-name svg")).toBeNull();
    // The header names the Host and reports its state through the status dot.
    expect(node.querySelector("header .mobile-header-host .mobile-host-status")!.getAttribute("aria-label")).toBe("Connected");
    expect(activePage().querySelector(".mobile-home-host")).toBeNull();
    const projectSearch = searchButton();
    expect(projectSearch.closest("header")).not.toBeNull();
    expect(activePage().querySelector(".mobile-home-search")).toBeNull();
    await act(async () => searchButton().click());
    await typeQuery("Other");
    expect(visibleIds()).toEqual([]);
    expect(node.textContent).toContain("No matching conversations");
    await act(async () => searchButton("Close search").click());
    await advanceMotionTimers(32);
    await act(async () => searchButton().click());
    expect(node.querySelector(".mobile-header-search")!.getAttribute("data-fold-state")).toBe("opening");
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
    await typeQuery("First");
    await act(async () => setUiLanguage("zh-CN"));
    expect(input().getAttribute("aria-label")).toBe("搜索对话");
    expect(input().value).toBe("First");
    expect(visibleIds()).toEqual(["one"]);
    const trigger = searchButton("关闭搜索");
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toBe(projectSearch);
    expect(node.querySelector("header strong")!.textContent).toBe("Project");
    expect(node.querySelector('header button[aria-label="返回"]')!.hasAttribute("inert")).toBe(false);
    await advanceMotionTimers(350);
    expect(node.querySelector(".mobile-header-search")).toBeNull();
  });

  it("searches Home, consumes dismissal before opening a conversation and respects reduced motion", async () => {
    const matchMedia = window.matchMedia.bind(window);
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = matchMedia(query);
      if (query === "(prefers-reduced-motion: reduce)")
        Object.defineProperty(result, "matches", { value: true });
      return result;
    });
    try {
      await clickProject();
      await act(async () => [...node.querySelectorAll<HTMLButtonElement>(".mobile-drawer-top > button")]
        .find((button) => button.textContent === "Sessions")!.click());
      await act(async () => searchButton().click());
      expect(node.querySelector(".mobile-header-search")!.getAttribute("data-fold-state")).toBe("open");
      await typeQuery("Other");
      expect(visibleIds()).toEqual(["two"]);
      const callsBeforeDismiss = mocked.session.mock.calls.length;
      await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-home [data-session-id="two"]')!.click());
      expect(mocked.session.mock.calls.length).toBe(callsBeforeDismiss);
      expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("home");
      expect(node.querySelector(".mobile-header-search")).toBeNull();
      await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-home [data-session-id="two"]')!.click());
      expect(mocked.session).toHaveBeenCalledWith("two");
      expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("chat");
      expect(node.querySelector(".mobile-header-search")).toBeNull();
      await openMenu();
      await act(async () => [...node.querySelectorAll<HTMLButtonElement>(".mobile-drawer-top > button")]
        .find((button) => button.textContent === "Sessions")!.click());
      expect(visibleIds()).toEqual(["one", "two"]);
      await act(async () => searchButton().click());
      expect(input().value).toBe("");
      await act(async () => searchButton("Close search").click());
      expect(node.querySelector(".mobile-header-search")).toBeNull();
    } finally {
      media.mockRestore();
    }
  });
});
describe("mobile project conversation Back navigation", () => {
  const headerButton = (label: string) => node.querySelector<HTMLButtonElement>(`header button[aria-label="${label}"]`);
  const openProjectPage = async () => {
    await act(async () => root.render(createElement(MobileApp)));
    await goToProject("/other");
  };
  const openRow = async () => {
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-home [data-session-id="two"]')!.click());
  };

  it.each(["recent", "pinned", "search"])("returns a %s conversation to its project", async (entry) => {
    if (entry === "pinned") mocked.summaries[1].pinned = true;
    await openProjectPage();
    if (entry === "search") {
      await act(async () => headerButton("Search conversations")!.click());
      await act(async () => {
        const input = node.querySelector<HTMLInputElement>(".mobile-header-search input")!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Other");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await finishListAnimations();
      expect(activePage().querySelectorAll(".mobile-home [data-session-id]")).toHaveLength(1);
      await openRow(); // Existing outside-click behavior dismisses search first.
    }
    await openRow();
    expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("chat");
    expect(headerButton("Menu")).toBeNull();
    await act(async () => headerButton("Back")!.click());
    expect(node.querySelector("header strong")!.textContent).toBe("Other");
    await finishListAnimations();
    expect(activePage().querySelectorAll(".mobile-home [data-session-id]")).toHaveLength(1);
    expect(activePage().querySelector('.mobile-home [data-session-id="two"]')).not.toBeNull();
  });

  it.each(["existing", "draft"])("preserves the %s conversation's source through settings and localizes Back", async (kind) => {
    await openProjectPage();
    if (kind === "existing") await openRow();
    else await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
    expect(headerButton("Back")).not.toBeNull();
    await swipeOpenDrawer();
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-settings")!.click());
    await act(async () => headerButton("Back")!.click());
    expect(node.querySelector(".mobile-app")!.getAttribute("data-view")).toBe("chat");
    expect(headerButton("Menu")).toBeNull();
    act(() => setUiLanguage("zh-CN"));
    await act(async () => headerButton("返回")!.click());
    expect(node.querySelector("header strong")!.textContent).toBe("Other");
  });

  it.each(["existing", "new"])("resets the source when the sidebar opens a %s conversation after a project visit", async (kind) => {
    await openProjectPage();
    await openRow();
    await swipeOpenDrawer();
    await act(async () => node.querySelector<HTMLButtonElement>(kind === "existing"
      ? '.mobile-drawer [data-session-id="two"]' : '.mobile-drawer-new')!.click());
    expect(node.querySelector("header strong")!.textContent).toBe(kind === "existing" ? "Other conversation" : "New conversation");
    expect(headerButton("Menu")).not.toBeNull();
    expect(headerButton("Back")).toBeNull();
  });

  it("resets the source when the assistant opens the same conversation", async () => {
    await openProjectPage();
    await openRow();
    await swipeOpenDrawer();
    await act(async () => [...node.querySelectorAll<HTMLButtonElement>(".mobile-drawer-top > button")]
      .find((button) => button.textContent === "Assistant")!.click());
    await act(async () => node.querySelector<HTMLButtonElement>("[data-assistant-open]")!.click());
    expect(node.querySelector("header strong")!.textContent).toBe("Other conversation");
    expect(headerButton("Menu")).not.toBeNull();
    expect(headerButton("Back")).toBeNull();
  });

  it("keeps the menu when Home opens the same conversation after a project visit", async () => {
    await openProjectPage();
    await openRow();
    await act(async () => headerButton("Back")!.click());
    await act(async () => headerButton("Back")!.click());
    expect(node.querySelector("header strong")!.textContent).toBe("OmniCode");
    await openRow();
    expect(headerButton("Menu")).not.toBeNull();
    expect(headerButton("Back")).toBeNull();
  });
});

describe("mobile unread indicators and notification navigation", () => {
  it("opens native conversation notification settings after permission is already granted", async () => {
    mocked.native = true;
    await clickProject();
    await act(async () => {
      node.querySelector<HTMLButtonElement>(".mobile-drawer-settings")!.click();
    });
    await act(async () => vi.dynamicImportSettled());
    expect(node.querySelector('[aria-label="Notifications"] .mobile-settings-value')?.textContent).toBe("On");
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Notifications"]')!.click());
    const notificationSettings = [...node.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Notification settings…");
    expect(notificationSettings).toBeDefined();
    await act(async () => notificationSettings!.click());
    expect(mocked.openSettings).toHaveBeenCalledOnce();
    await act(async () => setUiLanguage("zh-CN"));
    expect(notificationSettings!.textContent).toBe("通知设置…");
  });
  const menuButton = (label: string) => [...node.querySelectorAll<HTMLButtonElement>(".mobile-session-actions button")]
    .find(button => button.textContent?.trim() === label)!;
  const holdSession = async (id: string) => {
    const row = node.querySelector<HTMLButtonElement>(`[data-session-id="${id}"]`)!;
    await act(async () => {
      row.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, pointerId: 8, pointerType: "touch", button: 0, clientX: 100, clientY: 100,
      }));
      await advanceMotionTimers(450);
      row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 8, pointerType: "touch" }));
      row.click();
    });
    await act(async () => vi.dynamicImportSettled());
  };
  it("pins and archives the held conversation without switching away from the current conversation", async () => {
    mocked.summaries.push(summary("second", "project"));
    await clickProject();
    await act(async () => node.querySelector<HTMLButtonElement>('[data-session-id="one"]')!.click());
    await openMenu();
    await holdSession("second");
    const menu = node.querySelector<HTMLElement>('.mobile-sheet[aria-label="Session actions"]')!;
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("100px");
    expect(mocked.session).not.toHaveBeenCalledWith("second");
    await act(async () => menuButton("Pin").click());
    expect(mocked.updateSession).toHaveBeenCalledWith("project", "second", { pinned: true });
    expect(node.querySelector(".mobile-session-row")!.getAttribute("data-session-id")).toBe("second");
    expect(node.querySelector("header strong")?.textContent).toBe("First conversation");
    await holdSession("second");
    expect(menuButton("Unpin")).toBeDefined();
    await act(async () => menuButton("Archive").click());
    expect(mocked.updateSession).toHaveBeenCalledWith("project", "second", { archived: true });
    await finishListAnimations();
    expect(node.querySelector('[data-session-id="second"]')).toBeNull();
    expect(mocked.session).not.toHaveBeenCalledWith("second");
  });
  it.each([false, true])("retains a manual unread mark across activity polling (native=%s) until the conversation opens", async (native) => {
    mocked.native = native;
    await clickProject();
    await act(async () => node.querySelector<HTMLButtonElement>('[data-session-id="one"]')!.click());
    await openMenu();
    await holdSession("one");
    await act(async () => menuButton("Mark as unread").click());
    expect(node.querySelector(".mobile-unread-dot")).not.toBeNull();
    expect(node.querySelector("header strong")?.textContent).toBe("First conversation");
    await act(async () => {
      mocked.nativeUnread?.({ environmentId: "host", unreadIds: [] });
      await advanceMotionTimers(3000);
    });
    expect(node.querySelector(".mobile-unread-dot")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("omnicode.mobileActivity:host")!).entries.one.manualUnread).toBe(true);
    expect(mocked.notify).not.toHaveBeenCalled();
    await act(async () => node.querySelector<HTMLButtonElement>('[data-session-id="one"]')!.click());
    await openMenu();
    await advanceMotionTimers(600);
    await finishListAnimations();
    expect(node.querySelector(".mobile-unread-dot")).toBeNull();
    expect(JSON.parse(localStorage.getItem("omnicode.mobileActivity:host")!).entries.one.manualUnread).toBeUndefined();
  });
  it("shows a green unread marker at the end of a row, clears it after loading and does not repeat the banner", async () => {
    await clickProject();
    expect(node.querySelector(".mobile-unread-dot")).toBeNull();
    await updateReply();
    const dot = node.querySelector(
      '.mobile-unread-dot[aria-label="Unread reply"]',
    )!;
    expect(dot).not.toBeNull();
    expect(dot.parentElement?.tagName).toBe("SMALL");
    expect(dot.parentElement?.lastElementChild).toBe(dot);
    expect(mocked.notify).toHaveBeenCalledTimes(1);
    await act(async () => {
      node.querySelector<HTMLButtonElement>(".mobile-session-row")!.click();
    });
    expect(
      JSON.parse(localStorage.getItem("omnicode.mobileActivity:host")!).entries
        .one.read,
    ).toBe(20);
    await openMenu();
    await advanceMotionTimers(600);
    await finishListAnimations();
    expect(node.querySelector(".mobile-unread-dot")).toBeNull();
    await act(async () => {
      await advanceMotionTimers(3_000);
    });
    expect(mocked.notify).toHaveBeenCalledTimes(1);
  });
  it("keeps the unread marker if opening the conversation fails", async () => {
    await clickProject();
    await updateReply();
    mocked.session.mockRejectedValue(new Error("Offline"));
    await act(async () => {
      node.querySelector<HTMLButtonElement>(".mobile-session-row")!.click();
    });
    expect(
      JSON.parse(localStorage.getItem("omnicode.mobileActivity:host")!).entries
        .one.read,
    ).toBeLessThan(20);
    await openMenu();
    expect(node.querySelector(".mobile-unread-dot")).not.toBeNull();
  });
  it("still marks unread replies when permission is denied and localizes the marker", async () => {
    mocked.permission = "denied";
    await clickProject();
    await updateReply();
    expect(mocked.notify).not.toHaveBeenCalled();
    await act(async () => setUiLanguage("zh-CN"));
    expect(
      node.querySelector('.mobile-unread-dot[aria-label="未读回复"]'),
    ).not.toBeNull();
  });
  it("opens Home on launch and remembers the last project for a new conversation", async () => {
    localStorage.setItem(
      "omnicode-mobile-last",
      JSON.stringify({
        environmentId: "host",
        projectId: "other-project",
        sessionId: "two",
      }),
    );
    await act(async () => {
      root.render(createElement(MobileApp));
    });
    expect(mocked.session).not.toHaveBeenCalled();
    expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("home");
    expect(node.querySelector("header strong")?.textContent).toBe("OmniCode");
    await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
    expect(node.querySelector("header strong")?.textContent).toBe(
      "New conversation",
    );
    expect(node.querySelector(".mobile-header-context-item span")?.textContent).toBe("Other");
    expect(node.querySelector(".mobile-navigation")).toBeNull();
  });
  it("keeps Home usable when the remembered conversation is gone", async () => {
    localStorage.setItem(
      "omnicode-mobile-last",
      JSON.stringify({
        environmentId: "host",
        projectId: "project",
        sessionId: "deleted",
      }),
    );
    await act(async () => {
      root.render(createElement(MobileApp));
    });
    expect(mocked.session).not.toHaveBeenCalled();
    expect(node.querySelector("header strong")?.textContent).toBe(
      "OmniCode",
    );
  });
  it("opens All projects from the drawer and returns there after visiting settings", async () => {
    await clickProject();
    await openAllProjects();
    expect(node.querySelector("header strong")?.textContent).toBe("Projects");
    expect(activePage().querySelectorAll(".mobile-home-project strong")).toHaveLength(2);
    expect(node.querySelector(".mobile-drawer-backdrop")?.getAttribute("data-open")).toBe("false");
    await openMenu();
    await act(async () => node.querySelector<HTMLButtonElement>(".mobile-drawer-settings")!.click());
    expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("settings");
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
    expect(node.querySelector("header strong")?.textContent).toBe("Projects");
    expect(node.querySelector(".mobile-app")?.getAttribute("data-view")).toBe("home");
  });
  it("lists every project's conversations in the drawer and opens another project's conversation", async () => {
    await clickProject();
    expect(node.querySelector('.mobile-drawer [data-session-id="two"]')).not.toBeNull();
    const drawer = () =>
      node.querySelector(".mobile-drawer-backdrop")!.getAttribute("data-open");
    expect(drawer()).toBe("true");
    await act(async () =>
      node.querySelector<HTMLButtonElement>('.mobile-drawer [data-session-id="two"]')!.click(),
    );
    expect(drawer()).toBe("false");
    expect(mocked.session).toHaveBeenCalledWith("two");
    expect(node.querySelector("header strong")?.textContent).toBe(
      "Other conversation",
    );
    expect(
      JSON.parse(localStorage.getItem("omnicode-mobile-last")!),
    ).toMatchObject({ projectId: "other-project", sessionId: "two" });
  });
  it("opens a project page from Projects and starts a conversation there", async () => {
    await clickProject();
    await openAllProjects();
    await act(async () =>
      activePage().querySelector<HTMLButtonElement>('.mobile-home-project[title="/other"]')!.click(),
    );
    expect(node.querySelector("header strong")?.textContent).toBe("Other");
    expect(activePage().querySelector(".mobile-home-projects")).toBeNull();
    await act(async () => activePage().querySelector<HTMLButtonElement>(".mobile-home-new")!.click());
    expect(
      node.querySelector(".mobile-drawer-backdrop")!.getAttribute("data-open"),
    ).toBe("false");
    expect(
      JSON.parse(localStorage.getItem("omnicode-mobile-last")!),
    ).toEqual({ environmentId: "host", projectId: "other-project" });
  });
  it("follows a finger to open and close the drawer", async () => {
    await act(async () => {
      root.render(createElement(MobileApp));
    });
    const backdrop = node.querySelector(".mobile-drawer-backdrop")!;
    // Layout is absent in happy-dom; give the drawer a phone-sized width.
    Object.defineProperty(node.querySelector(".mobile-drawer")!, "offsetWidth", {
      value: 300,
    });
    const surface = activePage().querySelector(".mobile-home")!;
    const touch = (type: string, target: Element, x: number, y = 300) =>
      act(() => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      });
    expect(backdrop.getAttribute("data-open")).toBe("false");
    // A vertical scroll on the conversation leaves the drawer closed.
    await touch("pointerdown", surface, 100, 300);
    await touch("pointermove", surface, 104, 360);
    await touch("pointerup", surface, 104, 360);
    expect(backdrop.getAttribute("data-open")).toBe("false");
    // A slow pull past halfway opens it, following the finger meanwhile.
    await touch("pointerdown", surface, 20);
    await touch("pointermove", surface, 60);
    expect(backdrop.hasAttribute("data-dragging")).toBe(true);
    await touch("pointermove", surface, 240);
    await touch("pointerup", surface, 240);
    expect(backdrop.getAttribute("data-open")).toBe("true");
    expect(backdrop.hasAttribute("data-dragging")).toBe(false);
    // Pushing it back to the left closes it.
    await touch("pointerdown", backdrop, 300);
    await touch("pointermove", backdrop, 250);
    await touch("pointermove", backdrop, 60);
    await touch("pointerup", backdrop, 60);
    expect(backdrop.getAttribute("data-open")).toBe("false");
  });
  it("opens a notification from another project in its owning project", async () => {
    await act(async () => root.render(createElement(MobileApp)));
    await goToProject("/project");
    await act(async () => activePage().querySelector<HTMLButtonElement>('.mobile-home [data-session-id="one"]')!.click());
    expect(node.querySelector('header button[aria-label="Back"]')).not.toBeNull();
    await updateReply("two");
    expect(mocked.notify).toHaveBeenCalledTimes(1);
    const onOpen = mocked.notify.mock.calls[0][3];
    await act(async () => {
      onOpen({
        environmentId: "host",
        projectId: "other-project",
        sessionId: "two",
      });
    });
    expect(mocked.session).toHaveBeenCalledWith("two");
    expect(node.querySelector('header button[aria-label="Menu"]')).not.toBeNull();
    expect(node.querySelector('header button[aria-label="Back"]')).toBeNull();
    expect(node.querySelector("header strong")?.textContent).toBe(
      "Other conversation",
    );
    expect(
      JSON.parse(localStorage.getItem("omnicode.mobileActivity:host")!).entries
        .two.read,
    ).toBe(20);
  });
});
