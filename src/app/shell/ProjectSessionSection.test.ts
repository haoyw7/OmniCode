import { duration } from "../../shared/motion/tokens";
import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
import { delegateDesktopSession } from "../../features/bots/model/delegateDesktopSession";
vi.mock("../../features/bots/model/delegateDesktopSession", () => ({ delegateDesktopSession: vi.fn(async () => {}) }));
// @vitest-environment happy-dom
import { savePinnedProjects } from "../../features/projects/model/recents";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { invoke } from "@tauri-apps/api/core";
import {
  loadProjectTreeExpanded,
  saveProjectTreeExpanded,
  clearProjectTreeExpanded,
  rebaseProjectTreeExpanded,
} from "../../features/projects/model/projectTree";
import {
  loadSessionFolders,
  saveSessionFolders,
  loadSessionSidebarOrder,
  saveSessionSidebarOrder,
} from "../../features/sessions/model/sessionFolders";
import { saveTabGroupLabel } from "../../features/workspace/model/tabGroups";
import { useProjectDiffStats } from "../../features/source-control/hooks/useProjectDiffStats";
import { setUiLanguage } from "../../shared/i18n/language";
import {
  configureSharedHost,
  rememberRemoteProject,
} from "../../features/connections/model/remoteProjects";
import type { RemoteProjectSessions } from "../../features/connections/model/connections";
import { REMOTE_HISTORY_UPDATED } from "../../features/connections/model/connections";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { replaceProjectHistory } from "../../features/sessions/data/sessionHistory";

const remoteState = vi.hoisted(() => ({
  rows: new Map<string, HostSessionSummary[]>(),
  bindings: new Map<string, string>(),
  states: new Map<string, Partial<RemoteProjectSessions>>(),
  subscriptions: vi.fn(),
  request: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("../../features/source-control/ui/SidebarWorktreeSwitcher", () => ({
  SidebarWorktreeSwitcher: ({
    cwd,
    compact = false,
  }: {
    cwd: string;
    compact?: boolean;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": "Switch working copy",
        "data-worktree-picker": cwd,
        "data-compact": String(compact),
      },
      "master",
    ),
}));
vi.mock("../../features/connections/files/ui/FileTree", () => ({
  FileTree: ({ cwd }: { cwd: string }) =>
    createElement("div", { "data-files-project": cwd }, "Files"),
}));
vi.mock(
  "../../features/connections/model/connections",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../features/connections/model/connections")
    >()),
    useRemoteMachines: () => ({ machines: [], loaded: true }),
    useRemoteMachineOnline: () => false,
    remoteRequest: remoteState.request,
    refreshRemoteProjectSessions: remoteState.refresh,
    remoteSessionFor: (id: string) =>
      remoteState.bindings.get(id) ??
      (id.startsWith("shell:") ? id.slice(6) : undefined),
    remoteSessionResolver: () => (id: string) =>
      remoteState.bindings.get(id) ??
      (id.startsWith("shell:") ? id.slice(6) : undefined),
    hasCachedRemoteProjectSessions: (path: string) =>
      remoteState.rows.has(path),
    cachedRemoteSessions: (path: string) => remoteState.rows.get(path) ?? [],
    useRemoteProjectSessions: (path: string, enabled: boolean) => {
      remoteState.subscriptions(path, enabled);
      return {
        machine: undefined,
        sessions: remoteState.rows.get(path) ?? [],
        loaded: true,
        pending: false,
        offline: false,
        ...remoteState.states.get(path),
      };
    },
  }),
);

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;
let measuredHeight: number;
let resizeCallbacks: Array<() => void>;
const A = "/workspace/alpha";
const B = "/workspace/beta";
const summary = (id: string, cwd = A, title = id): SessionSummary => ({
  id,
  cwd,
  title,
  harness: "codex",
  model: "",
  runtimeMode: "supervised",
  createdAt: 0,
  updatedAt: 1234,
});
const hostRow = (id: string, title = id): HostSessionSummary => ({
  id,
  title,
  projectId: "host-project",
  cwd: "/host/repo",
  harness: "codex",
  model: "",
  runtimeMode: "supervised",
  updatedAt: 1234,
  status: "idle",
});
const project = (path: string) =>
  container.querySelector<HTMLElement>(`[data-project-path="${path}"]`)!;
const card = (id: string) =>
  // Closed project/group trees are retained; queries model their visible rows.
  ([
    ...container.querySelectorAll<HTMLElement>(
      `[data-project-path] [data-session-card="${id}"]`,
    ),
  ].find((node) => !node.closest("[hidden]")) ?? null)!;
const input = () =>
  container.querySelector<HTMLInputElement>(
    'input[aria-label="Search projects and conversations"], input[aria-label="Search conversations"]',
  )!;
