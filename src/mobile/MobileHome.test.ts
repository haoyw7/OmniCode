import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { act, createElement, createRef, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostProject,
  HostSessionSummary,
} from "../features/connections/model/protocol";
import { setUiLanguage } from "../shared/i18n/language";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import { MobileHome } from "./MobileHome";
import { lightImpact } from "./haptics";

vi.mock("./haptics", () => ({ lightImpact: vi.fn() }));

const projects: HostProject[] = [
  { id: "one", name: "monocode", cwd: "/projects/monocode" },
  { id: "two", name: "monocode", cwd: "/other/monocode" },
];
const session = (
  id: string,
  projectId: string,
  updatedAt: number,
  extra: Partial<HostSessionSummary> = {},
): HostSessionSummary => ({
  id,
  projectId,
  updatedAt,
  title: id,
  harness: "codex",
  status: "idle",
  revision: 1,
  ...extra,
});
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const defaults = {
  projects,
  hostName: "Computer",
  hostStatus: { state: "connected" as const },
  foreground: true,
  query: "",
  now: 100,
  unreadIds: new Set<string>(),
  loadSessions: async (id: string) =>
    id === "one"
      ? [
          session("old", id, 10),
          session("pin", id, 20, { pinned: true }),
          session("archive", id, 99, { archived: true }),
        ]
      : [session("new", id, 50)],
  onProject: vi.fn(),
  onSession: vi.fn(),
  onNewSession: vi.fn(),
  onSearch: vi.fn(),
  onAddProject: vi.fn(),
};
async function render(props: Partial<Parameters<typeof MobileHome>[0]> = {}) {
  await act(async () =>
    root.render(createElement(MobileHome, { ...defaults, ...props })),
  );
}
const ids = (area: string) =>
  [...node.querySelectorAll(`${area} [data-session-id]`)].map((row) =>
    row.getAttribute("data-session-id"),
  );

