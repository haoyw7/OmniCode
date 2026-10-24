// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { sessionExecutionCwd } from "../../domain/session";
import { type Session } from "../../contracts/session";
import { setWorktreeFocus, useWorktreeFocus, worktreeFocus, type WorktreeFocus } from "../../features/source-control/model/worktreeFocus";
import type { Worktree } from "../../contracts/worktree";
import { sessionInWorktree } from "../../features/source-control/model/worktrees";
import { leafIds, newAppViewWorkspaceTab, newTab, splitPane, type WorkspaceTab } from "../../features/workspace/model/layout";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";

const project = "/navigation-project";
const other = "/navigation-other";
const treeA = { path: "/navigation-trees/a", branch: "a" };
const treeB = { path: "/navigation-trees/b", branch: "b" };
const treeC = { path: "/navigation-trees/c", branch: "c" };
let root: Root;
let container: HTMLDivElement;
let navigation: ReturnType<typeof useWorkspaceNavigation>;
let view: {
  project: string;
  activeTabId: string;
  tabs: WorkspaceTab[];
  sessions: Session[];
};
let directOpen: (id: string) => void;
let openProject: (path: string, landingTab: string) => void;
const workspaceOf = (id: string) =>
  navigation.tabWorkspace(view.tabs.find((tab) => tab.id === id)!);
const activate = vi.fn();
const move =
  vi.fn<
    (id: string, tree: Worktree, isCurrent: () => boolean) => Promise<void>
  >();

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function chat(
  id: string,
  cwd = project,
  workingCopy?: string,
  started = false,
) {
  return {
    ...newSession("codex", cwd),
    id,
    executionCwd: workingCopy,
    blocks: started
      ? [{ id: `prompt-${id}`, role: "user" as const, text: "hello" }]
      : [],
  };
}
async function mount(
  sessions = [chat("blank")],
  activeId = sessions[0].id,
  initialTabs = sessions.map((s) => ({ ...newTab(s.id), id: `tab-${s.id}` })),
  canReuseBlank?: (sessionId: string) => boolean,
  restoreDefaultWorkspaces = false,
) {
  function Harness() {
    const [state, setState] = useState(() => ({
      project: sessions.find((s) => s.id === activeId)!.cwd,
      sessions,
      tabs: initialTabs,
      activeTabId: initialTabs.find((tab) =>
        leafIds(tab.layout).includes(activeId),
      )!.id,
    }));
    view = state;
    const focus = useWorktreeFocus(state.project);
    navigation = useWorkspaceNavigation({
      ...state,
      canReuseBlank,
      restoreDefaultWorkspaces,
      setActiveTabId: (id) =>
        setState((prev) => ({ ...prev, activeTabId: id })),
      moveSession: async (id, tree, isCurrent) => {
        await move(id, tree, isCurrent);
        if (isCurrent())
          setState((prev) => ({
            ...prev,
            sessions: prev.sessions.map((s) =>
              s.id === id ? sessionInWorktree(s, tree) : s,
            ),
          }));
      },
      activateTab: (id, paneId) => {
        activate(id);
        setState((prev) => ({
          ...prev,
          activeTabId: id,
          tabs: paneId
            ? prev.tabs.map((tab) =>
                tab.id === id ? { ...tab, focusedId: paneId } : tab,
              )
            : prev.tabs,
        }));
      },
      createTab: (cwd, nextFocus) => {
        const session = chat("created", cwd, nextFocus?.path);
        const tab = { ...newTab(session.id), id: "tab-created" };
        setState((prev) => ({
          ...prev,
          sessions: [...prev.sessions, session],
          tabs: [...prev.tabs, tab],
        }));
        return tab.id;
      },
    });
    directOpen = (id) => {
      navigation.setActiveTabId(`tab-${id}`);
      const target = state.sessions.find((s) => s.id === id)!;
      setState((prev) => ({
        ...prev,
        project: target.cwd,
        activeTabId: `tab-${id}`,
      }));
    };
    openProject = (path, landingTab) => {
      navigation.cancel();
      setState((prev) => ({ ...prev, project: path, activeTabId: landingTab }));
      navigation.selectProject(path);
    };
    return createElement(
      "output",
      null,
      JSON.stringify({
        workspace: focus?.path ?? state.project,
        activeTab: state.activeTabId,
        checkout: sessionExecutionCwd(
          state.sessions.find(
            (s) =>
              s.id ===
              state.tabs.find((tab) => tab.id === state.activeTabId)?.focusedId,
          )!,
        ),
        pending: !!navigation.pending,
        error: navigation.error?.message,
      }),
    );
  }
  await act(async () => root.render(createElement(Harness)));
}

