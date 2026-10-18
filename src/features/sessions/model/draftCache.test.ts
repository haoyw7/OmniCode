import { describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  beginComposerAttachmentRead,
  hasComposerDraftContent,
  setComposerAttachmentCount,
  getComposerDraft,
  getComposerMcpTags,
  setComposerDraft,
  setComposerMcpTags,
  stashComposerAttachments,
  takeComposerAttachments,
} from "./draftCache";
import { newMcpTag } from "./mcpPicker";

describe("draftCache", () => {
  it("protects whitespace and attachments independently when text is cleared", () => {
    const id = "presence";
    setComposerDraft(id, "  \n");
    expect(hasComposerDraftContent(id)).toBe(true);
    setComposerAttachmentCount(id, 1);
    setComposerDraft(id, "");
    expect(hasComposerDraftContent(id)).toBe(true);
    setComposerAttachmentCount(id, 0);
    expect(hasComposerDraftContent(id)).toBe(false);
  });

  it("protects overlapping attachment reads until both finish", () => {
    const id = "reading";
    const first = beginComposerAttachmentRead(id);
    const second = beginComposerAttachmentRead(id);
    first();
    first();
    expect(hasComposerDraftContent(id)).toBe(true);
    second();
    expect(hasComposerDraftContent(id)).toBe(false);
  });

  it("returns undefined for a session that never had a draft", () => {
    expect(getComposerDraft("never-seen")).toBeUndefined();
  });

  it("gives back the last text set for a session, across separate reads", () => {
    // This is the actual bug: SessionPane used to keep the composer's text
    // in a component-local ref, so closing a session's pane (unmounting
    // SessionPane) and reopening it - a fresh component instance calling
    // getComposerDraft again - lost whatever was typed. A module-level
    // cache has to answer the same text back on a later, independent read.
    setComposerDraft("s1", "half-typed message");

    expect(getComposerDraft("s1")).toBe("half-typed message");
  });

  it("keeps drafts for different sessions apart", () => {
    setComposerDraft("s2", "draft for session two");
    setComposerDraft("s3", "draft for session three");

    expect(getComposerDraft("s2")).toBe("draft for session two");
    expect(getComposerDraft("s3")).toBe("draft for session three");
  });

  it("treats setting an empty string as clearing the draft", () => {
    setComposerDraft("s4", "something");
    setComposerDraft("s4", "");

    expect(getComposerDraft("s4")).toBeUndefined();
  });

  it("clearComposerDraft removes a stored draft", () => {
    setComposerDraft("s5", "will be cleared");
    clearComposerDraft("s5");

    expect(getComposerDraft("s5")).toBeUndefined();
  });

  it("keeps MCP tag metadata with its session draft", () => {
    const tag = newMcpTag(
      {
        provider: "codex",
        name: "docs",
        scope: "user",
        configPath: "/config.toml",
        transport: "stdio",
      },
      [],
    );
    setComposerDraft("mcp-one", `Ask ${tag.token}`);
    setComposerMcpTags("mcp-one", [tag]);
    setComposerDraft("mcp-two", "Another draft");
    expect(getComposerMcpTags("mcp-one")).toEqual([tag]);
    expect(getComposerMcpTags("mcp-two")).toEqual([]);
    setComposerDraft("mcp-one", "");
    expect(getComposerMcpTags("mcp-one")).toEqual([]);
  });

  it("keeps stashed attachments as draft content until taken or cleared", () => {
    const file = {
      id: "image",
      name: "shot.png",
      mimeType: "image/png",
      kind: "image" as const,
      size: 1,
      data: "AA==",
    };
    stashComposerAttachments("stash", [file], new Set());
    expect(hasComposerDraftContent("stash")).toBe(true);
    expect(takeComposerAttachments("stash")?.attachments).toEqual([file]);
    expect(takeComposerAttachments("stash")).toBeUndefined();

    stashComposerAttachments("stash", [file], new Set());
    clearComposerDraft("stash");
    expect(takeComposerAttachments("stash")).toBeUndefined();
    expect(hasComposerDraftContent("stash")).toBe(false);
  });
});