describe("mobile home and project history", () => {
  it("waits for project discovery before offering the empty-state action", async () => {
    const onAddProject = vi.fn();
    await render({ projects: [], projectsPending: true, onAddProject });
    expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading projects…");
    expect(node.querySelector(".mobile-empty")).toBeNull();
    expect(node.querySelector(".mobile-home-add")).toBeNull();
    act(() => setUiLanguage("zh-CN"));
    expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("正在加载项目…");

    await render({ projects: [], projectsPending: false, onAddProject });
    expect(node.querySelector('[role="status"]')).toBeNull();
    const button = node.querySelector<HTMLButtonElement>(".mobile-empty .mobile-home-add")!;
    act(() => button.click());
    expect(onAddProject).toHaveBeenCalledExactlyOnceWith(button);
  });

  it.each([
    { label: "populated", projects, query: "" },
    { label: "empty", projects: [], query: "" },
    { label: "search with no matches", projects, query: "missing-project" },
  ])("opens the picker from the capsule in a $label project list", async ({ projects, query }) => {
    const onAddProject = vi.fn();
    await render({ projectsPage: true, projects, query, onAddProject });
    const button = node.querySelector<HTMLButtonElement>(".mobile-home-open-project")!;
    expect(button.textContent).toBe("Open project");
    expect(button.closest(".mobile-home-dock")).not.toBeNull();
    expect(button.closest(".mobile-home-scroll")).toBeNull();
    expect(node.querySelector(".mobile-home-add")).toBeNull();
    act(() => button.click());
    expect(onAddProject).toHaveBeenCalledExactlyOnceWith(button);
  });

  it("shows each project's state from its full history and clears it when work finishes", async () => {
    const history = Array.from({ length: 25 }, (_, index) => session(`idle-${index}`, "one", 100 - index));
    history.push(session("running-plan", "one", 1, { status: "running" }));
    let latest = history;
    const loadSessions = async (id: string) => id === "one" ? latest
      : [session("archived-run", "two", 200, { status: "running", needsInput: true, archived: true })];
    await render({ projectsPage: true, loadSessions });
    const row = (path: string) => node.querySelector<HTMLButtonElement>(`.mobile-home-project[title="${path}"]`)!;
    expect(row(projects[0].cwd).querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(row(projects[1].cwd).querySelector(".mobile-home-project-state")).toBeNull();
    latest = [
      session("asking", "one", 300, { status: "running", needsInput: true }),
      session("still-working", "one", 200, { status: "running" }),
    ];
    await advanceMotionTimers(3_000);
    expect(row(projects[0].cwd).querySelector('[aria-label="Working"]')).toBeNull();
    expect(row(projects[0].cwd).querySelector('[aria-label="Needs input"]')).not.toBeNull();
    act(() => setUiLanguage("zh-CN"));
    expect(row(projects[0].cwd).querySelector(".mobile-home-project-state")?.getAttribute("aria-label")).toBe("需要输入");
    latest = [session("finished", "one", 400, { lastCompletedRunId: "done" })];
    await advanceMotionTimers(3_000);
    expect(row(projects[0].cwd).querySelector(".mobile-home-project-state")).toBeNull();
  });

  it("shows cached project activity while refreshing and preserves it on a failed refresh", async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<HostSessionSummary[]>((_resolve, fail) => { reject = fail; });
    await render({
      projectsPage: true,
      cachedSessions: (id) => id === "one" ? [session("busy", id, 1, { status: "running" })] : [],
      loadSessions: () => pending,
    });
    expect(node.querySelector('.mobile-home-project [aria-label="Working"]')).not.toBeNull();
    await act(async () => reject(new Error("Offline")));
    expect(node.querySelector('.mobile-home-project [aria-label="Working"]')).not.toBeNull();
  });

  it("renders cached activity order before refresh, preserves it on failure and restores it on remount", async () => {
    const cache = new Map([
      ["one", [session("older", "one", 10), session("pin", "one", 1, { pinned: true })]],
      ["two", [session("latest", "two", 100)]],
    ]);
    const cachedSessions = (id: string) => cache.get(id);
    let reject!: (reason: Error) => void;
    const pending = new Promise<HostSessionSummary[]>((_resolve, fail) => { reject = fail; });
    const loadSessions = vi.fn(() => pending);
    const props = { cachedSessions, loadSessions };
    await render(props);
    expect(ids(".mobile-home")).toEqual(["pin", "latest", "older"]);
    expect(node.querySelector('.mobile-list-skeleton[role="status"]')).toBeNull();
    await act(async () => reject(new Error("Offline")));
    expect(ids(".mobile-home")).toEqual(["pin", "latest", "older"]);
    expect(node.querySelector('[role="alert"]')).not.toBeNull();
    act(() => root.render(null));
    await render({ ...props, projectsPage: true, loadSessions: () => new Promise(() => {}) });
    const paths = () => [...node.querySelectorAll('.mobile-home-project[title]')].map(row => row.getAttribute('title'));
    expect(paths()).toEqual([projects[1].cwd, projects[0].cwd]);
    expect(ids(".mobile-home")).toEqual([]);
  });

  it("fills newly arriving projects from cache without replacing newer live history", async () => {
    const cachedSessions = (id: string) => id === "one"
      ? [session("stale", id, 1)] : [session("cached", id, 50)];
    const loadSessions = (id: string) => id === "one"
      ? Promise.resolve([session("live", id, 100)])
      : new Promise<HostSessionSummary[]>(() => {});
    await render({ projects: [projects[0]], cachedSessions, loadSessions });
    await render({ cachedSessions, loadSessions });
    expect(ids(".mobile-home-recent")).toEqual(["live", "cached"]);
    expect(node.querySelector('.mobile-list-skeleton[role="status"]')).toBeNull();
  });

  it("holds uncached projects in loading state until their first histories arrive", async () => {
    let resolve!: (sessions: HostSessionSummary[]) => void;
    const pending = new Promise<HostSessionSummary[]>((done) => { resolve = done; });
    await render({ projectsPage: true, loadSessions: () => pending });
    expect(node.querySelectorAll('.mobile-home-project[title]')).toHaveLength(0);
    expect(node.querySelector('.mobile-home-projects [role="status"]')).not.toBeNull();
    expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading conversations…");
    act(() => setUiLanguage("zh-CN"));
    expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("正在加载对话…");
    await act(async () => resolve([]));
    expect(node.querySelectorAll('.mobile-home-project[title]')).toHaveLength(2);
    expect(node.querySelector('.mobile-list-skeleton[role="status"]')).toBeNull();
  });

  it("sorts projects by their newest visible conversation and refreshes the order", async () => {
    const owners = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index}`, name: `Project ${index}`, cwd: `/p${index}`,
    }));
    let latest = 20;
    let failed = false;
    const loadSessions = async (id: string) => {
      if (id === "p6") {
        if (failed) throw new Error("Offline");
        return [session("pinned", id, 1, { pinned: true }), session("latest", id, latest)];
      }
      if (id === "p0") return [];
      return [session(id, id, Number(id.slice(1))), session(`archived-${id}`, id, 1000, { archived: true })];
    };
    await render({ projects: owners, projectsPage: true, loadSessions });
    const paths = () => [...node.querySelectorAll('.mobile-home-project[title]')].map(row => row.getAttribute('title'));
    expect(paths()).toEqual(["/p6", "/p5", "/p4", "/p3", "/p2", "/p1", "/p0"]);
    expect(node.querySelector(".mobile-home-projects .mobile-list-more")).toBeNull();
    latest = 2;
    await advanceMotionTimers(3000);
    expect(paths()).toEqual(["/p5", "/p4", "/p3", "/p2", "/p6", "/p1", "/p0"]);
    failed = true;
    await advanceMotionTimers(3000);
    expect(paths()).toEqual(["/p5", "/p4", "/p3", "/p2", "/p6", "/p1", "/p0"]);
    expect(owners.map(item => item.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("opens a held conversation menu without navigating, then accepts a fresh tap", async () => {
    const onSession = vi.fn(), onSessionActions = vi.fn();
    await render({ onSession, onSessionActions });
    const row = node.querySelector<HTMLButtonElement>('[data-session-id="new"]')!;
    const touch = (type: string, x = 80) => act(() => row.dispatchEvent(new PointerEvent(type, {
      bubbles: true, button: 0, pointerId: 1, pointerType: "touch", clientX: x, clientY: 200,
    })));
    touch("pointerdown");
    await advanceMotionTimers(450);
    expect(onSessionActions).toHaveBeenCalledWith(expect.objectContaining({ id: "new", projectId: "two" }), row, { x: 80, y: 200 });
    expect(lightImpact).toHaveBeenCalledOnce();
    touch("pointerup");
    act(() => row.click());
    expect(onSession).not.toHaveBeenCalled();
    expect(lightImpact).toHaveBeenCalledOnce();
    touch("pointerdown"); touch("pointerup");
    act(() => row.click());
    expect(onSession).toHaveBeenCalledWith("new", projects[1]);
    onSession.mockClear(); onSessionActions.mockClear();
    touch("pointerdown"); touch("pointermove", 110);
    await advanceMotionTimers(500);
    touch("pointerup", 110); act(() => row.click());
    expect(onSessionActions).not.toHaveBeenCalled();
    expect(onSession).not.toHaveBeenCalled();
    touch("pointerdown"); touch("pointercancel");
    await advanceMotionTimers(500);
    expect(onSessionActions).not.toHaveBeenCalled();
    touch("pointerdown");
    await render({ inactive: true, onSession, onSessionActions });
    await advanceMotionTimers(500);
    expect(onSessionActions).not.toHaveBeenCalled();
  });

  it("opens pinned and project conversation actions by right click or keyboard", async () => {
    const onSession = vi.fn(), onSessionActions = vi.fn();
    await render({ onSession, onSessionActions });
    const row = node.querySelector<HTMLButtonElement>('[data-session-id="pin"]')!;
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 100 })));
    expect(onSessionActions).toHaveBeenCalledWith(expect.objectContaining({ id: "pin", pinned: true }), row, { x: 60, y: 100 });
    await render({ project: projects[0], onSession, onSessionActions });
    const projectRow = node.querySelector<HTMLButtonElement>('[data-session-id="old"]')!;
    act(() => projectRow.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true })));
    expect(onSessionActions).toHaveBeenLastCalledWith(expect.objectContaining({ id: "old" }), projectRow);
    expect(onSession).not.toHaveBeenCalled();
  });

  it("reveals only five more conversations per click", async () => {
    const loadSessions = async (id: string) => id === "one"
      ? Array.from({ length: 46 }, (_, i) => session(`recent-${i}`, id, 100 - i))
      : [];
    await render({ loadSessions });
    const more = (area: string) => node.querySelector<HTMLButtonElement>(`${area} .mobile-list-more`)!;
    expect(ids(".mobile-home-recent")).toHaveLength(20);
    for (const count of [25, 30, 35, 40, 45, 46]) {
      act(() => more(".mobile-home-recent").click());
      expect(ids(".mobile-home-recent")).toHaveLength(count);
    }
    expect(more(".mobile-home-recent").textContent).toBe("Show less");
    act(() => more(".mobile-home-recent").click());
    await advanceMotionTimers(350);
    expect(ids(".mobile-home-recent")).toHaveLength(20);
    expect(more(".mobile-home-recent").textContent).toBe("Show more items");
  });

  it("filters Home by conversation status and keeps archived rows separate", async () => {
    const loadSessions = async (id: string) => id === "one"
      ? [
          session("running", id, 40, { status: "running" }),
          session("asking", id, 30, { needsInput: true }),
          session("done", id, 20, { lastCompletedRunId: "run" }),
          session("stored", id, 50, { archived: true }),
        ]
      : [];
    await render({ loadSessions });
    expect(ids(".mobile-home-recent")).toEqual(["running", "asking", "done"]);
    const trigger = node.querySelector<HTMLButtonElement>(".mobile-home-filter")!;
    const choose = async (label: string) => {
      act(() => trigger.click());
      const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((item) => item.textContent === label)!;
      act(() => option.click());
      await advanceMotionTimers(400);
    };
    await choose("Working");
    expect(trigger.textContent).toBe("Working");
    expect(ids(".mobile-home-recent")).toEqual(["running"]);
    await choose("Needs input");
    expect(ids(".mobile-home-recent")).toEqual(["asking"]);
    await choose("Completed");
    expect(ids(".mobile-home-recent")).toEqual(["done"]);
    await choose("Archived");
    expect(ids(".mobile-home-recent")).toEqual(["stored"]);
    await choose("All");
    expect(ids(".mobile-home-recent")).toEqual(["running", "asking", "done"]);
    await render({ project: projects[0], loadSessions });
    expect(node.querySelector(".mobile-home-filter")).toBeNull();
  });

  it("lists each conversation as a plain row with its title and state or age", async () => {
    const loadSessions = async (id: string) => id === "one"
      ? [
          session("busy", id, 40, { status: "running" }),
          session("asking", id, 30, { status: "running", needsInput: true }),
          session("idle", id, 20, { pinned: true }),
        ]
      : [];
    await render({ loadSessions });
    const row = (id: string) => node.querySelector(`[data-session-id="${id}"]`)!;
    expect(row("busy").querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(row("asking").querySelector('[aria-label="Needs input"]')).not.toBeNull();
    expect(row("asking").querySelector('[aria-label="Working"]')).toBeNull();
    expect(row("asking").getAttribute("data-state")).toBe("input");
    expect(row("idle").querySelector("strong")?.textContent).toBe("idle");
    expect(row("idle").querySelector("time")).not.toBeNull();
    expect(row("idle").querySelector('[aria-label="Pinned"]')).not.toBeNull();
    expect(node.querySelector(".mobile-session-card")).toBeNull();
  });

  it("searches beyond the twenty-row recent preview and resets expansion for a new project", async () => {
    const loadSessions = async (id: string) => Array.from({ length: 25 }, (_, i) => session(`${id}-${i}`, id, 100 - i));
    await render({ project: projects[0], loadSessions });
    act(() => node.querySelector<HTMLButtonElement>(".mobile-list-more")!.click());
    expect(ids(".mobile-home-recent")).toHaveLength(25);
    await render({ project: projects[1], loadSessions });
    expect(ids(".mobile-home-recent")).toHaveLength(20);
    await render({ project: projects[1], query: "two-24", loadSessions });
    expect(ids(".mobile-home-recent")).toEqual(["two-24"]);
    expect(node.querySelector(".mobile-list-more")).toBeNull();
  });

  it("combines project history by activity, pins first, and opens the actual owning project", async () => {
    const onSession = vi.fn();
    const onProject = vi.fn();
    await render({ onSession, onProject });
    expect(ids(".mobile-home")).toEqual(["pin", "new", "old"]);
    expect(node.textContent).not.toContain("archive");
    expect(node.querySelector(".mobile-home-projects")).toBeNull();
    act(() =>
      node.querySelector<HTMLButtonElement>('[data-session-id="new"]')!.click(),
    );
    expect(onSession).toHaveBeenCalledExactlyOnceWith("new", projects[1]);
    await render({ onSession, onProject, projectsPage: true });
    act(() =>
      node
        .querySelector<HTMLButtonElement>(
          '.mobile-home-project[title="/other/monocode"]',
        )!
        .click(),
    );
    expect(onProject).toHaveBeenCalledExactlyOnceWith(projects[1]);
  });

  it("splits Home into projects, collapsible pins and recents, and shows only rows when filtered", async () => {
    await render({});
    expect(ids(".mobile-home-pinned")).toEqual(["pin"]);
    expect(ids(".mobile-home-recent")).toEqual(["new", "old"]);
    const projectRows = node.querySelectorAll(".mobile-home-overview-projects .mobile-home-project");
    expect(projectRows).toHaveLength(2);
    expect(projectRows[0].querySelector("small")).toBeNull();
    const toggle = node.querySelector<HTMLButtonElement>(".mobile-home-pinned .mobile-home-section-toggle")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await advanceMotionTimers(400);
    expect(ids(".mobile-home-pinned")).toEqual([]);
    act(() => toggle.click());
    expect(ids(".mobile-home-pinned")).toEqual(["pin"]);
    await render({ query: "o" });
    await advanceMotionTimers(400);
    expect(node.querySelector(".mobile-home-overview-projects")).toBeNull();
    expect(node.querySelector(".mobile-home-pinned")).toBeNull();
    expect(ids(".mobile-home-recent")).toEqual(["pin", "new", "old"]);
  });

  it("collapses projects in both directions and keeps activity visible and refreshed while closed", async () => {
    let history = [
      session("asking", "one", 30, { status: "running", needsInput: true }),
      session("working", "one", 20, { status: "running" }),
    ];
    const loadSessions = async (id: string) => id === "one" ? history : [];
    await render({ loadSessions });
    const section = node.querySelector(".mobile-home-overview-projects")!;
    const toggle = section.querySelector<HTMLButtonElement>(".mobile-home-section-toggle")!;
    const project = section.querySelector('.mobile-home-project[title="/projects/monocode"]')!;
    expect(project.querySelector('[aria-label="Needs input"]')).not.toBeNull();
    expect(project.querySelector('[aria-label="Working"] .mobile-spin')).not.toBeNull();
    act(() => toggle.click());
    expect(section.querySelector('[data-fold-state="closing"][inert]')).not.toBeNull();
    expect(section.querySelectorAll(".mobile-home-project")).toHaveLength(2);
    // Reversing a close keeps the same content mounted and interactive again.
    await advanceMotionTimers(100);
    act(() => toggle.click());
    expect(section.querySelector('[data-fold-state="opening"]')).not.toBeNull();
    expect(section.querySelector('[data-fold-state="opening"]')?.hasAttribute("inert")).toBe(false);
    await advanceMotionTimers(400);
    act(() => toggle.click());
    await advanceMotionTimers(400);
    expect(section.querySelector(".mobile-home-project")).toBeNull();
    expect(toggle.querySelector('[aria-label="Needs input"]')).not.toBeNull();
    expect(toggle.querySelector('[aria-label="Working"] .mobile-spin')).not.toBeNull();
    history = [session("finished", "one", 40),
      session("archived-work", "one", 50, { archived: true, status: "running" })];
    await advanceMotionTimers(3_000);
    expect(toggle.querySelector(".mobile-home-project-activity")).toBeNull();
    act(() => toggle.click());
    expect(section.querySelector('[data-fold-state="opening"]')).not.toBeNull();
    expect(section.querySelectorAll(".mobile-home-project")).toHaveLength(2);
  });

  it.each([false, true])("shows and searches remote projects when the active device has none (offline: %s)", async (offline) => {
    const props = {
      projects: [],
      projectsUnavailable: offline,
      unavailable: createElement("p", {}, "Couldn’t connect"),
      remote: [{ endpoint: "http://b", name: "Laptop", failed: false,
        projects: [{ id: "remote", name: "Remote project", cwd: "/remote" }],
        sessions: [session("remote-conversation", "remote", 60)] }],
    };
    await render(props);
    expect(node.querySelectorAll(".mobile-home-overview-projects .mobile-home-project")).toHaveLength(1);
    expect(ids(".mobile-home-recent")).toEqual(["remote-conversation"]);
    expect(node.textContent).not.toContain("Couldn’t connect");
    expect(node.querySelector(".mobile-home-add")).toBeNull();
    await render({ ...props, query: "remote-conversation" });
    expect(ids(".mobile-home-recent")).toEqual(["remote-conversation"]);
  });

  it("lists other devices' conversations and projects with their device and opens them there", async () => {
    const onRemoteSession = vi.fn();
    const onRemoteProject = vi.fn();
    const onSessionActions = vi.fn();
    const remoteProject = { id: "one", name: "remote-app", cwd: "/srv/app" };
    const remote = [{
      endpoint: "http://b", name: "Laptop", failed: false,
      projects: [remoteProject],
      // The same id as a local conversation must stay a separate row.
      sessions: [session("new", "one", 60), session("far", "one", 55)],
    }];
    await render({ remote, onRemoteSession, onRemoteProject, onSessionActions });
    const rows = [...node.querySelectorAll<HTMLButtonElement>(".mobile-home-recent [data-session-id]")];
    expect(rows.map((row) => row.getAttribute("data-session-id"))).toEqual(["new", "far", "new", "old"]);
    expect(rows[1].querySelector(".mobile-home-session-host")?.textContent).toBe("Laptop");
    expect(rows[2].querySelector(".mobile-home-session-host")).toBeNull();
    act(() => rows[1].click());
    expect(onRemoteSession).toHaveBeenCalledExactlyOnceWith("http://b", "far", remoteProject);
    act(() => { rows[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    expect(onSessionActions).not.toHaveBeenCalled();
    const project = [...node.querySelectorAll<HTMLButtonElement>(".mobile-home-overview-projects .mobile-home-project")]
      .find((item) => item.textContent?.includes("Laptop"))!;
    act(() => project.click());
    expect(onRemoteProject).toHaveBeenCalledExactlyOnceWith("http://b", remoteProject);
  });

  it("filters a single project using the header query and restores rows when cleared", async () => {
    const loadSessions = vi.fn(defaults.loadSessions);
    await render({ project: projects[0], query: "old", loadSessions });
    expect(loadSessions).toHaveBeenCalledExactlyOnceWith("one");
    expect(node.querySelector(".mobile-home-projects")).toBeNull();
    expect(node.querySelector("input")).toBeNull();
    expect(ids(".mobile-home")).toEqual(["old"]);
    await render({ project: projects[0], loadSessions });
    expect(ids(".mobile-home")).toEqual(["pin", "old"]);
  });

  it("keeps successful projects usable when another fails and retries without erasing their rows", async () => {
    let failed = true;
    const loadSessions = vi.fn(async (id: string) => {
      if (id === "two" && failed) throw new Error("Offline");
      return defaults.loadSessions(id);
    });
    await render({ loadSessions });
    expect(ids(".mobile-home")).toEqual(["pin", "old"]);
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn’t load sessions",
    );
    failed = false;
    await act(async () =>
      node.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(ids(".mobile-home")).toEqual(["pin", "new", "old"]);
  });

  it("ignores a late result from the project left behind", async () => {
    let resolve!: (value: HostSessionSummary[]) => void;
    const pending = new Promise<HostSessionSummary[]>((done) => {
      resolve = done;
    });
    const loadSessions = vi.fn((id: string) =>
      id === "one" ? pending : defaults.loadSessions(id),
    );
    await render({ project: projects[0], loadSessions });
    expect(node.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading conversations…");
    await render({ project: projects[1], loadSessions });
    await act(async () => resolve([session("stale", "one", 200)]));
    expect(ids(".mobile-home-recent")).toEqual(["new"]);
    expect(node.textContent).not.toContain("stale");
  });

  it("pauses history polling in the background and translates labels while preserving user names", async () => {
    const loadSessions = vi.fn(defaults.loadSessions);
    await render({ loadSessions });
    await render({ loadSessions, foreground: false });
    await advanceMotionTimers(10_000);
    expect(loadSessions).toHaveBeenCalledTimes(2);
    act(() => setUiLanguage("zh-CN"));
    expect(node.textContent).toContain("最近");
    expect(node.textContent).not.toContain("Computer");
  });

  it("uses the drawer's newest cached history before its resumed request finishes", async () => {
    const cache = new Map([["one", [session("old", "one", 1)]], ["two", [] as HostSessionSummary[]]]);
    const cachedSessions = (id: string) => cache.get(id);
    const loadSessions = vi.fn(async (id: string) => cache.get(id)!);
    await render({ cachedSessions, loadSessions });
    await render({ cachedSessions, loadSessions, foreground: false });
    cache.set("one", [session("new", "one", 2)]);
    loadSessions.mockImplementation(() => new Promise(() => {}));
    await render({ cachedSessions, loadSessions });
    expect(ids(".mobile-home-recent")).toEqual(["new"]);
  });
});

it("pauses list refresh while the retained page is hidden", async () => {
  const loadSessions = vi.fn(defaults.loadSessions);
  const render = (visible: boolean) => act(() => root.render(
    createElement(SurfaceVisibilityContext.Provider, { value: visible },
      createElement(MobileHome, { ...defaults, loadSessions })),
  ));
  render(true);
  await act(async () => {});
  expect(loadSessions).toHaveBeenCalledTimes(2);
  render(false);
  loadSessions.mockClear();
  await advanceMotionTimers(6000);
  expect(loadSessions).not.toHaveBeenCalled();
  render(true);
  await act(async () => {});
  expect(loadSessions).toHaveBeenCalledTimes(2);
});

it("does not clear the next page's search anchor when the retained chats page exits", () => {
  const searchTrigger = createRef<HTMLButtonElement>();
  const previous = createElement(MobileHome, { ...defaults, key: "previous", foreground: false,
    chatsPage: true, searchTrigger });
  const next = createElement("button", { key: "next", ref: searchTrigger, "data-next-search": true }, "Search");
  act(() => root.render(createElement(Fragment, null, previous)));
  expect(searchTrigger.current?.className).toBe("mobile-home-search");
  act(() => root.render(createElement(Fragment, null, next, previous)));
  const anchor = node.querySelector<HTMLButtonElement>("[data-next-search]");
  expect(searchTrigger.current).toBe(anchor);
  act(() => root.render(createElement(Fragment, null, next)));
  expect(searchTrigger.current).toBe(anchor);
});

describe("projectless chats", () => {
  const chat: HostProject = {
    id: "chat",
    name: "chat-101010-aaaaaa",
    cwd: "/home/me/Documents/ohmymonocode/2026-10-11/chat-101010-aaaaaa",
  };
  const loadSessions = async (id: string) =>
    id === "chat" ? [session("chatting", id, 60)] : [session("work", id, 50)];

  it("lists Chats first among projects instead of each chat folder and keeps chats in recents", async () => {
    const onChats = vi.fn();
    await render({ projects: [projects[0], chat], loadSessions, onChats });
    const rows = [...node.querySelectorAll(".mobile-home-overview-projects .mobile-home-project")];
    expect(rows.map((row) => row.textContent)).toEqual(["Chats", "monocode"]);
    expect(ids(".mobile-home-recent")).toEqual(["chatting", "work"]);
    act(() => (rows[0] as HTMLButtonElement).click());
    expect(onChats).toHaveBeenCalledOnce();
  });

  it("shows only chat conversations on the chats page with search and a new chat action", async () => {
    const onNewChat = vi.fn();
    await render({ projects: [projects[0], chat], loadSessions, chatsPage: true, onNewChat });
    expect(ids(".mobile-home-recent")).toEqual(["chatting"]);
    expect(node.querySelector(".mobile-home-search")?.textContent).toBe("Search chats");
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click());
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(defaults.onNewSession).not.toHaveBeenCalled();
  });
});
