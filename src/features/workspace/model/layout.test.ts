import { describe, expect, it } from "vitest";
import type { LayoutNode } from "./layout";
import {
  APP_VIEW_KINDS,
  closeLeaf,
  closeSurfacePanes,
  editorTabKey,
  isChangesTab,
  isCommitTab,
  isFilesystemTab,
  isAppViewOnlyTab,
  isAppViewTab,
  isPreviewableTab,
  isVirtualDocumentTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  layoutLeaves,
  layoutSashes,
  leaf,
  leafIds,
  sessionToolPanes,
  sessionsWithToolPanes,
  newChangesTab,
  newCommitTab,
  newEditorWorkspaceTab,
  newAppViewWorkspaceTab,
  newFileTab,
  newPlanTab,
  newReleaseNotesWorkspaceTab,
  newSessionChangesTab,
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  resetTabToSession,
  isolateTerminalPanes,
  movePane,
  moveTabPane,
  openChangesTab,
  openCommitTab,
  openEditorTab,
  openFileExplorer,
  openAppViewTab,
  openSessionAppView,
  openSessionChangesTab,
  pinEditorFile,
  openWorkspaceFile,
  openTerminalTab,
  paneEdgeFromPoint,
  placePane,
  splitPane,
  splitSizesAtBoundary,
  updateTerminalTab,
  type WorkspaceTab,
} from "./layout";

describe("app view tabs", () => {
  it.each(APP_VIEW_KINDS)("opens %s as a permanent virtual document", (kind) => {
    const tab = newAppViewWorkspaceTab(kind);
    const file = tab.editorPanes[0].files[0];
    expect(file).toMatchObject({ path: `app:${kind}`, cwd: "~", appView: { kind } });
    expect(editorTabKey(file)).toBe(`app:${kind}`);
    expect(isAppViewTab(file)).toBe(true);
    expect(isVirtualDocumentTab(file)).toBe(true);
    expect(isFilesystemTab(file)).toBe(false);
    expect(isPreviewableTab(file)).toBe(false);
    expect(isAppViewOnlyTab(tab)).toBe(true);
    expect(openEditorTab(newTab("chat"), file).editorPanes[0].files[0].preview)
      .toBeUndefined();
  });

  it("finds an existing kind across the whole window and focuses its pane", () => {
    const chat = newTab("chat");
    const opened = openAppViewTab([chat], "settings");
    const settings = opened.tabs[1];
    const mixed = {
      ...settings,
      layout: splitPane(settings.layout, settings.focusedId, "right", "other-chat"),
      focusedId: "other-chat",
      diffFocused: true,
    };
    const reopened = openAppViewTab([chat, mixed], "settings");
    expect(reopened.tabs).toHaveLength(2);
    expect(reopened.tabId).toBe(settings.id);
    expect(reopened.paneId).toBe(settings.focusedId);
    expect(reopened.tabs[1].focusedId).toBe(settings.focusedId);
    expect(reopened.tabs[1].diffFocused).toBe(false);
    expect(reopened.tabs[1].editorPanes[0].files).toEqual(settings.editorPanes[0].files);
    expect(isAppViewOnlyTab(mixed)).toBe(false);
  });

  it("keeps the same app view independent in each chat and reuses it locally", () => {
    const first = openSessionAppView(newTab("first-chat"), "notes");
    const second = openSessionAppView(newTab("second-chat"), "notes");
    const firstNotes = first.editorPanes[0];
    const secondNotes = second.editorPanes[0];
    expect(firstNotes.id).not.toBe(secondNotes.id);
    expect(firstNotes.files[0].id).not.toBe(secondNotes.files[0].id);
    expect(leafIds(first.layout)).toContain("first-chat");
    expect(leafIds(second.layout)).toContain("second-chat");

    const withSettings = openSessionAppView(first, "settings");
    const reopened = openSessionAppView(withSettings, "notes");
    expect(reopened.id).toBe(first.id);
    expect(reopened.editorPanes).toHaveLength(withSettings.editorPanes.length);
    expect(reopened.focusedId).toBe(firstNotes.id);
    expect(reopened.editorPanes[0].activeFileId).toBe(firstNotes.files[0].id);
    expect(reopened.editorPanes[0].files[0].preview).toBeUndefined();
    expect(second.editorPanes[0]).toBe(secondNotes);
  });

  it("recognizes split app-only tabs and excludes sessions, files and terminals", () => {
    const settings = newAppViewWorkspaceTab("settings");
    const notesPane = newAppViewWorkspaceTab("notes").editorPanes[0];
    const only = {
      ...settings,
      layout: splitPane(settings.layout, settings.focusedId, "right", notesPane.id),
      editorPanes: [...settings.editorPanes, notesPane],
    };
    expect(isAppViewOnlyTab(only)).toBe(true);
    expect(isAppViewOnlyTab({ ...only, terminalPanes: [notesPane] })).toBe(false);
    expect(isAppViewOnlyTab(newTab("chat"))).toBe(false);
    expect(isAppViewOnlyTab(newEditorWorkspaceTab(newFileTab("/r/a.ts", "/r"))))
      .toBe(false);
  });

  it.each(["file", "plan", "diff"])(
    "splits a %s beside the app view instead of inserting inside it",
    (kind) => {
      const app = newAppViewWorkspaceTab("settings");
      const file = kind === "plan"
        ? newPlanTab("chat", "plan", "Plan", "/repo")
        : newFileTab("/repo/file.ts", "/repo", kind === "diff");
      const opened = openEditorTab(app, file);
      expect(opened.editorPanes).toHaveLength(2);
      expect(opened.editorPanes[0]).toBe(app.editorPanes[0]);
      expect(opened.editorPanes[1].files[0].id).toBe(file.id);
      expect(opened.focusedId).toBe(opened.editorPanes[1].id);
    },
  );

  it("uses a non-app pane when the app view has focus", () => {
    const app = newAppViewWorkspaceTab("notes");
    const mixed = openEditorTab(app, newFileTab("/repo/a.ts", "/repo"), { pin: true });
    mixed.focusedId = app.focusedId;
    const opened = openEditorTab(mixed, newFileTab("/repo/b.ts", "/repo"));
    expect(opened.editorPanes).toHaveLength(2);
    expect(opened.editorPanes[0].files).toEqual(app.editorPanes[0].files);
    expect(opened.editorPanes[1].files.map((file) => file.path))
      .toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });
});

