import { afterEach, expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { setRetiredSessionIds } from "../../sessions/model/retiredSessions";
import { newTab, newEditorWorkspaceTab, newFileTab, splitPane, leaf, leafIds } from "./layout";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot, withoutRetiredSessions } from "./workspaceSnapshot";

afterEach(() => setRetiredSessionIds([]));

it("does not resurrect retired stubs or missing leaves and retains adjacent files", () => {
  const chat = { ...newSession("codex", "/repo"), id: "old-lead" };
  const file = newFileTab("/repo/kept.ts", "/repo");
  const editor = newEditorWorkspaceTab(file);
  const tab = { ...newTab(chat.id),
    layout: splitPane(leaf(chat.id), chat.id, "right", editor.focusedId),
    editorPanes: editor.editorPanes,
  };
  const missing = newTab("old-worker");
  const snapshot = collectWorkspaceSnapshot([tab, missing], [chat], tab.id, "/repo", new Map());
  setRetiredSessionIds(["old-lead", "old-worker"]);
  const restored = hydrateWorkspaceSnapshot(snapshot, new Map(), new Set(["old-worker"]));
  expect(restored?.sessions).toEqual([]);
  expect(restored?.tabs).toHaveLength(1);
  expect(leafIds(restored!.tabs[0].layout)).toEqual([editor.focusedId]);
  expect(restored?.tabs[0].editorPanes[0].files[0].path).toBe("/repo/kept.ts");
});

it("keeps an ordinary remote conversation with the same wire ID", () => {
  const cwd = "remote://other/repo";
  const chat = { ...newSession("codex", cwd), id: "old-lead" };
  const tab = newTab(chat.id);
  const snapshot = collectWorkspaceSnapshot([tab], [chat], tab.id, cwd, new Map());
  setRetiredSessionIds([chat.id]);
  expect(hydrateWorkspaceSnapshot(snapshot, new Map())?.sessions[0].id).toBe(chat.id);
});

it("filters window-transfer payloads without dropping file/terminal metadata", () => {
  const tab = newTab("old-lead");
  const editor = newEditorWorkspaceTab(newFileTab("/repo/a.ts", "/repo"));
  const transfer = {
    tabs: [tab, editor], sessions: [{ ...newSession("codex", "/repo"), id: "old-lead" }],
    activeTabId: tab.id, projectCwd: "/repo", dirtyFileIds: [editor.editorPanes[0].files[0].id],
    projectTerminals: [],
  };
  setRetiredSessionIds(["old-lead"]);
  const clean = withoutRetiredSessions(transfer);
  expect(clean.sessions).toEqual([]);
  expect(clean.tabs).toEqual([editor]);
  expect(clean.activeTabId).toBe(editor.id);
  expect(clean.dirtyFileIds).toEqual(transfer.dirtyFileIds);
});