it("opens another workspace without moving a blank protected by its composer or resources", async () => {
  await mount(undefined, undefined, undefined, () => false);
  await act(async () => navigation.selectWorkspace(project, treeA));
  expect(move).not.toHaveBeenCalled();
  expect(view.activeTabId).toBe("tab-created");
  expect(
    view.sessions.find((session) => session.id === "blank")?.executionCwd,
  ).toBeUndefined();
  expect(
    view.sessions.find((session) => session.id === "created")?.executionCwd,
  ).toBe(treeA.path);
});
const select = async (focus?: WorktreeFocus) => {
  await act(async () => navigation.selectWorkspace(project, focus));
};
const screen = () => JSON.parse(container.textContent!);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus(project, undefined);
  setWorktreeFocus(other, undefined);
  move.mockReset().mockResolvedValue(undefined);
  activate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("restores default-workspace ownership even for a background worktree checkout", async () => {
  await mount(
    [
      chat("main", project, undefined, true),
      chat("worktree", project, treeA.path, true),
    ],
    undefined,
    undefined,
    undefined,
    true,
  );
  const restored = view.tabs.find((tab) => tab.id === "tab-worktree")!;
  expect(navigation.tabWorkspace(restored)).toBe(project);
  expect(navigation.keepWorkspaceTab(restored)).toBe(true);
  expect(sessionExecutionCwd(view.sessions[1])).toBe(treeA.path);

  await select(treeA);
  const created = view.tabs.find((tab) => tab.id === view.activeTabId)!;
  expect(created.id).toBe("tab-created");
  expect(navigation.keepWorkspaceTab(created)).toBe(false);
  expect(navigation.keepWorkspaceTab(restored)).toBe(true);
});

it("keeps checkout locks across navigation cancellation and ignores an old release", async () => {
  await mount();
  const finishFirst = navigation.beginMove("blank", treeA.path)!;
  expect(navigation.beginMove("blank", treeB.path)).toBeNull();
  expect(navigation.hasMoveInto("/navigation-trees")).toBe(true);
  expect(navigation.hasMoveInto(treeB.path)).toBe(false);
  await act(async () => navigation.cancel());
  expect(navigation.isMoving("blank")).toBe(true);
  expect(navigation.isSwitching("blank")).toBe(true);
  finishFirst();
  const finishSecond = navigation.beginMove("blank", treeB.path)!;
  finishFirst();
  expect(navigation.isMoving("blank")).toBe(true);
  expect(navigation.hasMoveInto(treeB.path)).toBe(true);
  finishSecond();
  expect(navigation.isMoving("blank")).toBe(false);
  expect(navigation.isSwitching("blank")).toBe(false);
  expect(navigation.hasMoveInto("/navigation-trees")).toBe(false);
});

it("records the focused split pane when activating and returning between projects", async () => {
  const split = newTab("first");
  split.layout = splitPane(split.layout, "first", "right", "second");
  await mount(
    [
      chat("first", project, undefined, true),
      chat("second", project, undefined, true),
      chat("other", other, undefined, true),
    ],
    "first",
    [split, { ...newTab("other"), id: "tab-other" }],
  );
  await act(async () => navigation.activateTab(split.id, "second"));
  await act(async () => openProject(other, "tab-other"));
  expect(navigation.readProjectReturnMemory().get(project)).toBe("second");
  expect(navigation.readProjectReturnMemory().get(other)).toBe("other");
});

it("activating a pane cancels a move before its late completion can steal focus", async () => {
  const pending = deferred();
  move.mockImplementationOnce(() => pending.promise);
  const split = newTab("blank");
  split.layout = splitPane(split.layout, "blank", "right", "second");
  await mount(
    [chat("blank"), chat("second", project, undefined, true)],
    "blank",
    [split],
  );
  await select(treeA);
  await act(async () => navigation.activateTab(split.id, "second"));
  await act(async () => pending.resolve());
  expect(view.tabs[0].focusedId).toBe("second");
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: false,
  });
  expect(navigation.isSwitching("blank")).toBe(false);
});

