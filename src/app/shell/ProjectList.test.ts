import { completeMotionAnimation } from "../../../tests/helpers/motionDriver";
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList";
import {
  configureSharedHost,
  rememberRemoteProject,
  remoteProjectFor,
  sessionUsesHost,
} from "../../features/connections/model/remoteProjects";
import {
  useRemoteMachineOnline,
  useRemoteMachines,
} from "../../features/connections/model/connections";
import { useProjectDiffStats } from "../../features/source-control/hooks/useProjectDiffStats";
import {
  saveProjectGroups,
  setProjectGroupAssignment,
} from "../../features/projects/model/projectGroups";
import {
  loadPinnedProjects,
  loadProjectRailOrder,
  savePinnedProjects,
  saveProjectRailOrder,
} from "../../features/projects/model/recents";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import {
  loadSidebarSectionOrder,
  saveSidebarSectionOrder,
} from "../../features/settings/model/sidebarSectionOrder";

const { reorderPointerDown, reorderState } = vi.hoisted(() => ({
  reorderPointerDown: vi.fn(),
  reorderState: { draggingId: null as string | null, consumeClick: false },
}));
vi.mock("../../shared/hooks/useAnimatedReorder", () => ({
  useAnimatedReorder: vi.fn((ids: string[]) => ({
    draggingId: ids.includes(reorderState.draggingId ?? "")
      ? reorderState.draggingId
      : null,
    setItemRef: vi.fn(),
    onItemPointerDown: reorderPointerDown,
    consumeClick: () => reorderState.consumeClick,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));
vi.mock(
  "../../features/connections/model/connections",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../features/connections/model/connections")
    >()),
    useRemoteMachines: vi.fn(),
    useRemoteMachineOnline: vi.fn(),
  }),
);

const machine = {
  id: "computer",
  environmentId: "environment",
  name: "wy-ubuntu",
  endpoint: "http://127.0.0.1:3774",
};
const project = { id: "project", cwd: "/home/me/repo", name: "repo" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  configureSharedHost(undefined, []);
  reorderPointerDown.mockClear();
  vi.mocked(useAnimatedReorder).mockClear();
  reorderState.draggingId = null;
  reorderState.consumeClick = false;
  vi.mocked(useProjectDiffStats).mockClear();
  vi.mocked(useRemoteMachines)
    .mockReset()
    .mockReturnValue({ machines: [machine], loaded: true });
  vi.mocked(useRemoteMachineOnline).mockReset().mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  configureSharedHost(undefined, []);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderRail(path: string) {
  await act(async () =>
    root.render(
      createElement(ProjectList, {
        cwd: path,
        recents: [{ path, openedAt: 1 }],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
}

it("filters visible project trees without pruning pins or persisted project order", async () => {
  const paths = ["/work/alpha", "/work/beta"];
  savePinnedProjects([paths[0]]);
  saveProjectRailOrder(paths);
  await act(async () => root.render(createElement(ProjectList, {
    cwd: paths[0], recents: paths.map((path) => ({ path, openedAt: 1 })),
    visibleProjectPaths: new Set(), showProjectSections: false,
    onSelectProject: vi.fn(), onOpenProject: vi.fn(),
  })));
  expect(container.querySelector("[data-project-select]")).toBeNull();
  expect(loadPinnedProjects()).toEqual([paths[0]]);
  expect(loadProjectRailOrder()).toEqual(paths);
});

it.each([true, false])(
  "shows a local folder without remote decoration (registered: %s)",
  async (registered) => {
    configureSharedHost(
      machine.environmentId,
      registered ? [project] : [],
      machine.id,
    );
    await renderRail(project.cwd);

    const card = container.querySelector<HTMLButtonElement>(
      'button[aria-current="true"]',
    )!;
    expect(card).not.toBeNull();
    expect(card.textContent).toBe("repo");
    expect(card.hasAttribute("title")).toBe(false);
    expect(card.getAttribute("aria-description")).toContain(project.cwd);
    expect(card.querySelector('[role="img"]')).toBeNull();
    expect(useRemoteMachines).toHaveBeenCalledWith(false);
    expect(useRemoteMachineOnline).toHaveBeenCalledWith(undefined);
    expect(remoteProjectFor(project.cwd)).toMatchObject({ local: true });
    expect(sessionUsesHost({ cwd: project.cwd })).toBe(true);
  },
);

it("keeps the machine label and connection badge for a remote path", async () => {
  const remote = rememberRemoteProject(machine.environmentId, project);
  await renderRail(remote.key);

  const card = container.querySelector<HTMLButtonElement>(
    'button[aria-current="true"]',
  )!;
  expect(card.textContent).toBe("repowy-ubuntu");
  expect(card.hasAttribute("title")).toBe(false);
  expect(card.getAttribute("aria-description")).toContain(`${project.cwd}`);
  expect(
    card.querySelector('[role="img"][aria-label="Connected"]'),
  ).not.toBeNull();
  expect(useRemoteMachines).toHaveBeenCalledWith(true);
  expect(useRemoteMachineOnline).toHaveBeenCalledWith(machine.id);
});

it("keeps the connection badge for a remote path whose machine is unavailable", async () => {
  vi.mocked(useRemoteMachines).mockReturnValue({ machines: [], loaded: true });
  const remote = rememberRemoteProject(machine.environmentId, project);
  await renderRail(remote.key);

  expect(
    container.querySelector(
      '[role="img"][aria-label="Machine not connected on this computer"]',
    ),
  ).not.toBeNull();
});

async function renderTree(
  overrides: Partial<ComponentProps<typeof ProjectList>> = {},
) {
  const props: ComponentProps<typeof ProjectList> = {
    cwd: "/work/alpha",
    recents: [
      { path: "/work/alpha", openedAt: 3 },
      { path: "/work/beta", openedAt: 2 },
      { path: "/work/gamma", openedAt: 1 },
    ],
    expandedPaths: new Set(["/work/alpha", "/work/beta"]),
    onSelectProject: vi.fn(),
    onToggleProject: vi.fn(),
    onNewInProject: vi.fn(),
    onOpenProject: vi.fn(),
    renderProjectChildren: (path) =>
      createElement("button", { "data-session": path }, `Session in ${path}`),
    ...overrides,
  };
  await act(async () => root.render(createElement(ProjectList, props)));
  return props;
}

it("shows names for every project and independent children for multiple expanded projects", async () => {
  await renderTree({
    needsApprovalPaths: ["/work/beta/"],
    busyPaths: ["/work/alpha"],
  });
  expect(container.querySelector('[data-project-list="tree"]')).not.toBeNull();
  expect(container.querySelectorAll("[data-project-header]")).toHaveLength(3);
  expect(container.querySelectorAll("[data-project-children]")).toHaveLength(2);
  expect(
    container.querySelector('[data-project-children="/work/gamma"]'),
  ).toBeNull();
  expect(
    container.querySelectorAll(
      '[aria-expanded="true"][title="Collapse project"]',
    ),
  ).toHaveLength(2);
  expect(
    container.querySelector(
      '[data-project-path="/work/beta"] [aria-label="Needs approval"]',
    ),
  ).not.toBeNull();
  expect(
    container.querySelector('[data-project-path="/work/alpha"] button[title]')
      ?.title,
  ).toBe("Collapse project");
  expect(useProjectDiffStats).toHaveBeenCalledWith("/work/alpha", true);
  expect(useProjectDiffStats).toHaveBeenCalledWith("/work/beta", false);
  expect(useProjectDiffStats).toHaveBeenCalledWith("/work/gamma", false);
});

it("keeps expand, select, new session and child actions independent", async () => {
  const childClick = vi.fn();
  const props = await renderTree({
    renderProjectChildren: (path) =>
      createElement(
        "button",
        { "data-session": path, onClick: childClick },
        "A session",
      ),
  });
  const beta = container.querySelector('[data-project-path="/work/beta"]')!;
  act(() => {
    beta
      .querySelector<HTMLButtonElement>('button[title="Collapse project"]')!
      .click();
    beta
      .querySelector<HTMLButtonElement>(
        'button[data-project-select="/work/beta"]',
      )!
      .click();
    beta
      .querySelector<HTMLButtonElement>('button[title="New session in beta"]')!
      .click();
    const child = beta.querySelector<HTMLButtonElement>("[data-session]")!;
    child.click();
    child.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    child.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  expect(props.onToggleProject).toHaveBeenCalledExactlyOnceWith("/work/beta");
  expect(props.onSelectProject).toHaveBeenCalledExactlyOnceWith("/work/beta");
  expect(props.onNewInProject).toHaveBeenCalledExactlyOnceWith("/work/beta");
  expect(childClick).toHaveBeenCalledOnce();
  expect(reorderPointerDown).not.toHaveBeenCalled();
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(
    document.querySelector('[role="menu"][aria-label="Project options"]'),
  ).toBeNull();
  act(() =>
    beta
      .querySelector("[data-project-header]")!
      .dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
  );
  expect(reorderPointerDown).toHaveBeenCalledExactlyOnceWith(
    "/work/beta",
    expect.objectContaining({ type: "pointerdown" }),
    expect.objectContaining({ onDrop: expect.any(Function) }),
  );
});

it.each([false, true])(
  "lets unpinned project headers start a reorder (grouped: %s)",
  async (grouped) => {
    if (grouped) {
      saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
      setProjectGroupAssignment("/work/beta", "team");
    }
    await renderTree();
    const header = projectNameButton("/work/beta").closest<HTMLElement>(
      "[data-project-header]",
    )!;
    act(() =>
      header.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    expect(reorderPointerDown).toHaveBeenCalledExactlyOnceWith(
      "/work/beta",
      expect.objectContaining({ type: "pointerdown" }),
      expect.objectContaining({ onDrop: expect.any(Function) }),
    );
    const call = vi.mocked(useAnimatedReorder).mock.calls.find(([ids]) =>
      ids.includes("/work/beta"),
    )!;
    expect(call[2]).toBe("y");
    expect(call[4]?.activationDistance).toBe(3);
    Object.defineProperty(header, "offsetHeight", { value: 32 });
    expect(call[4]?.collapsedSize?.("/work/beta", header.parentElement!)).toBe(32);
  },
);

it("temporarily folds only the dragged project's children and animates them back", async () => {
  const props = await renderTree();
  reorderState.draggingId = "/work/beta";
  await renderTree(props);
  const beta = container.querySelector('[data-project-path="/work/beta"]')!;
  const fold = beta.querySelector<HTMLElement>(".zen-fold-item")!;
  expect(fold.dataset.foldState).toBe("closing");
  expect(fold.inert).toBe(true);
  expect(fold.getAttribute("aria-hidden")).toBe("true");
  expect(beta.querySelector('[aria-expanded="true"]')).not.toBeNull();
  expect(
    container.querySelector<HTMLElement>(
      '[data-project-path="/work/alpha"] .zen-fold-item',
    )?.dataset.foldState,
  ).toBe("open");
  act(() => completeMotionAnimation(fold));
  const retained = beta.querySelector("[data-project-children]");
  expect(retained).not.toBeNull();
  expect(fold.hidden).toBe(true);

  reorderState.draggingId = null;
  await renderTree(props);
  const reopening = beta.querySelector<HTMLElement>(".zen-fold-item")!;
  expect(reopening.dataset.foldState).toBe("opening");
  expect(reopening.inert).toBe(false);
  expect(beta.querySelector("[data-project-children]")).toBe(retained);
  expect(reopening.hidden).toBe(false);
  expect(props.onToggleProject).not.toHaveBeenCalled();
});

it("persists each project subset without moving pins, other groups or chats", async () => {
  const paths = [
    "/work/alpha",
    "/work/beta",
    "/work/gamma",
    "/work/delta",
    "/work/epsilon",
  ];
  saveProjectRailOrder(paths);
  savePinnedProjects([paths[0]]);
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  setProjectGroupAssignment(paths[1], "team");
  setProjectGroupAssignment(paths[3], "team");
  await renderTree({
    recents: paths.map((path, index) => ({ path, openedAt: 5 - index })),
    chatEntries: [{ id: "session", content: "Chat conversation" }],
  });
  const reorder = (subset: string[]) => {
    const call = vi.mocked(useAnimatedReorder).mock.calls.find(([ids]) =>
      ids.includes(subset[0]),
    )!;
    vi.mocked(useAnimatedReorder).mockClear();
    act(() => call[1](subset));
  };
  reorder([paths[3], paths[1]]);
  expect(loadProjectRailOrder()).toEqual([
    paths[0],
    paths[3],
    paths[2],
    paths[1],
    paths[4],
  ]);
  reorder([paths[4], paths[2]]);
  expect(loadProjectRailOrder()).toEqual([
    paths[0],
    paths[3],
    paths[4],
    paths[1],
    paths[2],
  ]);
  expect(container.querySelector("[data-chat-project]")?.textContent).toContain("Chat conversation");
  expect(loadPinnedProjects()).toEqual([paths[0]]);
});

it("keeps unavailable project disclosures aligned while their names remain selectable", async () => {
  const props = await renderTree({
    canExpandProject: (path) => path === "/work/alpha",
  });
  const alpha = container.querySelector('[data-project-path="/work/alpha"]')!;
  const beta = container.querySelector('[data-project-path="/work/beta"]')!;
  expect(alpha.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  expect(beta.querySelector("button[aria-expanded]")).toBeNull();
  // The avatar keeps the disclosure slot's width, so names stay aligned.
  expect(
    beta
      .querySelector("[data-project-header] > span[data-project-avatar]")
      ?.classList.contains("w-4"),
  ).toBe(true);
  expect(
    alpha
      .querySelector('button[aria-expanded="true"]')
      ?.querySelector("[data-project-avatar]"),
  ).not.toBeNull();
  expect(beta.querySelector("[data-project-children]")).toBeNull();
  act(() =>
    beta
      .querySelector<HTMLButtonElement>(
        'button[data-project-select="/work/beta"]',
      )!
      .click(),
  );
  expect(props.onSelectProject).toHaveBeenCalledExactlyOnceWith("/work/beta");
  expect(props.onToggleProject).not.toHaveBeenCalled();
});

it("reveals matching projects in collapsed groups only for the duration of search", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: true }]);
  setProjectGroupAssignment("/work/beta", "team");
  await renderTree();
  expect(
    container.querySelector('[data-project-path="/work/beta"]'),
  ).toBeNull();
  await renderTree({
    searchActive: true,
    matchedProjectPaths: new Set(["/work/beta"]),
    query: "matching session title",
  });
  expect(
    container.querySelector('[data-project-path="/work/beta"]'),
  ).not.toBeNull();
  expect(
    container.querySelector('[data-project-path="/work/alpha"]'),
  ).toBeNull();
  expect(
    container.querySelector(
      '[data-project-group="team"] button[aria-expanded="true"]',
    ),
  ).not.toBeNull();
  await renderTree();
  const fold = container.querySelector<HTMLElement>(
    '[data-project-group="team"] .zen-fold-item',
  )!;
  expect(fold.dataset.foldState).toBe("closing");
  expect(fold.inert).toBe(true);
  act(() => completeMotionAnimation(fold));
  expect(
    container.querySelector('[data-project-path="/work/beta"]')?.closest("[hidden]"),
  ).toBe(fold);
});

it("distinguishes identically named projects by their accessible path and exposes its scroll container", async () => {
  const scrollRef = { current: null as HTMLDivElement | null };
  await renderTree({
    cwd: "/one/repo",
    recents: [
      { path: "/one/repo", openedAt: 2 },
      { path: "/two/repo", openedAt: 1 },
    ],
    expandedPaths: new Set(),
    scrollRef,
    scrollable: false,
  });
  expect(
    container.querySelector(
      'button[data-project-select="/one/repo"][aria-description="/one/repo"]',
    ),
  ).not.toBeNull();
  expect(
    container.querySelector(
      'button[data-project-select="/two/repo"][aria-description="/two/repo"]',
    ),
  ).not.toBeNull();
  expect(scrollRef.current).not.toBeNull();
  expect(scrollRef.current!.classList.contains("overflow-y-auto")).toBe(false);
});

function projectNameButton(path: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(
    `[data-project-select="${path}"]`,
  )!;
}

function projectSummary(path: string): HTMLElement | null {
  return document.querySelector(`[data-project-summary="${path}"]`);
}

it("opens a project summary on keyboard focus with complete counts and an accessible full path", async () => {
  const onProjectHoverOpen = vi.fn();
  await renderTree({
    projectSummaries: new Map([
      ["/work/beta", { total: 6, unread: 1, opened: 1, historyState: "ready" }],
    ]),
    onProjectHoverOpen,
  });
  act(() => projectNameButton("/work/beta").focus());
  const summary = projectSummary("/work/beta")!;
  expect(summary).not.toBeNull();
  expect(summary.getAttribute("role")).toBe("dialog");
  expect(summary.textContent).toContain("6 sessions");
  expect(summary.textContent).toContain("1 unread");
  expect(summary.textContent).toContain("1 opened");
  expect(summary.textContent).toContain("/work/beta");
  expect(summary.querySelector('[aria-label="Pin project"]')).not.toBeNull();
  expect(
    summary.querySelector('button[aria-label="Edit project"]'),
  ).not.toBeNull();
  expect(onProjectHoverOpen).toHaveBeenCalledExactlyOnceWith("/work/beta");
  expect(projectNameButton("/work/beta").hasAttribute("title")).toBe(false);
});

it("opens and closes immediately and keeps the summary open while crossing into its actions", async () => {
  const onProjectHoverOpen = vi.fn();
  await renderTree({ onProjectHoverOpen });
  vi.useFakeTimers();
  const header = container.querySelector<HTMLElement>(
    '[data-project-path="/work/beta"] [data-project-header]',
  )!;
  act(() =>
    header.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
      }),
    ),
  );
  const summary = projectSummary("/work/beta")!;
  expect(summary).not.toBeNull();
  expect(onProjectHoverOpen).toHaveBeenCalledExactlyOnceWith("/work/beta");
  act(() =>
    header.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: summary,
      }),
    ),
  );
  act(() =>
    summary.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: header,
      }),
    ),
  );
  expect(projectSummary("/work/beta")).toBe(summary);
  act(() =>
    summary.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: header,
      }),
    ),
  );
  expect(projectSummary("/work/beta")).toBe(summary);
  expect(onProjectHoverOpen).toHaveBeenCalledTimes(1);
  act(() =>
    header.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.body,
      }),
    ),
  );
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
});