function render() {
  root.render(createElement(Sidebar, props));
}
function query(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Complete the Motion engine boundary while retaining disclosure semantics. */
function settleFolds() {
  act(() => {
    for (const fold of container.querySelectorAll(
      '.zen-fold-item[data-fold-state="closing"]',
    ))
      completeMotionAnimation(fold);
  });
}
function expand(path: string) {
  act(() =>
    project(path)
      .querySelector<HTMLButtonElement>('button[aria-label="Expand project"]')!
      .click(),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setUiLanguage("en");
  configureSharedHost(undefined, []);
  remoteState.rows.clear();
  remoteState.bindings.clear();
  remoteState.states.clear();
  remoteState.subscriptions.mockClear();
  remoteState.request.mockReset().mockResolvedValue(undefined);
  remoteState.refresh.mockReset();
  vi.mocked(invoke).mockClear();
  vi.mocked(useProjectDiffStats).mockReset().mockReturnValue(null);
  resizeCallbacks = [];
  measuredHeight = 700;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => measuredHeight,
  );
  props = {
    cwd: A,
    open: true,
    recents: [
      { path: B, openedAt: 2 },
      { path: A, openedAt: 1 },
    ],
    sessions: [summary("a", A, "Alpha conversation")],
    projectHistory: [
      summary("a", A, "Alpha conversation"),
      summary("b", B, "Hidden conversation"),
    ],
    loadedProjectPaths: new Set([A, B]),
    failedProjectPaths: new Set(),
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "a",
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onOpenFile: vi.fn(),
    onSelectSession: vi.fn(),
    onSelectProject: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
    onOpenProject: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setUiLanguage("en");
  configureSharedHost(undefined, []);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("named project/session tree", () => {
  it("keeps phone-controlled Shared Host conversations in their project with a remote-control indicator", async () => {
    // This test exercises routing and attribution, independently of disclosure interpolation.
    document.documentElement.dataset.reducedMotion = "on";
    try {
      configureSharedHost("local-machine", [{ id: "host-project", cwd: A, name: "alpha" }]);
      props.desktopMode = "code";
      props.onSelectRemoteSession = vi.fn();
      const phone = {
        ...hostRow("phone", "codex · Phone conversation"),
        remoteControl: true,
        remoteControlDevice: { id: "phone-device", name: "My phone", manufacturer: "Google", model: "Pixel 9" },
      };
      remoteState.rows.set(A, [
        hostRow("desktop", "Desktop conversation"),
        phone,
        { ...hostRow("phone-pin"), remoteControl: true, pinned: true },
        { ...hostRow("phone-archive"), remoteControl: true, archived: true },
        hostRow("legacy", "Legacy conversation"),
      ]);
      props.openSessions = [summary("phone", A), summary("desktop", A)];
      await act(async () => render());
      expect(container.querySelector('[data-project-section="remote-control"]')).toBeNull();
      const phoneCard = project(A).querySelector<HTMLElement>('[data-session-card="phone"]')!;
      expect(phoneCard.textContent).toContain("Phone conversation");
      expect(phoneCard.textContent).not.toContain("codex ·");
      expect(phoneCard.querySelector("[data-session-avatar] img")).not.toBeNull();
      expect(phoneCard.querySelector('[data-session-remote-control]')?.getAttribute("aria-label")).toBe("Remote control from My phone · Google Pixel 9");
      act(() => phoneCard.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Remote control from My phone · Google Pixel 9");
      expect(phoneCard.querySelector('[data-session-menu]')).not.toBeNull();
      expect(container.querySelectorAll('[data-session-card="phone"]')).toHaveLength(1);
      for (const section of ["pinned", "projects"]) {
        const rows = container.querySelectorAll(`[data-project-section="${section}"] [data-session-card]`);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.getAttribute("data-session-layout")).toBe("two-line");
          expect(row.querySelector("[data-session-project]")?.textContent).toBe("alpha");
        }
      }
      expect(project(A).querySelector('[data-session-card="desktop"]')).not.toBeNull();
      expect(project(A).querySelector('[data-session-card="desktop"] [data-session-remote-control]')).toBeNull();
      expect(project(A).querySelector('[data-session-card="legacy"]')).not.toBeNull();
      expect(container.querySelector('[data-project-section="pinned"] [data-session-card="phone-pin"] [data-session-remote-control]')).not.toBeNull();
      expect(container.querySelector('[data-session-card="phone-archive"]')).toBeNull();
      act(() => phoneCard.click());
      expect(props.onSelectSession).toHaveBeenCalledWith("phone", A);

      // Taking over an existing conversation updates its indicator in place.
      const legacyCard = project(A).querySelector('[data-session-card="legacy"]');
      remoteState.rows.set(A, [phone, { ...hostRow("legacy"), remoteControl: true }]);
      await act(async () => { window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)); });
      expect(project(A).querySelector('[data-session-card="legacy"]')).toBe(legacyCard);
      expect(legacyCard?.querySelector('[data-session-remote-control]')).not.toBeNull();
      expect(legacyCard?.querySelector('[data-session-remote-control]')?.getAttribute("aria-label")).toBe("Remote control from an unknown device");
      expect(container.querySelectorAll('[data-session-card="legacy"]')).toHaveLength(1);
    } finally {
      delete document.documentElement.dataset.reducedMotion;
    }
  });

  it("opens desktop row actions from the more button without selecting the conversation", async () => {
    document.documentElement.dataset.reducedMotion = "on";
    try {
      props.desktopMode = "code";
      props.onRenameSession = vi.fn();
      props.onArchiveSession = vi.fn();
      saveTabGroupLabel(A, "My project");
      await act(async () => render());
      const row = card("a");
      expect(row.querySelector("[data-session-project]")?.textContent).toBe("My project");
      const menuButton = row.querySelector<HTMLButtonElement>("[data-session-menu]")!;
      menuButton.focus();
      await act(async () => menuButton.click());
      expect(props.onSelectSession).not.toHaveBeenCalled();
      const menu = document.querySelector('[role="menu"][aria-label="Session actions"]')!;
      expect(menu).not.toBeNull();
      const rename = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find(item => item.textContent?.startsWith("Rename"))!;
      await act(async () => rename.click());
      const editor = container.querySelector<HTMLElement>('[data-session-rename-row="a"]')!;
      expect(editor.dataset.sessionLayout).toBe("two-line");
      expect(editor.querySelector("[data-session-project]")?.textContent).toBe("My project");
      await act(async () => editor.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ));
      expect(props.onRenameSession).not.toHaveBeenCalled();
      expect(card("a")).not.toBeNull();
    } finally {
      delete document.documentElement.dataset.reducedMotion;
    }
  });

  it("keeps project names visible, expands independently and routes inactive session selection with its project", () => {
    props.onSessionNavigationOrder = vi.fn();
    props.onNewInProject = vi.fn(() => "new-b");
    act(() => render());
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect(project(A).textContent).toContain("alpha");
    expect(project(B).textContent).toContain("beta");
    expect(card("a")).not.toBeNull();
    expect(card("b")).toBeNull();
    expand(B);
    expect(card("a")).not.toBeNull();
    expect(card("b")).not.toBeNull();
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(props.onSessionNavigationOrder).toHaveBeenCalledTimes(1);
    expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(["a"]);
    act(() => card("b").click());
    expect(props.onSelectSession).toHaveBeenCalledWith("b", B);
    act(() =>
      project(B)
        .querySelector<HTMLButtonElement>('[aria-label="New session in beta"]')!
        .click(),
    );
    expect(props.onNewInProject).toHaveBeenCalledWith(B);
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A, B]));
  });

  it("collapses an open project from its name and animates rows in and out", () => {
    act(() => render());
    const header = (path: string) =>
      project(path).querySelector<HTMLElement>("[data-project-header]")!;
    const fold = (path: string) =>
      project(path).querySelector<HTMLElement>(".zen-fold-item");
    // Initially open rows render settled, without replaying the animation.
    expect(fold(A)?.dataset.foldState).toBe("open");
    act(() => header(A).click());
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(fold(A)?.dataset.foldState).toBe("closing");
    expect(fold(A)?.inert).toBe(true);
    expect(loadProjectTreeExpanded(A)).toEqual(new Set());
    settleFolds();
    expect(card("a")).toBeNull();
    expect(fold(A)?.hidden).toBe(true);
    act(() => header(B).click());
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(fold(B)?.dataset.foldState).toBe("opening");
    expect(card("b")).not.toBeNull();
    act(() => completeMotionAnimation(fold(B)!));
    expect(props.onSelectProject).toHaveBeenCalledExactlyOnceWith(B);
  });

  it("lets search matches collapse and reopen from their names without changing saved expansion", () => {
    vi.useFakeTimers();
    saveProjectTreeExpanded([A]);
    act(() => render());
    query("Hidden");
    const name = () =>
      project(B).querySelector<HTMLButtonElement>("[data-project-select]")!;
    const fold = () => project(B).querySelector<HTMLElement>(".zen-fold-item");
    expect(card("b")).not.toBeNull();
    act(() => name().click());
    expect(fold()?.dataset.foldState).toBe("closing");
    expect(fold()?.inert).toBe(true);
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
    act(() => vi.advanceTimersByTime(200));
    act(() => name().click());
    expect(fold()?.dataset.foldState).toBe("opening");
    expect(fold()?.inert).toBe(false);
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
    act(() => vi.advanceTimersByTime(150));
    expect(card("b")).not.toBeNull();
    act(() => completeMotionAnimation(fold()!));
    expect(props.onSelectProject).toHaveBeenCalledExactlyOnceWith(B);
    query("");
    settleFolds();
    expect(card("a")).not.toBeNull();
    expect(card("b")).toBeNull();
  });

  it("cancels queued workspace activation when an opening project is folded", () => {
    vi.useFakeTimers();
    saveProjectTreeExpanded([]);
    act(() => render());
    const name = () =>
      project(B).querySelector<HTMLButtonElement>("[data-project-select]")!;
    act(() => name().click());
    expect(props.onSelectProject).not.toHaveBeenCalled();
    act(() => name().click());
    expand(B);
    act(() => vi.advanceTimersByTime(300));
    expect(project(B).querySelector(".project-tree-collapse")?.getAttribute("data-fold-state")).toBe("open");
    expect(props.onSelectProject).not.toHaveBeenCalled();
  });

  it("activates only the latest project after overlapping name-triggered disclosures", () => {
    vi.useFakeTimers();
    saveProjectTreeExpanded([]);
    act(() => render());
    act(() =>
      project(B).querySelector<HTMLButtonElement>("[data-project-select]")!.click(),
    );
    act(() =>
      project(A).querySelector<HTMLButtonElement>("[data-project-select]")!.click(),
    );
    expect(props.onSelectProject).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(props.onSelectProject).toHaveBeenCalledExactlyOnceWith(A);
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A, B]));
  });

  it("keeps search disclosure overrides temporary and resets them when the query changes", () => {
    saveProjectTreeExpanded([A]);
    act(() => render());
    query("conversation");
    const toggle = (path: string) =>
      project(path).querySelector<HTMLButtonElement>("[aria-expanded]")!;
    act(() => toggle(A).click());
    expect(toggle(A).getAttribute("aria-expanded")).toBe("false");
    expect(toggle(B).getAttribute("aria-expanded")).toBe("true");
    settleFolds();
    expect(card("a")).toBeNull();
    expect(card("b")).not.toBeNull();
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
    query("Alpha");
    expect(card("a")).not.toBeNull();
    expect(toggle(A).getAttribute("aria-expanded")).toBe("true");
    act(() =>
      project(A).querySelector<HTMLElement>("[data-project-header]")!.click(),
    );
    expect(toggle(A).getAttribute("aria-expanded")).toBe("false");
    query("conversation");
    act(() => toggle(B).click());
    settleFolds();
    expect(card("b")).toBeNull();
    query("");
    query("conversation");
    expect(toggle(B).getAttribute("aria-expanded")).toBe("true");
    expect(card("b")).not.toBeNull();
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
  });

  it("reopens a temporarily collapsed search result when creating a session", () => {
    props.onNewInProject = vi.fn(() => "new-b");
    act(() => render());
    query("Hidden");
    act(() =>
      project(B)
        .querySelector<HTMLButtonElement>("[data-project-select]")!
        .click(),
    );
    settleFolds();
    expect(card("b")).toBeNull();
    act(() =>
      project(B)
        .querySelector<HTMLButtonElement>('[aria-label="New session in beta"]')!
        .click(),
    );
    expect(props.onNewInProject).toHaveBeenCalledExactlyOnceWith(B);
    expect(card("b")).not.toBeNull();
    expect(
      project(B)
        .querySelector("[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A, B]));
  });

  it("expands projects activated outside the tree and focuses the unified query on request", () => {
    act(() => render());
    expect(card("b")).toBeNull();
    props = {
      ...props,
      cwd: B,
      activeSessionId: "b",
      sessions: [summary("b", B, "Hidden conversation")],
      searchFocusToken: 1,
    };
    act(() => render());
    expect(card("b")).not.toBeNull();
    expect(card("a")).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(loadProjectTreeExpanded(B)).toEqual(new Set([A, B]));
  });

  it("persists first-use expansion so renaming and removing a project update the mounted tree", () => {
    const renamed = "/workspace/renamed-alpha";
    act(() => render());
    expect(localStorage.getItem("omnicode.projectTreeExpanded.v1")).toBe(
      JSON.stringify([A]),
    );
    act(() => rebaseProjectTreeExpanded(A, renamed));
    props = {
      ...props,
      cwd: renamed,
      recents: [{ path: renamed, openedAt: 1 }],
      sessions: [summary("a", renamed)],
      projectHistory: [summary("a", renamed)],
      loadedProjectPaths: new Set([renamed]),
    };
    act(() => render());
    expect(loadProjectTreeExpanded(renamed)).toEqual(new Set([renamed]));
    expect(card("a")).not.toBeNull();
    act(() => clearProjectTreeExpanded(renamed));
    expect(loadProjectTreeExpanded(renamed)).toEqual(new Set());
    settleFolds();
    expect(card("a")).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    act(() => render());
    expect(card("a")).toBeNull();
    expect(loadProjectTreeExpanded(renamed)).toEqual(new Set());
  });

  it("scopes reminder and completion/link flags to project identity and translates its open Host shell binding", () => {
    configureSharedHost("machine", [
      { id: "alpha-host", cwd: A, name: "alpha" },
      { id: "beta-host", cwd: B, name: "beta" },
    ]);
    remoteState.rows.set(A, [hostRow("same", "Host alpha")]);
    remoteState.rows.set(B, [hostRow("same", "Host beta")]);
    props.projectHistory = [summary("same", A, "Local/native alpha")];
    props.openSessions = [summary("b-shell", B, "Open beta")];
    props.reminders = [
      {
        sessionId: "same",
        cwd: A,
        title: "Alpha reminder",
        harness: "codex",
        dueAt: 12_345,
        firedAt: null,
      },
    ];
    props.unseenFinishedIds = new Set(["same"]);
    props.linkedSessionUpdateIds = new Set(["same"]);
    saveProjectTreeExpanded([A, B]);
    act(() => render());
    expect(project(A).querySelector("[data-reminder-sessions]")).not.toBeNull();
    expect(project(B).querySelector("[data-reminder-sessions]")).toBeNull();
    expect(project(A).querySelector('[aria-label="Unread reply"]')).not.toBeNull();
    expect(project(B).querySelector('[aria-label="Unread reply"]')).toBeNull();
    expect(
      project(A).querySelector('[aria-label="Linked work item updated"]'),
    ).not.toBeNull();
    expect(
      project(B).querySelector('[aria-label="Linked work item updated"]'),
    ).toBeNull();
    remoteState.bindings.set("b-shell", "same");
    props = {
      ...props,
      unseenFinishedIds: new Set(["b-shell"]),
      linkedSessionUpdateIds: new Set(["b-shell"]),
    };
    act(() => render());
    expect(project(B).querySelector('[aria-label="Unread reply"]')).not.toBeNull();
    expect(project(A).querySelector('[aria-label="Unread reply"]')).toBeNull();
    expect(
      project(B).querySelector('[aria-label="Linked work item updated"]'),
    ).not.toBeNull();
    expect(
      project(A).querySelector('[aria-label="Linked work item updated"]'),
    ).toBeNull();
  });

  it("marks unopened Host replies at the row's far right and clears only the focused project's reply", () => {
    configureSharedHost("machine", [
      { id: "alpha-host", cwd: A, name: "alpha" },
      { id: "beta-host", cwd: B, name: "beta" },
    ]);
    const initial = { ...hostRow("same"), revision: 4, lastReplyRevision: 3 };
    remoteState.rows.set(A, [initial]);
    remoteState.rows.set(B, [{ ...initial, projectId: "beta-host" }]);
    props.unseenFinishedIds = new Set();
    saveProjectTreeExpanded([A, B]);
    act(() => render());
    const dot = (path: string) => project(path).querySelector('[aria-label="Unread reply"]');
    expect(dot(A)).toBeNull();
    expect(dot(B)).toBeNull();

    const reply = { ...initial, revision: 6, lastReplyRevision: 6, status: "running" as const };
    remoteState.rows.set(B, [{ ...reply, projectId: "beta-host" }]);
    act(() => window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)));
    expect(dot(A)).toBeNull();
    expect(dot(B)).not.toBeNull();
    const replyCard = dot(B)!.closest("[data-session-card]")!;
    expect(replyCard.lastElementChild).toBe(dot(B));
    expect(replyCard.querySelector("[data-session-select]")?.contains(dot(B))).toBe(false);
    expect(project(B).querySelector('[aria-label="Working..."]')).not.toBeNull();

    // A folded project's replies survive the row disappearing and returning.
    act(() => project(B).querySelector<HTMLElement>("[data-project-header]")!.click());
    settleFolds();
    expand(B);
    expect(dot(B)).not.toBeNull();

    remoteState.rows.set(A, [reply]);
    remoteState.bindings.set("b-shell", "same");
    props = { ...props, cwd: B, activeSessionId: "b-shell", visibleSessionId: null };
    act(() => render());
    expect(dot(B)).not.toBeNull();
    props = { ...props, visibleSessionId: "b-shell" };
    act(() => render());
    expect(dot(B)).toBeNull();
    expect(dot(A)).not.toBeNull();
    props = { ...props, cwd: A, activeSessionId: "a", visibleSessionId: "a" };
    act(() => render());
    expect(dot(B)).toBeNull();
    expect(dot(A)).not.toBeNull();
  });

  it("shows structured metadata with complete values and status on keyboard focus", () => {
    const title =
      "Complete title that remains readable across multiple lines in the summary";
    const branch = "workbench-ui/codex/020-desktop-architecture-refactor";
    const executionCwd =
      "/workspace/alpha/a-long-worktree-directory/desktop-shell-overhaul";
    props.projectHistory = [
      {
        ...summary("a", A, title),
        branch,
        repo: "alpha",
        model: "codex:test",
        executionCwd,
        updatedAt: Date.now() - 65_000,
      },
    ];
    props.sessions = props.projectHistory;
    props.busySessionIds = new Set(["a"]);
    act(() => render());
    expect(card("a").classList.contains("h-8")).toBe(true);
    expect(card("a").textContent).toContain(title);
    expect(card("a").textContent).not.toContain(branch);
    expect(card("a").hasAttribute("title")).toBe(false);
    expect(card("a").querySelector('[aria-label="Working..."]')).not.toBeNull();
    act(() =>
      card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
    );
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toContain(title);
    expect(tooltip.textContent).toContain(`alpha/${branch}`);
    expect(tooltip.textContent).toContain(executionCwd);
    expect(tooltip.textContent).toContain("1m");
    expect(tooltip.textContent).toContain("Working...");
    expect(tooltip.querySelector('[aria-label="Model"]')).not.toBeNull();
    expect(tooltip.querySelector('[aria-label="Branch"]')).not.toBeNull();
    expect(
      tooltip.querySelector('[aria-label="Working directory"]'),
    ).not.toBeNull();
    expect(tooltip.querySelector('[aria-label="Last updated"]')).not.toBeNull();
    expect(tooltip.querySelector("h3")?.classList.contains("truncate")).toBe(
      false,
    );
    expect(
      tooltip.querySelector("h3")?.classList.contains("line-clamp-1"),
    ).toBe(false);
  });

  it("opens and closes pointer summaries immediately and retains direct card transfer", () => {
    vi.useFakeTimers();
    act(() => render());
    act(() => {
      card("a").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip).not.toBeNull();
    act(() => {
      card("a").dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: tooltip }),
      );
      tooltip.dispatchEvent(
        new MouseEvent("pointerover", {
          bubbles: true,
          relatedTarget: card("a"),
        }),
      );
    });
    expect(document.querySelector('[role="tooltip"]')).toBe(tooltip);
    act(() => {
      tooltip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("does not keep a clicked row's summary open once the pointer leaves", () => {
    vi.useFakeTimers();
    act(() => render());
    const trigger = card("a").querySelector<HTMLElement>("[data-session-select]")!;
    act(() => {
      card("a").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger.focus();
      trigger.click();
    });
    expect(document.activeElement).toBe(trigger);
    act(() => {
      card("a").dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      card("a").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() => {
      card("a").dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it.each([
    ["en", "Needs input", "Need approval", "Working..."],
    ["zh-CN", "需要输入", "需要审批", "正在运行…"],
  ] as const)(
    "distinguishes questions from approvals in dense rows and summaries (%s)",
    (language, inputLabel, approvalLabel, workingLabel) => {
      props.busySessionIds = new Set(["a"]);
      props.approvalSessionIds = new Set(["a"]);
      props.questionSessionIds = new Set(["a"]);
      setUiLanguage(language);
      act(() => render());
      expect(card("a").querySelector(`[aria-label="${inputLabel}"]`)).not.toBeNull();
      expect(card("a").querySelector(`[aria-label="${approvalLabel}"]`)).toBeNull();
      act(() =>
        card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
      );
      const tooltip = () => document.querySelector('[role="tooltip"]')!;
      expect(tooltip().textContent).toContain(inputLabel);
      expect(tooltip().textContent).not.toContain(approvalLabel);

      // Changing the request kind must update a memoized card even though the
      // combined waiting set did not change.
      props.questionSessionIds = new Set();
      act(() => render());
      expect(card("a").querySelector(`[aria-label="${approvalLabel}"]`)).not.toBeNull();
      expect(tooltip().textContent).toContain(approvalLabel);
      expect(tooltip().textContent).not.toContain(inputLabel);

      props.approvalSessionIds = new Set();
      act(() => render());
      expect(card("a").querySelector(`[aria-label="${approvalLabel}"]`)).toBeNull();
      expect(tooltip().textContent).toContain(workingLabel);
    },
  );

  it.each([
    ["run:question:4", "Needs input"],
    ["run:approval:3,question:4", "Needs input"],
    ["run:approval:3", "Need approval"],
    [undefined, "Needs input"],
  ] as const)(
    "labels remote waiting rows without requiring an open session (%s)",
    (pendingInputKey, label) => {
      configureSharedHost("machine", [{ id: "project", cwd: B, name: "beta" }]);
      remoteState.rows.set(B, [
        { ...hostRow("b"), status: "running", needsInput: true, pendingInputKey },
      ]);
      saveProjectTreeExpanded([A, B]);
      act(() => render());
      expect(card("b").querySelector(`[aria-label="${label}"]`)).not.toBeNull();
      act(() =>
        card("b").querySelector<HTMLElement>("[data-session-select]")!.focus(),
      );
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(label);
    },
  );

  it("hides missing metadata and uses the row status priority in summaries", () => {
    props.projectHistory = [{ ...summary("a"), draft: true, updatedAt: 0 }];
    props.sessions = props.projectHistory;
    props.busySessionIds = new Set(["a"]);
    props.approvalSessionIds = new Set(["a"]);
    props.unseenFinishedIds = new Set(["a"]);
    act(() => render());
    act(() =>
      card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
    );
    const tooltip = () =>
      document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip().textContent).toContain("Need approval");
    expect(tooltip().querySelector('[aria-label="Model"]')).toBeNull();
    expect(tooltip().querySelector('[aria-label="Branch"]')).toBeNull();
    expect(
      tooltip().querySelector('[aria-label="Working directory"]'),
    ).toBeNull();
    expect(tooltip().querySelector('[aria-label="Last updated"]')).toBeNull();
    props.approvalSessionIds = new Set();
    act(() => render());
    expect(tooltip().textContent).toContain("Working...");
    props.busySessionIds = new Set();
    act(() => render());
    expect(tooltip().textContent).toContain("Done");
    props.unseenFinishedIds = new Set();
    act(() => render());
    expect(tooltip().textContent).toContain("Draft");
    props.projectHistory = [summary("a")];
    props.sessions = props.projectHistory;
    act(() => render());
    expect(tooltip().textContent).toContain("Idle");
  });

  it("dismisses a focused summary on Escape, outside click, scroll and selection", () => {
    act(() => render());
    const trigger = card("a").querySelector<HTMLElement>(
      "[data-session-select]",
    )!;
    const focus = () => {
      act(() => trigger.blur());
      act(() => trigger.focus());
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    };
    focus();
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    focus();
    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      ),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    focus();
    act(() => container.dispatchEvent(new Event("scroll")));
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    focus();
    act(() => card("a").click());
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(props.onSelectSession).toHaveBeenCalledWith("a", A);
  });

  it("closes summaries when a project or the sidebar starts collapsing", () => {
    act(() => render());
    act(() =>
      card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    act(() =>
      project(A).querySelector<HTMLElement>("[data-project-header]")!.click(),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    settleFolds();
    // Browsers blur focus inside display:none; happy-dom keeps it on retained DOM.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expand(A);
    act(() =>
      card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    props.open = false;
    act(() => render());
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("dismisses metadata before a session menu or drag and keeps it hidden during dragging", () => {
    props.onPlaceSessionOnPane = vi.fn();
    vi.useFakeTimers();
    act(() => render());
    const trigger = card("a").querySelector<HTMLElement>(
      "[data-session-select]",
    )!;
    act(() => trigger.focus());
    act(() =>
      card("a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    act(() => trigger.blur());
    act(() => trigger.focus());
    const from = card("a");
    from.setPointerCapture = vi.fn();
    from.releasePointerCapture = vi.fn();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    act(() => {
      from.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          pointerId: 1,
          clientX: 1,
          clientY: 1,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          bubbles: true,
        }),
      );
    });
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      from.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() =>
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      ),
    );
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps the immediate subagent tooltip ahead of session metadata", () => {
    props.projectHistory = [
      {
        ...summary("a"),
        orchestration: {
          status: "active",
          tasks: [
            {
              sessionId: "worker",
              title: "Review changes",
              harness: "codex",
              model: "codex:test",
              status: "running",
            },
          ],
        },
      },
    ];
    props.sessions = props.projectHistory;
    act(() => render());
    act(() =>
      card("a").querySelector<HTMLElement>("[data-session-select]")!.focus(),
    );
    expect(document.querySelector('[role="tooltip"] h3')).not.toBeNull();
    act(() =>
      card("a")
        .querySelector("[data-orchestration-icon]")!
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    const tooltip = document.querySelector('[role="tooltip"]')!;
    expect(tooltip.textContent).toContain("Subagents");
    expect(tooltip.textContent).toContain("Review changes");
    expect(tooltip.querySelector("h3")).toBeNull();
  });

  it("matches the project row height and horizontal bounds for plain, formerly grouped, pinned and reminder sessions, including rename", () => {
    props.projectHistory = [
      summary("plain", A),
      summary("folder", A),
      { ...summary("pinned", A), pinned: true },
      summary("reminder", A),
    ];
    props.sessions = props.projectHistory;
    props.reminders = [
      {
        sessionId: "reminder",
        cwd: A,
        title: "Reminder",
        harness: "codex",
        dueAt: 12_345,
        firedAt: null,
      },
    ];
    props.onRenameSession = vi.fn();
    saveSessionFolders(A, [
      {
        id: "folder-a",
        name: "Folder",
        sessionIds: ["folder"],
        collapsed: false,
      },
    ]);
    act(() => render());
    const header = project(A).querySelector<HTMLElement>(
      "[data-project-header]",
    )!;
    expect(header.classList.contains("h-8")).toBe(true);
    expect(header.classList.contains("px-2")).toBe(true);
    const lists = project(A).querySelectorAll<HTMLElement>(
      "[data-project-session-section] ul",
    );
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list.classList.contains("gap-px")).toBe(true);
      if (list.hasAttribute("data-session-list")) {
        expect(list.classList.contains("py-px")).toBe(true);
      } else {
        expect(list.classList.contains("pt-px")).toBe(true);
        expect(list.classList.contains("py-px")).toBe(false);
      }
    }
    const groups = project(A).querySelectorAll<HTMLElement>(
      "[data-pinned-sessions],[data-reminder-sessions],[data-session-folder]",
    );
    expect(groups).toHaveLength(1);
    for (const group of groups) {
      expect(group.classList.contains("mb-1")).toBe(false);
      expect(group.classList.contains("mb-1.5")).toBe(false);
    }
    for (const id of ["plain", "folder", "pinned", "reminder"]) {
      const row = id === "pinned"
        ? container.querySelector<HTMLElement>('[data-project-section="pinned"] [data-session-card="pinned"]')!
        : card(id);
      expect(row.classList.contains("h-8")).toBe(true);
      expect(row.classList.contains("w-full")).toBe(true);
      for (
        let node = row.parentElement;
        node && !node.hasAttribute("data-project-session-section");
        node = node.parentElement
      ) {
        expect(node.classList.contains("px-1")).toBe(false);
        expect(node.classList.contains("p-1")).toBe(false);
      }
    }
    expect(project(A).querySelector('[data-session-card="pinned"]')).toBeNull();
    // Rows keep the header's bounds while their text indents to its name.
    expect(card("plain").classList.contains("pl-8")).toBe(true);
    expect(card("plain").classList.contains("pr-2")).toBe(true);
    expect(card("folder").classList.contains("pl-8")).toBe(true);
    expect(card("folder").classList.contains("pr-2")).toBe(true);
    act(() =>
      card("plain")
        .querySelector<HTMLElement>("[data-session-select]")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
        ),
    );
    const rename = project(A).querySelector<HTMLElement>(
      '[data-session-rename-row="plain"]',
    )!;
    expect(rename.classList.contains("h-8")).toBe(true);
    expect(rename.classList.contains("w-full")).toBe(true);
    expect(rename.classList.contains("pl-6")).toBe(true);
  });

  it.each(["pinned", "reminders"] as const)(
    "animates %s members open and closed through the shared disclosure",
    (kind) => {
      props.projectHistory = [
        { ...summary("member", A), pinned: kind === "pinned" },
      ];
      props.sessions = props.projectHistory;
      if (kind === "pinned") props.recents = undefined;
      if (kind === "reminders") {
        props.reminders = [
          {
            sessionId: "member",
            cwd: A,
            title: "Reminder",
            harness: "codex",
            dueAt: 12_345,
            firedAt: null,
          },
        ];
      }
      act(() => render());
      const selector =
        kind === "pinned"
            ? "[data-pinned-sessions]"
            : "[data-reminder-sessions]";
      const group = project(A).querySelector<HTMLElement>(selector)!;
      const toggle = group.querySelector<HTMLButtonElement>(
        "button[aria-expanded]",
      )!;
      const fold = () => group.querySelector<HTMLElement>(".zen-fold-item");
      const member = card("member");
      expect(fold()?.dataset.foldState).toBe("open");
      act(() => toggle.click());
      expect(fold()?.dataset.foldState).toBe("closing");
      expect(fold()?.inert).toBe(true);
      expect(card("member")).not.toBeNull();
      settleFolds();
      expect(card("member")).toBeNull();
      expect(fold()?.hidden).toBe(true);
      expect(group.querySelector('[data-session-card="member"]')).toBe(member);
      act(() => toggle.click());
      expect(fold()?.dataset.foldState).toBe("opening");
      expect(card("member")).toBe(member);
      act(() =>
        completeMotionAnimation(fold()!),
      );
      expect(fold()?.dataset.foldState).toBe("open");
    },
  );

  it("reveals matching collapsed projects and ignores legacy folder collapse", () => {
    saveSessionFolders(B, [
      { id: "folder-b", name: "Team", sessionIds: ["b"], collapsed: true },
    ]);
    saveTabGroupLabel(B, "My custom beta");
    act(() => render());
    query("Hidden conversation");
    expect(card("b")).not.toBeNull();
    expect(project(A)).toBeNull();
    expect(project(B).querySelector("[data-session-folder]")).toBeNull();
    expect(loadSessionFolders(B)[0].collapsed).toBe(true);
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
    query("");
    settleFolds();
    expect(card("b")).toBeNull();
    expect(card("a")).not.toBeNull();
    query("My custom");
    expect(card("b")).not.toBeNull();
    query("/workspace/beta");
    expect(card("b")).not.toBeNull();
  });

  it("keeps folder membership through first load, filtered searches and failed refreshes", () => {
    saveProjectTreeExpanded([A, B]);
    saveSessionFolders(B, [
      {
        id: "folder-b",
        name: "Team",
        sessionIds: ["b", "later"],
        collapsed: false,
      },
    ]);
    props.loadedProjectPaths = new Set([A]);
    act(() => render());
    expect(loadSessionFolders(B)[0].sessionIds).toEqual(["b", "later"]);
    props.failedProjectPaths = new Set([B]);
    act(() => render());
    expect(card("b")).not.toBeNull();
    expect(project(B).textContent).toContain("Couldn’t load sessions");
    query("Hidden conversation");
    expect(loadSessionFolders(B)[0].sessionIds).toEqual(["b", "later"]);
    expect(project(B).querySelector("button")?.textContent).not.toBe(
      "No sessions yet",
    );
  });

  it.each(["files"] as const)(
    "keeps the full-height %s working copy and header actions without project pickers",
    (tab) => {
      props.tab = tab;
      props.onSelectWorkspace = vi.fn();
      props.onGoToFile = vi.fn();
      act(() => render());
      expect(container.querySelector("[data-project-switcher]")).toBeNull();
      expect(container.querySelector("[data-active-worktree-toolbar]")).toBeNull();
      const header = container.querySelector<HTMLElement>("aside > [data-project-header]")!;
      const quickOpen = header.querySelector<HTMLButtonElement>('button[aria-label^="Quick Open"]')!;
      act(() => quickOpen.click());
      expect(props.onGoToFile).toHaveBeenCalledTimes(1);
      expect(header.querySelector('button[aria-label="Open project"]')).not.toBeNull();
      const copy = container.querySelector<HTMLElement>("[data-project-working-copy]")!;
      expect(copy.style.height).toBe("");
      expect(copy.classList.contains("flex-1")).toBe(true);
      expect(copy.querySelector(`[data-${tab}-project="${A}"]`)).not.toBeNull();
      props.cwd = B;
      act(() => render());
      expect(container.querySelectorAll(`[data-${tab}-project]`)).toHaveLength(1);
      expect(container.querySelector(`[data-${tab}-project="${B}"]`)).not.toBeNull();
    },
  );

  it.each([
    ["files", ""], ["files", "~"],
  ] as const)("shows the %s empty hint without a project picker (%s)", (tab, cwd) => {
    props.tab = tab;
    props.cwd = cwd;
    act(() => render());
    expect(container.querySelector("[data-project-switcher]")).toBeNull();
    expect(container.querySelector("[data-active-worktree-toolbar]")).toBeNull();
    expect(container.querySelector("[data-project-working-copy]")).toBeNull();
    expect(Array.from(container.querySelectorAll("p"), node => node.textContent)).toContain("Choose project");
  });

  it.each(["files"] as const)(
    "keeps the open-project header action in %s",
    (tab) => {
      props.tab = tab;
      act(() => render());
      const header = container.querySelector<HTMLElement>(
        "aside > [data-project-header]",
      )!;
      act(() =>
        header
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Open project"]',
          )!
          .click(),
      );
      const openFolder = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[role="menu"][aria-label="Open project"] button',
        ),
      ).find((button) => button.textContent === "Open folder…")!;
      expect(openFolder).not.toBeNull();
      act(() => openFolder.click());
      expect(props.onOpenProject).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps all project conversations available across project changes without a scope picker", () => {
    saveProjectTreeExpanded([A, B]);
    props.desktopMode = "code";
    props.onSelectWorkspace = vi.fn();
    act(() => render());
    expect(container.querySelector("[data-project-switcher]")).toBeNull();
    expect(container.querySelector("[data-active-worktree-toolbar]")).toBeNull();
    expect(card("a")).not.toBeNull();
    expect(card("b")).not.toBeNull();
    props.cwd = B;
    act(() => render());
    expect(card("a")).not.toBeNull();
    expect(card("b")).not.toBeNull();
    expect(container.querySelector("aside > [data-project-header]")).toBeNull();
    expect(container.querySelector("[data-sidebar-search]")).toBeNull();
    expect(container.querySelector('button[aria-label="Filter sessions"]')).toBeNull();
  });

  it.each(["files"] as const)(
    "keeps the single-project %s working copy without a picker",
    (tab) => {
      props.tab = tab;
      props.recents = undefined;
      props.onSelectWorkspace = vi.fn();
      act(() => render());
      expect(container.querySelector("[data-project-switcher]")).toBeNull();
      const header = container.querySelector<HTMLElement>(
        "aside > [data-project-header]",
      )!;
      const tablist = container.querySelector('[role="tablist"]')!;
      expect(header.textContent).toBe("Projects");
      expect(header.nextElementSibling).toBe(tablist);
      expect(container.querySelector("[data-active-worktree-toolbar]")).toBeNull();
      expect(
        container.querySelectorAll("[data-project-working-copy]"),
      ).toHaveLength(1);
      expect(
        container.querySelector(`[data-${tab}-project="${A}"]`),
      ).not.toBeNull();
    },
  );

  it("does not drop cached remote folder members while offline", () => {
    configureSharedHost("machine", [{ id: "project", cwd: B, name: "beta" }]);
    remoteState.rows.set(B, [hostRow("b", "Host conversation")]);
    remoteState.states.set(B, { loaded: true, offline: true });
    saveProjectTreeExpanded([A, B]);
    saveSessionFolders(B, [
      {
        id: "folder-b",
        name: "Team",
        sessionIds: ["b", "offline-only"],
        collapsed: false,
      },
    ]);
    act(() => render());
    expect(card("b")).not.toBeNull();
    expect(loadSessionFolders(B)[0].sessionIds).toEqual(["b", "offline-only"]);
    expect(project(B).textContent).toContain(
      "Offline — showing cached sessions",
    );
  });

  it("preserves a blank Host session in the flat list through project collapse and binding", () => {
    configureSharedHost("machine", [{ id: "project", cwd: B, name: "beta" }]);
    remoteState.rows.set(B, [hostRow("b")]);
    saveProjectTreeExpanded([A, B]);
    saveSessionFolders(B, [
      { id: "folder-b", name: "Team", sessionIds: ["b"], collapsed: false },
    ]);
    props.onNewInProject = vi.fn((path) => {
      props = {
        ...props,
        openSessions: [summary("blank-host", path, "Blank Host session")],
      };
      render();
      return "blank-host";
    });
    act(() => render());
    act(() =>
      project(B)
        .querySelector<HTMLButtonElement>(
          'button[aria-label="New session in beta"]',
        )!
        .click(),
    );
    act(() =>
      project(B)
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Collapse project"]',
        )!
        .click(),
    );
    settleFolds();
    expect(card("blank-host")).toBeNull();
    expand(B);
    expect(card("blank-host")).not.toBeNull();
    act(() => card("blank-host").click());
    expect(props.onSelectSession).toHaveBeenCalledWith("blank-host", B);
    remoteState.bindings.set("blank-host", "host-new");
    props = { ...props, openSessions: [...props.openSessions!] };
    act(() => render());
    expect(card("host-new")).not.toBeNull();
  });

  it("drags a Host session of a local project onto a workspace pane", () => {
    configureSharedHost("machine", [{ id: "project", cwd: B, name: "beta" }]);
    remoteState.rows.set(B, [hostRow("b", "Host conversation")]);
    saveProjectTreeExpanded([A, B]);
    props.onPlaceSessionOnPane = vi.fn();
    act(() => render());
    const from = card("b");
    from.setPointerCapture = vi.fn();
    from.releasePointerCapture = vi.fn();
    const pane = document.createElement("div");
    pane.dataset.paneId = "workspace-pane";
    vi.spyOn(document, "elementFromPoint").mockReturnValue(pane);
    act(() => {
      from.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 1, button: 0, clientX: 1, clientY: 1, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 1, clientX: 20, clientY: 20, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 1, clientX: 20, clientY: 20, bubbles: true,
      }));
    });
    expect(props.onPlaceSessionOnPane).toHaveBeenCalledWith(
      "b", "workspace-pane", expect.any(String), B,
    );
  });

  it("ignores drops onto another session while still allowing workspace pane drops", () => {
    props.projectHistory = [summary("a"), summary("target")];
    props.sessions = props.projectHistory;
    props.onPlaceSessionOnPane = vi.fn();
    act(() => render());
    const from = card("a");
    from.setPointerCapture = vi.fn();
    from.releasePointerCapture = vi.fn();
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(card("target"));
    const drag = () => act(() => {
      from.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 1, button: 0, clientX: 1, clientY: 1, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 1, clientX: 20, clientY: 20, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 1, clientX: 20, clientY: 20, bubbles: true,
      }));
    });
    drag();
    expect(loadSessionFolders(A)).toEqual([]);
    expect(container.querySelector("[data-session-folder]")).toBeNull();
    expect(card("a")).not.toBeNull();
    expect(card("target")).not.toBeNull();
    expect(props.onPlaceSessionOnPane).not.toHaveBeenCalled();
    const pane = document.createElement("div");
    pane.dataset.paneId = "workspace-pane";
    hit.mockReturnValue(pane);
    drag();
    expect(props.onPlaceSessionOnPane).toHaveBeenCalledWith("a", "workspace-pane", expect.any(String));
    expect(loadSessionFolders(A)).toEqual([]);
  });

  it("rejects dragging a session into another project's folder and keeps keyboard multiselection scoped", () => {
    saveProjectTreeExpanded([A, B]);
    saveSessionFolders(B, [
      { id: "folder-b", name: "Team", sessionIds: ["b"], collapsed: false },
    ]);
    props.onPlaceSessionOnPane = vi.fn();
    act(() => render());
    const select = (id: string) =>
      act(() =>
        card(id)
          .querySelector<HTMLElement>("[data-session-select]")!
          .dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              ctrlKey: true,
              bubbles: true,
            }),
          ),
      );
    select("a");
    expect(card("a").dataset.sessionSelected).toBe("true");
    select("b");
    expect(card("a").dataset.sessionSelected).toBeUndefined();
    expect(card("b").dataset.sessionSelected).toBe("true");
    const from = card("a");
    from.setPointerCapture = vi.fn();
    from.releasePointerCapture = vi.fn();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(card("b"));
    act(() => {
      from.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          button: 0,
          clientX: 1,
          clientY: 1,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          bubbles: true,
        }),
      );
    });
    expect(loadSessionFolders(A)).toEqual([]);
    expect(loadSessionFolders(B)[0].sessionIds).toEqual(["b"]);
    expect(props.onPlaceSessionOnPane).not.toHaveBeenCalled();
  });

  it("routes a native-history row on another machine through the remote project", () => {
    const remoteProject = rememberRemoteProject("other-machine", {
      id: "remote-project",
      cwd: "/remote/repo",
      name: "repo",
    });
    props.recents!.push({ path: remoteProject.key, openedAt: 3 });
    props.onSelectRemoteSession = vi.fn();
    remoteState.rows.set(remoteProject.key, [
      {
        ...hostRow("remote-native"),
        nativeSession: {
          provider: "codex",
          providerSessionId: "provider",
          createdAt: 0,
          updatedAt: 0,
          path: "/native.jsonl",
          revision: "r1",
          blockIds: [],
        },
      },
    ]);
    saveProjectTreeExpanded([A, remoteProject.key]);
    act(() => render());
    act(() => card("remote-native").click());
    expect(props.onSelectRemoteSession).toHaveBeenCalledWith(
      remoteProject.key,
      "remote-native",
    );
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("uses project identity for colliding Host ids and preserves native Shared Host routing", () => {
    configureSharedHost("machine", [
      { id: "alpha-host", cwd: A, name: "alpha" },
      { id: "beta-host", cwd: B, name: "beta" },
    ]);
    remoteState.rows.set(A, [hostRow("same", "Host alpha")]);
    remoteState.rows.set(B, [
      hostRow("same", "Host beta"),
      {
        ...hostRow("native", "Native imported"),
        nativeSession: {
          provider: "codex",
          providerSessionId: "provider",
          createdAt: 0,
          updatedAt: 0,
          path: "/native.jsonl",
          revision: "r1",
          blockIds: [],
        },
      },
    ]);
    props.activeSessionId = "shell:same";
    props.onSelectRemoteSession = vi.fn();
    saveProjectTreeExpanded([A, B]);
    act(() => render());
    expect(
      project(A)
        .querySelector('[data-session-select="same"]')
        ?.getAttribute("aria-current"),
    ).toBe("true");
    expect(
      project(B)
        .querySelector('[data-session-select="same"]')
        ?.getAttribute("aria-current"),
    ).toBeNull();
    act(() =>
      project(B)
        .querySelector<HTMLElement>('[data-session-card="same"]')!
        .click(),
    );
    expect(props.onSelectRemoteSession).toHaveBeenCalledWith(B, "same");
    act(() => card("native").click());
    expect(props.onSelectSession).toHaveBeenCalledWith("native", B);
  });
});

