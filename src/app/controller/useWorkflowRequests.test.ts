// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { newTab, newEditorWorkspaceTab, newWorkflowRunTab, type WorkspaceTab } from "../../features/workspace/model/layout";
import { useWorkflowRequests } from "./useWorkflowRequests";

type Options = Parameters<typeof useWorkflowRequests>[0];
const parent = { ...newSession("codex", "/repo"), id: "parent" };
let root: Root;
let container: HTMLDivElement;
let actions: ReturnType<typeof useWorkflowRequests>["workflowApp"];
let latestTabs: WorkspaceTab[];
let commits: { active: string; composer: boolean; files: number }[];
let focusParent: ReturnType<typeof vi.fn<Options["focusOpenSession"]>>;
let loadHistory: ReturnType<typeof vi.fn<Options["onSelectHistorySession"]>>;

function Harness({ initialTabs }: { initialTabs: WorkspaceTab[] }) {
  const [tabs, setTabs] = useState(initialTabs);
  const [active, setActive] = useState("other");
  const [composer, setComposer] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const sessionsRef = useRef([parent]);
  focusParent.mockImplementation(() => {
    setActive(tabsRef.current[0]?.id ?? "other");
    setComposer(true);
    return tabsRef.current.length > 0;
  });
  loadHistory.mockImplementation(async () => {
    setTabs([newTab(parent.id)]);
  });
  actions = useWorkflowRequests({
    tabs, tabsRef, setTabs, sessions: sessionsRef.current, sessionsRef,
    recents: [], activeId: parent.id, activeAppView: null,
    setActiveTabId: setActive, setComposerFocused: setComposer,
    onSubmit: vi.fn(), focusOpenSession: focusParent,
    onSelectHistorySession: loadHistory, onSelectRemoteSession: vi.fn(),
    onNewInProject: vi.fn(),
  }).workflowApp;
  useLayoutEffect(() => {
    latestTabs = tabs;
    commits.push({ active, composer, files: tabs.flatMap(tab => tab.editorPanes.flatMap(pane => pane.files)).length });
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  commits = [];
  focusParent = vi.fn();
  loadHistory = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("workflow navigation", () => {
  it.each(["run", "agent"] as const)("opens %s without an intermediate parent activation", async kind => {
    const tab = newTab(parent.id);
    await act(async () => root.render(createElement(Harness, { initialTabs: [tab] })));
    commits.length = 0;
    await act(async () => {
      if (kind === "run") actions.openRun({ cwd: "/repo", parentSessionId: parent.id, runId: "run" });
      else actions.openAgent({ cwd: "/repo", parentSessionId: parent.id, runId: "run", sessionId: "worker", title: "Worker" });
    });
    expect(focusParent).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
    expect(commits).toEqual([{ active: tab.id, composer: false, files: 1 }]);
    expect(latestTabs[0].layout).not.toEqual(tab.layout);
  });

  it("opens beside a detached source without briefly activating its parent", async () => {
    const run = newWorkflowRunTab("Run", "/repo", { parentSessionId: parent.id, runId: "run" });
    const source = newEditorWorkspaceTab(run);
    await act(async () => root.render(createElement(Harness, { initialTabs: [newTab(parent.id), source] })));
    commits.length = 0;
    await act(async () => actions.openAgent({ cwd: "/repo", parentSessionId: parent.id, runId: "run", sessionId: "worker", title: "Worker", sourceFileId: run.id }));
    expect(focusParent).not.toHaveBeenCalled();
    expect(loadHistory).not.toHaveBeenCalled();
    expect(commits).toEqual([{ active: source.id, composer: false, files: 2 }]);
    expect(latestTabs[0].editorPanes).toHaveLength(0);
  });

  it("waits for an unopened parent to load before adding its run", async () => {
    await act(async () => root.render(createElement(Harness, { initialTabs: [] })));
    await act(async () => actions.openRun({ cwd: "/repo", parentSessionId: parent.id, runId: "run" }));
    expect(loadHistory).toHaveBeenCalledExactlyOnceWith(parent.id);
    expect(latestTabs).toHaveLength(1);
    expect(latestTabs[0].editorPanes[0].files[0].workflowRun?.runId).toBe("run");
    expect(commits.at(-1)).toEqual({ active: latestTabs[0].id, composer: false, files: 1 });
  });
});