it("does not keep a clicked project's summary open once the pointer leaves", async () => {
  await renderTree();
  vi.useFakeTimers();
  const header = container.querySelector<HTMLElement>(
    '[data-project-path="/work/beta"] [data-project-header]',
  )!;
  const nameButton = projectNameButton("/work/beta");
  const pointer = (target: EventTarget, type: string) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType: "mouse", relatedTarget: document.body }),
    );
  act(() => {
    pointer(header, "pointerover");
    pointer(nameButton, "pointerdown");
    nameButton.focus();
    pointer(header, "pointerout");
  });
  expect(document.activeElement).toBe(nameButton);
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  act(() => pointer(header, "pointerover"));
  expect(projectSummary("/work/beta")).not.toBeNull();
  act(() => pointer(header, "pointerout"));
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
});

it("allows Tab into summary actions and edits the original project without activation or disclosure", async () => {
  const props = await renderTree();
  const nameButton = projectNameButton("/work/beta");
  act(() => nameButton.focus());
  act(() =>
    nameButton.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const summary = projectSummary("/work/beta")!;
  expect(summary.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Pin project",
  );
  const edit = summary.querySelector<HTMLButtonElement>(
    '[aria-label="Edit project"]',
  )!;
  act(() => {
    edit.focus();
    edit.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    edit.click();
  });
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Project options"]',
  )!;
  expect(menu).not.toBeNull();
  expect(
    menu.querySelector<HTMLInputElement>('input[aria-label="Group name"]')
      ?.value,
  ).toBe("beta");
  expect(props.onSelectProject).not.toHaveBeenCalled();
  expect(props.onToggleProject).not.toHaveBeenCalled();
  expect(reorderPointerDown).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(projectNameButton("/work/beta"));
});

