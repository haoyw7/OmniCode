import { describe, expect, it, vi } from "vitest";
import {
  nativeAcpTitleEvent,
  noteAcpTitleCapabilities,
  parseClaudeNativeTitle,
  readAcpSessionTitle,
} from "./nativeTitles";
import type { AcpClient } from "./acp";

describe("native title protocols", () => {
  it("filters child sessions and absent/cleared metadata without changing provider text", () => {
    const update = {
      sessionId: "main",
      update: { sessionUpdate: "session_info_update", title: "中文原生标题" },
    };
    expect(nativeAcpTitleEvent(update, "main")?.title).toBe("中文原生标题");
    expect(nativeAcpTitleEvent(update, "child")).toBeNull();
    expect(
      nativeAcpTitleEvent(
        { ...update, update: { ...update.update, title: null } },
        "main",
      ),
    ).toBeNull();
  });
  it("checks list support, paginates and matches the native ID", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        sessions: [{ sessionId: "other", title: "Other" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        sessions: [{ sessionId: "main", title: "Native name" }],
      });
    const acp = { request } as unknown as AcpClient;
    expect(await readAcpSessionTitle(acp, "main", "/project")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    noteAcpTitleCapabilities(acp, {
      agentCapabilities: { sessionCapabilities: { list: {} } },
    });
    expect(await readAcpSessionTitle(acp, "main", "/project")).toBe(
      "Native name",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("reads only the bound Claude session and gives native manual names precedence", () => {
    const line = (
      type: string,
      sessionId: string,
      key: string,
      value: string,
    ) => JSON.stringify({ type, sessionId, [key]: value });
    const data = [
      line("ai-title", "main", "aiTitle", "Initial name"),
      line("ai-title", "other", "aiTitle", "Wrong"),
      line("custom-title", "main", "customTitle", "My name"),
      line("ai-title", "main", "aiTitle", "Late"),
      "{unfinished",
    ].join("\n");
    expect(parseClaudeNativeTitle(data, "main")).toBe("My name");
    expect(parseClaudeNativeTitle(data + "\n" + line("custom-title", "main", "customTitle", ""), "main")).toBe("Late");
  });
});
