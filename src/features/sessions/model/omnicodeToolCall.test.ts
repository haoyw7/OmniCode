import { describe, expect, it } from "vitest";
import type { Block } from "../../../contracts/session";
import { omniCodeToolCall, omniCodeWorkSummary } from "./omnicodeToolCall";

function shell(text: string): Block {
  return { id: text, role: "tool", text, tool: { kind: "shell" } };
}

describe("OmniCode CLI tool calls", () => {
  it("recognizes app actions with absolute, quoted, or bare executables", () => {
    expect(
      omniCodeToolCall(
        shell(
          "/repo/target/debug/OmniCode.app/Contents/MacOS/omnicode app notes.list --json '{}'",
        ),
      )?.label,
    ).toBe("List notes");
    expect(
      omniCodeToolCall(
        shell(
          "'/Applications/OmniCode App/omnicode' app folders.move --input -",
        ),
      )?.label,
    ).toBe("Move a session");
    expect(
      omniCodeToolCall(
        shell('"C:\\Program Files\\OmniCode\\omnicode.exe" app notes.list'),
      )?.label,
    ).toBe("List notes");
    expect(omniCodeToolCall(shell("omnicode app --help"))?.label).toBe(
      "View CLI commands",
    );
    expect(
      omniCodeToolCall(shell("omnicode app sessions.read --json '{}'"))?.label,
    ).toBe("Read a session");
    expect(
      omniCodeToolCall(shell("omnicode app sessions.send --json '{}'"))?.label,
    ).toBe("Continue a session");
    expect(
      omniCodeToolCall(shell("omnicode app sessions.draft --json '{}'"))?.label,
    ).toBe("Save a draft");
    expect(
      omniCodeToolCall(shell("omnicode app notes.write --input -"))?.label,
    ).toBe("Write a note");
    expect(
      omniCodeToolCall({
        id: "generic",
        role: "tool",
        text: "Run command:",
        tool: { kind: "other", title: "omnicode app sessions.start" },
      })?.label,
    ).toBe("Start a session");
    expect(
      omniCodeToolCall({
        id: "codex-action",
        role: "tool",
        text: "List",
        tool: {
          kind: "execute",
          preview: { kind: "shell", title: "omnicode app notes.list" },
        },
      })?.label,
    ).toBe("List notes");
  });

  it("does not restyle unrelated commands or text mentioning the CLI", () => {
    expect(
      omniCodeToolCall(shell("echo omnicode app notes.list")),
    ).toBeUndefined();
    expect(omniCodeToolCall(shell("omnicode control list"))).toBeUndefined();
    expect(
      omniCodeToolCall({
        id: "prose",
        role: "assistant",
        text: "omnicode app notes.list",
      }),
    ).toBeUndefined();
  });

  it("does not compact compound shell commands or hide a longer shell preview", () => {
    for (const command of [
      "omnicode app notes.list && echo extra",
      "omnicode app notes.list; echo extra",
      "omnicode app notes.list | cat",
      "omnicode app notes.list\necho extra",
      "omnicode app notes.list --json \"$(echo extra)\"",
    ]) {
      expect(omniCodeToolCall(shell(command))).toBeUndefined();
    }
    expect(
      omniCodeToolCall({
        id: "short-title",
        role: "tool",
        text: "omnicode app notes.list",
        tool: {
          kind: "shell",
          title: "omnicode app notes.list",
          preview: {
            kind: "shell",
            title: "omnicode app notes.list && echo extra",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      omniCodeToolCall(
        shell("omnicode app sessions.send --json '{\"prompt\":\"a; b\"}'"),
      )?.command,
    ).toBe("omnicode app sessions.send --json '{\"prompt\":\"a; b\"}'");
  });

  it("names a group only when all its tool calls use OmniCode", () => {
    const calls = [
      shell("omnicode app --help"),
      shell("omnicode app notes.list"),
    ];
    expect(omniCodeWorkSummary(calls, true)).toBe("Using OmniCode");
    expect(omniCodeWorkSummary(calls, false)).toBe("Used OmniCode");
    expect(
      omniCodeWorkSummary([...calls, shell("git status")], true),
    ).toBeUndefined();
  });
});