describe("project conversation sorting", () => {
  const initial = ["a", "b", "c", "d", "e"];
  const visibleRows = () =>
    [...project(A).querySelectorAll<HTMLElement>("[data-session-row]")].filter(
      (row) =>
        row.querySelector("[data-session-card]") && !row.closest("[hidden]"),
    );
  const rowIds = () => visibleRows().map((row) => row.dataset.sessionRow);

  function pointer(target: EventTarget, type: string, y: number, x = 40) {
    act(() =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      ),
    );
  }

  function fixture(scrollTop = 0) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      window.clearTimeout,
    );
    props.projectHistory = initial.map((id, index) => ({
      ...summary(id, A, index % 2 === 0 ? `Match ${id}` : `Other ${id}`),
      updatedAt: 100 - index,
    }));
    props.sessions = props.projectHistory;
    props.onSessionNavigationOrder = vi.fn();
    act(() => render());
    const scroller = container.querySelector<HTMLElement>(
      "[data-project-list] > div",
    )!;
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, {
      clientHeight: { value: 80, configurable: true },
      scrollHeight: { value: 165, configurable: true },
    });
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 240, 80);
    scroller.scrollTop = scrollTop;
    const measure = () =>
      visibleRows().forEach((row) => {
        row.getBoundingClientRect = () =>
          new DOMRect(
            0,
            visibleRows().indexOf(row) * 33 - scroller.scrollTop,
            240,
            32,
          );
      });
    measure();
    return { scroller, measure };
  }

  it.each([
    {
      direction: "down",
      from: "a",
      start: 16,
      edge: 75,
      scroll: 0,
      end: 85,
      order: ["b", "c", "d", "e", "a"],
    },
    {
      direction: "up",
      from: "e",
      start: 63,
      edge: 5,
      scroll: 85,
      end: 0,
      order: ["e", "a", "b", "c", "d"],
    },
  ])(
    "scrolls $direction with a stationary pointer and drops beyond the original viewport",
    ({ from, start, edge, scroll, end, order }) => {
      const { scroller } = fixture(scroll);
      pointer(card(from), "pointerdown", start);
      pointer(window, "pointermove", edge);
      act(() => vi.advanceTimersByTime(256));
      expect(scroller.scrollTop).toBe(end);
      expect(rowIds()).toEqual(initial);
      pointer(window, "pointerup", edge);
      expect(rowIds()).toEqual(order);
      expect(loadSessionSidebarOrder(A)).toEqual(order);
      expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(order);
      act(() => card(from).click());
      expect(props.onSelectSession).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(64));
      expect(scroller.scrollTop).toBe(end);
      pointer(card(from), "pointerdown", edge);
      pointer(window, "pointerup", edge);
      act(() => card(from).click());
      expect(props.onSelectSession).toHaveBeenCalledWith(from, A);
    },
  );

  it("uses message activity for automatic ordering while retaining a manual order", () => {
    fixture();
    props.projectHistory = props.projectHistory!.map((session, index) => ({
      ...session,
      activityAt: 10 + index,
    }));
    act(() => render());
    expect(rowIds()).toEqual(["e", "d", "c", "b", "a"]);
    expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(["e", "d", "c", "b", "a"]);
    props.projectHistory = props.projectHistory!.map((session) => ({
      ...session,
      activityAt: session.id === "a" ? 200 : session.activityAt,
    }));
    act(() => render());
    expect(rowIds()).toEqual(["a", "e", "d", "c", "b"]);
    act(() => saveSessionSidebarOrder(A, initial));
    expect(rowIds()).toEqual(initial);
  });

  it("preserves filtered slots and restores manual order after activity and remounting", () => {
    saveSessionSidebarOrder(A, initial);
    const { measure } = fixture();
    query("Match");
    measure();
    pointer(card("e"), "pointerdown", 82);
    pointer(window, "pointerup", 16);
    expect(loadSessionSidebarOrder(A)).toEqual(["e", "b", "a", "d", "c"]);
    query("");
    props.projectHistory = props.projectHistory!.map((session) => ({
      ...session,
      updatedAt: session.id === "c" ? 10_000 : session.updatedAt,
    }));
    act(() => render());
    expect(rowIds()).toEqual(["e", "b", "a", "d", "c"]);
    act(() => root.unmount());
    root = createRoot(container);
    act(() => render());
    expect(rowIds()).toEqual(["e", "b", "a", "d", "c"]);
    props.projectHistory = [summary("new", A), ...props.projectHistory!];
    act(() => render());
    expect(rowIds()).toEqual(["new", "e", "b", "a", "d"]);
    expect(loadSessionSidebarOrder(B)).toEqual([]);
  });

  it.each([true, false])("raises a finished reply above a saved manual order with reduced motion %s", async (reduced) => {
    saveSessionSidebarOrder(A, initial);
    fixture();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: reduced, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    props.busySessionIds = new Set(["e"]);
    act(() => render());
    const rows = visibleRows();
    const play = vi.spyOn(Animation.prototype, "play");
    await act(async () => vi.advanceTimersByTimeAsync(duration.panel * 1000));
    expect(rowIds()).toEqual(initial);
    props.busySessionIds = new Set();
    props.projectHistory = props.projectHistory!.map((session) => session.id === "e"
      ? { ...session, activityAt: 200 } : session);
    act(() => render());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rowIds()).toEqual(["e", "a", "b", "c", "d"]);
    expect(loadSessionSidebarOrder(A)).toEqual(["e", "a", "b", "c", "d"]);
    expect(visibleRows()[0]).toBe(rows[4]);
    expect(play.mock.contexts.some((animation) => rows.includes((animation.effect as KeyframeEffect)?.target as HTMLElement))).toBe(!reduced);
    expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(["e", "a", "b", "c", "d"]);
  });

  it("promotes a completed Shared Host conversation inside a pinned Windows project", async () => {
    const cwd = "D:/A-Projects/OmniCode";
    configureSharedHost("local-machine", [{ id: "host-project", cwd, name: "OmniCode" }]);
    props.cwd = cwd;
    props.recents = [{ path: cwd, openedAt: 1 }];
    props.sessions = [];
    props.projectHistory = [];
    props.loadedProjectPaths = new Set([cwd]);
    savePinnedProjects([cwd]);
    saveProjectTreeExpanded([cwd]);
    saveSessionSidebarOrder(cwd, ["a", "b", "c"]);
    remoteState.rows.set(cwd, [
      hostRow("a"), hostRow("b"),
      { ...hostRow("c"), status: "running", revision: 1 },
    ]);
    await act(async () => render());
    const rows = () => [...project(cwd.toLowerCase()).querySelectorAll<HTMLElement>("[data-session-row]")]
      .filter((row) => !row.closest("[hidden]"));
    const original = rows();
    expect(original.map((row) => row.dataset.sessionRow)).toEqual(["a", "b", "c"]);
    remoteState.rows.set(cwd, [
      hostRow("a"), hostRow("b"),
      { ...hostRow("c"), revision: 2, lastCompletedRunId: "reply-1" },
    ]);
    await act(async () => window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)));
    expect(rows().map((row) => row.dataset.sessionRow)).toEqual(["c", "a", "b"]);
    expect(rows()[0]).toBe(original[2]);
    expect(loadSessionSidebarOrder(cwd)).toEqual(["c", "a", "b"]);
  });

  it("settles a manual drop once while retaining motion for later external order changes", async () => {
    fixture();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const section = project(A).querySelector<HTMLElement>(
      "[data-project-session-section]",
    )!;
    vi.spyOn(section, "animate");
    const rows = visibleRows();
    const play = vi.spyOn(Animation.prototype, "play");
    pointer(card("a"), "pointerdown", 16);
    pointer(window, "pointerup", 148);
    await act(async () => vi.advanceTimersByTimeAsync(duration.panel * 1000));
    await act(async () => vi.advanceTimersByTimeAsync(32));
    expect(rowIds()).toEqual(["b", "c", "d", "e", "a"]);
    expect(
      play.mock.contexts.every((animation) => !rows.includes((animation.effect as KeyframeEffect)?.target as HTMLElement)),
    ).toBe(true);
    await act(async () => { saveSessionSidebarOrder(A, initial); await vi.advanceTimersByTimeAsync(0); });
    expect(rowIds()).toEqual(initial);
    expect(
      play.mock.contexts.some((animation) => rows.includes((animation.effect as KeyframeEffect)?.target as HTMLElement)),
    ).toBe(true);
  });

  it.each(["Escape", "pointercancel", "blur"])(
    "stops scrolling and keeps the original order on %s",
    (reason) => {
      const { scroller } = fixture();
      pointer(card("a"), "pointerdown", 16);
      pointer(window, "pointermove", 75);
      act(() => vi.advanceTimersByTime(32));
      expect(scroller.scrollTop).toBeGreaterThan(0);
      act(() =>
        window.dispatchEvent(
          reason === "Escape"
            ? new KeyboardEvent("keydown", { key: "Escape" })
            : new Event(reason),
        ),
      );
      const stoppedAt = scroller.scrollTop;
      act(() => vi.advanceTimersByTime(64));
      expect(scroller.scrollTop).toBe(stoppedAt);
      expect(rowIds()).toEqual(initial);
      expect(loadSessionSidebarOrder(A)).toEqual([]);
      expect(props.onSelectSession).not.toHaveBeenCalled();
    },
  );

  it("stops sidebar scrolling when transferring the conversation to a pane", () => {
    props.onPlaceSessionOnPane = vi.fn();
    const { scroller } = fixture();
    const pane = document.createElement("div");
    pane.dataset.paneId = "workspace-pane";
    vi.spyOn(document, "elementFromPoint").mockImplementation((x) =>
      x >= 300 ? pane : card("b"),
    );
    pointer(card("a"), "pointerdown", 16);
    pointer(window, "pointermove", 75);
    act(() => vi.advanceTimersByTime(32));
    const stoppedAt = scroller.scrollTop;
    pointer(window, "pointermove", 75, 350);
    act(() => vi.advanceTimersByTime(64));
    expect(scroller.scrollTop).toBe(stoppedAt);
    pointer(window, "pointerup", 75, 350);
    expect(props.onPlaceSessionOnPane).toHaveBeenCalledWith(
      "a",
      "workspace-pane",
      expect.any(String),
    );
    expect(loadSessionSidebarOrder(A)).toEqual([]);
    expect(document.querySelector(".drag-ghost")).toBeNull();
  });

  it.each(["project", "sidebar"])(
    "cancels a drag when the %s starts collapsing",
    (surface) => {
      const { scroller } = fixture();
      pointer(card("a"), "pointerdown", 16);
      pointer(window, "pointermove", 75);
      act(() => vi.advanceTimersByTime(32));
      if (surface === "project") {
        act(() =>
          project(A)
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Collapse project"]',
            )!
            .click(),
        );
      } else {
        props.open = false;
        act(() => render());
      }
      const stoppedAt = scroller.scrollTop;
      act(() => vi.advanceTimersByTime(64));
      expect(scroller.scrollTop).toBe(stoppedAt);
      expect(loadSessionSidebarOrder(A)).toEqual([]);
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
    },
  );
});