describe("preview tabs", () => {
  it("keeps remote files from different machines in distinct editor tabs", () => {
    const first = newFileTab("remote://machine-a/repo/a.ts", "remote://machine-a/repo");
    const second = newFileTab("remote://machine-b/repo/a.ts", "remote://machine-b/repo");
    expect(editorTabKey(first)).not.toBe(editorTabKey(second));
    let tab = openEditorTab(newTab("s"), first, { pin: true });
    tab = openEditorTab(tab, second, { pin: true });
    expect(tab.editorPanes[0]?.files).toHaveLength(2);
  });
  it("keeps remote file and review tabs distinct and retargets one unified review", () => {
    const cwd = "remote://machine/repo";
    const ordinary = newFileTab(`${cwd}/a.ts`, cwd);
    const review = {
      ...ordinary,
      id: crypto.randomUUID(),
      review: true,
      changeKind: "staged" as const,
    };
    const changes = newChangesTab(cwd, `${cwd}/a.ts`, "staged");
    expect(editorTabKey(ordinary)).not.toBe(editorTabKey(review));
    expect(editorTabKey(review)).not.toBe(editorTabKey(changes));
    let tab = openEditorTab(newTab("s"), ordinary, { pin: true });
    tab = openEditorTab(tab, review, { pin: true });
    tab = openEditorTab(tab, { ...review, changeKind: "unstaged" });
    expect(
      tab.editorPanes
        .flatMap((pane) => pane.files)
        .find((file) => file.review && !file.changes)?.changeKind,
    ).toBe("unstaged");
    tab = openChangesTab(tab, cwd, `${cwd}/a.ts`, "staged");
    tab = openChangesTab(tab, cwd, `${cwd}/b.ts`, "unstaged");
    const open = tab.editorPanes.flatMap((pane) => pane.files);
    expect(open).toHaveLength(2);
    expect(open.find((file) => file.changes)).toMatchObject({
      path: `${cwd}/b.ts`,
      changeKind: "unstaged",
    });
  });
  const paths = (tab: WorkspaceTab) =>
    tab.editorPanes[0]?.files.map((file) => [file.path, !!file.preview]);

  it("replaces the pane's preview in place and keeps permanent tabs", () => {
    let tab = openEditorTab(newTab("s"), newFileTab("/r/a.ts", "/r"), {
      pin: true,
    });
    tab = openEditorTab(tab, newFileTab("/r/b.ts", "/r"));
    tab = openEditorTab(tab, newFileTab("/r/c.ts", "/r", true));
    tab = openEditorTab(
      tab,
      newCommitTab("/r", { sha: "1", shortSha: "1", subject: "x" }),
    );
    expect(paths(tab)).toEqual([
      ["/r/a.ts", false],
      ["commit:1", true],
    ]);
    expect(tab.editorPanes[0]?.activeFileId).toBe(
      tab.editorPanes[0]?.files[1]?.id,
    );
  });

  it("promotes an open preview when reopened pinned, and pinEditorFile does the same", () => {
    let tab = openEditorTab(newTab("s"), newFileTab("/r/a.ts", "/r"));
    tab = openEditorTab(tab, newFileTab("/r/a.ts", "/r"), { pin: true });
    tab = openEditorTab(tab, newFileTab("/r/b.ts", "/r"));
    expect(paths(tab)).toEqual([
      ["/r/a.ts", false],
      ["/r/b.ts", true],
    ]);
    const previewId = tab.editorPanes[0]!.files[1]!.id;
    tab = pinEditorFile(tab, previewId);
    tab = openEditorTab(tab, newFileTab("/r/c.ts", "/r"));
    expect(paths(tab)?.map(([path]) => path)).toEqual([
      "/r/a.ts",
      "/r/b.ts",
      "/r/c.ts",
    ]);
    expect(pinEditorFile(tab, previewId)).toBe(tab);
  });

  it("never makes plans or Changes reviews previews", () => {
    let tab = openEditorTab(newTab("s"), newPlanTab("s", "p", "Plan", "/r"));
    tab = openChangesTab(tab, "/r");
    tab = openEditorTab(tab, newFileTab("/r/a.ts", "/r"));
    expect(paths(tab)?.map(([, preview]) => preview)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("workspace mode: back-to-back opens share one preview per project", () => {
    const append = (tabs: WorkspaceTab[], tab: WorkspaceTab) => [...tabs, tab];
    const open = (
      tabs: WorkspaceTab[],
      path: string,
      cwd: string,
      pin = false,
    ) => {
      const file = newFileTab(path, cwd);
      const created = newEditorWorkspaceTab(
        pin ? file : { ...file, preview: true },
      );
      return openWorkspaceFile(tabs, file, created, append, pin).tabs;
    };
    // Each open reads the previous result, as chained state updaters do.
    let tabs = open([newTab("s")], "/r/a.ts", "/r");
    tabs = open(tabs, "/r/b.ts", "/r");
    tabs = open(tabs, "/other/c.ts", "/other");
    const files = () =>
      tabs
        .slice(1)
        .map((tab) => tab.editorPanes[0]?.files.map((file) => file.path));
    expect(files()).toEqual([["/r/b.ts"], ["/other/c.ts"]]);

    tabs = open(tabs, "/r/d.ts", "/r", true);
    tabs = open(tabs, "/r/e.ts", "/r");
    expect(files()).toEqual([["/r/e.ts"], ["/other/c.ts"], ["/r/d.ts"]]);
  });
});

describe("splitSizesAtBoundary", () => {
  it("moves only the adjacent panes and preserves their total", () => {
    const result = splitSizesAtBoundary([0.2, 0.3, 0.5], 1, 0.7);
    expect(result[0]).toBe(0.2);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(0.3);
  });

  it("clamps both panes to the minimum size", () => {
    const right = splitSizesAtBoundary([0.5, 0.5], 0, 0.99);
    expect(right[0]).toBeCloseTo(0.92);
    expect(right[1]).toBeCloseTo(0.08);

    const left = splitSizesAtBoundary([0.5, 0.5], 0, 0.01);
    expect(left[0]).toBeCloseTo(0.08);
    expect(left[1]).toBeCloseTo(0.92);
  });

  it("leaves invalid boundaries unchanged", () => {
    const sizes = [0.5, 0.5];
    expect(splitSizesAtBoundary(sizes, 2, 0.5)).toBe(sizes);
  });
});

describe("layoutLeaves", () => {
  it("keeps a single pane filling the tab", () => {
    const leaves = layoutLeaves(leaf("a"));
    expect(leaves).toEqual([
      { id: "a", rect: { x: 0, y: 0, w: 1, h: 1 }, axis: "x" },
    ]);
  });

  it("places a right split side by side without changing leaf ids", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const leaves = layoutLeaves(tree);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(leaves[0].rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(leaves[1].rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });
});

describe("layoutSashes", () => {
  it("puts a sash on the shared edge of a right split", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const sashes = layoutSashes(tree);
    expect(sashes).toHaveLength(1);
    expect(sashes[0]?.index).toBe(0);
    expect(sashes[0]?.dir).toBe("right");
    expect(sashes[0]?.group).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("editorTabKey", () => {
  it("keeps a working-tree tab distinct from a normal file tab", () => {
    const cwd = "/repo";
    const path = "/repo/EventStore.swift";
    expect(editorTabKey(newFileTab(path, cwd))).toBe(`file:${path}`);
    expect(editorTabKey(newFileTab(path, cwd, true))).toBe(`review:${path}`);
    expect(editorTabKey(newChangesTab(cwd, path))).toBe(`changes:${cwd}`);
    expect(editorTabKey(newChangesTab(cwd, `${cwd}/other.ts`))).toBe(
      `changes:${cwd}`,
    );
    expect(editorTabKey(newSessionChangesTab(cwd, "s1", path))).toBe(
      `session-changes:${cwd}:s1`,
    );
    expect(isFilesystemTab(newSessionChangesTab(cwd, "s1", path))).toBe(false);
    expect(
      editorTabKey(
        newCommitTab(cwd, {
          sha: "abc1234deadbeef",
          shortSha: "abc1234",
          subject: "Fix the graph",
        }),
      ),
    ).toBe(`commit:${cwd}:abc1234deadbeef`);
    expect(editorTabKey(newPlanTab("s", "b", "Plan", cwd))).toBe("plan:b");
    const terminal = newTerminalFile(cwd);
    expect(editorTabKey(terminal)).toBe(`terminal:${terminal.id}`);
    expect(isTerminalTab(terminal)).toBe(true);
    expect(isTerminalTab(newFileTab(path, cwd))).toBe(false);
  });
});

describe("openSessionChangesTab", () => {
  it("reuses one review per session without merging different sessions", () => {
    const cwd = "/repo";
    const first = openSessionChangesTab(
      newTab("session-a"),
      cwd,
      "session-a",
      "/repo/a.ts",
      undefined,
      true,
    );
    const focused = openSessionChangesTab(
      first,
      cwd,
      "session-a",
      "/repo/b.ts",
    );
    const second = openSessionChangesTab(
      focused,
      cwd,
      "session-b",
      "/repo/c.ts",
    );
    const reviews = second.editorPanes.flatMap((pane) =>
      pane.files.filter(isSessionChangesTab),
    );
    expect(reviews).toHaveLength(2);
    expect(
      reviews.find((file) => file.sessionChanges.sessionId === "session-a")
        ?.path,
    ).toBe("/repo/b.ts");
  });
});

describe("openChangesTab", () => {
  it("keeps Changes and per-file reviews independent across worktrees", () => {
    const main = openChangesTab(newTab("session-a"), "/repo");
    const mainReview = newFileTab("/repo/a.ts", "/repo", true);
    const withReview = openEditorTab(main, mainReview, { pin: true });
    const worktree = openChangesTab(
      withReview,
      "/repo-worktrees/feature",
      undefined,
      undefined,
      "/repo",
    );
    const files = worktree.editorPanes.flatMap((pane) => pane.files);
    expect(files.filter(isChangesTab).map((file) => file.cwd)).toEqual([
      "/repo",
      "/repo-worktrees/feature",
    ]);
    expect(files).toContainEqual(mainReview);
    const pane = worktree.editorPanes.find(
      (pane) => pane.id === worktree.focusedId,
    )!;
    expect(
      pane.files.find((file) => file.id === pane.activeFileId),
    ).toMatchObject({
      cwd: "/repo-worktrees/feature",
      projectCwd: "/repo",
    });
    const back = openChangesTab(worktree, "/repo");
    expect(
      back.editorPanes.flatMap((pane) => pane.files).filter(isChangesTab),
    ).toHaveLength(2);
    expect(back.editorPanes[0]?.activeFileId).toBe(
      main.editorPanes[0]?.activeFileId,
    );
  });

  it("reuses one Changes tab and updates the focused file", () => {
    const cwd = "/repo";
    const first = openChangesTab(
      newTab("session-a"),
      cwd,
      "/repo/a.ts",
      "staged",
    );
    const second = openChangesTab(first, cwd, "/repo/b.ts", "unstaged");
    const files = second.editorPanes[0]?.files ?? [];
    expect(files.filter(isChangesTab)).toHaveLength(1);
    expect(files.filter(isReviewTab)).toHaveLength(1);
    expect(files.find(isChangesTab)?.path).toBe("/repo/b.ts");
    expect(files.find(isChangesTab)?.changeKind).toBe("unstaged");
  });

  it("switches the reused Changes tab to the section it was opened from", () => {
    const cwd = "/repo";
    const staged = openChangesTab(
      newTab("session-a"),
      cwd,
      undefined,
      "staged",
    );
    const unstaged = openChangesTab(staged, cwd, undefined, "unstaged");
    const all = openChangesTab(unstaged, cwd);
    const kindOf = (tab: typeof staged) =>
      tab.editorPanes[0]?.files.find(isChangesTab)?.changeKind;
    expect(kindOf(staged)).toBe("staged");
    expect(kindOf(unstaged)).toBe("unstaged");
    expect(kindOf(all)).toBeUndefined();
  });

  it("opens a Changes tab without a focused file", () => {
    const cwd = "/repo";
    const next = openChangesTab(newTab("session-a"), cwd);
    expect(next.editorPanes[0]?.files.find(isChangesTab)?.path).toBe(cwd);
  });

  it("drops per-file review tabs in the same pane", () => {
    const cwd = "/repo";
    const withReview = openEditorTab(
      newTab("session-a"),
      newFileTab("/repo/a.ts", cwd, true),
    );
    const next = openChangesTab(withReview, cwd, "/repo/b.ts");
    const files = next.editorPanes[0]?.files ?? [];
    expect(
      files.some((file) => editorTabKey(file) === `review:${cwd}/a.ts`),
    ).toBe(false);
    expect(files.filter(isChangesTab)).toHaveLength(1);
  });

  it("keeps a commit tab when opening Changes", () => {
    const cwd = "/repo";
    const withCommit = openCommitTab(newTab("session-a"), cwd, {
      sha: "abc1234deadbeef",
      shortSha: "abc1234",
      subject: "Fix the graph",
    });
    const next = openChangesTab(withCommit, cwd);
    const files = next.editorPanes[0]?.files ?? [];
    expect(files.filter(isCommitTab)).toHaveLength(1);
    expect(files.filter(isChangesTab)).toHaveLength(1);
  });
});

describe("openCommitTab", () => {
  it("reuses one tab per commit", () => {
    const cwd = "/repo";
    const commit = {
      sha: "abc1234deadbeef",
      shortSha: "abc1234",
      subject: "Fix the graph",
    };
    const first = openCommitTab(newTab("session-a"), cwd, commit);
    const second = openCommitTab(first, cwd, { ...commit, subject: "other" });
    const files = second.editorPanes[0]?.files ?? [];
    const commitFile = files.find(isCommitTab);
    expect(files.filter(isCommitTab)).toHaveLength(1);
    expect(commitFile?.commit.subject).toBe("Fix the graph");
    expect(commitFile && isFilesystemTab(commitFile)).toBe(false);
  });
});

describe("newReleaseNotesWorkspaceTab", () => {
  it("creates a projectless editor-only workspace tab", () => {
    const tab = newReleaseNotesWorkspaceTab({ version: "0.1.23" });
    const file = tab.editorPanes[0]?.files[0];

    expect(file && isReleaseNotesTab(file)).toBe(true);
    expect(file && editorTabKey(file)).toBe("release-notes:0.1.23");
    expect(file && isReviewTab(file)).toBe(false);
    expect(file && isFilesystemTab(file)).toBe(false);
    expect(tab.terminalPanes).toEqual([]);
    expect(layoutLeaves(tab.layout).map((pane) => pane.id)).toEqual([
      tab.editorPanes[0]?.id,
    ]);
    expect(tab.focusedId).toBe(tab.editorPanes[0]?.id);
  });

  it("deduplicates release files by version", () => {
    const first = newReleaseNotesWorkspaceTab({ version: "0.1.23" })
      .editorPanes[0]!.files[0]!;
    const second = newReleaseNotesWorkspaceTab({ version: "0.1.23" })
      .editorPanes[0]!.files[0]!;
    expect(editorTabKey(first)).toBe(editorTabKey(second));
  });
});

describe("openTerminalTab", () => {
  it("occupies a session pane instead of splitting a leftover chat", () => {
    const tab = newTab("session-a");
    const file = newTerminalFile("/repo");
    const next = openTerminalTab(tab, file, "session-a");
    expect(layoutLeaves(next.layout).map((pane) => pane.id)).toEqual([
      next.terminalPanes[0]?.id,
    ]);
    expect(next.focusedId).toBe(next.terminalPanes[0]?.id);
    expect(next.editorPanes).toEqual([]);
    expect(next.terminalPanes[0]?.files).toEqual([file]);
  });

  it("opens a terminal card beside the session when no terminal pane exists", () => {
    const tab = newTab("session-a");
    const file = newTerminalFile("/repo");
    const next = openTerminalTab(tab, file);
    const leaves = layoutLeaves(next.layout);
    expect(leaves.map((pane) => pane.id)).toEqual([
      "session-a",
      next.terminalPanes[0]?.id,
    ]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(leaves[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(next.editorPanes).toEqual([]);
    expect(next.terminalPanes[0]?.files).toEqual([file]);
  });

  it("stacks a terminal card under the document card", () => {
    const withFile = openEditorTab(
      newTab("session-a"),
      newFileTab("/repo/App.tsx", "/repo"),
    );
    const next = openTerminalTab(withFile, newTerminalFile("/repo"));
    const leaves = layoutLeaves(next.layout);
    expect(leaves.map((pane) => pane.rect)).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ]);
  });

  it("keeps terminals out of the file pane tab strip", () => {
    const withFile = openEditorTab(
      newTab("session-a"),
      newFileTab("/repo/App.tsx", "/repo"),
    );
    const first = newTerminalFile("/repo");
    const withTerminal = openTerminalTab(withFile, first);
    const extra = newTerminalFile(
      "/repo",
      nextTerminalTitle(withTerminal, "/repo"),
    );
    const next = openTerminalTab(withTerminal, extra);
    expect(next.editorPanes).toHaveLength(1);
    expect(next.editorPanes[0]?.files.map((file) => file.path)).toEqual([
      "/repo/App.tsx",
    ]);
    expect(next.terminalPanes).toHaveLength(1);
    expect(next.terminalPanes[0]?.files.map((file) => file.id)).toEqual([
      first.id,
      extra.id,
    ]);
    expect(extra.path).toBe("repo 2");
    expect(layoutLeaves(next.layout)).toHaveLength(3);
  });
});

describe("closeLeaf", () => {
  it("keeps a file pane when the last chat is closed", () => {
    const file = newFileTab("/repo/App.tsx", "/repo");
    const tab = openEditorTab(newTab("session-a"), file, { pin: true });
    const next = closeLeaf(tab, "session-a");
    expect(next).not.toBeNull();
    expect(layoutLeaves(next!.layout).map((pane) => pane.id)).toEqual([
      next!.editorPanes[0]?.id,
    ]);
    expect(next!.focusedId).toBe(next!.editorPanes[0]?.id);
    expect(next!.editorPanes[0]?.files).toEqual([file]);
  });

  it("keeps a terminal pane when the last chat is closed", () => {
    const file = newTerminalFile("/repo");
    const tab = openTerminalTab(newTab("session-a"), file);
    const next = closeLeaf(tab, "session-a");
    expect(next).not.toBeNull();
    expect(layoutLeaves(next!.layout).map((pane) => pane.id)).toEqual([
      next!.terminalPanes[0]?.id,
    ]);
    expect(next!.focusedId).toBe(next!.terminalPanes[0]?.id);
    expect(next!.terminalPanes[0]?.files).toEqual([file]);
  });

  it("returns null when closing the last remaining pane", () => {
    expect(closeLeaf(newTab("session-a"), "session-a")).toBeNull();
  });

  it("gives a closed pane's space to its neighbour and keeps the other sizes", () => {
    const ids = ["a", "b", "c", "d"];
    const tab = {
      ...newTab("a"),
      layout: { type: "split", id: "row", dir: "right", sizes: [0.1, 0.2, 0.3, 0.4], children: ids.map((id) => ({ type: "leaf" as const, id })) } as LayoutNode,
    };
    const widths = (next: ReturnType<typeof closeLeaf>) =>
      layoutLeaves(next!.layout).map((pane) => [pane.id, Math.round(pane.rect.w * 100)]);
    expect(widths(closeLeaf(tab, "c"))).toEqual([["a", 10], ["b", 50], ["d", 40]]);
    expect(widths(closeLeaf(tab, "a"))).toEqual([["b", 30], ["c", 30], ["d", 40]]);
  });
});

describe("closeSurfacePanes", () => {
  it("keeps the chat and clears every editor pane", () => {
    const tab = openEditorTab(
      openEditorTab(newTab("session-a"), newFileTab("/repo/a.ts", "/repo")),
      newFileTab("/repo/b.ts", "/repo"),
      { split: "right" },
    );
    const next = closeSurfacePanes(tab, "editor");
    expect(next).not.toBeNull();
    expect(layoutLeaves(next!.layout).map((pane) => pane.id)).toEqual([
      "session-a",
    ]);
    expect(next!.focusedId).toBe("session-a");
    expect(next!.editorPanes).toEqual([]);
  });

  it("keeps a terminal pane when the editor panes go", () => {
    const tab = openEditorTab(
      openTerminalTab(newTab("session-a"), newTerminalFile("/repo")),
      newFileTab("/repo/a.ts", "/repo"),
    );
    const next = closeSurfacePanes(closeLeaf(tab, "session-a")!, "editor");
    expect(next).not.toBeNull();
    expect(layoutLeaves(next!.layout).map((pane) => pane.id)).toEqual([
      next!.terminalPanes[0]?.id,
    ]);
    expect(next!.editorPanes).toEqual([]);
  });

  it("returns null when only editor panes remain", () => {
    const tab = closeLeaf(
      openEditorTab(newTab("session-a"), newFileTab("/repo/a.ts", "/repo")),
      "session-a",
    )!;
    expect(closeSurfacePanes(tab, "editor")).toBeNull();
  });

  it("leaves a tab without panes of that kind unchanged", () => {
    const tab = newTab("session-a");
    expect(closeSurfacePanes(tab, "editor")).toEqual(tab);
  });
});

describe("resetTabToSession", () => {
  it("keeps id and group, replaces contents with one session leaf", () => {
    const tab = {
      ...openEditorTab(newTab("session-a"), newFileTab("/repo/a.ts", "/repo")),
      groupId: "group-1",
      diffOpen: true,
      diffFocused: true,
      surfaceMode: "unified" as const,
      autoArrangeTools: false,
    };
    const next = resetTabToSession(tab, "session-b");
    expect(next.id).toBe(tab.id);
    expect(next.groupId).toBe("group-1");
    expect(next.layout).toEqual(leaf("session-b"));
    expect(next.focusedId).toBe("session-b");
    expect(next.editorPanes).toEqual([]);
    expect(next.terminalPanes).toEqual([]);
    expect(next.diffOpen).toBe(false);
    expect(next.diffFocused).toBe(false);
    expect(next.surfaceMode).toBeUndefined();
    expect(next.autoArrangeTools).toBeUndefined();
  });
});

describe("openEditorTab", () => {
  it("can put the first file before a focused session", () => {
    const file = newFileTab("/repo/App.tsx", "/repo");
    const next = openEditorTab(newTab("session-a"), file, { split: "left" });
    const leaves = layoutLeaves(next.layout);

    expect(leaves.map((pane) => pane.id)).toEqual([
      next.editorPanes[0]?.id,
      "session-a",
    ]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(leaves[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(next.focusedId).toBe(next.editorPanes[0]?.id);
  });

  it("does not open files into a terminal pane", () => {
    const terminal = openTerminalTab(
      newTab("session-a"),
      newTerminalFile("/repo"),
    );
    const next = openEditorTab(terminal, newFileTab("/repo/App.tsx", "/repo"));
    expect(next.terminalPanes[0]?.files.every(isTerminalTab)).toBe(true);
    expect(next.editorPanes[0]?.files.map((file) => file.path)).toEqual([
      "/repo/App.tsx",
    ]);
    expect(layoutLeaves(next.layout)).toHaveLength(3);
  });
});

describe("newTerminalWorkspaceTab", () => {
  it("creates a tab whose only leaf is the terminal pane", () => {
    const file = newTerminalFile("/repo");
    const tab = newTerminalWorkspaceTab(file);
    expect(layoutLeaves(tab.layout).map((pane) => pane.id)).toEqual([
      tab.terminalPanes[0]?.id,
    ]);
    expect(tab.focusedId).toBe(tab.terminalPanes[0]?.id);
    expect(tab.editorPanes).toEqual([]);
    expect(tab.terminalPanes[0]?.files).toEqual([file]);
  });
});

describe("newEditorWorkspaceTab", () => {
  it("creates a top-level tab whose only leaf is the file pane", () => {
    const file = newFileTab("/repo/App.tsx", "/repo");
    const tab = newEditorWorkspaceTab(file);
    expect(layoutLeaves(tab.layout).map((pane) => pane.id)).toEqual([
      tab.editorPanes[0]?.id,
    ]);
    expect(tab.focusedId).toBe(tab.editorPanes[0]?.id);
    expect(tab.editorPanes[0]?.files).toEqual([file]);
    expect(tab.terminalPanes).toEqual([]);
  });
});

describe("updateTerminalTab", () => {
  it("stores the foreground process on the matching terminal", () => {
    const file = newTerminalFile("/repo");
    const tab = openTerminalTab(newTab("session-a"), file);
    const next = updateTerminalTab(tab, file.id, {
      title: "vite",
      foreground: "vite",
    });
    expect(next.terminalPanes[0]?.files[0]).toMatchObject({
      path: "vite",
      foreground: "vite",
    });
    expect(updateTerminalTab(next, file.id, { foreground: "vite" })).toBe(next);
  });
});

describe("isolateTerminalPanes", () => {
  it("splits mixed file and terminal tabs into separate panes", () => {
    const file = newFileTab("/repo/App.tsx", "/repo");
    const terminal = newTerminalFile("/repo");
    const mixed = openEditorTab(newTab("session-a"), file);
    const pane = mixed.editorPanes[0];
    if (!pane) throw new Error("expected editor pane");
    const tab = {
      ...mixed,
      editorPanes: [
        {
          ...pane,
          files: [file, terminal],
          activeFileId: terminal.id,
        },
      ],
    };
    const next = isolateTerminalPanes(tab);
    expect(next.editorPanes[0]?.files.map((entry) => entry.id)).toEqual([
      file.id,
    ]);
    expect(next.terminalPanes[0]?.files.map((entry) => entry.id)).toEqual([
      terminal.id,
    ]);
    expect(next.focusedId).toBe(next.terminalPanes[0]?.id);
    expect(layoutLeaves(next.layout)).toHaveLength(3);
  });
});

describe("paneEdgeFromPoint", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it("picks the nearest edge from the pane center", () => {
    expect(paneEdgeFromPoint(20, 50, rect)).toBe("left");
    expect(paneEdgeFromPoint(80, 50, rect)).toBe("right");
    expect(paneEdgeFromPoint(50, 20, rect)).toBe("top");
    expect(paneEdgeFromPoint(50, 80, rect)).toBe("bottom");
  });
});

describe("moveTabPane", () => {
  it("preserves an explicit horizontal tool placement during later fitting", () => {
    const tab: WorkspaceTab = {
      ...newTab("chat"),
      layout: {
        type: "split", id: "root", dir: "right", sizes: [0.6, 0.4],
        children: [leaf("chat"), {
          type: "split", id: "tools", dir: "down", sizes: [0.5, 0.5],
          children: [leaf("files"), leaf("terminal")],
        }],
      },
    };
    const moved = moveTabPane(tab, "terminal", "files", "right");
    const [, files, terminal] = layoutLeaves(moved.layout);
    expect(files.rect.y).toBe(terminal.rect.y);
    expect(terminal.rect.x).toBeGreaterThan(files.rect.x);
    expect(moved.autoArrangeTools).toBe(false);
    expect(moved.focusedId).toBe("terminal");
    expect(moved.editorPanes).toBe(tab.editorPanes);
  });

  it("records a valid manual placement even when its order already matches", () => {
    const tab = { ...newTab("chat"), layout: splitPane(leaf("chat"), "chat", "right", "files") };
    const moved = moveTabPane(tab, "files", "chat", "right");
    expect(moved.layout).toBe(tab.layout);
    expect(moved.autoArrangeTools).toBe(false);
    expect(moveTabPane(moved, "files", "chat", "right")).toBe(moved);
  });

  it("does not turn off automatic placement for an invalid drop", () => {
    const tab = newTab("chat");
    expect(moveTabPane(tab, "missing", "chat", "right")).toBe(tab);
    expect(tab.autoArrangeTools).toBeUndefined();
  });
});

describe("movePane", () => {
  it("reorders siblings along a horizontal split", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const next = movePane(tree, "a", "b", "right");
    const leaves = layoutLeaves(next);
    expect(leaves.map((pane) => pane.id)).toEqual(["b", "a"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(leaves[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("stacks a dragged pane under its sibling", () => {
    const tree = splitPane(leaf("a"), "a", "right", "b");
    const next = movePane(tree, "b", "a", "bottom");
    const leaves = layoutLeaves(next);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(leaves[1]?.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it("nests a pane under one column of a row", () => {
    const row = splitPane(
      splitPane(leaf("a"), "a", "right", "b"),
      "b",
      "right",
      "c",
    );
    const next = movePane(row, "c", "a", "bottom");
    const leaves = layoutLeaves(next);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "c", "b"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(leaves[1]?.rect).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(leaves[2]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("inserts into an existing vertical split on a matching edge", () => {
    const stacked = splitPane(leaf("a"), "a", "down", "b");
    const row = splitPane(stacked, "a", "right", "c");
    const next = movePane(row, "c", "a", "bottom");
    const leaves = layoutLeaves(next);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "c", "b"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 1, h: 0.25 });
    expect(leaves[1]?.rect).toEqual({ x: 0, y: 0.25, w: 1, h: 0.25 });
    expect(leaves[2]?.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe("placePane", () => {
  it("splits a lone pane toward the drop edge", () => {
    const right = layoutLeaves(placePane(leaf("a"), "b", "a", "right"));
    expect(right.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(right[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    expect(right[1]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });

    const left = layoutLeaves(placePane(leaf("a"), "b", "a", "left"));
    expect(left.map((pane) => pane.id)).toEqual(["b", "a"]);

    const below = layoutLeaves(placePane(leaf("a"), "b", "a", "bottom"));
    expect(below.map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(below[1]?.rect).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it("inserts into an existing row on a matching edge", () => {
    const row = splitPane(leaf("a"), "a", "right", "b");
    const next = placePane(row, "c", "a", "right");
    expect(layoutLeaves(next).map((pane) => pane.id)).toEqual(["a", "c", "b"]);
  });

  it("nests onto one column of a row", () => {
    const row = splitPane(leaf("a"), "a", "right", "b");
    const next = placePane(row, "c", "a", "bottom");
    const leaves = layoutLeaves(next);
    expect(leaves.map((pane) => pane.id)).toEqual(["a", "c", "b"]);
    expect(leaves[0]?.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(leaves[1]?.rect).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(leaves[2]?.rect).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("moves an existing pane instead of duplicating it", () => {
    const row = splitPane(leaf("a"), "a", "right", "b");
    const next = placePane(row, "a", "b", "right");
    expect(layoutLeaves(next).map((pane) => pane.id)).toEqual(["b", "a"]);
  });

  it("ignores a missing target or a drop onto itself", () => {
    const tree = leaf("a");
    expect(placePane(tree, "b", "missing", "right")).toBe(tree);
    expect(placePane(tree, "a", "a", "right")).toBe(tree);
  });
});


describe("file explorer panes", () => {
  it("keeps the browser and its file previews separate from changes and virtual documents", () => {
    const initial = openFileExplorer(newTab("chat"), "/repo");
    const explorerId = initial.focusedId;
    const browser = initial.editorPanes[0].files[0];
    expect(isFilesystemTab(browser)).toBe(false);
    expect(isPreviewableTab(browser)).toBe(false);
    const first = openEditorTab(initial, newFileTab("/repo/a.ts", "/repo"));
    const second = openEditorTab(first, newFileTab("/repo/b.ts", "/repo"));
    expect(second.focusedId).toBe(explorerId);
    expect(second.editorPanes[0].files.map(file => file.path)).toEqual(["/repo", "/repo/b.ts"]);
    const review = openChangesTab(second, "/repo");
    expect(review.focusedId).not.toBe(explorerId);
    expect(review.editorPanes.find(pane => pane.id === explorerId)).toEqual(second.editorPanes[0]);
    const reopened = openFileExplorer(review, "/repo");
    expect(reopened.focusedId).toBe(explorerId);
    expect(reopened.editorPanes).toHaveLength(2);
    const other = openFileExplorer(reopened, "/other");
    expect(other.focusedId).not.toBe(explorerId);
    expect(other.editorPanes).toHaveLength(3);
  });
});

describe("per-chat header tools", () => {
  const twoChats = () => ({
    ...newTab("left"),
    layout: { type: "split", id: "row", dir: "right", sizes: [0.5, 0.5], children: [leaf("left"), leaf("right")] } as LayoutNode,
  });

  it("gives each chat its own explorer beside it, even for the same folder", () => {
    const left = openFileExplorer(twoChats(), "/repo", undefined, "left");
    const both = openFileExplorer({ ...left, focusedId: "right" }, "/repo", undefined, "right");
    expect(both.editorPanes).toHaveLength(2);
    const [leftPane] = sessionToolPanes(both, "left", "files");
    const [rightPane] = sessionToolPanes(both, "right", "files");
    expect(leftPane.id).not.toBe(rightPane.id);
    expect(leafIds(both.layout)).toEqual(["left", leftPane.id, "right", rightPane.id]);
    expect([...sessionsWithToolPanes(both, "files")].sort()).toEqual(["left", "right"]);
    // Reopening focuses the chat's own explorer instead of adding another.
    expect(openFileExplorer(both, "/repo", undefined, "left").focusedId).toBe(leftPane.id);
  });
});