it("pins a project from its summary without activating it or starting a reorder", async () => {
  const props = await renderTree();
  act(() => projectNameButton("/work/beta").focus());
  const pin = projectSummary("/work/beta")!.querySelector<HTMLButtonElement>(
    '[aria-label="Pin project"]',
  )!;
  act(() => {
    pin.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    pin.click();
  });
  expect(loadPinnedProjects()).toContain("/work/beta");
  expect(props.onSelectProject).not.toHaveBeenCalled();
  expect(props.onToggleProject).not.toHaveBeenCalled();
  expect(reorderPointerDown).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(projectNameButton("/work/beta"));
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
  act(() => {
    projectNameButton("/work/alpha").focus();
    projectNameButton("/work/beta").focus();
  });
  expect(
    projectSummary("/work/beta")?.querySelector('[aria-label="Unpin project"]'),
  ).not.toBeNull();
});

it("shows unavailable history as an error rather than zero and retries through the hover loader", async () => {
  const onProjectHoverOpen = vi.fn();
  await renderTree({
    projectSummaries: new Map([
      ["/work/beta", { unread: 0, opened: 1, historyState: "error" }],
    ]),
    onProjectHoverOpen,
  });
  act(() => projectNameButton("/work/beta").focus());
  const summary = projectSummary("/work/beta")!;
  expect(summary.textContent).toContain("Project summary unavailable");
  expect(summary.textContent).not.toContain("0 sessions");
  act(() =>
    summary
      .querySelector<HTMLButtonElement>('button[aria-label="Retry"]')!
      .click(),
  );
  expect(onProjectHoverOpen).toHaveBeenCalledTimes(2);
});