it("serializes A then B and never publishes A after B was requested", async () => {
  const first = deferred(),
    second = deferred();
  move
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  await mount();
  await select(treeA);
  expect(navigation.isSwitching("blank")).toBe(true);
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: true,
  });
  await select(treeB);
  expect(move).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve());
  expect(move).toHaveBeenCalledTimes(2);
  expect(move.mock.calls[0][2]()).toBe(false);
  expect(move.mock.calls[1][1].path).toBe(treeB.path);
  expect(navigation.isSwitching("blank")).toBe(true);
  expect(activate).not.toHaveBeenCalled();
  expect(workspaceOf("tab-blank")).toBe(project);
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: true,
  });
  await act(async () => second.resolve());
  expect(screen()).toMatchObject({
    workspace: treeB.path,
    checkout: treeB.path,
    pending: false,
  });
  expect(workspaceOf("tab-blank")).toBe(treeB.path);
  expect(navigation.isSwitching("blank")).toBe(false);
});

it("coalesces superseded selections and ignores an obsolete failure", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount();
  await select(treeA);
  await select(treeB);
  await select(treeC);
  await act(async () => first.reject(new Error("obsolete failure")));
  expect(move.mock.calls.map((call) => call[1].path)).toEqual([
    treeA.path,
    treeC.path,
  ]);
  expect(screen()).toMatchObject({
    workspace: treeC.path,
    checkout: treeC.path,
    pending: false,
  });
  expect(navigation.error).toBeNull();
});

it("keeps the previous workspace and reports a failed move, then allows retry", async () => {
  move.mockRejectedValueOnce(new Error("Working copy no longer exists"));
  await mount();
  await select(treeA);
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: false,
    error: "Working copy no longer exists",
  });
  expect(workspaceOf("tab-blank")).toBe(project);
  expect(navigation.isSwitching("blank")).toBe(false);
  await select(treeB);
  expect(screen()).toMatchObject({
    workspace: treeB.path,
    checkout: treeB.path,
  });
  expect(navigation.error).toBeNull();
});

it("an explicit session open supersedes a pending workspace move", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount([chat("blank"), chat("requested", project, undefined, true)]);
  await select(treeA);
  await act(async () => directOpen("requested"));
  await act(async () => first.resolve());
  expect(screen()).toMatchObject({
    workspace: project,
    activeTab: "tab-requested",
    checkout: project,
    pending: false,
  });
  expect(
    view.sessions.find((s) => s.id === "blank")?.executionCwd,
  ).toBeUndefined();
  expect(activate).not.toHaveBeenCalled();
});

it("opening the same session still cancels a pending move", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount();
  await select(treeA);
  await act(async () => directOpen("blank"));
  // Cancellation preserves the draft while the old operation cleans up.
  expect(navigation.pending).toBeNull();
  expect(navigation.isSwitching("blank")).toBe(true);
  await act(async () => first.resolve());
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: false,
  });
  expect(navigation.isSwitching("blank")).toBe(false);
});

it("can return to the original workspace while a move is pending", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount();
  await select(treeA);
  await select(undefined);
  await act(async () => first.resolve());
  expect(screen()).toMatchObject({
    workspace: project,
    checkout: project,
    pending: false,
  });
  expect(workspaceOf("tab-blank")).toBe(project);
  expect(move).toHaveBeenCalledTimes(1);
  expect(navigation.isSwitching("blank")).toBe(false);
});

it("a completed project switch cannot override a later explicit session open", async () => {
  setWorktreeFocus(project, treeA);
  await mount([
    chat("worktree", project, treeA.path, true),
    chat("main", project, undefined, true),
    chat("other", other, undefined, true),
  ]);
  await act(async () => openProject(other, "tab-other"));
  expect(screen().activeTab).toBe("tab-other");
  activate.mockClear();
  await act(async () => directOpen("main"));
  expect(screen()).toMatchObject({
    activeTab: "tab-main",
    workspace: treeA.path,
    checkout: project,
  });
  expect(workspaceOf("tab-main")).toBe(treeA.path);
  expect(activate).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
});

it("project selection still restores the last tab in its remembered workspace", async () => {
  setWorktreeFocus(project, treeA);
  await mount([
    chat("worktree", project, treeA.path, true),
    chat("main", project, undefined, true),
    chat("other", other, undefined, true),
  ]);
  await act(async () => openProject(other, "tab-other"));
  await act(async () => openProject(project, "tab-main"));
  expect(screen()).toMatchObject({
    activeTab: "tab-worktree",
    workspace: treeA.path,
    checkout: treeA.path,
  });
  expect(move).not.toHaveBeenCalled();
  expect(workspaceOf("tab-main")).toBe(project);
});

