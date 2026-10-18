import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { resolveToolRenderer, toolBodyText } from "./toolRenderer";

function tool(text: string, patch: NonNullable<Block["tool"]> = {}): Block {
  return {
    id: text,
    role: "tool",
    text,
    tool: { status: "completed", ...patch },
  };
}

describe("resolveToolRenderer", () => {
  it("routes provider tools to their renderer", () => {
    expect(resolveToolRenderer(tool("git status", { kind: "execute" }))).toBe(
      "execute",
    );
    expect(
      resolveToolRenderer(tool("Skill dynamic-workflows", { kind: "skill" })),
    ).toBe("skill");
    expect(
      resolveToolRenderer(tool("AskUserQuestion", { kind: "AskUserQuestion" })),
    ).toBe("question");
    expect(
      resolveToolRenderer(
        tool("mcp__github__get_me", { kind: "mcp__github__get_me" }),
      ),
    ).toBe("mcp");
    expect(resolveToolRenderer(tool("Read src/a.ts", { kind: "read" }))).toBe(
      "read",
    );
    expect(resolveToolRenderer(tool("Find theme", { kind: "search" }))).toBe(
      "search",
    );
    expect(resolveToolRenderer(tool("Edit src/a.ts", { kind: "edit" }))).toBe(
      "edit",
    );
    expect(resolveToolRenderer(tool("Review", { kind: "agent" }))).toBe(
      "agent",
    );
    expect(resolveToolRenderer(tool("WebFetch", { kind: "WebFetch" }))).toBe(
      "generic",
    );
  });
});

describe("toolBodyText", () => {
  it("prefers shell output and hides a running call's echoed request", () => {
    const running = tool("git status", {
      kind: "execute",
      status: "in_progress",
      detail: "Bash: git status",
    });
    expect(toolBodyText(running, "execute")).toBeUndefined();
    const streaming = tool("git status", {
      kind: "execute",
      status: "in_progress",
      preview: { kind: "shell", output: "On branch main\n" },
    });
    expect(toolBodyText(streaming, "execute")).toBe("On branch main");
    expect(
      toolBodyText(
        tool("git status", { kind: "execute", detail: "clean" }),
        "execute",
      ),
    ).toBe("clean");
  });

  it("keeps file rows closed unless they failed", () => {
    expect(
      toolBodyText(
        tool("Read a.ts", { kind: "read", detail: "contents" }),
        "read",
      ),
    ).toBeUndefined();
    expect(
      toolBodyText(
        tool("Read a.ts", { kind: "read", status: "failed", detail: "ENOENT" }),
        "read",
      ),
    ).toBe("ENOENT");
  });

  it("drops a result that only repeats the label", () => {
    expect(
      toolBodyText(tool("WebFetch", { detail: "WebFetch" }), "generic"),
    ).toBeUndefined();
  });
});