it("hides Retry for a project whose backend has no available loader", async () => {
  await renderTree({
    projectSummaries: new Map([
      [
        "/work/beta",
        {
          unread: 0,
          opened: 1,
          historyState: "error",
          canRetry: false,
        },
      ],
    ]),
    onProjectHoverOpen: vi.fn(),
  });
  act(() => projectNameButton("/work/beta").focus());
  expect(projectSummary("/work/beta")?.textContent).toContain(
    "Project summary unavailable",
  );
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(
    projectSummary("/work/beta")?.querySelector('button[aria-label="Retry"]'),
  ).toBeNull();
});

it.each(["loading", "error"] as const)(
  "retains cached counts with an explicit note during a project history %s",
  async (historyState) => {
    await renderTree({
      projectSummaries: new Map([
        [
          "/work/beta",
          { total: 6, unread: 1, opened: 2, historyState, cached: true },
        ],
      ]),
    });
    act(() => projectNameButton("/work/beta").focus());
    const summary = projectSummary("/work/beta")!;
    expect(summary.textContent).toContain("6 sessions");
    expect(summary.textContent).toContain("1 unread");
    expect(summary.textContent).toContain("2 opened");
    expect(summary.textContent).toContain("Showing cached summary");
    expect(summary.textContent).toContain(
      historyState === "error"
        ? "Project summary unavailable"
        : "Loading project summary…",
    );
  },
);

it("suppresses pointer-origin focus and hides summaries during project drag", async () => {
  savePinnedProjects(["/work/beta"]);
  const props = await renderTree();
  const beta = projectNameButton("/work/beta");
  act(() => {
    beta.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
    beta.focus();
  });
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
  act(() => {
    beta.blur();
    beta.focus();
  });
  expect(projectSummary("/work/beta")).not.toBeNull();
  reorderState.draggingId = "/work/beta";
  await renderTree(props);
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
  act(() => {
    beta.blur();
    beta.focus();
  });
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
});

it("preserves manual recent project order after a project is reopened", async () => {
  saveProjectRailOrder([
    "/work/gamma", "/work/beta", "/work/alpha",
  ]);
  const props = await renderTree();
  const paths = () => [...container.querySelectorAll<HTMLElement>(
    '[data-project-section="projects"] [data-project-path]',
  )].map((row) => row.dataset.projectPath);
  expect(paths()).toEqual(["/work/gamma", "/work/beta", "/work/alpha"]);
  await renderTree({
    ...props,
    recents: props.recents.map((row) => row.path === "/work/alpha"
      ? { ...row, openedAt: 4 }
      : row),
  });
  expect(paths()).toEqual(["/work/gamma", "/work/beta", "/work/alpha"]);
});

it("supports summary hover for compact project avatars and projects inside groups", async () => {
  saveProjectGroups([{ id: "team", name: "Team" }]);
  setProjectGroupAssignment("/work/beta", "team");
  await renderTree({ compact: true });
  act(() => projectNameButton("/work/beta").focus());
  expect(projectSummary("/work/beta")?.textContent).toContain("/work/beta");
  expect(projectSummary("/work/beta")?.textContent).toContain("Edit project");
});