it("selects an existing workspace tab without moving the current session", async () => {
  await mount([
    chat("main", project, undefined, true),
    chat("worktree", project, treeA.path, true),
  ]);
  await select(treeA);
  expect(screen()).toMatchObject({
    activeTab: "tab-worktree",
    workspace: treeA.path,
    checkout: treeA.path,
  });
  expect(move).not.toHaveBeenCalled();
});

it("keeps globally visible app tabs out of workspace return targets", async () => {
  const sessions = [
    chat("main", project, undefined, true),
    chat("worktree", project, treeA.path, true),
  ];
  await mount(sessions, "main", [
    ...sessions.map((session) => ({
      ...newTab(session.id),
      id: `tab-${session.id}`,
    })),
    newAppViewWorkspaceTab("settings"),
  ]);
  await select(treeA);
  expect(screen()).toMatchObject({
    activeTab: "tab-worktree",
    workspace: treeA.path,
  });
  expect(move).not.toHaveBeenCalled();
});

it("creates a project tab for an empty workspace even when app tabs are open", async () => {
  const sessions = [chat("main", project, undefined, true)];
  await mount(sessions, "main", [
    { ...newTab("main"), id: "tab-main" },
    newAppViewWorkspaceTab("notes"),
  ]);
  await select(treeA);
  expect(screen()).toMatchObject({
    activeTab: "tab-created",
    workspace: treeA.path,
  });
  expect(move).not.toHaveBeenCalled();
});

it("creates a session in an empty workspace without moving an existing conversation", async () => {
  await mount([chat("main", project, undefined, true)]);
  await select(treeA);
  expect(screen()).toMatchObject({
    activeTab: "tab-created",
    workspace: treeA.path,
    checkout: treeA.path,
  });
  expect(view.sessions[0].executionCwd).toBeUndefined();
  expect(move).not.toHaveBeenCalled();
});

it("a delayed completion cannot return to the project the user left", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount([chat("blank"), chat("other", other, undefined, true)]);
  await select(treeA);
  await act(async () => openProject(other, "tab-other"));
  await act(async () => first.resolve());
  expect(screen()).toMatchObject({
    activeTab: "tab-other",
    workspace: other,
    checkout: other,
    pending: false,
  });
  expect(worktreeFocus(project)).toBeUndefined();
});

it("does not commit after unmount", async () => {
  const first = deferred();
  move.mockImplementationOnce(() => first.promise);
  await mount();
  await select(treeA);
  await act(async () => root.unmount());
  await act(async () => first.resolve());
  expect(worktreeFocus(project)).toBeUndefined();
  expect(activate).not.toHaveBeenCalled();
});

it("a failed project restore returns to its landing workspace", async () => {
  setWorktreeFocus(project, treeA);
  await mount([chat("other", other, undefined, true), chat("blank")]);
  move.mockRejectedValueOnce(new Error("Unable to restore worktree"));
  await act(async () => openProject(project, "tab-blank"));
  expect(screen()).toMatchObject({
    activeTab: "tab-blank",
    workspace: project,
    checkout: project,
    pending: false,
    error: "Unable to restore worktree",
  });
});

it("preserves the landing conversation when a project's remembered workspace has no open tab", async () => {
  setWorktreeFocus(project, treeA);
  await mount([
    chat("other", other, undefined, true),
    chat("main", project, undefined, true),
  ]);
  await act(async () => openProject(project, "tab-main"));
  expect(screen()).toMatchObject({
    activeTab: "tab-main",
    workspace: treeA.path,
    checkout: project,
    pending: false,
  });
  expect(workspaceOf("tab-main")).toBe(treeA.path);
  expect(view.sessions).toHaveLength(2);
  expect(move).not.toHaveBeenCalled();
});

it("keeps a split tab grouped under another project without leaving navigation pending", async () => {
  setWorktreeFocus(other, treeB);
  const mixed = newTab("main");
  mixed.id = "tab-main";
  mixed.layout = splitPane(mixed.layout, "main", "right", "other");
  mixed.focusedId = "other";
  await mount([chat("main"), chat("other", other)], "other", [mixed]);
  await act(async () => navigation.selectProject(other));
  expect(screen()).toMatchObject({
    activeTab: "tab-main",
    workspace: treeB.path,
    checkout: other,
    pending: false,
  });
  expect(view.sessions.slice(0, 2).map(sessionExecutionCwd)).toEqual([
    project,
    other,
  ]);
  expect(workspaceOf("tab-main")).toBe(project);
  expect(view.sessions).toHaveLength(2);
  expect(move).not.toHaveBeenCalled();
});
