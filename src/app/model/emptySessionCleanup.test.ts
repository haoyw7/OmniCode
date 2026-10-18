import { describe, expect, it } from "vitest";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  newFileTab,
  newTab,
  newTerminalFile,
  openEditorTab,
  splitPane,
  leafIds,
} from "../../features/workspace/model/layout";
import {
  clearComposerDraft,
  setComposerDraft,
} from "../../features/sessions/model/draftCache";
import {
  isDisposableEmptySession,
  pendingNewSessionDraft,
  pruneDepartedEmptySessions,
} from "./emptySessionCleanup";

describe("empty session cleanup", () => {
  it("allows only an untouched empty conversation", () => {
    expect(isDisposableEmptySession(newSession("codex", "/repo"))).toBe(true);
  });

  it.each<Partial<Session>>([
    { blocks: [{ id: "draft", role: "user", text: "Saved", draft: true }] },
    { blocks: [{ id: "sent", role: "user", text: "Sent" }] },
    { blocks: [{ id: "reply", role: "assistant", text: "Reply" }] },
    { busy: true },
    { worktreePreparing: true },
    { providerSessionId: "thread" },
    { composerSeed: "Prompt" },
    { assistantOwnerId: "assistant" },
    { workflowParentId: "parent" },
    { orchestrationLeadId: "lead" },
    { automationId: "automation" },
    { backgroundTasks: ["task"] },
    {
      linkedWorkItem: {
        kind: "issue",
        url: "https://github.com/a/b/issues/1",
        number: 1,
        repo: "a/b",
      },
    },
  ])("preserves nonempty or managed state: %j", (patch) => {
    expect(
      isDisposableEmptySession({ ...newSession("codex", "/repo"), ...patch }),
    ).toBe(false);
  });

  it("preserves a manually named conversation", () => {
    const session = newSession("codex", "/repo");
    session.titleState = { ...session.titleState!, source: "manual" };
    expect(isDisposableEmptySession(session)).toBe(false);
  });

  it.each(["file", "terminal", "diff"])(
    "retains a tab that owns a %s",
    (kind) => {
      const tab = newTab("empty");
      if (kind === "diff") tab.diffOpen = true;
      else {
        const pane = {
          id: "resource",
          files: [
            kind === "file"
              ? newFileTab("/repo/a", "/repo")
              : newTerminalFile("/repo"),
          ],
          activeFileId: "file",
        };
        if (kind === "file") tab.editorPanes = [pane];
        else tab.terminalPanes = [pane];
      }
      expect(
        pruneDepartedEmptySessions([tab], new Set(["empty"]), () => true).tabs,
      ).toEqual([tab]);
    },
  );

  it("removes only eligible departed panes without disturbing a split sibling", () => {
    const original = newTab("empty");
    const split = {
      ...original,
      layout: splitPane(original.layout, "empty", "right", "kept"),
    };
    const background = newTab("unvisited");
    const active = newTab("current");
    const result = pruneDepartedEmptySessions(
      [split, background, active],
      new Set(["empty"]),
      () => true,
    );
    expect(result.removedIds).toEqual(["empty"]);
    expect(leafIds(result.tabs[0].layout)).toEqual(["kept"]);
    expect(result.tabs[0].focusedId).toBe("kept");
    expect(result.tabs.slice(1)).toEqual([background, active]);
  });

  it("retains a conversation with a protected owner or pin/history guard", () => {
    const blank = newTab("empty");
    const owned = openEditorTab(
      newTab("empty"),
      newFileTab("/repo/a", "/repo"),
    );
    expect(
      pruneDepartedEmptySessions([blank, owned], new Set(["empty"]), () => true)
        .removedIds,
    ).toEqual([]);
    expect(
      pruneDepartedEmptySessions([blank], new Set(["empty"]), () => false)
        .removedIds,
    ).toEqual([]);
  });

  it("finds an unsent new conversation unless it is already in front", () => {
    const typed = newSession("codex", "/repo");
    const untouched = newSession("codex", "/repo");
    const sent = {
      ...newSession("codex", "/repo"),
      blocks: [{ id: "sent", role: "user" as const, text: "Sent" }],
    };
    const tabs = [newTab(typed.id), newTab(untouched.id), newTab(sent.id)];
    const sessions = [untouched, sent, typed];
    setComposerDraft(typed.id, "half typed");
    setComposerDraft(sent.id, "follow-up");
    const all = () => true;
    try {
      expect(
        pendingNewSessionDraft(sessions, tabs, all, sent.id)?.session.id,
      ).toBe(typed.id);
      expect(
        pendingNewSessionDraft(sessions, tabs, all, typed.id),
      ).toBeUndefined();
      expect(
        pendingNewSessionDraft(sessions, tabs, () => false, undefined),
      ).toBeUndefined();
    } finally {
      clearComposerDraft(typed.id);
      clearComposerDraft(sent.id);
    }
  });
});
