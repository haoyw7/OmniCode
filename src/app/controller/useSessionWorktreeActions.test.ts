// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  setWorktreeFocus,
  worktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import type {
  Worktree,
  Worktrees,
} from "../../features/source-control/model/worktrees";
import {
  newTab,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import {
  useWorkspaceNavigation,
  type WorkspaceNavigation,
} from "../hooks/useWorkspaceNavigation";
import { useSessionWorktreeActions } from "./useSessionWorktreeActions";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  forget: vi.fn(),
  flush: vi.fn(),
  keep: vi.fn(),
  review: vi.fn(),
  git: vi.fn(),
}));
vi.mock("../../features/source-control/model/worktrees", async (original) => ({
  ...(await original<
    typeof import("../../features/source-control/model/worktrees")
  >()),
  listWorktrees: mocks.list,
}));
vi.mock("../../features/orchestration/model/orchestration", () => ({
  orchestrator: { forSession: () => undefined },
}));
vi.mock("../../integrations/harness", () => ({
  forgetHarnessSession: mocks.forget,
}));
vi.mock("../../platform/tauri/fs", () => ({ notifyGitChanged: mocks.git }));
vi.mock("../../features/sessions/data/sessionStore", () => ({
  shouldPersistSession: (session: Session) =>
    session.blocks.some((block) => block.role === "user"),
  upsertSession: mocks.save,
}));
vi.mock("../../features/sessions/model/checkpoint", () => ({
  flushSessionCheckpoint: mocks.flush,
  keepSessionChanges: mocks.keep,
  notifyReviewChanged: mocks.review,
}));

const project = "/checkout-project";
const tree: Worktree = {
  path: "/checkout-trees/feature",
  branch: "feature",
  head: "head",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
};
const listing: Worktrees = {
  worktrees: [tree],
  defaultRoot: "/checkout-trees",
};
const data = {
  isRemoving: () => false,
  cancelSave: vi.fn(),
  invalidate: vi.fn(),
  persist: vi.fn(),
  refreshHistory: vi.fn(async () => {}),
};
let root: Root;
let container: HTMLDivElement;
let navigation: WorkspaceNavigation;
let actions: ReturnType<typeof useSessionWorktreeActions>;
let view: { sessions: Session[]; tabs: WorkspaceTab[]; activeTabId: string };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(
  source: Session = { ...newSession("codex", project), id: "source" },
) {
  function Harness() {
    const [sessions, setSessions] = useState([source]);
    const [tabs, setTabs] = useState([newTab(source.id)]);
    const [activeTabId, setActiveTabId] = useState(tabs[0].id);
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const removing = useRef(new Set<string>());
    navigation = useWorkspaceNavigation({
      project,
      sessions,
      tabs,
      activeTabId,
      setActiveTabId,
      activateTab: setActiveTabId,
      createTab: () => {
        throw new Error("Expected a reusable session");
      },
      moveSession: (id, target, isCurrent) =>
        actions.onWorktreeChange(id, target, false, isCurrent),
    });
    actions = useSessionWorktreeActions({
      navigation,
      sessionsRef,
      setSessions,
      sessionData: data,
      removingWorktreePaths: removing,
      appendTab: (tab) => setTabs((prev) => [...prev, tab]),
      setComposerFocused: () => {},
    });
    view = { sessions, tabs, activeTabId };
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.list.mockReset().mockResolvedValue(listing);
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.forget.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(undefined);
  mocks.keep.mockResolvedValue(undefined);
  setWorktreeFocus(project, undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setWorktreeFocus(project, undefined);
  vi.unstubAllGlobals();
});

it("holds the move lock until a superseded lookup finishes, then allows another selection", async () => {
  const lookup = deferred<Worktrees>();
  mocks.list.mockImplementationOnce(() => lookup.promise);
  await mount();
  const originalTab = view.activeTabId;
  await act(async () => navigation.selectWorkspace(project, tree));
  expect(navigation.isMoving("source")).toBe(true);
  await act(async () => navigation.activateTab(originalTab));
  expect(navigation.isMoving("source")).toBe(true);
  await expect(
    actions.onComposerWorktreeChange("source", tree),
  ).rejects.toThrow("Wait for this session");
  await act(async () => lookup.resolve(listing));
  expect(view.sessions[0].executionCwd).toBeUndefined();
  expect(worktreeFocus(project)).toBeUndefined();
  expect(navigation.isMoving("source")).toBe(false);
  expect(mocks.forget).not.toHaveBeenCalled();

  await act(async () => navigation.selectWorkspace(project, tree));
  expect(view.activeTabId).toBe(originalTab);
  expect(view.sessions[0].executionCwd).toBe(tree.path);
  expect(navigation.tabWorkspace(view.tabs[0])).toBe(tree.path);
  expect(navigation.isSwitching("source")).toBe(false);
});

it("releases a failed move without changing the checkout and can retry", async () => {
  await mount();
  mocks.list.mockResolvedValueOnce({ ...listing, worktrees: [] });
  await act(async () => navigation.selectWorkspace(project, tree));
  expect(navigation.error?.message).toContain("no longer available");
  expect(navigation.isMoving("source")).toBe(false);
  expect(navigation.hasMoveInto(tree.path)).toBe(false);
  expect(view.sessions[0].executionCwd).toBeUndefined();
  await act(async () => navigation.selectWorkspace(project, tree));
  expect(view.sessions[0].executionCwd).toBe(tree.path);
  expect(navigation.error).toBeNull();
});

it("opens a new conversation from the composer while keeping the original provider and workspace", async () => {
  const source: Session = {
    ...newSession("codex", project),
    id: "source",
    providerSessionId: "original-provider",
    blocks: [{ id: "prompt", role: "user", text: "Existing conversation" }],
  };
  await mount(source);
  await act(async () => actions.onComposerWorktreeChange(source.id, tree));
  expect(view.sessions[0]).toBe(source);
  expect(view.sessions).toHaveLength(2);
  expect(view.sessions[1]).toMatchObject({
    cwd: project,
    executionCwd: tree.path,
    providerSessionId: undefined,
  });
  expect(view.tabs.find((tab) => tab.id === view.activeTabId)?.focusedId).toBe(
    view.sessions[1].id,
  );
  expect(navigation.tabWorkspace(view.tabs[1])).toBe(project);
  expect(worktreeFocus(project)).toBeUndefined();
  expect(mocks.forget).not.toHaveBeenCalled();
  expect(navigation.isMoving(source.id)).toBe(false);
});

it("does not publish ownership or live state when a persisted restoration is superseded", async () => {
  const source: Session = {
    ...newSession("codex", project),
    id: "source",
    executionCwd: "/deleted-checkout",
    worktreeRemoved: true,
    blocks: [{ id: "prompt", role: "user", text: "Existing conversation" }],
  };
  await mount(source);
  await act(async () =>
    navigation.pinSessionToCurrentWorkspace(source.id, project),
  );
  const save = deferred<void>();
  mocks.save.mockImplementationOnce(() => save.promise);
  let current = true;
  let change!: Promise<void>;
  await act(async () => {
    change = actions.onWorktreeChange(source.id, tree, false, () => current);
  });
  expect(mocks.save).toHaveBeenCalledOnce();
  current = false;
  await act(async () => {
    save.resolve();
    await change;
  });
  expect(view.sessions[0]).toBe(source);
  // A new tab without a tab pin must still see the original session ownership.
  expect(navigation.tabWorkspace(newTab(source.id))).toBe(project);
  expect(data.invalidate).not.toHaveBeenCalled();
  expect(navigation.isMoving(source.id)).toBe(false);
});
