import { describe, expect, it } from "vitest";
import { appendUser } from "../../../integrations/harness/core/apply";
import {
  CONTINUE_PROMPT,
  INTERRUPT_MESSAGE,
  canAutoContinue,
} from "../../sessions/model/inFlight";
import {
  leaf,
  leafIds,
  APP_VIEW_KINDS,
  APP_PAGE_KINDS,
  isAppPageKind,
  newAppViewWorkspaceTab,
  newAgentTab,
  newWorkflowArtifactTab,
  newChangesTab,
  newCommitTab,
  newFileTab,
  newEditorWorkspaceTab,
  newReleaseNotesWorkspaceTab,
  newSessionChangesTab,
  newTab,
  newTerminalFile,
  openEditorTab,
  openFileExplorer,
  openSessionAppView,
  splitPane,
} from "./layout";
import { createProjectTerminal } from "../../projects/model/projectTerminal";
import { newSession, type Session } from "../../sessions/model/session";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";

describe("app view snapshots", () => {
  it.each(APP_PAGE_KINDS)("removes legacy %s pages while preserving chat, file and terminal panes", (kind) => {
    const session = chat("chat", "/repo");
    const tab = openSessionAppView(newTab(session.id), kind);
    const file = newFileTab("/repo/a.ts", "/repo");
    tab.editorPanes[0].files.push(file);
    const emptyPage = newAppViewWorkspaceTab(kind).editorPanes[0];
    tab.editorPanes.push(emptyPage);
    tab.layout = splitPane(tab.layout, tab.focusedId, "down", emptyPage.id);
    tab.focusedId = emptyPage.id;
    const terminal = newTerminalFile("/repo");
    const dock = createProjectTerminal("/repo", terminal);
    const standalone = newAppViewWorkspaceTab(kind);
    const raw = { tabs: [standalone, tab], sessions: [session], activeTabId: standalone.id, projectCwd: "/repo", projectTerminals: [dock] };
    for (const parsed of [parseWorkspaceSnapshot(raw)!, collectWorkspaceSnapshot(raw.tabs, raw.sessions, raw.activeTabId, raw.projectCwd, new Map(), raw.projectTerminals)]) {
      expect(parsed.tabs).toHaveLength(1);
      expect(parsed.activeTabId).toBe(tab.id);
      expect(leafIds(parsed.tabs[0].layout)).toContain(session.id);
      expect(leafIds(parsed.tabs[0].layout)).not.toContain(emptyPage.id);
      expect(parsed.tabs[0].focusedId).not.toBe(emptyPage.id);
      expect(parsed.tabs[0].editorPanes).toHaveLength(1);
      expect(parsed.tabs[0].editorPanes[0].files).toEqual([file]);
      expect(parsed.tabs[0].editorPanes[0].activeFileId).toBe(file.id);
      expect(parsed.projectTerminals[0].pane.files[0].id).toBe(terminal.id);
    }
  });

  it("restores a chat in the same project when the only saved tab was a page", () => {
    const tab = newAppViewWorkspaceTab("notes");
    const dock = createProjectTerminal("/repo", newTerminalFile("/repo"));
    const restored = hydrateWorkspaceSnapshot({ tabs: [tab], sessions: [], activeTabId: tab.id, projectCwd: "/repo", projectTerminals: [dock] }, new Map())!;
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0].editorPanes).toEqual([]);
    expect(restored.sessions[0].cwd).toBe("/repo");
    expect(restored.projectTerminals).toEqual([dock]);
  });

  it.each(APP_VIEW_KINDS.filter((kind) => !isAppPageKind(kind)))("round-trips %s by kind without transient view data", (kind) => {
    const tab = newAppViewWorkspaceTab(kind);
    const original = tab.editorPanes[0].files[0];
    const file = {
      ...original,
      path: "/incorrect-path",
      cwd: "/incorrect-project",
      projectCwd: "/incorrect-owner",
      preview: true,
      appView: { kind, query: "transient query", selectedSection: "providers" },
    };
    tab.editorPanes[0].files = [file];
    const snapshot = collectWorkspaceSnapshot([tab], [], tab.id, "/repo", new Map());
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(workspace?.tabs[0].editorPanes[0].files[0]).toEqual({
      id: original.id, path: `app:${kind}`, cwd: "~", appView: { kind },
    });
    expect(workspace?.sessions).toEqual([]);
  });

  it.each([
    { plan: { sessionId: "s", blockId: "b", title: "Plan" } },
    { releaseNotes: { version: "0.1.23" } },
    { review: true },
    { changes: true },
    { changeKind: "staged" },
    { sessionChanges: { sessionId: "s" } },
    { commit: { sha: "123", shortSha: "123", subject: "Commit" } },
    { agent: { sessionId: "s", leadId: "lead", harness: "codex" } },
    { terminal: true },
    { remoteFile: { machineId: "m", projectId: "p", relativePath: "a.ts" } },
  ])("rejects an app view mixed with virtual fields %j", (extra) => {
    const app = newAppViewWorkspaceTab("settings");
    app.editorPanes[0].files[0] = { ...app.editorPanes[0].files[0], ...extra };
    expect(parseWorkspaceSnapshot({
      tabs: [app], sessions: [], activeTabId: app.id, projectCwd: "~",
    })).toBeNull();
  });

  it("rejects unknown kinds instead of restoring them as files", () => {
    const app = newAppViewWorkspaceTab("settings");
    const raw = JSON.parse(JSON.stringify(app));
    raw.editorPanes[0].files[0].appView.kind = "unknown";
    expect(parseWorkspaceSnapshot({ tabs: [raw], activeTabId: app.id })).toBeNull();
  });

  it("rejects app views disguised as terminal panes", () => {
    const app = newAppViewWorkspaceTab("notes");
    expect(parseWorkspaceSnapshot({
      tabs: [{ ...app, terminalPanes: app.editorPanes, editorPanes: [] }],
      activeTabId: app.id,
    })).toBeNull();
  });

  it("keeps chat-owned views while removing duplicate legacy standalone views", () => {
    const first = newAppViewWorkspaceTab("settings");
    const duplicate = newAppViewWorkspaceTab("settings");
    const search = newAppViewWorkspaceTab("search");
    const chatTab = {
      ...newTab("chat"),
      layout: splitPane(leaf("chat"), "chat", "right", duplicate.focusedId),
      focusedId: duplicate.focusedId,
      editorPanes: duplicate.editorPanes,
    };
    const raw = {
      tabs: [first, chatTab, duplicate, search],
      sessions: [chat("chat", "/repo")],
      activeTabId: duplicate.id,
      projectCwd: "/repo",
    };
    const parsed = parseWorkspaceSnapshot(raw)!;
    expect(parsed.tabs.map((tab) => tab.id)).toEqual([first.id, chatTab.id, search.id]);
    expect(parsed.tabs[1].layout).toEqual(chatTab.layout);
    expect(parsed.tabs[1].focusedId).toBe(duplicate.focusedId);
    expect(parsed.tabs[1].editorPanes).toEqual(duplicate.editorPanes);
    expect(parsed.activeTabId).toBe(first.id);
    const collected = collectWorkspaceSnapshot(raw.tabs, raw.sessions, duplicate.id, "/repo", new Map());
    expect(collected.tabs.map((tab) => tab.id)).toEqual(parsed.tabs.map((tab) => tab.id));
    expect(collected.activeTabId).toBe(first.id);
  });

  it("retains the other files when removing a duplicate within one pane", () => {
    const first = newAppViewWorkspaceTab("search");
    const duplicate = { ...first.editorPanes[0].files[0], id: "duplicate-search" };
    const file = newFileTab("/repo/a.ts", "/repo");
    first.editorPanes[0].files.push(duplicate, file);
    first.editorPanes[0].activeFileId = duplicate.id;
    const parsed = parseWorkspaceSnapshot({
      tabs: [first], activeTabId: first.id,
    })!;
    expect(parsed.tabs[0].editorPanes[0].files).toEqual([
      first.editorPanes[0].files[0], file,
    ]);
    expect(parsed.tabs[0].editorPanes[0].activeFileId).toBe(first.editorPanes[0].files[0].id);
  });

  it("round-trips independent app views and active documents for two chats", () => {
    const firstSession = chat("first", "/repo");
    const secondSession = chat("second", "/repo");
    const first = openSessionAppView(newTab(firstSession.id), "search");
    const second = openSessionAppView(newTab(secondSession.id), "search");
    const firstFile = first.editorPanes[0].files[0];
    const secondFile = second.editorPanes[0].files[0];
    const snapshot = collectWorkspaceSnapshot(
      [first, second], [firstSession, secondSession], second.id, "/repo", new Map(),
    );
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map())!;
    expect(restored.tabs).toHaveLength(2);
    expect(restored.tabs.map((tab) => tab.editorPanes[0].activeFileId))
      .toEqual([firstFile.id, secondFile.id]);
    expect(restored.tabs.map((tab) => tab.focusedId))
      .toEqual([first.focusedId, second.focusedId]);
    expect(restored.activeTabId).toBe(second.id);
  });

  it.each(["split", "unified"] as const)(
    "preserves %s display mode and the active file on restore",
    (surfaceMode) => {
      const session = chat("chat", "/repo");
      const first = newFileTab("/repo/a.ts", "/repo");
      const second = newFileTab("/repo/b.ts", "/repo");
      const tab = {
        ...openEditorTab(openEditorTab(newTab(session.id), first, { pin: true }), second, { pin: true }),
        surfaceMode,
        autoArrangeTools: false,
      };
      const snapshot = collectWorkspaceSnapshot(
        [tab], [session], tab.id, "/repo", new Map(),
      );
      const restored = hydrateWorkspaceSnapshot(snapshot, new Map())!.tabs[0];
      expect(restored.surfaceMode).toBe(surfaceMode);
      expect(restored.autoArrangeTools).toBe(false);
      expect(restored.focusedId).toBe(tab.focusedId);
      expect(restored.editorPanes[0].activeFileId).toBe(second.id);
      expect(restored.editorPanes[0].files.map((file) => file.id))
        .toEqual([first.id, second.id]);
    },
  );

  it.each([undefined, "invalid", false, 1, {}])(
    "falls back to split mode when saved mode is %j",
    (surfaceMode) => {
      const tab = newTab("chat");
      const parsed = parseWorkspaceSnapshot({
        tabs: [{ ...tab, surfaceMode }], activeTabId: tab.id,
      })!;
      expect(parsed.tabs[0].surfaceMode).toBeUndefined();
    },
  );

  it("prunes duplicate app-view panes within one chat without affecting other chats", () => {
    const first = openSessionAppView(newTab("first-chat"), "search");
    const second = openSessionAppView(newTab("second-chat"), "search");
    const duplicate = newAppViewWorkspaceTab("search").editorPanes[0];
    first.layout = splitPane(first.layout, first.focusedId, "right", duplicate.id);
    first.editorPanes.push(duplicate);
    first.focusedId = duplicate.id;
    const parsed = parseWorkspaceSnapshot({
      tabs: [first, second], activeTabId: first.id,
    })!;
    expect(parsed.tabs[0].editorPanes).toHaveLength(1);
    expect(leafIds(parsed.tabs[0].layout)).not.toContain(duplicate.id);
    expect(parsed.tabs[0].focusedId).not.toBe(duplicate.id);
    expect(parsed.tabs[1].editorPanes).toEqual(second.editorPanes);
  });
});