it("hides the project summary while its menu or a closing project group owns the surface", async () => {
  saveProjectGroups([{ id: "team", name: "Team" }]);
  setProjectGroupAssignment("/work/beta", "team");
  await renderTree();
  act(() => projectNameButton("/work/beta").focus());
  expect(projectSummary("/work/beta")).not.toBeNull();
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-project-path="/work/beta"] button[aria-label="Project options"]',
      )!
      .click(),
  );
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
  expect(
    document.querySelector('[role="menu"][aria-label="Project options"]'),
  ).not.toBeNull();
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    ),
  );
  act(() => projectNameButton("/work/beta").focus());
  // A focus already restored to the name does not re-emit an event; visit it again.
  act(() => {
    projectNameButton("/work/alpha").focus();
    projectNameButton("/work/beta").focus();
  });
  expect(projectSummary("/work/beta")).not.toBeNull();
  act(() => saveProjectGroups([{ id: "team", name: "Team", collapsed: true }]));
  const fold = container.querySelector<HTMLElement>(
    '[data-project-group="team"] .zen-fold-item',
  )!;
  expect(fold.dataset.foldState).toBe("closing");
  expect(projectNameButton("/work/beta")).not.toBeNull();
  act(() => document.querySelectorAll('[data-popover-side][data-fold-state="closing"]').forEach(completeMotionAnimation));
  expect(projectSummary("/work/beta")).toBeNull();
});

it("shows a remote project's host path and machine connection in its summary", async () => {
  const remote = rememberRemoteProject(machine.environmentId, project);
  await renderRail(remote.key);
  act(() => projectNameButton(remote.key).focus());
  const summary = projectSummary(remote.key)!;
  expect(summary.textContent).toContain(project.cwd);
  expect(summary.textContent).toContain("wy-ubuntu");
  expect(summary.textContent).toContain("Connected");
  expect(summary.textContent).not.toContain(remote.key);
});


it("only prepares visible shortcuts from a large history and animates the next page", async () => {
  const prepare = vi.fn((index: number) =>
    createElement(
      "button",
      { "data-history-entry": index },
      `Conversation ${index}`,
    ),
  );
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    id: `entry-${index}`,
    content: () => prepare(index),
  }));
  const props = await renderTree({ chatEntries: entries });
  const prepared = () => [...new Set(prepare.mock.calls.map(([index]) => index))];
  expect(prepared()).toEqual([0, 1, 2, 3, 4]);
  await renderTree({ ...props, expandedPaths: new Set() });
  expect(prepared()).toEqual([0, 1, 2, 3, 4]);
  const chats = container.querySelector("[data-chat-project]")!;
  await act(async () =>
    chats
      .querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!
      .click(),
  );
  expect(prepared()).toEqual(Array.from({ length: 10 }, (_, index) => index));
  expect(
    chats
      .querySelector('[data-history-entry="9"]')
      ?.closest<HTMLElement>(".zen-fold-item")?.dataset.foldState,
  ).toBe("opening");
  await renderTree({
    ...props,
    chatEntries: [entries[1999]],
    searchActive: true,
  });
  expect(container.querySelector('[data-history-entry="1999"]')).not.toBeNull();
});

it("does not let a queued disclosure override an external project selection", async () => {
  vi.useFakeTimers();
  const onActivateProject = vi.fn();
  const props = await renderTree({
    expandedPaths: new Set(),
    onActivateProject,
  });
  act(() => projectNameButton("/work/beta").click());
  await renderTree({
    ...props,
    expandedPaths: new Set(["/work/beta"]),
    cwd: "/work/gamma",
  });
  act(() => vi.advanceTimersByTime(300));
  expect(onActivateProject).not.toHaveBeenCalled();
});

it("defers unopened session sections and retains them without repeated hidden preparation", async () => {
  const prepare = vi.fn((path: string) =>
    createElement("button", { "data-session": path }, "Conversation"),
  );
  const props = await renderTree({
    expandedPaths: new Set(),
    renderProjectChildren: prepare,
  });
  expect(prepare).not.toHaveBeenCalled();
  await renderTree({
    ...props,
    expandedPaths: new Set(["/work/alpha"]),
  });
  expect(new Set(prepare.mock.calls.map(([path]) => path))).toEqual(
    new Set(["/work/alpha"]),
  );
  const session = container.querySelector('[data-session="/work/alpha"]');
  await renderTree(props);
  const fold = container.querySelector<HTMLElement>(
    '[data-project-path="/work/alpha"] .zen-fold-item',
  )!;
  act(() => completeMotionAnimation(fold));
  expect(fold.hidden).toBe(true);
  prepare.mockClear();
  await renderTree({ ...props, renderProjectChildren: (path) => prepare(path) });
  expect(prepare).not.toHaveBeenCalled();
  expect(container.querySelector('[data-session="/work/alpha"]')).toBe(session);
  await renderTree({ ...props, expandedPaths: new Set(["/work/alpha"]) });
  expect(container.querySelector('[data-session="/work/alpha"]')).toBe(session);
  expect(fold.hidden).toBe(false);
});

it("reveals projects in batches of five independently for pins, groups and loose projects", async () => {
  const recents = Array.from({ length: 36 }, (_, index) => ({
    path: `/work/project-${index}`,
    openedAt: 100 - index,
  }));
  savePinnedProjects(recents.slice(0, 12).map((row) => row.path));
  saveProjectGroups([{ id: "group", name: "Group", collapsed: false }]);
  for (const row of recents.slice(12, 24))
    setProjectGroupAssignment(row.path, "group");
  await renderTree({ cwd: recents[0].path, recents });
  const headers = () => container.querySelectorAll("[data-project-header]");
  const toggles = () =>
    container.querySelectorAll<HTMLButtonElement>("[data-sidebar-list-toggle]");
  expect(headers()).toHaveLength(15);
  expect(toggles()).toHaveLength(3);
  await act(async () => toggles()[0].click());
  expect(headers()).toHaveLength(20);
  await act(async () => toggles()[0].click());
  expect(headers()).toHaveLength(22);
  await act(async () => toggles()[0].click());
  const closing = container.querySelector<HTMLElement>(
    '[data-fold-state="closing"]',
  )!;
  expect(closing.inert).toBe(true);
  await act(async () => {
    container
      .querySelectorAll('[data-fold-state="closing"]')
      .forEach((node) =>
        completeMotionAnimation(node),
      );
  });
  expect(headers()).toHaveLength(15);
  await renderTree({
    cwd: recents[0].path,
    recents,
    query: "project-35",
    searchActive: true,
  });
  expect(headers()).toHaveLength(1);
  expect(container.textContent).toContain("project-35");
});

