import { describe, expect, it } from "vitest";
import {
  isPreviewableTab,
  newEditorPane,
  newFileTab,
  newTab,
  newWorkflowAgentTab,
  newWorkflowRunTab,
  openEditorTab,
  splitPane,
} from "./layout";

const runTab = () => newWorkflowRunTab("Run", "/repo", {
  runId: "run",
  parentSessionId: "parent",
});
const agentTab = (sessionId = "worker") => newWorkflowAgentTab(sessionId, "/repo", {
  sessionId,
  parentSessionId: "parent",
  runId: "run",
});

describe("workflow tab navigation", () => {
  it("keeps the run and inserts a permanent agent immediately to its right", () => {
    const run = runTab();
    const other = newFileTab("/repo/other.ts", "/repo");
    const worker = agentTab();
    let tab = openEditorTab(newTab("parent"), run);
    tab = openEditorTab(tab, other);
    const layout = tab.layout;
    tab = openEditorTab(tab, worker, { afterFileId: run.id });

    expect(tab.layout).toBe(layout);
    expect(tab.editorPanes).toHaveLength(1);
    expect(tab.editorPanes[0].files.map((file) => file.id)).toEqual([run.id, worker.id, other.id]);
    expect(tab.editorPanes[0].activeFileId).toBe(worker.id);
    expect(tab.editorPanes[0].files.slice(0, 2).every((file) => !file.preview)).toBe(true);
    expect(isPreviewableTab(run)).toBe(false);
    expect(isPreviewableTab(worker)).toBe(false);
  });

  it("uses the source pane even when another editor pane has focus", () => {
    const run = runTab();
    let tab = openEditorTab(newTab("parent"), run);
    const sourcePane = tab.editorPanes[0];
    const otherPane = newEditorPane(newFileTab("/repo/other.ts", "/repo"));
    tab = {
      ...tab,
      layout: splitPane(tab.layout, sourcePane.id, "right", otherPane.id),
      editorPanes: [sourcePane, otherPane],
      focusedId: otherPane.id,
    };
    const worker = agentTab();
    tab = openEditorTab(tab, worker, { afterFileId: run.id });

    expect(tab.focusedId).toBe(sourcePane.id);
    expect(tab.editorPanes[0].files.map((file) => file.id)).toEqual([run.id, worker.id]);
    expect(tab.editorPanes[1]).toBe(otherPane);
  });

  it("keeps different agents and focuses an existing one without moving or duplicating it", () => {
    const run = runTab();
    const first = agentTab("first");
    const second = agentTab("second");
    let tab = openEditorTab(newTab("parent"), run);
    tab = openEditorTab(tab, first, { afterFileId: run.id });
    tab = openEditorTab(tab, second, { afterFileId: run.id });
    const files = tab.editorPanes[0].files;
    expect(files.map((file) => file.id)).toEqual([run.id, second.id, first.id]);
    tab = openEditorTab(tab, agentTab("first"), { afterFileId: run.id });

    expect(tab.editorPanes[0].files).toBe(files);
    expect(tab.editorPanes[0].activeFileId).toBe(first.id);
  });

  it.each([undefined, "closed-source"])("falls back to the focused pane for source %s", (afterFileId) => {
    const run = runTab();
    const worker = agentTab();
    let tab = openEditorTab(newTab("parent"), run);
    const otherPane = newEditorPane(newFileTab("/repo/other.ts", "/repo"));
    tab = {
      ...tab,
      layout: splitPane(tab.layout, tab.focusedId, "right", otherPane.id),
      editorPanes: [...tab.editorPanes, otherPane],
      focusedId: otherPane.id,
    };
    tab = openEditorTab(tab, worker, { afterFileId });

    expect(tab.focusedId).toBe(otherPane.id);
    expect(tab.editorPanes[0].files).toEqual([run]);
    expect(tab.editorPanes[1].files.map((file) => file.id)).toEqual([otherPane.files[0].id, worker.id]);
  });

  it("promotes legacy workflow previews before opening ordinary file previews", () => {
    const run = runTab();
    const worker = agentTab();
    let tab = openEditorTab(openEditorTab(newTab("parent"), run), worker);
    tab.editorPanes[0].files = tab.editorPanes[0].files.map((file) => ({ ...file, preview: true }));
    const firstFile = newFileTab("/repo/first.ts", "/repo");
    const secondFile = newFileTab("/repo/second.ts", "/repo");
    tab = openEditorTab(tab, firstFile);
    tab = openEditorTab(tab, secondFile);

    expect(tab.editorPanes[0].files).toEqual([run, worker, { ...secondFile, preview: true }]);
  });

  it("promotes an existing legacy agent when reopening it", () => {
    const worker = agentTab();
    let tab = openEditorTab(newTab("parent"), worker);
    tab.editorPanes[0].files[0] = { ...worker, preview: true };
    tab = openEditorTab(tab, agentTab());
    tab = openEditorTab(tab, newFileTab("/repo/file.ts", "/repo"));

    expect(tab.editorPanes[0].files[0]).toEqual(worker);
    expect(tab.editorPanes[0].files).toHaveLength(2);
  });
});