function chat(id: string, cwd: string): Session {
  const session = newSession("cursor", cwd);
  session.id = id;
  session.blocks = [{ id: "u1", role: "user", text: "hello" }];
  session.providerSessionId = "p1";
  return session;
}

describe("project return snapshots", () => {
  it("migrates saved host file tabs to shared remote paths", () => {
    const project = "remote://env/repo";
    const file = {
      ...newFileTab("/repo/src/index.ts", "/repo", false, undefined, project),
      remoteFile: {
        machineId: "machine",
        projectId: "project",
        relativePath: "src/index.ts",
      },
    };
    const tab = newEditorWorkspaceTab(file);
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      tab.id,
      project,
      new Map(),
    );
    const restored = parseWorkspaceSnapshot(snapshot);
    expect(restored?.tabs[0].editorPanes[0].files[0]).toMatchObject({
      path: "remote://env/repo/src/index.ts",
      cwd: project,
    });
    expect(restored?.tabs[0].editorPanes[0].files[0].remoteFile).toBeUndefined();
    const malformed = JSON.parse(JSON.stringify(snapshot));
    malformed.tabs[0].editorPanes[0].files[0].remoteFile = { machineId: 42 };
    expect(parseWorkspaceSnapshot(malformed)).toBeNull();
  });
  it("restores a host diff tab with its review state", () => {
    const project = "remote://env/repo";
    const file = {
      ...newFileTab("/repo/a.ts", "/repo", true, "staged", project),
      remoteFile: {
        machineId: "machine",
        projectId: "project",
        relativePath: "a.ts",
      },
    };
    const tab = newEditorWorkspaceTab(file);
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      tab.id,
      project,
      new Map(),
    );
    const restored = parseWorkspaceSnapshot(snapshot);
    expect(restored?.tabs[0].editorPanes[0].files[0]).toMatchObject({
      review: true,
      changeKind: "staged",
      path: "remote://env/repo/a.ts",
    });
  });
  function saved() {
    const sessions = [
      chat("a1", "/alpha"),
      chat("a2", "/alpha"),
      chat("b1", "/beta"),
      chat("b2", "/beta"),
    ];
    const tabs = sessions.map((session) => ({
      ...newTab(session.id),
      id: `tab-${session.id}`,
    }));
    return {
      ...collectWorkspaceSnapshot(tabs, sessions, "tab-b2", "/beta", new Map()),
      projectReturnTargets: [
        { projectPath: "/alpha", tabId: "a2" },
        { projectPath: "/beta", tabId: "b2" },
      ],
    };
  }

  it("collects and round-trips choices while rejecting stale references", () => {
    const sessions = [
      chat("a1", "/alpha"),
      chat("a2", "/alpha"),
      chat("b2", "/beta"),
    ];
    const tabs = sessions.map((session) => ({
      ...newTab(session.id),
      id: `tab-${session.id}`,
    }));
    const memory = new Map([
      ["/alpha", "a2"],
      ["/beta", "b2"],
      ["/gone", "missing"],
    ]);
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      "tab-b2",
      "/beta",
      memory,
    );
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect([...(restored?.projectReturnMemory ?? [])]).toEqual([
      ["/alpha", "a2"],
      ["/beta", "b2"],
    ]);
    expect(memory.size).toBe(3);
  });

  it("restores both project choices, not just the active tab", () => {
    const restored = hydrateWorkspaceSnapshot(saved(), new Map());
    expect(restored?.projectReturnMemory?.get("/alpha")).toBe("a2");
    expect(restored?.projectReturnMemory?.get("/beta")).toBe("b2");
  });

  it("loads old snapshots and seeds only the active project", () => {
    const { projectReturnTargets: _targets, ...old } = saved();
    const restored = hydrateWorkspaceSnapshot(old, new Map());
    expect([...(restored?.projectReturnMemory ?? [])]).toEqual([
      ["/beta", "b2"],
    ]);
  });

  it("prunes invalid entries and uses the last valid duplicate", () => {
    const raw = saved();
    const parsed = parseWorkspaceSnapshot({
      ...raw,
      projectReturnTargets: [
        null,
        42,
        {},
        { projectPath: "/alpha", tabId: 12 },
        { projectPath: "/alpha/", tabId: "a1" },
        { projectPath: "/alpha", tabId: "a2" },
        { projectPath: "/gone", tabId: "missing" },
        { projectPath: "/beta", tabId: "a1" },
      ],
    });
    expect(parsed?.projectReturnTargets).toEqual([
      { projectPath: "/alpha", tabId: "a2" },
    ]);
  });

  it("lets the restored active tab override inconsistent saved preference", () => {
    const raw = saved();
    raw.projectReturnTargets[1].tabId = "tab-b1";
    expect(
      hydrateWorkspaceSnapshot(raw, new Map())?.projectReturnMemory?.get(
        "/beta",
      ),
    ).toBe("b2");
  });

  it.each([null, "broken", {}])(
    "ignores a malformed choice list: %j",
    (projectReturnTargets) => {
      const restored = hydrateWorkspaceSnapshot(
        { ...saved(), projectReturnTargets },
        new Map(),
      );
      expect(restored?.tabs).toHaveLength(4);
      expect([...(restored?.projectReturnMemory ?? [])]).toEqual([
        ["/beta", "b2"],
      ]);
    },
  );

  it("rechecks project membership against loaded sessions", () => {
    const restored = hydrateWorkspaceSnapshot(
      saved(),
      new Map([["a2", chat("a2", "/moved")]]),
    );
    expect(restored?.projectReturnMemory?.has("/alpha")).toBe(false);
    expect(restored?.projectReturnMemory?.get("/beta")).toBe("b2");
  });
});