describe("unified pinned sidebar group", () => {
  function pinnedRows() {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-project-section="pinned"] [data-sidebar-pinned-entry], [data-project-section="pinned"] [data-project-path]',
      ),
    ];
  }

  function measurePins() {
    const rows = pinnedRows();
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => ({
        x: 0,
        y: index * 33,
        top: index * 33,
        bottom: index * 33 + 32,
        left: 0,
        right: 240,
        width: 240,
        height: 32,
        toJSON() {},
      });
      Object.defineProperty(row, "offsetHeight", {
        value: 32,
        configurable: true,
      });
      const header = row.querySelector("[data-project-header]");
      if (header)
        Object.defineProperty(header, "offsetHeight", {
          value: 32,
          configurable: true,
        });
      row.setPointerCapture = vi.fn();
      row.hasPointerCapture = () => true;
      row.releasePointerCapture = vi.fn();
    });
    return rows;
  }

  function pointer(target: EventTarget, type: string, y: number, x = 40) {
    act(() =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      ),
    );
  }

  function pinFixtures() {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    savePinnedProjects([A]);
    saveProjectTreeExpanded([]);
    props.projectHistory = [
      { ...summary("same", A, "Alpha pin"), pinned: true },
      { ...summary("same", B, "Beta pin"), pinned: true },
    ];
    props.sessions = [];
    act(() => render());
  }

  it("restores manual mixed ordering after defaulting to conversations before projects", () => {
    pinFixtures();
    const initial = pinnedRows();
    expect(initial.map((row) => !!row.dataset.sidebarPinnedEntry)).toEqual([true, true, false]);
    localStorage.setItem(
      "omnicode.sidebarPinnedOrder.v1",
      JSON.stringify([
        A,
        initial[1].dataset.sidebarPinnedEntry,
        initial[0].dataset.sidebarPinnedEntry,
      ]),
    );
    act(() => root.render(null));
    act(() => render());
    expect(pinnedRows().map(
      (row) => row.dataset.sidebarPinnedEntry ?? row.dataset.projectPath,
    )).toEqual([
      A,
      initial[1].dataset.sidebarPinnedEntry,
      initial[0].dataset.sidebarPinnedEntry,
    ]);
  });

  it("reorders conversations and projects together and restores their mixed order", () => {
    pinFixtures();
    act(() => savePinnedProjects([A, B]));
    const initial = measurePins();
    const name = initial[3].querySelector<HTMLElement>("[data-project-select]")!;
    expect(name.classList.contains("cursor-grab")).toBe(true);
    pointer(name, "pointerdown", 115);
    pointer(window, "pointermove", 111);
    // No timers or long press are required to start dragging.
    expect(initial[3].dataset.dragging).toBe("true");
    expect(document.body.style.cursor).toBe("grabbing");
    pointer(window, "pointerup", 16);
    act(() => name.click());
    expect(pinnedRows()).toEqual([initial[3], initial[0], initial[1], initial[2]]);
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(loadProjectTreeExpanded(A).size).toBe(0);

    const rows = measurePins();
    const session = rows[2].querySelector<HTMLElement>("[data-session-card]")!;
    expect(session.classList.contains("cursor-grab")).toBe(true);
    pointer(session, "pointerdown", 82);
    pointer(window, "pointermove", 78);
    expect(rows[2].dataset.dragging).toBe("true");
    pointer(window, "pointerup", 16);
    act(() => session.click());
    expect(pinnedRows()).toEqual([initial[1], initial[3], initial[0], initial[2]]);
    expect(props.onSelectSession).not.toHaveBeenCalled();

    const order = pinnedRows().map(
      (row) => row.dataset.sidebarPinnedEntry ?? row.dataset.projectPath,
    );
    act(() => root.render(null));
    act(() => render());
    expect(
      pinnedRows().map(
        (row) => row.dataset.sidebarPinnedEntry ?? row.dataset.projectPath,
      ),
    ).toEqual(order);
    // A fresh press after dropping remains an ordinary click.
    const restored = project(A).querySelector<HTMLElement>(
      "[data-project-select]",
    )!;
    measurePins();
    pointer(restored, "pointerdown", 49);
    pointer(window, "pointerup", 49);
    act(() => restored.click());
    expect(loadProjectTreeExpanded(A).has(A)).toBe(true);
    pointer(restored, "pointerdown", 49);
    pointer(window, "pointerup", 49);
    act(() => restored.click());
    expect(loadProjectTreeExpanded(A).has(A)).toBe(false);
  });

  it.each(["Escape", "pointercancel", "blur"])(
    "cancels pin sorting on %s without opening the conversation",
    (reason) => {
      pinFixtures();
      const rows = measurePins();
      const session = rows[0].querySelector<HTMLElement>("[data-session-card]")!;
      pointer(session, "pointerdown", 16);
      pointer(window, "pointermove", 82);
      act(() =>
        window.dispatchEvent(
          reason === "Escape"
            ? new KeyboardEvent("keydown", { key: "Escape" })
            : new Event(reason),
        ),
      );
      act(() => session.click());
      expect(pinnedRows()).toEqual(rows);
      expect(props.onSelectSession).not.toHaveBeenCalled();
      expect(document.body.style.cursor).toBe("");
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
    },
  );

  it("keeps horizontal pane drops available even for a single pinned conversation", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    props.projectHistory = [{ ...summary("pinned", B), pinned: true }];
    props.sessions = [];
    props.onPlaceSessionOnPane = vi.fn();
    saveProjectTreeExpanded([]);
    act(() => render());
    const rows = measurePins();
    expect(rows).toHaveLength(1);
    const session = rows[0].querySelector<HTMLElement>("[data-session-card]")!;
    const pane = document.createElement("div");
    pane.dataset.paneId = "workspace-pane";
    vi.spyOn(document, "elementFromPoint").mockReturnValue(pane);
    pointer(session, "pointerdown", 16);
    pointer(window, "pointermove", 16, 350);
    expect(document.querySelector(".drag-ghost")).not.toBeNull();
    pointer(window, "pointerup", 16, 350);
    act(() => session.click());
    expect(props.onPlaceSessionOnPane).toHaveBeenCalledWith(
      "pinned",
      "workspace-pane",
      expect.any(String),
    );
    expect(props.onSelectSession).not.toHaveBeenCalled();
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(session.style.opacity).toBe("");
  });
  it("keeps collapsed-project shortcuts scoped across duplicate Host ids and native sessions", () => {
    configureSharedHost("machine", [
      { id: "alpha-host", cwd: A, name: "alpha" },
      { id: "beta-host", cwd: B, name: "beta" },
    ]);
    remoteState.rows.set(A, [
      { ...hostRow("same", "Alpha pin"), pinned: true },
    ]);
    remoteState.rows.set(B, [
      { ...hostRow("same", "Beta pin"), pinned: true },
      {
        ...hostRow("native", "Native pin"),
        pinned: true,
        nativeSession: {
          provider: "codex",
          providerSessionId: "provider",
          createdAt: 0,
          updatedAt: 0,
          path: "/native.jsonl",
          revision: "r1",
          blockIds: [],
        },
      },
    ]);
    props.activeSessionId = "shell:same";
    props.onSelectRemoteSession = vi.fn();
    saveProjectTreeExpanded([]);
    act(() => render());
    const pinned = container.querySelector('[data-project-section="pinned"]')!;
    const row = (path: string, id: string) =>
      pinned.querySelector<HTMLElement>(
        `[data-project-session-section="${path}"] [data-session-card="${id}"]`,
      )!;
    expect(
      pinned.querySelectorAll("[data-pinned-session-shortcut]"),
    ).toHaveLength(3);
    expect(
      row(A, "same").querySelector('[aria-current="true"]'),
    ).not.toBeNull();
    expect(row(B, "same").querySelector('[aria-current="true"]')).toBeNull();
    act(() => row(B, "same").click());
    expect(props.onSelectRemoteSession).toHaveBeenCalledWith(B, "same");
    act(() => row(B, "native").click());
    expect(props.onSelectSession).toHaveBeenCalledWith("native", B);
    expect(
      remoteState.subscriptions.mock.calls.every(([, enabled]) => !enabled),
    ).toBe(true);
  });

  it("mixes pinned conversations and projects with a shared five-item preview and routes collapsed-project shortcuts", () => {
    props.projectHistory = Array.from({ length: 7 }, (_, index) => ({
      ...summary(`pin-${index}`, B, `Pinned conversation ${index}`),
      pinned: true,
      updatedAt: 100 - index,
    }));
    props.sessions = [summary("a", A)];
    savePinnedProjects([A]);
    saveProjectTreeExpanded([]);
    props.onPinSession = vi.fn();
    act(() => render());
    const pinned = container.querySelector('[data-project-section="pinned"]')!;
    const projects = container.querySelector(
      '[data-project-section="projects"]',
    )!;
    const toggle = () =>
      pinned.querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!;
    expect(pinned.textContent).toContain("Pinned items");
    expect(projects.textContent).toContain("Projects");
    expect(
      pinned.querySelectorAll("[data-pinned-session-shortcut]"),
    ).toHaveLength(5);
    expect(pinned.querySelector("[data-project-header]")).toBeNull();
    act(() =>
      pinned.querySelector<HTMLElement>('[data-session-card="pin-0"]')!.click(),
    );
    expect(props.onSelectSession).toHaveBeenCalledWith("pin-0", B);
    act(() => toggle().click());
    expect(
      pinned.querySelectorAll("[data-pinned-session-shortcut]"),
    ).toHaveLength(7);
    expect(pinned.querySelector("[data-project-path]")).not.toBeNull();
    expect(
      projects.querySelector('[data-project-path="' + A + '"]'),
    ).toBeNull();
    act(() =>
      pinned
        .querySelector<HTMLElement>('[data-session-card="pin-0"]')!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    const unpin = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((node) => node.textContent?.includes("Unpin"))!;
    expect(unpin).toBeDefined();
    act(() => unpin.click());
    expect(props.onPinSession).toHaveBeenCalledWith("pin-0", false);
    act(() => toggle().click());
    settleFolds();
    expect(
      pinned.querySelectorAll("[data-pinned-session-shortcut]"),
    ).toHaveLength(5);
    query("Pinned conversation 6");
    expect(
      pinned.querySelectorAll("[data-pinned-session-shortcut]"),
    ).toHaveLength(1);
    expect(pinned.textContent).toContain("Pinned conversation 6");
  });
  function measurePinDropSource(source: HTMLElement) {
    const list = container.querySelector<HTMLElement>("[data-project-list]")!;
    const pinArea = container.querySelector<HTMLElement>(
      '[data-project-section="pinned"]',
    )!;
    const pinHeader = pinArea.querySelector<HTMLElement>(
      "[data-sidebar-section-header]",
    )!;
    const row = source.closest<HTMLElement>(".session-reorder-item, .sidebar-pinned-entry")!;
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 240, 500),
    );
    vi.spyOn(pinArea, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 240, 80),
    );
    vi.spyOn(pinHeader, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 240, 28),
    );
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 200, 240, 32),
    );
    Object.assign(row, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    return pinArea;
  }

  it.each([
    { origin: "project", cancel: false },
    { origin: "pinned project", cancel: false },
    { origin: "chat", cancel: false },
    { origin: "reminder", cancel: false },
    { origin: "project", cancel: true },
  ])(
    "pins a conversation dragged from $origin without duplicate rows (cancel: $cancel)",
    ({ origin, cancel }) => {
      vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: true,
      } as MediaQueryList);
      const path =
        origin === "chat"
          ? "/home/me/Documents/omnicode/2026-10-11/chat-101010-aaaaaa"
          : A;
      if (origin === "chat") {
        localStorage.setItem("omnicode.chatFolders.v1", JSON.stringify([path]));
        props.recents = [];
      }
      if (origin === "pinned project") savePinnedProjects([path]);
      props.cwd = path;
      props.projectHistory = [summary("drag-me", path)];
      props.sessions = props.projectHistory;
      props.loadedProjectPaths = new Set([path]);
      if (origin === "reminder")
        props.reminders = [
          {
            sessionId: "drag-me",
            cwd: path,
            title: "Reminder",
            harness: "codex",
            dueAt: Date.now() + 60_000,
            firedAt: null,
          },
        ];
      saveProjectTreeExpanded([path]);
      props.onPinSession = vi.fn((id, pinned) => {
        props.projectHistory = props.projectHistory!.map((row) =>
          row.id === id ? { ...row, pinned } : row,
        );
        props.sessions = props.projectHistory;
        render();
      });
      act(() => render());
      const source = container.querySelector<HTMLElement>(
        '[data-session-card="drag-me"]',
      )!;
      const pinArea = measurePinDropSource(source);
      const toggle = pinArea.querySelector<HTMLButtonElement>(
        "[data-sidebar-section-toggle]",
      )!;
      // A source inside a pinned project must remain visible while dragged.
      if (origin !== "pinned project") act(() => toggle.click());
      pointer(source, "pointerdown", 216);
      pointer(window, "pointermove", 16);
      expect(pinArea.dataset.sidebarPinDropTarget).toBe("true");
      expect(props.onPinSession).not.toHaveBeenCalled();
      if (cancel)
        act(() =>
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
        );
      else pointer(window, "pointerup", 16);
      expect(pinArea.dataset.sidebarPinDropTarget).toBeUndefined();
      expect(document.querySelector(".drag-label")).toBeNull();
      expect(props.onSelectSession).not.toHaveBeenCalled();
      if (cancel) {
        expect(props.onPinSession).not.toHaveBeenCalled();
        expect(
          project(path).querySelector('[data-session-card="drag-me"]'),
        ).not.toBeNull();
      } else {
        expect(props.onPinSession).toHaveBeenCalledExactlyOnceWith(
          "drag-me",
          true,
        );
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(
          pinArea.querySelector('[data-pinned-session-shortcut="drag-me"]'),
        ).not.toBeNull();
        expect(
          container.querySelectorAll('[data-session-card="drag-me"]'),
        ).toHaveLength(1);
        expect(
          container.querySelector(
            '[data-project-path] [data-session-card="drag-me"]',
          ),
        ).toBeNull();
        expect(
          container.querySelector(
            '[data-chat-project] [data-session-card="drag-me"]',
          ),
        ).toBeNull();
        // Unpinning restores the original project/chat/reminder list.
        act(() => props.onPinSession!("drag-me", false));
        expect(
          pinArea.querySelector('[data-pinned-session-shortcut="drag-me"]'),
        ).toBeNull();
        expect(
          container.querySelectorAll('[data-session-card="drag-me"]'),
        ).toHaveLength(1);
      }
    },
  );

  it("routes a dragged Host conversation pin to its own project despite duplicate IDs", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const machine = {
      id: "machine",
      name: "Host",
      endpoint: "http://localhost",
      environmentId: "environment",
    };
    configureSharedHost(
      machine.environmentId,
      [
        { id: "alpha-host", cwd: A, name: "alpha" },
        { id: "beta-host", cwd: B, name: "beta" },
      ],
      machine.id,
    );
    for (const path of [A, B]) {
      remoteState.rows.set(path, [
        hostRow("same", path === A ? "Alpha" : "Beta"),
      ]);
      remoteState.states.set(path, { machine });
    }
    props.onPinSession = vi.fn();
    saveProjectTreeExpanded([A, B]);
    act(() => render());
    const source = project(B).querySelector<HTMLElement>(
      '[data-session-card="same"]',
    )!;
    measurePinDropSource(source);
    pointer(source, "pointerdown", 216);
    pointer(window, "pointermove", 16);
    await act(async () => pointer(window, "pointerup", 16));
    expect(remoteState.request).toHaveBeenCalledExactlyOnceWith(
      "machine",
      "sessions.update",
      { projectId: "beta-host", sessionId: "same", pinned: true },
    );
    expect(props.onPinSession).not.toHaveBeenCalled();
    remoteState.rows.set(B, [{ ...hostRow("same", "Beta"), pinned: true }]);
    act(() => window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED)));
    expect(
      project(A).querySelector('[data-session-card="same"]'),
    ).not.toBeNull();
    expect(project(B).querySelector('[data-session-card="same"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-project-section="pinned"] [data-project-session-section="' +
          B +
          '"] [data-session-card="same"]',
      ),
    ).not.toBeNull();
  });

});

