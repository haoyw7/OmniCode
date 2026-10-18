import { describe, expect, it } from "vitest";
import { parseCommand } from "./engine";

const record = {
  base: "main",
  path: "/projects/monocode-worktrees/wt-mc-3f2a1b7c",
  log: [
    { kind: "info", key: "Starting worktree creation" },
    { kind: "output", text: "Preparing worktree (new branch 'mc/3f2a1b7c')" },
    { kind: "text", key: "Worktree created at {value0}", values: { value0: "/projects/monocode-worktrees/wt-mc-3f2a1b7c" } },
  ],
};

describe("first message keeps the worktree it created", () => {
  it("accepts a well-formed record on the send command", () => {
    const command = { type: "send", commandId: "turn-1", sessionId: "session", text: "Fix login", worktreeCreation: record };
    expect(parseCommand(command)).toEqual(command);
  });

  it("rejects a malformed record rather than storing it on the message", () => {
    const command = { type: "send", commandId: "turn-1", sessionId: "session", text: "Fix login", worktreeCreation: { base: 1, path: "/x", log: [] } };
    expect(() => parseCommand(command)).toThrow("Invalid worktree record");
  });
});