describe("collectWorkspaceSnapshot", () => {
  it("saves open empty panes and background work without retaining abandoned blanks", () => {
    const blank = (id: string) => ({ ...newSession("codex", "/repo"), id });
    const tab = newTab("open-blank");
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [blank("open-blank"), blank("abandoned"), { ...blank("working"), busy: true }, chat("history", "/repo")],
      tab.id,
      "/repo",
      new Map(),
    );
    expect(snapshot.sessions.map((session) => session.id)).toEqual(["open-blank", "working", "history"]);
  });

  it("migrates an old workspace directory without inferring Git membership", () => {
    const session = chat("legacy", "/repo");
    const tab = newTab(session.id);
    const snapshot = collectWorkspaceSnapshot([tab], [session], tab.id, "/repo", new Map());
    const raw = { ...snapshot, sessions: [{ ...snapshot.sessions[0], worktreeCwd: "/repo/subdir" }] };
    const migrated = parseWorkspaceSnapshot(raw)!;
    expect(migrated.sessions[0]).toMatchObject({ cwd: "/repo", executionCwd: "/repo/subdir" });
    expect(migrated.sessions[0]).not.toHaveProperty("worktreeCwd");
    expect(migrated.sessions[0]).not.toHaveProperty("linkedWorktree");
  });

  it("stores tabs, stubs, and the focused tab — not transcripts", () => {
    const session = chat("s1", "/tmp/a");
    session.executionCwd = "/tmp/a-worktrees/feature";
    session.worktreeRemoved = true;
    session.blocks.push({ id: "a1", role: "assistant", text: "hi" });
    const file = newFileTab("/tmp/a/README.md", "/tmp/a");
    const tab = {
      ...newTab("s1"),
      id: "t1",
      editorPanes: [{ id: "e1", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [session],
      "t1",
      "/tmp/a",
      new Map(),
    );
    expect(snapshot.activeTabId).toBe("t1");
    expect(snapshot.tabs[0]?.editorPanes[0]?.files[0]?.path).toBe(
      "/tmp/a/README.md",
    );
    expect(snapshot.sessions).toEqual([
      expect.objectContaining({
        id: "s1",
        cwd: "/tmp/a",
        providerSessionId: "p1",
        executionCwd: "/tmp/a-worktrees/feature",
        worktreeRemoved: true,
      }),
    ]);
    expect("blocks" in snapshot.sessions[0]!).toBe(false);
    expect(snapshot.projectTerminals).toEqual([]);
  });

  it.each(["agent", "workflow artifact"])("drops %s tabs, and the pane holding only them", (kind) => {
    const file = newFileTab("/tmp/a/README.md", "/tmp/a");
    const agent = kind === "workflow artifact" ? newWorkflowArtifactTab("Report", "/tmp/a", {
      parentSessionId: "s1", runId: "run", artifactId: "report",
    }) : newAgentTab("Audit the UI", "/tmp/a", {
      sessionId: "worker",
      leadId: "s1",
      harness: "codex",
    });
    const mixed = newAgentTab("Audit the engine", "/tmp/a", {
      sessionId: "worker-2",
      leadId: "s1",
      harness: "codex",
    });
    const tab = {
      ...newTab("s1"),
      id: "t1",
      layout: splitPane(newTab("s1").layout, "s1", "right", "e1"),
      editorPanes: [
        { id: "e1", files: [agent], activeFileId: agent.id },
        { id: "e2", files: [file, mixed], activeFileId: mixed.id },
      ],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const panes = snapshot.tabs[0]!.editorPanes;
    // The agent-only pane is gone along with its leaf; the mixed one keeps its
    // file and falls back to it as the active tab.
    expect(panes.map((pane) => pane.id)).toEqual(["e2"]);
    expect(panes[0]!.files.map((entry) => entry.path)).toEqual([
      "/tmp/a/README.md",
    ]);
    expect(panes[0]!.activeFileId).toBe(file.id);
    expect(leafIds(snapshot.tabs[0]!.layout)).toEqual(["s1"]);
  });

  it("round-trips a unified Changes tab", () => {
    const file = newChangesTab("/tmp/a", "/tmp/a/src/lib.rs", "staged");
    const tab = {
      ...newTab("s1"),
      id: "t1",
      editorPanes: [{ id: "e1", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    const restored = workspace?.tabs[0]?.editorPanes[0]?.files[0];
    expect(restored?.changes).toBe(true);
    expect(restored?.review).toBe(true);
    expect(restored?.path).toBe("/tmp/a/src/lib.rs");
    expect(restored?.changeKind).toBe("staged");
  });

  it.each([undefined, "first-turn"])("round-trips a session-scoped Changes tab (turn: %s)", (turnId) => {
    const file = newSessionChangesTab(
      "/tmp/a",
      "session-a",
      "/tmp/a/src/lib.rs",
      undefined,
      turnId,
    );
    const tab = {
      ...newTab("s1"),
      id: "t1",
      editorPanes: [{ id: "e1", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map())?.tabs[0]
      ?.editorPanes[0]?.files[0];
    expect(restored?.sessionChanges).toEqual({ sessionId: "session-a", ...(turnId ? { turnId } : {}) });
    expect(restored?.review).toBe(true);
    expect(restored?.changes).toBe(true);
    expect(restored?.path).toBe("/tmp/a/src/lib.rs");
  });

  it("preserves a worktree editor's execution directory and owning project", () => {
    const file = newFileTab(
      "/repo-worktrees/feature/readme.md",
      "/repo-worktrees/feature",
      false,
      undefined,
      "/repo",
    );
    const tab = {
      ...newTab("editor"),
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      tab.id,
      "/repo",
      new Map(),
    );
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map())?.tabs[0]
      ?.editorPanes[0]?.files[0];
    expect(restored).toMatchObject({
      cwd: "/repo-worktrees/feature",
      projectCwd: "/repo",
    });
  });

  it("round-trips a commit review tab", () => {
    const file = newCommitTab("/tmp/a", {
      sha: "abc1234deadbeef",
      shortSha: "abc1234",
      subject: "Fix the graph",
    });
    const tab = {
      ...newTab("s1"),
      id: "t1",
      editorPanes: [{ id: "e1", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    const restored = workspace?.tabs[0]?.editorPanes[0]?.files[0];
    expect(restored?.commit).toEqual({
      sha: "abc1234deadbeef",
      shortSha: "abc1234",
      subject: "Fix the graph",
    });
  });

  it("round-trips a release-note descriptor", () => {
    const tab = newReleaseNotesWorkspaceTab({ version: "0.1.22" });
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      tab.id,
      "~",
      new Map(),
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());

    expect(workspace?.tabs[0]?.editorPanes[0]?.files[0]?.releaseNotes).toEqual({
      version: "0.1.22",
    });
    expect(workspace?.sessions).toEqual([]);
  });

  it("stores the project terminal dock", () => {
    const term = newTerminalFile("/tmp/a", "zsh");
    const dock = createProjectTerminal("/tmp/a", term);
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [],
      "t1",
      "/tmp/a",
      new Map(),
      [dock],
    );
    expect(snapshot.projectTerminals).toEqual([
      expect.objectContaining({
        projectPath: "/tmp/a",
        side: "bottom",
        open: true,
      }),
    ]);
    expect(snapshot.projectTerminals[0]?.pane.files[0]?.id).toBe(term.id);
  });

  it("stores the last dock side for new projects", () => {
    const term = newTerminalFile("/tmp/a", "zsh");
    const dock = createProjectTerminal("/tmp/a", term);
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [],
      "t1",
      "/tmp/a",
      new Map(),
      [dock],
      "right",
    );
    expect(snapshot.lastDockSide).toBe("right");
    expect(
      collectWorkspaceSnapshot(
        [{ ...newTab("s1"), id: "t1" }],
        [],
        "t1",
        "/tmp/a",
        new Map(),
      ).lastDockSide,
    ).toBeUndefined();
  });
});

describe("parseWorkspaceSnapshot", () => {
  it("returns null for empty or invalid payloads", () => {
    expect(parseWorkspaceSnapshot(null)).toBeNull();
    expect(parseWorkspaceSnapshot({ tabs: [], activeTabId: "t1" })).toBeNull();
    expect(
      parseWorkspaceSnapshot({ tabs: [{}], activeTabId: "t1" }),
    ).toBeNull();
  });

  it("keeps a valid last dock side and drops an invalid one", () => {
    const term = newTerminalFile("/tmp/a", "zsh");
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [],
      "t1",
      "/tmp/a",
      new Map(),
      [createProjectTerminal("/tmp/a", term)],
      "right",
    );
    const raw = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    expect(parseWorkspaceSnapshot(raw)?.lastDockSide).toBe("right");
    raw.lastDockSide = "diagonal";
    expect(parseWorkspaceSnapshot(raw)?.lastDockSide).toBeUndefined();
  });

  it("drops unknown fields and repairs a missing active tab", () => {
    const tab = { ...newTab("s1"), id: "t1" };
    const parsed = parseWorkspaceSnapshot({
      tabs: [{ ...tab, extra: true }],
      sessions: [
        {
          id: "s1",
          harness: "cursor",
          runtimeMode: "supervised",
          cwd: "/tmp/a",
        },
      ],
      activeTabId: "missing",
      projectCwd: "/tmp/a",
    });
    expect(parsed?.activeTabId).toBe("t1");
    expect(parsed?.tabs[0] && "extra" in parsed.tabs[0]).toBe(false);
  });

  it.each([
    { releaseNotes: { version: "" } },
    { releaseNotes: { version: 123 } },
    {
      releaseNotes: { version: "0.1.22" },
      plan: { sessionId: "s", blockId: "b", title: "Plan" },
    },
    { releaseNotes: { version: "0.1.22" }, review: true },
    { releaseNotes: { version: "0.1.22" }, changes: true },
    { releaseNotes: { version: "0.1.22" }, terminal: true },
    {
      releaseNotes: { version: "0.1.22" },
      commit: { sha: "abc", shortSha: "abc", subject: "x" },
    },
  ])("rejects a tab whose release pane is invalid: %j", (descriptor) => {
    const valid = { ...newTab("session-a"), id: "valid-tab" };
    const invalidPaneId = "invalid-release-pane";
    const invalid = {
      kind: "session",
      id: "invalid-tab",
      layout: leaf(invalidPaneId),
      focusedId: invalidPaneId,
      editorPanes: [
        {
          id: invalidPaneId,
          activeFileId: "release-file",
          files: [
            {
              id: "release-file",
              path: "release-notes:0.1.22",
              cwd: "~",
              ...descriptor,
            },
          ],
        },
      ],
      terminalPanes: [],
    };

    const parsed = parseWorkspaceSnapshot({
      tabs: [valid, invalid],
      sessions: [],
      activeTabId: "invalid-tab",
      projectCwd: "~",
    });
    expect(parsed?.tabs.map((tab) => tab.id)).toEqual(["valid-tab"]);

    const workspace = parsed && hydrateWorkspaceSnapshot(parsed, new Map());
    expect(
      workspace?.sessions.some((session) => session.id === invalidPaneId),
    ).toBe(false);
  });
});

describe("hydrateWorkspaceSnapshot", () => {
  it("reopens splits, file panes, and stored transcripts", () => {
    const left = chat("s1", "/tmp/a");
    const right = chat("s2", "/tmp/a");
    const file = newFileTab("/tmp/a/src/lib.rs", "/tmp/a");
    const tab = {
      ...newTab("s1"),
      id: "t1",
      layout: {
        type: "split" as const,
        id: "split1",
        dir: "right" as const,
        children: [leaf("s1"), leaf("e1")],
        sizes: [0.5, 0.5],
      },
      focusedId: "e1",
      editorPanes: [{ id: "e1", files: [file], activeFileId: file.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [left, right],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const loaded = new Map([
      [
        "s1",
        {
          ...left,
          blocks: [
            ...left.blocks,
            { id: "a1", role: "assistant" as const, text: "stored" },
          ],
        },
      ],
    ]);
    const workspace = hydrateWorkspaceSnapshot(snapshot, loaded);
    expect(workspace?.tabs).toHaveLength(1);
    expect(workspace?.tabs[0]?.layout).toEqual(tab.layout);
    expect(workspace?.tabs[0]?.editorPanes[0]?.files[0]?.path).toBe(
      "/tmp/a/src/lib.rs",
    );
    expect(
      workspace?.sessions.find((session) => session.id === "s1")?.blocks,
    ).toEqual(loaded.get("s1")?.blocks);
    expect(workspace?.sessions.find((session) => session.id === "s2")).toBeUndefined();
  });

  it("drops legacy orphan stubs while retaining open blanks and loaded parked conversations", () => {
    const open = { ...newSession("codex", "/repo"), id: "open" };
    const tab = newTab(open.id);
    const snapshot = collectWorkspaceSnapshot([tab], [open], tab.id, "/repo", new Map());
    snapshot.sessions.push(
      { ...snapshot.sessions[0], id: "orphan", title: "codex" },
      { ...snapshot.sessions[0], id: "missing", title: "Old conversation" },
      { ...snapshot.sessions[0], id: "parked" },
    );
    const parked = chat("parked", "/repo");
    const restored = hydrateWorkspaceSnapshot(snapshot, new Map([[parked.id, parked]]))!;
    expect(restored.sessions.map((session) => session.id)).toEqual(["open", "parked"]);
    expect(restored.sessions.find((session) => session.id === "open")?.blocks).toEqual([]);
    expect(restored.sessions.find((session) => session.id === "parked")?.blocks).toEqual(parked.blocks);
    expect(restored.tabs[0].layout).toEqual(tab.layout);
  });

  it("marks in-flight chats interrupted and adds a tab if they were parked", () => {
    const open = chat("s1", "/tmp/a");
    const parked = chat("s2", "/tmp/a");
    parked.busy = true;
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [open, parked],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const workspace = hydrateWorkspaceSnapshot(
      snapshot,
      new Map([
        ["s1", open],
        ["s2", parked],
      ]),
      new Set(["s2"]),
    );
    expect(workspace?.tabs).toHaveLength(2);
    const resumed = workspace?.sessions.find((session) => session.id === "s2");
    expect(resumed?.busy).toBe(false);
    expect(
      resumed?.blocks.some((block) => block.text === INTERRUPT_MESSAGE),
    ).toBe(true);
  });

  it("continues a Codex snapshot with its saved model and settings before discovery", () => {
    const session: Session = {
      ...chat("s1", "/tmp/a"),
      harness: "codex",
      model: "codex:gpt-5.6-sol",
      modelSettings: { reasoningEffort: "high", serviceTier: "priority" },
    };
    const tab = newTab(session.id);
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [session],
      tab.id,
      session.cwd,
      new Map(),
    );
    const restored = hydrateWorkspaceSnapshot(
      snapshot,
      new Map(),
      new Set([session.id]),
    )?.sessions[0];
    expect(restored).toBeDefined();
    expect(restored?.model).toBe("codex:gpt-5.6-sol");
    expect(restored?.modelSettings).toEqual(session.modelSettings);
    expect(canAutoContinue(restored!)).toBe(true);
    const continued = appendUser(restored!, CONTINUE_PROMPT);
    expect(continued.blocks.at(-1)?.turnModel).toEqual({
      harness: "codex",
      id: "codex:gpt-5.6-sol",
      name: "GPT-5.6-Sol",
    });
  });

  it("keeps terminal-only tabs", () => {
    const term = newTerminalFile("/tmp/a");
    const tab = {
      kind: "session" as const,
      id: "t1",
      layout: leaf("p1"),
      focusedId: "p1",
      editorPanes: [],
      terminalPanes: [{ id: "p1", files: [term], activeFileId: term.id }],
    };
    const snapshot = collectWorkspaceSnapshot(
      [tab],
      [],
      "t1",
      "/tmp/a",
      new Map(),
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(workspace?.tabs[0]?.terminalPanes[0]?.files[0]?.terminal).toBe(true);
  });

  it("restores a project terminal dock", () => {
    const term = { ...newTerminalFile("/tmp/a"), foreground: "vite" };
    const dock = {
      ...createProjectTerminal("/tmp/a", term),
      side: "left" as const,
      size: 300,
      open: false,
    };
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [],
      "t1",
      "/tmp/a",
      new Map(),
      [dock],
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(workspace?.projectTerminals).toEqual([
      expect.objectContaining({
        projectPath: "/tmp/a",
        side: "left",
        size: 300,
        open: false,
      }),
    ]);
    expect(workspace?.projectTerminals?.[0]?.pane.files[0]?.terminal).toBe(
      true,
    );
    expect(
      workspace?.projectTerminals?.[0]?.pane.files[0]?.foreground,
    ).toBeUndefined();
  });

  it("restores the last dock side", () => {
    const term = newTerminalFile("/tmp/a", "zsh");
    const snapshot = collectWorkspaceSnapshot(
      [{ ...newTab("s1"), id: "t1" }],
      [],
      "t1",
      "/tmp/a",
      new Map(),
      [createProjectTerminal("/tmp/a", term)],
      "left",
    );
    const workspace = hydrateWorkspaceSnapshot(snapshot, new Map());
    expect(workspace?.lastDockSide).toBe("left");
  });
});

describe("worktree tab cleanup", () => {
  it("drops tabs the caller leaves out, with sessions only they showed", () => {
    const main = chat("main", "/repo");
    const feature = { ...chat("feature", "/repo"), executionCwd: "/trees/a" };
    const mainTab = { ...newTab("main"), id: "tab-main" };
    const featureTab = { ...newTab("feature"), id: "tab-feature" };
    const snapshot = collectWorkspaceSnapshot(
      [mainTab, featureTab],
      [main, feature],
      "tab-feature",
      "/repo",
      new Map(),
      [],
      undefined,
      (tab) => tab.id !== "tab-feature",
    );
    expect(snapshot.tabs.map((tab) => tab.id)).toEqual(["tab-main"]);
    expect(snapshot.sessions.map((stub) => stub.id)).toEqual(["main"]);
  });
});


it("restores an empty file explorer alongside an independent changes pane", () => {
  const session = chat("explorer-chat", "/repo");
  const explorer = openFileExplorer(newTab(session.id), "/repo");
  const tab = openEditorTab(explorer, newChangesTab("/repo"));
  const restored = parseWorkspaceSnapshot({ tabs: [tab], sessions: [session], activeTabId: tab.id, projectCwd: "/repo" })!;
  expect(restored.tabs[0].editorPanes).toEqual(tab.editorPanes);
  expect(restored.tabs[0].layout).toEqual(tab.layout);
});

it("keeps the chat that owns a header explorer across restarts", () => {
  const session = chat("owner-chat", "/repo");
  const tab = openFileExplorer(newTab(session.id), "/repo", undefined, session.id);
  const restored = parseWorkspaceSnapshot({ tabs: [tab], sessions: [session], activeTabId: tab.id, projectCwd: "/repo" })!;
  expect(restored.tabs[0].editorPanes[0].files[0].ownerSessionId).toBe(session.id);
});