describe("sidebar chat conversations", () => {
  const C1 = "/home/me/Documents/omnicode/2026-10-11/chat-101010-aaaaaa";
  const C2 = "/home/me/Documents/omnicode/2026-10-11/chat-202020-bbbbbb";
  beforeEach(() => {
    localStorage.setItem("omnicode.chatFolders.v1", JSON.stringify([C1, C2]));
    props.cwd = C1;
    props.recents = [];
    props.sessions = [summary("a", C1, "Alpha conversation")];
    props.projectHistory = [...props.sessions, summary("b", C2, "Hidden conversation")];
    props.loadedProjectPaths = new Set([C1, C2]);
  });
  const chats = () => container.querySelector("[data-chat-project]")!;
  const chatIds = () =>
    [...chats().querySelectorAll<HTMLElement>("[data-session-card]")].map(
      (row) => row.dataset.sessionCard,
    );

  it("shows one chat shortcut per session after repeated canonical history loads through a project alias", () => {
    const alias = "/home/me/alpha";
    const conversation = summary("same-session", C1, "问题咨询");
    props.projectHistory = [conversation];
    props.sessions = [conversation];
    props.activeSessionId = conversation.id;
    props.recents = [{ path: C1, openedAt: 1 }];
    saveProjectTreeExpanded([]);
    act(() => render());
    expect(chatIds()).toEqual([conversation.id]);

    for (let refresh = 0; refresh < 3; refresh++) {
      props.projectHistory = replaceProjectHistory(
        props.projectHistory,
        alias,
        [{ ...conversation, updatedAt: conversation.updatedAt + refresh + 1 }],
      );
      act(() => render());
      expect(chatIds()).toEqual([conversation.id]);
    }

    const otherConversation = summary("another-session", C1, "问题咨询");
    props.projectHistory = replaceProjectHistory(
      props.projectHistory,
      alias,
      [conversation, otherConversation],
    );
    act(() => render());
    expect(chatIds().sort()).toEqual([otherConversation.id, conversation.id]);
  });

  const chatCard = (path: string, id: string) =>
    container.querySelector<HTMLElement>(
      `[data-project-session-section="${path}"] [data-session-card="${id}"]`,
    )!;
  const pickChatAction = async (path: string, id: string, label: string) => {
    await act(async () =>
      chatCard(path, id).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((button) => !button.closest("[inert]") && button.textContent?.startsWith(label))!;
    expect(item, label).toBeDefined();
    await act(async () => item.click());
  };
  const renameChat = async (path: string, id: string, title: string) => {
    await pickChatAction(path, id, "Rename");
    const renameInput = chats().querySelector<HTMLInputElement>(
      `[data-project-session-section="${path}"] [data-session-rename-row="${id}"] input`,
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(renameInput, title);
      renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      renameInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  };

  it("keeps rename, pin, unpin, archive and delete actions on an inactive local chat shortcut", async () => {
    props.onRenameSession = vi.fn();
    props.onPinSession = vi.fn();
    props.onArchiveSession = vi.fn();
    props.onDeleteSession = vi.fn();
    saveProjectTreeExpanded([]);
    act(() => render());

    await renameChat(C2, "b", "Renamed chat");
    expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith(
      "b",
      "Renamed chat",
    );
    await pickChatAction(C2, "b", "Pin");
    expect(props.onPinSession).toHaveBeenLastCalledWith("b", true);
    props.projectHistory = props.projectHistory!.map((row) =>
      row.id === "b" ? { ...row, pinned: true } : row,
    );
    act(() => render());
    await pickChatAction(C2, "b", "Unpin");
    expect(props.onPinSession).toHaveBeenLastCalledWith("b", false);
    await pickChatAction(C2, "b", "Archive");
    expect(props.onArchiveSession).toHaveBeenCalledExactlyOnceWith("b", true);
    await pickChatAction(C2, "b", "Delete");
    expect(props.onDeleteSession).toHaveBeenCalledExactlyOnceWith("b");
    expect(props.onSelectSession).not.toHaveBeenCalled();
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(container.querySelector("[data-project-children]")).toBeNull();
  });

  it("scopes chat Host mutations to the correct project when another project has the same session ID", async () => {
    const machine = {
      id: "machine",
      name: "Host",
      endpoint: "http://localhost",
      environmentId: "environment",
    };
    configureSharedHost(
      machine.environmentId,
      [
        { id: "alpha-host", cwd: C1, name: "alpha" },
        { id: "beta-host", cwd: C2, name: "beta" },
      ],
      machine.id,
    );
    for (const path of [C1, C2]) {
      remoteState.rows.set(path, [
        hostRow("same", path === C1 ? "Alpha" : "Beta"),
      ]);
      remoteState.states.set(path, { machine });
    }
    props.onRenameSession = vi.fn();
    props.onPinSession = vi.fn();
    props.onArchiveSession = vi.fn();
    props.onDeleteSession = vi.fn();
    props.onRemoteSessionDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    saveProjectTreeExpanded([]);
    act(() => render());

    await renameChat(C2, "same", "Beta renamed");
    await pickChatAction(C2, "same", "Pin");
    remoteState.rows.set(C2, [
      { ...hostRow("same", "Beta renamed"), pinned: true },
    ]);
    act(() => render());
    await pickChatAction(C2, "same", "Unpin");
    await pickChatAction(C2, "same", "Archive");
    await pickChatAction(C2, "same", "Delete");

    expect(remoteState.request.mock.calls).toEqual([
      [
        machine.id,
        "sessions.update",
        { projectId: "beta-host", sessionId: "same", title: "Beta renamed" },
      ],
      [
        machine.id,
        "sessions.update",
        { projectId: "beta-host", sessionId: "same", pinned: true },
      ],
      [
        machine.id,
        "sessions.update",
        { projectId: "beta-host", sessionId: "same", pinned: false },
      ],
      [
        machine.id,
        "sessions.update",
        { projectId: "beta-host", sessionId: "same", archived: true },
      ],
      [
        machine.id,
        "sessions.delete",
        { projectId: "beta-host", sessionId: "same" },
      ],
    ]);
    expect(remoteState.refresh).toHaveBeenCalledTimes(5);
    expect(props.onRemoteSessionDeleted).toHaveBeenCalledExactlyOnceWith(
      "same",
      C2,
    );
    for (const callback of [
      props.onRenameSession,
      props.onPinSession,
      props.onArchiveSession,
      props.onDeleteSession,
    ])
      expect(callback).not.toHaveBeenCalled();
    expect(chatCard(C1, "same").textContent).toContain("Alpha");
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(
      remoteState.subscriptions.mock.calls.every(([, enabled]) => !enabled),
    ).toBe(true);
  });

  it("applies provider, time, archive and running-status filters to chat rows", () => {
    localStorage.setItem(
      "omnicode.sessionSidebarFilters",
      JSON.stringify({
        hiddenHarnesses: ["codex"],
        time: "7d",
        status: { working: true },
      }),
    );
    props.projectHistory = [
      { ...summary("running", C2), harness: "pi", updatedAt: Date.now() },
      { ...summary("hidden", C1), updatedAt: Date.now() },
      { ...summary("old", C1), harness: "pi", updatedAt: 0 },
      { ...summary("waiting", C2), harness: "pi", updatedAt: Date.now() },
      {
        ...summary("archived", C2),
        harness: "pi",
        updatedAt: Date.now(),
        archived: true,
      },
    ];
    props.busySessionIds = new Set(["running", "hidden", "old", "archived"]);
    props.approvalSessionIds = new Set(["waiting"]);
    saveProjectTreeExpanded([]);
    act(() => render());
    expect(chatIds()).toEqual(["running"]);
  });

  it("keeps pinned chats only in the pinned section while sorting ordinary chats by activity", () => {
    props.projectHistory = [
      { ...summary("old-pin", C1), updatedAt: 1, pinned: true },
      { ...summary("latest", C2), updatedAt: 30 },
      { ...summary("middle", C1), updatedAt: 20 },
      { ...summary("archived", C2), updatedAt: 40, archived: true },
      { ...summary("worker", C2), updatedAt: 50, orchestrationLeadId: "lead" },
    ];
    saveProjectTreeExpanded([]);
    props.onSessionNavigationOrder = vi.fn();
    act(() => render());
    expect(chatIds()).toEqual(["latest", "middle"]);
    expect(container.querySelector('[data-project-section="pinned"] [data-session-card="old-pin"]')).not.toBeNull();
    expect(chats().textContent).toContain("Chats");
    expect(card("latest")).toBeNull();
    act(() =>
      chats()
        .querySelector<HTMLElement>('[data-session-card="latest"]')!
        .click(),
    );
    expect(props.onSelectSession).toHaveBeenCalledWith("latest", C2);
    expect(props.onSessionNavigationOrder).toHaveBeenCalledWith([]);
    props.projectHistory = props.projectHistory.map((row) =>
      row.id === "middle" ? { ...row, updatedAt: 60 } : row,
    );
    act(() => render());
    expect(chatIds()).toEqual(["middle", "latest"]);
    query("no matching conversation");
    settleFolds();
    expect(chats()).toBeNull();
  });

  it("keeps an independent five-row preview with animated closing and rapid reversal", () => {
    props.projectHistory = Array.from({ length: 12 }, (_, index) => ({
      ...summary(`chat-${index}`, index % 2 ? C1 : C2),
      updatedAt: 100 - index,
    }));
    saveProjectTreeExpanded([]);
    act(() => render());
    const toggle = () =>
      chats().querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!;
    expect(chatIds()).toHaveLength(5);
    act(() => toggle().click());
    expect(chatIds()).toHaveLength(10);
    act(() => toggle().click());
    expect(chatIds()).toHaveLength(12);
    act(() => toggle().click());
    const closing = chats().querySelector<HTMLElement>(
      '[data-fold-state="closing"]',
    )!;
    expect(closing.inert).toBe(true);
    act(() => toggle().click());
    settleFolds();
    expect(chatIds()).toHaveLength(10);
    act(() => toggle().click());
    act(() => toggle().click());
    settleFolds();
    expect(chatIds()).toHaveLength(5);
    expect(project(C1)).toBeNull();
    query("chat-11");
    settleFolds();
    expect(chatIds()).toEqual(["chat-11"]);
  });

  it("deduplicates blank Host shells while preserving project-scoped IDs and routes", () => {
    configureSharedHost("machine", [
      { id: "alpha-host", cwd: C1, name: "alpha" },
      { id: "beta-host", cwd: C2, name: "beta" },
    ]);
    remoteState.rows.set(C1, [{ ...hostRow("same", "Alpha"), updatedAt: 10 }]);
    remoteState.rows.set(C2, [{ ...hostRow("same", "Beta"), updatedAt: 20 }]);
    remoteState.bindings.set("blank-shell", "blank");
    props.openSessions = [
      { ...summary("shell:same", C1), updatedAt: 10 },
      {
        ...summary("blank-shell", C2),
        title: "",
        updatedAt: 30,
      },
    ];
    props.onSelectRemoteSession = vi.fn();
    props.cwd = C2;
    props.activeSessionId = "blank-shell";
    saveProjectTreeExpanded([]);
    act(() => render());
    expect(chatIds()).toEqual(["blank", "same", "same"]);
    const row = (path: string, id: string) =>
      chats().querySelector<HTMLElement>(
        `[data-project-session-section="${path}"] [data-session-card="${id}"]`,
      )!;
    expect(
      row(C2, "blank").querySelector('[aria-current="true"]'),
    ).not.toBeNull();
    act(() => row(C2, "same").click());
    expect(props.onSelectRemoteSession).toHaveBeenCalledWith(C2, "same");
    act(() => row(C1, "same").click());
    expect(props.onSelectRemoteSession).toHaveBeenCalledWith(C1, "same");
    expect(
      remoteState.subscriptions.mock.calls.every(([, enabled]) => !enabled),
    ).toBe(true);
  });
});

describe("project conversation summaries", () => {
  it("keeps a new live conversation first through project switches, collapse and stale history", () => {
    props.projectHistory = [summary("older", A), { ...summary("middle", A), updatedAt: 2_000 }];
    props.openSessions = [{ ...summary("new", A), updatedAt: 3_000 }];
    saveProjectTreeExpanded([A, B]);
    act(() => render());
    const projectIds = () => [...project(A).querySelectorAll<HTMLElement>("[data-session-card]")]
      .map((node) => node.dataset.sessionCard);
    expect(projectIds()).toEqual(["new", "middle", "older"]);
    props.cwd = B;
    act(() => render());
    act(() => project(A).querySelector<HTMLButtonElement>('button[aria-label="Collapse project"]')!.click());
    settleFolds();
    props.projectHistory = [...props.projectHistory, { ...summary("new", A), updatedAt: 1_500 }];
    act(() => render());
    expand(A);
    expect(projectIds()).toEqual(["new", "middle", "older"]);
  });

  it("loads collapsed local and Host summaries before searching and localizes the headings", async () => {
    const remote = rememberRemoteProject("other-machine", {
      id: "project",
      cwd: "/remote/beta",
      name: "beta",
    });
    props.recents = [
      { path: A, openedAt: 1 },
      { path: remote.key, openedAt: 2 },
    ];
    props.projectHistory = [];
    props.loadedProjectPaths = new Set();
    saveProjectTreeExpanded([]);
    props.onLoadProject = vi.fn(async (path) => {
      props.projectHistory = [summary("loaded", path)];
      props.loadedProjectPaths = new Set([path]);
      render();
    });
    props.onPrefetchRemoteProject = vi.fn(async (path) => {
      remoteState.rows.set(path, [
        { ...hostRow("host-recent"), updatedAt: 2000 },
      ]);
      window.dispatchEvent(new Event("omnicode:remote-history-updated"));
    });
    await act(async () => render());
    expect(props.onLoadProject).toHaveBeenCalledExactlyOnceWith(A);
    expect(props.onPrefetchRemoteProject).toHaveBeenCalledExactlyOnceWith(
      remote.key,
    );
    expect(container.querySelector("[data-project-children]")).toBeNull();
    expect(
      remoteState.subscriptions.mock.calls.every(([, enabled]) => !enabled),
    ).toBe(true);
    act(() => setUiLanguage("zh-CN"));
    expect(container.querySelector('[data-project-section="recent"]')).toBeNull();
    expect(
      container.querySelector('[data-project-section="projects"]')!.textContent,
    ).toContain("项目");
  });
});

describe("unified project search loading", () => {
  it.each(["close", "tab", "unmount"])(
    "loads at most four unvisited projects, continues after search clears, and stops queuing on %s",
    async (stop) => {
      props.recents = [
        A,
        ...Array.from({ length: 7 }, (_, n) => `/workspace/project-${n}`),
      ].map((path) => ({ path, openedAt: 0 }));
      props.loadedProjectPaths = new Set([A]);
      const finish: Array<() => void> = [];
      props.onLoadProject = vi.fn(
        () => new Promise<void>((resolve) => finish.push(resolve)),
      );
      act(() => render());
      await act(async () => query("a search that has no matches"));
      expect(props.onLoadProject).toHaveBeenCalledTimes(4);
      expect(container.textContent).toContain("Searching projects…");
      expect(container.textContent).not.toContain("No matching sessions");
      query("another query");
      await act(async () => Promise.resolve());
      expect(props.onLoadProject).toHaveBeenCalledTimes(4);
      query("");
      await act(async () => finish[0]());
      expect(props.onLoadProject).toHaveBeenCalledTimes(5);
      if (stop === "unmount") act(() => root.unmount());
      else {
        if (stop === "close") props.open = false;
        else props.tab = "files";
        act(() => render());
      }
      await act(async () => finish.forEach((resolve) => resolve()));
      expect(props.onLoadProject).toHaveBeenCalledTimes(5);
    },
  );

  it("prefetches a collapsed Shared Host project despite already-loaded local summaries without starting its poller", async () => {
    configureSharedHost("machine", [{ id: "project", cwd: B, name: "beta" }]);
    props.loadedProjectPaths = new Set([A, B]);
    props.projectHistory = [summary("a", A, "Alpha conversation")];
    props.onPrefetchRemoteProject = vi.fn(async (path) => {
      remoteState.rows.set(
        path,
        path === B ? [hostRow("host-match", "Found through Host")] : [],
      );
      window.dispatchEvent(new Event("omnicode:remote-history-updated"));
    });
    act(() => render());
    await act(async () => query("Found through Host"));
    expect(props.onPrefetchRemoteProject).toHaveBeenCalledWith(B);
    expect(card("host-match")).not.toBeNull();
    expect(
      remoteState.subscriptions.mock.calls
        .filter(([path]) => path === B)
        .every(([, enabled]) => enabled === false),
    ).toBe(true);
    expect(loadProjectTreeExpanded(A)).toEqual(new Set([A]));
    await act(async () => query(""));
    settleFolds();
    expect(card("host-match")).toBeNull();
    expand(B);
    expect(card("host-match")).not.toBeNull();
  });

  it("retains a failed nonmatching remote project and its error when a search retry also fails", async () => {
    const remoteProject = rememberRemoteProject("other-machine", {
      id: "remote-project",
      cwd: "/remote/repo",
      name: "repo",
    });
    props.recents!.push({ path: remoteProject.key, openedAt: 3 });
    props.onPrefetchRemoteProject = vi.fn(async () => {
      throw new Error("offline");
    });
    act(() => render());
    await act(async () => query("Alpha conversation"));
    expect(project(remoteProject.key).textContent).toContain(
      "Couldn’t load sessions",
    );
    const retry = Array.from(
      project(remoteProject.key).querySelectorAll("button"),
    ).find((button) => button.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(props.onPrefetchRemoteProject).toHaveBeenCalledTimes(2);
    expect(project(remoteProject.key).textContent).toContain(
      "Couldn’t load sessions",
    );
    expect(card("a")).not.toBeNull();
    expect(container.textContent).not.toContain("No matching sessions");
  });

  it("displays a failed project with a retry while other projects remain operable", async () => {
    props.loadedProjectPaths = new Set([A]);
    props.projectHistory = props.sessions;
    props.onLoadProject = vi.fn(async () => {
      throw new Error("list failed");
    });
    act(() => render());
    await act(async () => query("Alpha conversation"));
    expect(card("a")).not.toBeNull();
    expect(project(B).textContent).toContain("Couldn’t load sessions");
    const retry = Array.from(project(B).querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    )!;
    expect(retry).not.toBeNull();
    await act(async () => retry.click());
    expect(props.onLoadProject).toHaveBeenCalledTimes(2);
    act(() => card("a").click());
    expect(props.onSelectSession).toHaveBeenCalledWith("a", A);
  });
});

describe("project tree session preview", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      ...summary(`s${index}`, A, `Chat ${index}`),
      updatedAt: 10_000 - index,
    }));
  const toggle = () =>
    project(A).querySelector<HTMLButtonElement>("[data-session-list-toggle]");

  it.each(["project", "section"])(
    "resets expanded conversations to five when their %s collapses",
    (scope) => {
      props.projectHistory = many(12);
      props.sessions = props.projectHistory;
      act(() => render());
      const header = scope === "project"
        ? project(A).querySelector<HTMLElement>("[data-project-header]")!
        : container.querySelector<HTMLElement>(
          '[data-sidebar-reorder-section="projects"] [data-sidebar-section-toggle]',
        )!;
      const count = () => project(A).querySelectorAll("[data-session-card]").length;
      for (const rapid of [false, true]) {
        act(() => toggle()!.click());
        act(() => toggle()!.click());
        expect(count()).toBe(12);
        act(() => header.click());
        expect(count()).toBe(12);
        expect(project(A).querySelector('[data-fold-state="closing"]')).not.toBeNull();
        if (!rapid) settleFolds();
        act(() => header.click());
        if (rapid) settleFolds();
        expect(count()).toBe(5);
        expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
      }
    },
  );

  it.each(["pinned", "reminders"] as const)(
    "resets the nested %s preview after closing without resetting ordinary conversations",
    (kind) => {
      props.recents = undefined;
      props.projectHistory = many(24).map((row, index) => ({
        ...row,
        pinned: kind === "pinned" && index < 12,
      }));
      props.sessions = props.projectHistory;
      if (kind === "reminders") props.reminders = props.sessions.slice(0, 12).map((row) => ({
        sessionId: row.id,
        cwd: A,
        title: "Reminder",
        harness: "codex",
        dueAt: 12_345,
        firedAt: null,
      }));
      act(() => render());
      const group = project(A).querySelector<HTMLElement>(kind === "pinned"
        ? "[data-pinned-sessions]" : "[data-reminder-sessions]")!;
      const more = () => group.querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!;
      act(() => toggle()!.click());
      act(() => more().click());
      act(() => more().click());
      expect(group.querySelectorAll("[data-session-card]")).toHaveLength(12);
      const header = group.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
      act(() => header.click());
      settleFolds();
      act(() => header.click());
      expect(group.querySelectorAll("[data-session-card]")).toHaveLength(5);
      expect(more().getAttribute("aria-expanded")).toBe("false");
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
      expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(15);
    },
  );

  it("reveals five more chats per click without automatic paging, then animates Show less", () => {
    props.projectHistory = many(43);
    props.sessions = props.projectHistory;
    props.activeSessionId = "s0";
    act(() => render());
    expect(card("s4")).not.toBeNull();
    expect(card("s5")).toBeNull();
    expect(toggle()?.textContent).toBe("Show more");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    for (const count of [10, 15, 20, 25, 30, 35, 40, 43]) {
      act(() => toggle()!.click());
      expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(
        count,
      );
      expect(card(`s${count - 1}`)).not.toBeNull();
      expect(card(`s${count}`)).toBeNull();
      expect(toggle()?.textContent).toBe(
        count < 43 ? "Show more" : "Show less",
      );
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
      expect(
        project(A).querySelector("[data-session-list] > li[aria-hidden]"),
      ).toBeNull();
      expect(
        card(`s${count - 1}`)
          .closest(".zen-fold-item")
          ?.getAttribute("data-fold-state"),
      ).toBe("opening");
    }
    expect(toggle()?.textContent).toBe("Show less");
    act(() => toggle()!.click());
    const closing = card("s5").closest<HTMLElement>(".zen-fold-item")!;
    expect(closing.dataset.foldState).toBe("closing");
    expect(closing.inert).toBe(true);
    expect(closing.getAttribute("aria-hidden")).toBe("true");
    expect(toggle()?.textContent).toBe("Show more");
    // A click during closing reopens exactly the next five rows.
    act(() => toggle()!.click());
    expect(closing.dataset.foldState).toBe("opening");
    expect(closing.inert).toBe(false);
    settleFolds();
    expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(10);
    for (const count of [15, 20, 25, 30, 35, 40, 43]) {
      act(() => toggle()!.click());
      expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(
        count,
      );
    }
    act(() => toggle()!.click());
    settleFolds();
    expect(card("s5")).toBeNull();
    expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(5);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("includes legacy folder members in the same five-chat preview", () => {
    props.projectHistory = many(9);
    props.sessions = props.projectHistory;
    props.activeSessionId = "s7";
    saveSessionFolders(A, [
      { id: "f", name: "Folder", sessionIds: ["s0", "s1"], collapsed: false },
    ]);
    act(() => render());
    expect(card("s0")).not.toBeNull();
    expect(card("s1")).not.toBeNull();
    // Legacy folder members count toward the ordinary five-row preview.
    expect(card("s4")).not.toBeNull();
    expect(card("s5")).toBeNull();
    expect(container.querySelector("[data-session-folder]")).toBeNull();
    expect(card("s7")).toBeNull();
    expect(card("s8")).toBeNull();
    expect(toggle()).not.toBeNull();
    act(() => toggle()!.click());
    expect(card("s8")).not.toBeNull();
    expect(toggle()?.textContent).toBe("Show less");
    act(() => toggle()!.click());
    settleFolds();
    expect(card("s7")).toBeNull();
    expect(card("s8")).toBeNull();
  });

  it("paginates pins separately while legacy folder members remain in the flat list", () => {
    props.projectHistory = many(36).map((row, index) => ({
      ...row,
      pinned: index < 12,
    }));
    props.sessions = props.projectHistory;
    saveSessionFolders(A, [
      {
        id: "f",
        name: "Folder",
        sessionIds: props.sessions.slice(12, 24).map((row) => row.id),
        collapsed: false,
      },
    ]);
    act(() => render());
    const pins = container.querySelector('[data-project-section="pinned"]')!;
    const pinsToggle = () =>
      pins.querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!;
    expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(5);
    expect(pins.querySelectorAll("[data-session-card]")).toHaveLength(5);
    act(() => pinsToggle().click());
    expect(pins.querySelectorAll("[data-session-card]")).toHaveLength(10);
    expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(5);
    act(() => pinsToggle().click());
    expect(pins.querySelectorAll("[data-session-card]")).toHaveLength(12);
    act(() => pinsToggle().click());
    expect(pins.querySelector('[data-session-card="s5"]')!.closest<HTMLElement>(".zen-fold-item")!.inert).toBe(true);
    settleFolds();
    expect(project(A).querySelectorAll("[data-session-card]")).toHaveLength(5);
  });

  it("does not truncate search results or show the toggle for short lists", () => {
    props.projectHistory = many(9);
    props.sessions = props.projectHistory;
    act(() => render());
    query("Chat");
    expect(card("s8")).not.toBeNull();
    expect(toggle()).toBeNull();
    query("");
    props.projectHistory = many(3);
    props.sessions = props.projectHistory;
    act(() => render());
    expect(toggle()).toBeNull();
  });
});

it("hands over the right-clicked conversation in its own project", async () => {
  configureSharedHost("local-host", [{ id: "alpha", cwd: A, name: "Alpha" }], "local-machine");
  remoteState.rows.set(A, [{ ...hostRow("a"), projectId: "alpha", cwd: A }]);
  await act(async () => render());
  await act(async () => card("a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
  const handoff = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Hand over to assistant"))!;
  expect(handoff).toBeDefined();
  await act(async () => handoff.click());
  expect(delegateDesktopSession).toHaveBeenCalledWith(A, "a");
});

describe("chat project row", () => {
  const C1 = "/home/me/Documents/omnicode/2026-10-11/chat-101010-aaaaaa";
  const C2 = "/home/me/Documents/omnicode/2026-10-11/chat-202020-bbbbbb";
  const chatRow = () => container.querySelector("[data-chat-project]")!;
  const chatIds = () =>
    [...chatRow().querySelectorAll<HTMLElement>("[data-session-card]")].map(
      (row) => row.dataset.sessionCard,
    );

  it("places chats before workflows and projects without recent-session duplicates and starts new chats", () => {
    localStorage.setItem("omnicode.chatFolders.v1", JSON.stringify([C1, C2]));
    props.projectHistory = [
      { ...summary("older-chat", C1), updatedAt: 10 },
      { ...summary("newer-chat", C2), updatedAt: 30 },
      { ...summary("project", A), updatedAt: 20 },
    ];
    props.recents = [
      { path: A, openedAt: 1 },
      { path: C1, openedAt: 2 },
    ];
    props.onNewChat = vi.fn();
    props.workflowsSection = createElement("button", null, "Saved workflows");
    saveProjectTreeExpanded([]);
    act(() => render());
    const projects = container.querySelector('[data-project-section="projects"]')!;
    expect(projects.querySelector("[data-chat-project]")).toBeNull();
    expect([...container.querySelectorAll<HTMLElement>("[data-project-section]")]
      .map((section) => section.dataset.projectSection)).toEqual(["pinned", "chats", "workflows", "projects"]);
    expect(projects.textContent).toContain("Projects");
    expect(chatIds()).toEqual(["newer-chat", "older-chat"]);
    expect(project(C1)).toBeNull();
    expect(container.querySelector('[data-project-section="recent"]')).toBeNull();
    expect(container.querySelectorAll('[data-session-card="newer-chat"]')).toHaveLength(1);
    act(() =>
      chatRow()
        .querySelector<HTMLElement>('[data-session-card="newer-chat"]')!
        .click(),
    );
    expect(props.onSelectSession).toHaveBeenCalledWith("newer-chat", C2);
    act(() =>
      chatRow()
        .querySelector<HTMLButtonElement>('button[aria-label="New chat"]')!
        .click(),
    );
    expect(props.onNewChat).toHaveBeenCalledOnce();
    act(() => chatRow().querySelector<HTMLButtonElement>("[data-sidebar-section-toggle]")!.click());
    expect(
      chatRow().querySelector("[data-sidebar-section-toggle]")!.getAttribute("aria-expanded"),
    ).toBe("false");
    act(() => setUiLanguage("zh-CN"));
    expect(chatRow().textContent).toContain("聊天");
    expect(projects.textContent).toContain("项目");
    expect(container.textContent).not.toContain("最近项目");
    expect(container.textContent).not.toContain("最近会话");
  });
});