const sectionIds = () =>
  [
    ...container.querySelectorAll<HTMLElement>(
      "[data-sidebar-reorder-section]",
    ),
  ].map((section) => section.dataset.sidebarReorderSection);
const sectionHeader = (id: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-sidebar-reorder-section="${id}"] [data-sidebar-section-toggle]`,
  )!;

it.each(["pinned", "chats", "group", "groups", "projects"])(
  "resets only the collapsed %s preview to five, including rapid reopening",
  async (id) => {
    const recents = Array.from({ length: 36 }, (_, index) => ({
      path: `/work/project-${index}`,
      openedAt: 100 - index,
    }));
    savePinnedProjects(recents.slice(0, 12).map((row) => row.path));
    saveProjectGroups([{ id: "group", name: "Group", collapsed: false }]);
    for (const row of recents.slice(12, 24))
      setProjectGroupAssignment(row.path, "group");
    await renderTree({
      cwd: recents[0].path,
      recents,
      chatEntries: Array.from({ length: 12 }, (_, index) => ({
        id: `chat-${index}`,
        content: createElement("span", { "data-chat-preview-row": index }, `Chat ${index}`),
      })),
    });
    const lists = ["pinned", "chats", "group", "projects"].map((name) =>
      container.querySelector<HTMLElement>(name === "group"
        ? '[data-project-group="group"]'
        : `[data-sidebar-reorder-section="${name}"]`)!,
    );
    const target = lists[id === "groups" ? 2 : ["pinned", "chats", "group", "projects"].indexOf(id)];
    const count = (list: HTMLElement) => list.querySelectorAll(
      "[data-project-header], [data-chat-preview-row]",
    ).length;
    const more = (list: HTMLElement) => list.querySelector<HTMLButtonElement>("[data-sidebar-list-toggle]")!;
    const header = id === "group"
      ? target.querySelector<HTMLButtonElement>("[data-project-group-header] button")!
      : sectionHeader(id);
    const settle = () => act(() => {
      container.querySelectorAll('[data-fold-state="closing"]').forEach((fold) =>
        completeMotionAnimation(fold),
      );
    });
    for (const list of lists) {
      act(() => more(list).click());
      act(() => more(list).click());
      expect(count(list)).toBe(12);
    }
    for (const rapid of [false, true]) {
      act(() => header.click());
      // Expanded rows stay mounted and inert until the closing animation ends.
      expect(count(target)).toBe(12);
      expect(target.closest("[inert]") ?? target.querySelector("[inert]")).not.toBeNull();
      if (!rapid) settle();
      act(() => header.click());
      if (rapid) settle();
      expect(count(target)).toBe(5);
      expect(more(target).getAttribute("aria-expanded")).toBe("false");
      for (const other of lists.filter((list) => list !== target))
        expect(count(other)).toBe(12);
      act(() => more(target).click());
      expect(count(target)).toBe(10);
      act(() => more(target).click());
    }
  },
);

it("drags every sidebar section from its title without intercepting new-chat or child actions", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  const childClick = vi.fn();
  const props = await renderTree({
    pinnedEntries: [{ id: "pin", content: "Pinned conversation" }],
    chatEntries: [
      {
        id: "chat",
        content: createElement(
          "button",
          { "data-chat-action": true, onClick: childClick },
          "Chat",
        ),
      },
    ],
    onNewChat: vi.fn(),
    workflowsSection: "Workflows",
  });
  for (const id of sectionIds()) {
    reorderPointerDown.mockClear();
    act(() =>
      sectionHeader(id!).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    expect(reorderPointerDown).toHaveBeenCalledExactlyOnceWith(
      id,
      expect.objectContaining({ type: "pointerdown" }),
    );
  }
  reorderPointerDown.mockClear();
  act(() => {
    for (const selector of ['[aria-label="New chat"]', "[data-chat-action]"]) {
      const button = container.querySelector<HTMLButtonElement>(selector)!;
      button.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      button.click();
    }
  });
  expect(reorderPointerDown).not.toHaveBeenCalled();
  expect(props.onNewChat).toHaveBeenCalledOnce();
  expect(childClick).toHaveBeenCalledOnce();

  reorderState.consumeClick = true;
  act(() => sectionHeader("chats").click());
  expect(sectionHeader("chats").getAttribute("aria-expanded")).toBe("true");
  reorderState.consumeClick = false;
  act(() => sectionHeader("chats").click());
  expect(sectionHeader("chats").getAttribute("aria-expanded")).toBe("false");
});

it("persists section moves, preserves mounted content and restores hidden sections in their saved slots", async () => {
  const props = await renderTree({
    chatEntries: [
      {
        id: "chat",
        content: createElement("input", { "data-chat-draft": true }),
      },
    ],
    workflowsSection: "Workflows",
  });
  const draft = container.querySelector<HTMLInputElement>("[data-chat-draft]")!;
  draft.value = "Keep this draft";
  const call = vi
    .mocked(useAnimatedReorder)
    .mock.calls.find(([ids]) => ids.includes("chats"))!;
  act(() => call[1](["projects", "chats", "workflows"], "projects"));
  expect(sectionIds()).toEqual(["pinned", "projects", "chats", "workflows"]);
  expect(container.querySelector("[data-chat-draft]")).toBe(draft);
  expect(draft.value).toBe("Keep this draft");
  expect(loadSidebarSectionOrder()).toEqual([
    "pinned",
    "projects",
    "chats",
    "groups",
    "workflows",
  ]);

  act(() => saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]));
  await renderTree({
    ...props,
    pinnedEntries: [{ id: "pin", content: "Pinned" }],
  });
  expect(sectionIds()).toEqual([
    "pinned",
    "projects",
    "chats",
    "groups",
    "workflows",
  ]);
  act(() => root.unmount());
  root = createRoot(container);
  await renderTree(props);
  expect(sectionIds()).toEqual(["pinned", "projects", "chats", "groups", "workflows"]);
  act(() =>
    saveSidebarSectionOrder([
      "workflows",
      "chats",
      "projects",
      "groups",
      "pinned",
    ]),
  );
  expect(sectionIds()).toEqual(["workflows", "chats", "projects", "groups", "pinned"]);
});

it.each(["pinned", "chats", "workflows", "groups", "projects"])(
  "temporarily folds only the dragged %s section and reverses without changing its preference",
  async (id) => {
    saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
    const props = await renderTree({
      pinnedEntries: [{ id: "pin", content: "Pinned" }],
      chatEntries: [{ id: "chat", content: "Chat" }],
      workflowsSection: "Workflows",
    });
    const section = container.querySelector(
      `[data-sidebar-reorder-section="${id}"]`,
    )!;
    const fold = section.querySelector<HTMLElement>(".project-tree-collapse")!;
    const content = fold.firstElementChild;
    reorderState.draggingId = id;
    await renderTree(props);
    expect(fold.dataset.foldState).toBe("closing");
    expect(fold.inert).toBe(true);
    expect(sectionHeader(id).getAttribute("aria-expanded")).toBe("true");
    for (const other of sectionIds().filter((value) => value !== id)) {
      expect(
        container.querySelector<HTMLElement>(
          `[data-sidebar-reorder-section="${other}"] .project-tree-collapse`,
        )?.dataset.foldState,
      ).toBe("open");
    }
    reorderState.draggingId = null;
    await renderTree(props);
    expect(fold.dataset.foldState).toBe("opening");
    expect(fold.inert).toBe(false);
    expect(fold.firstElementChild).toBe(content);
    expect(
      localStorage.getItem("omnicode.sidebarSectionsCollapsed.v1"),
    ).toBeNull();
    expect(localStorage.getItem("omnicode.chatProjectExpanded.v1")).toBeNull();
  },
);

it("keeps a previously collapsed section closed after dragging and leaves the compact rail usable", async () => {
  const props = await renderTree({
    chatEntries: [],
    workflowsSection: "Workflows",
  });
  act(() => sectionHeader("workflows").click());
  const fold = container.querySelector<HTMLElement>(
    '[data-sidebar-reorder-section="workflows"] .project-tree-collapse',
  )!;
  act(() => completeMotionAnimation(fold));
  reorderState.draggingId = "workflows";
  await renderTree(props);
  reorderState.draggingId = null;
  await renderTree(props);
  expect(fold.hidden).toBe(true);
  expect(sectionHeader("workflows").getAttribute("aria-expanded")).toBe(
    "false",
  );
  await renderTree({ ...props, compact: true });
  expect(container.querySelector("[data-sidebar-section-toggle]")).toBeNull();
  expect(
    container.querySelector<HTMLElement>(
      '[data-project-section="projects"] .project-tree-collapse',
    )?.dataset.foldState,
  ).toBe("open");
});

it.each([false, true])(
  "handles a real section pointer gesture across unequal heights (cancel: %s)",
  async (cancel) => {
    const actual = await vi.importActual<
      typeof import("../../shared/hooks/useAnimatedReorder")
    >("../../shared/hooks/useAnimatedReorder");
    const mock = vi.mocked(useAnimatedReorder);
    const implementation = mock.getMockImplementation()!;
    mock.mockImplementation(actual.useAnimatedReorder);
    document.documentElement.dataset.reducedMotion = "on";
    try {
      await renderTree({
        chatEntries: [{ id: "chat", content: "Chat" }],
        workflowsSection: "Workflows",
      });
      const layouts = [
        { top: -64, height: 60 },
        { top: 0, height: 100 },
        { top: 104, height: 80 },
        { top: 188, height: 220 },
      ];
      const sections = [
        ...container.querySelectorAll<HTMLElement>(
          "[data-sidebar-reorder-section]",
        ),
      ];
      sections.forEach((node, index) => {
        const { top, height } = layouts[index];
        vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
          top,
          bottom: top + height,
          height,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: top,
          toJSON: () => ({}),
        });
        Object.defineProperty(node, "offsetHeight", { value: height });
        Object.defineProperty(
          node.querySelector(".project-tree-collapse"),
          "offsetHeight",
          { value: height - 24 },
        );
        Object.assign(node, {
          setPointerCapture: vi.fn(),
          hasPointerCapture: () => true,
          releasePointerCapture: vi.fn(),
        });
      });
      const header = sectionHeader("chats");
      act(() =>
        header.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientY: 12,
          }),
        ),
      );
      act(() =>
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientY: 300,
          }),
        ),
      );
      expect(sections[1].dataset.dragging).toBe("true");
      expect(
        sections[1].querySelector<HTMLElement>(".project-tree-collapse")?.inert,
      ).toBe(true);
      act(() => {
        if (cancel)
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else
          window.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerId: 1,
              pointerType: "mouse",
              clientY: 300,
            }),
          );
        header.click();
      });
      expect(sectionIds()).toEqual(
        cancel
          ? ["pinned", "chats", "workflows", "projects"]
          : ["pinned", "workflows", "projects", "chats"],
      );
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(
        sections[1].querySelector<HTMLElement>(".project-tree-collapse")?.inert,
      ).toBe(false);
      expect(sections[1].dataset.dragging).toBeUndefined();
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(loadSidebarSectionOrder()).toEqual(
        cancel
          ? ["pinned", "chats", "workflows", "groups", "projects"]
          : ["pinned", "workflows", "projects", "groups", "chats"],
      );
    } finally {
      delete document.documentElement.dataset.reducedMotion;
      mock.mockImplementation(implementation);
    }
  },
);

it.each([
  { origin: "projects", cancel: false },
  { origin: "group", cancel: false },
  { origin: "pinned", cancel: false },
  { origin: "projects", cancel: true },
])(
  "drags a lone project from $origin into a collapsed group (cancel: $cancel)",
  async ({ origin, cancel }) => {
    const actual = await vi.importActual<
      typeof import("../../shared/hooks/useAnimatedReorder")
    >("../../shared/hooks/useAnimatedReorder");
    const mock = vi.mocked(useAnimatedReorder);
    const implementation = mock.getMockImplementation()!;
    mock.mockImplementation(actual.useAnimatedReorder);
    document.documentElement.dataset.reducedMotion = "on";
    try {
      saveProjectGroups([
        { id: "source", name: "Source", collapsed: false },
        { id: "target", name: "Target", collapsed: true },
      ]);
      if (origin === "group")
        setProjectGroupAssignment("/work/alpha", "source");
      if (origin === "pinned") savePinnedProjects(["/work/alpha"]);
      const props = await renderTree({
        recents: [{ path: "/work/alpha", openedAt: 1 }],
      });
      const list = container.querySelector<HTMLElement>("[data-project-list]")!;
      const header = projectNameButton("/work/alpha").closest<HTMLElement>(
        "[data-project-header]",
      )!;
      const node = header.closest<HTMLElement>("[data-project-path]")!;
      const target = container.querySelector<HTMLElement>(
        '[data-project-group-header="target"]',
      )!;
      vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 300, 600),
      );
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
        new DOMRect(8, 40, 284, 32),
      );
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        new DOMRect(8, 200, 284, 100),
      );
      Object.defineProperty(header, "offsetHeight", { value: 32 });
      Object.assign(node, {
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
      });
      act(() =>
        header.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 100,
            clientY: 216,
          }),
        ),
      );
      act(() =>
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 100,
            clientY: 56,
          }),
        ),
      );
      expect(target.dataset.projectGroupDropTarget).toBe("true");
      expect(
        projectNameButton("/work/alpha")
          .closest("[data-project-group]")
          ?.getAttribute("data-project-group"),
      ).toBe(origin === "group" ? "source" : undefined);
      act(() => {
        if (cancel)
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else
          window.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerId: 1,
              pointerType: "mouse",
              clientX: 100,
              clientY: 56,
            }),
          );
      });
      expect(target.dataset.projectGroupDropTarget).toBeUndefined();
      expect(document.querySelector(".drag-label")).toBeNull();
      expect(props.onSelectProject).not.toHaveBeenCalled();
      expect(props.onToggleProject).not.toHaveBeenCalled();
      expect(loadProjectRailOrder()).toEqual(["/work/alpha"]);
      if (cancel) {
        expect(
          projectNameButton("/work/alpha").closest("[data-project-group]"),
        ).toBeNull();
        expect(
          target.querySelector("button")?.getAttribute("aria-expanded"),
        ).toBe("false");
      } else {
        expect(
          projectNameButton("/work/alpha")
            .closest("[data-project-group]")
            ?.getAttribute("data-project-group"),
        ).toBe("target");
        expect(
          target.querySelector("button")?.getAttribute("aria-expanded"),
        ).toBe("true");
        expect(loadPinnedProjects()).toEqual([]);
        act(() => root.unmount());
        root = createRoot(container);
        await renderTree(props);
        expect(
          projectNameButton("/work/alpha")
            .closest("[data-project-group]")
            ?.getAttribute("data-project-group"),
        ).toBe("target");
      }
    } finally {
      delete document.documentElement.dataset.reducedMotion;
      mock.mockImplementation(implementation);
    }
  },
);

it.each([false, true])(
  "drags a project into the empty pinned area (cancel: %s)",
  async (cancel) => {
    const actual = await vi.importActual<
      typeof import("../../shared/hooks/useAnimatedReorder")
    >("../../shared/hooks/useAnimatedReorder");
    const mock = vi.mocked(useAnimatedReorder);
    const implementation = mock.getMockImplementation()!;
    mock.mockImplementation(actual.useAnimatedReorder);
    document.documentElement.dataset.reducedMotion = "on";
    try {
      const props = await renderTree({
        recents: [{ path: "/work/alpha", openedAt: 1 }],
      });
      const list = container.querySelector<HTMLElement>("[data-project-list]")!;
      const pins = container.querySelector<HTMLElement>(
        '[data-project-section="pinned"]',
      )!;
      expect(pins.textContent).toContain(
        "Drag conversations or projects here to pin them",
      );
      const toggle = pins.querySelector<HTMLButtonElement>(
        "[data-sidebar-section-toggle]",
      )!;
      act(() => toggle.click());
      const header = projectNameButton("/work/alpha").closest<HTMLElement>(
        "[data-project-header]",
      )!;
      const node = header.closest<HTMLElement>("[data-project-path]")!;
      vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 300, 600),
      );
      vi.spyOn(pins, "getBoundingClientRect").mockReturnValue(
        new DOMRect(8, 0, 284, 32),
      );
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        new DOMRect(8, 200, 284, 100),
      );
      Object.defineProperty(header, "offsetHeight", { value: 32 });
      Object.assign(node, {
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
      });
      act(() =>
        header.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 100,
            clientY: 216,
          }),
        ),
      );
      act(() =>
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            buttons: 1,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 100,
            clientY: 16,
          }),
        ),
      );
      expect(pins.dataset.sidebarPinDropTarget).toBe("true");
      expect(loadPinnedProjects()).toEqual([]);
      act(() => {
        if (cancel)
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else
          window.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerId: 1,
              pointerType: "mouse",
              clientX: 100,
              clientY: 16,
            }),
          );
      });
      expect(pins.dataset.sidebarPinDropTarget).toBeUndefined();
      expect(document.querySelector(".drag-label")).toBeNull();
      expect(props.onSelectProject).not.toHaveBeenCalled();
      expect(props.onToggleProject).not.toHaveBeenCalled();
      expect(loadPinnedProjects()).toEqual(cancel ? [] : ["/work/alpha"]);
      expect(
        pins.querySelector('[data-project-path="/work/alpha"]') !== null,
      ).toBe(!cancel);
      if (!cancel) {
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(
          container.querySelector(
            '[data-project-section="projects"] [data-project-path]',
          ),
        ).toBeNull();
        act(() => root.unmount());
        root = createRoot(container);
        await renderTree(props);
        expect(
          container.querySelector(
            '[data-project-section="pinned"] [data-project-path="/work/alpha"]',
          ),
        ).not.toBeNull();
      }
    } finally {
      delete document.documentElement.dataset.reducedMotion;
      mock.mockImplementation(implementation);
    }
  },
);

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { motionTestDriver } = await import("../../../tests/helpers/motionDriver");
  return { ...actual, ...motionTestDriver(actual, true) };
});
