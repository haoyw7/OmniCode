import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "./claudeSessionImport";
import type { NativeSessionFile } from "../../core/nativeSessions";

const file: NativeSessionFile = {
  provider: "claude",
  providerSessionId: "s1",
  cwd: "/repo",
  path: "/home/u/.claude/projects/-repo/s1.jsonl",
  revision: "1",
  modifiedAt: 10,
  storage: "jsonl",
};
const base = { sessionId: "s1", cwd: "/repo", isSidechain: false };
const row = (uuid: string, parentUuid: string | null, extra: object) => ({
  ...base,
  uuid,
  parentUuid,
  timestamp: "2026-10-05T10:00:00.000Z",
  ...extra,
});
const user = (content: unknown, extra: object = {}) => ({
  type: "user",
  message: { role: "user", content },
  ...extra,
});
const assistant = (id: string, content: unknown[]) => ({
  type: "assistant",
  message: { id, role: "assistant", model: "claude-opus-5-5", content },
});
const lines = (...rows: unknown[]) =>
  rows.map((value) => JSON.stringify(value)).join("\n") + "\n";

describe("Claude session import", () => {
  it("merges split assistant rows, pairs tools, and skips CLI chrome", () => {
    const result = parseClaudeSession(
      lines(
        { type: "queue-operation", sessionId: "s1" },
        row("u1", null, user("hello")),
        row("a0", "u1", { type: "attachment" }),
        row("m1", "a0", user("caveat", { isMeta: true })),
        row("a1", "m1", assistant("msg_1", [{ type: "thinking", thinking: "plan" }])),
        row("a2", "a1", { ...assistant("msg_1", [{ type: "text", text: "first" }]), timestamp: "2026-10-05T10:00:01Z" }),
        row("a3", "a2", { ...assistant("msg_1", [{ type: "text", text: "second" }]), timestamp: "2026-10-05T10:00:02Z" }),
        row("a4", "a3", assistant("msg_1", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }])),
        row("r1", "a4", user([{ type: "tool_result", tool_use_id: "toolu_1", content: "out", is_error: true }])),
        row("c1", "r1", user("<command-name>/model</command-name>\n<command-args>opus</command-args>")),
        row("c2", "c1", user("<local-command-stdout>set</local-command-stdout>")),
        row("x1", "c2", { ...assistant("msg_x", [{ type: "text", text: "side" }]), isSidechain: true }),
        { type: "custom-title", sessionId: "s1", customTitle: "Named" },
        { type: "file-history-snapshot", messageId: "m" },
      ),
      file,
    );
    expect(result.blocks.map((block) => [block.role, block.text])).toEqual([
      ["user", "hello"],
      ["reasoning", "plan"],
      ["assistant", "first\n\nsecond"],
      ["tool", '{"command":"ls"}'],
      ["user", "/model opus"],
    ]);
    expect(result.blocks[3].tool).toMatchObject({ callId: "toolu_1", detail: "out", status: "error" });
    expect(result.blocks[2]).toMatchObject({
      startedAt: Date.parse("2026-10-05T10:00:01Z"),
      sentAt: Date.parse("2026-10-05T10:00:02Z"),
    });
    expect(result.blocks[0].id).toBe("native-claude-u1");
    expect(result.title).toBe("Named");
    expect(result.model).toBe("claude:opus-5-5");
  });

  it("follows the active branch and keeps history across a compact boundary", () => {
    const result = parseClaudeSession(
      lines(
        row("u1", null, user("one")),
        row("old", "u1", assistant("m_old", [{ type: "text", text: "abandoned" }])),
        row("new", "u1", assistant("m_new", [{ type: "text", text: "kept" }])),
        row("b1", null, { type: "system", subtype: "compact_boundary", logicalParentUuid: "new" }),
        row("s1", "b1", user("summary of earlier work", { isCompactSummary: true })),
        row("u2", "s1", user([{ type: "text", text: "two" }, { type: "image", source: {} }])),
        row("e1", "u2", { type: "system", subtype: "api_error" }),
      ),
      file,
    );
    expect(result.blocks.map((block) => [block.role, block.text])).toEqual([
      ["user", "one"],
      ["assistant", "kept"],
      ["system", "Conversation compacted"],
      ["system", "summary of earlier work"],
      ["user", "two\n[Image retained in the native session]"],
    ]);
  });

  it("rejects a moved project or a different file", () => {
    expect(() => parseClaudeSession(lines(row("u1", null, user("x"))), { ...file, cwd: "/other" })).toThrow();
    expect(() => parseClaudeSession(lines(row("u1", null, user("x"))), { ...file, providerSessionId: "s2" })).toThrow();
    expect(() => parseClaudeSession(lines(row("u1", null, user("x"))) + "{\"partial", file)).not.toThrow();
  });

  it("rejects cycles without publishing a partial branch", () => {
    expect(() => parseClaudeSession(lines(row("u1", "u1", user("cycle"))), file)).toThrow("cycle");
  });
});
