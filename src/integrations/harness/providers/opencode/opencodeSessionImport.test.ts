import { describe, expect, it } from "vitest";
import { parseOpenCodeSession } from "./opencodeSessionImport";
import type { NativeSessionFile } from "../../core/nativeSessions";

const file: NativeSessionFile = {
  provider: "opencode",
  providerSessionId: "ses_1",
  cwd: "/repo",
  path: "/home/u/.local/share/opencode/opencode.db",
  revision: "sqlite:1:2:3",
  modifiedAt: 10,
  storage: "sqlite",
};
const doc = (messages: unknown[], session: object = {}) =>
  JSON.stringify({
    session: {
      id: "ses_1",
      directory: "/repo",
      title: "New session - 2026-10-05T15:05:28.521Z",
      timeCreated: 5,
      model: { id: "big-pickle", providerID: "opencode", variant: "default" },
      ...session,
    },
    messages,
  });

describe("OpenCode session import", () => {
  it("maps text, reasoning, tool states and step markers", () => {
    const result = parseOpenCodeSession(
      doc([
        {
          id: "msg_u",
          timeCreated: 7,
          info: { role: "user" },
          parts: [
            { id: "p0", type: "text", text: "hello" },
            { id: "p1", type: "text", text: "injected", synthetic: true },
            { id: "p2", type: "file", mime: "image/png", url: "data:..." },
          ],
        },
        {
          id: "msg_a",
          timeCreated: 8,
          info: { role: "assistant", providerID: "opencode", modelID: "big-pickle" },
          parts: [
            { id: "p3", type: "step-start" },
            { id: "p4", type: "reasoning", text: "think" },
            {
              id: "p5",
              type: "tool",
              callID: "call_1",
              tool: "bash",
              state: { status: "completed", input: { command: "ls" }, output: "a\nb", title: "ls" },
            },
            { id: "p6", type: "tool", callID: "call_2", tool: "read", state: { status: "running", input: {} } },
            { id: "p7", type: "text", text: "pong" },
            { id: "p8", type: "step-finish", reason: "stop" },
          ],
        },
      ]),
      file,
    );
    expect(result.blocks.map((block) => [block.role, block.text])).toEqual([
      ["user", "hello\n[Image retained in the native session]"],
      ["reasoning", "think"],
      ["tool", '{"command":"ls"}'],
      ["tool", "{}"],
      ["assistant", "pong"],
    ]);
    expect(result.blocks[2].tool).toMatchObject({ callId: "call_1", title: "ls", status: "completed", detail: "a\nb" });
    expect(result.blocks[3].tool?.status).toBe("running");
    expect(result.blocks[0]).toMatchObject({ id: "native-opencode-msg_u", startedAt: 7 });
    expect(result.blocks[4]).toMatchObject({ role: "assistant", startedAt: 8 });
    expect(result.title).toBeUndefined();
    expect(result.model).toBe("opencode:opencode/big-pickle");
    expect(result.createdAt).toBe(5);
  });

  it("keeps real titles and surfaces provider errors", () => {
    const result = parseOpenCodeSession(
      doc(
        [
          { id: "u", info: { role: "user" }, parts: [{ id: "a", type: "text", text: "q" }] },
          { id: "e", info: { role: "assistant", error: { name: "APIError", data: { message: "rate limited" } } }, parts: [] },
          { id: "x", info: { role: "assistant", error: { name: "MessageAbortedError", data: { message: "aborted" } } }, parts: [] },
        ],
        { title: "Fix the build" },
      ),
      file,
    );
    expect(result.title).toBe("Fix the build");
    expect(result.blocks.map((block) => block.text)).toEqual(["q", "rate limited"]);
  });

  it("rejects another session or project", () => {
    expect(() => parseOpenCodeSession(doc([], { id: "ses_2" }), file)).toThrow();
    expect(() => parseOpenCodeSession(doc([], { directory: "/x" }), file)).toThrow();
    expect(() => parseOpenCodeSession("{bad", file)).toThrow();
  });
});
