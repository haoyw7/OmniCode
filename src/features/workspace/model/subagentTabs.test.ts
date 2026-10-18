import { describe, expect, it } from "vitest";
import {
  editorTabKey,
  isFilesystemTab,
  isPreviewableTab,
  leafIds,
  newFileTab,
  newSubagentTab,
  newTab,
  openEditorTab,
} from "./layout";
import { collectWorkspaceSnapshot } from "./workspaceSnapshot";

const agent = (parentSessionId: string, path: string[]) =>
  newSubagentTab("Reviewer", "/repo", {
    parentSessionId,
    path,
    harness: "codex",
  });

describe("provider subagent tabs", () => {
  it("distinguishes parents and nested paths, and focuses existing conversations", () => {
    const first = agent("parent", ["a/b"]);
    const nested = agent("parent", ["a", "b"]);
    const other = agent("other", ["a/b"]);
    expect(new Set([first, nested, other].map(editorTabKey)).size).toBe(3);
    let workspace = openEditorTab(newTab("parent"), first);
    workspace = openEditorTab(workspace, nested, { afterFileId: first.id });
    workspace = openEditorTab(workspace, agent("parent", ["a/b"]));
    expect(workspace.editorPanes).toHaveLength(1);
    expect(workspace.editorPanes[0].files.map((file) => file.id)).toEqual([
      first.id,
      nested.id,
    ]);
    expect(workspace.editorPanes[0].activeFileId).toBe(first.id);
    expect(leafIds(workspace.layout)).toEqual([
      "parent",
      workspace.editorPanes[0].id,
    ]);
    expect(isFilesystemTab(first)).toBe(false);
    expect(isPreviewableTab(first)).toBe(false);
  });

  it("keeps agent tabs when opening files and excludes them from filesystem restoration", () => {
    const first = agent("parent", ["child"]);
    let workspace = openEditorTab(newTab("parent"), first);
    workspace = openEditorTab(workspace, newFileTab("/repo/file.ts", "/repo"));
    expect(workspace.editorPanes[0].files).toHaveLength(2);
    const snapshot = collectWorkspaceSnapshot(
      [workspace],
      [],
      workspace.id,
      "/repo",
      new Map(),
    );
    expect(
      snapshot.tabs[0].editorPanes[0].files.map((file) => file.path),
    ).toEqual(["/repo/file.ts"]);
  });
});
