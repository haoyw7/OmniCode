import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { getSession } = await import("./sessionStore");
const { summaryFromSession } = await import("./sessionHistory");

/** A saved Codex session holding the one row this PR repairs. */
function codexRecord() {
  return {
    id: "s1",
    harness: "codex",
    model: "gpt-5",
    cwd: "/repo",
    providerSessionId: "01a0e6f4-13e3-7692-9250-4befceed807b",
    blocks: [
      { id: "b0", role: "user", text: "list the agents" },
      {
        id: "b1",
        role: "tool",
        text: "Shell",
        tool: {
          callId: "exec-1",
          title: "Shell",
          kind: "execute",
          status: "completed",
          preview: {
            kind: "shell",
            title: "rg --files -g AGENTS.md -g '!node_modules'",
          },
        },
      },
    ],
  };
}

describe("restoring read-only legacy session projections", () => {
  beforeEach(() => invoke.mockReset());

  it("preserves stored activity when an older transcript is reopened", async () => {
    invoke.mockResolvedValue({ ...codexRecord(), createdAt: 100, updatedAt: 200,
      blocks: [{ id: "u", role: "user", text: "Legacy conversation" }] });
    const session = await getSession("s1");
    expect(summaryFromSession(session!)).toMatchObject({ createdAt: 100, updatedAt: 200 });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["session_get"]);
  });

  it("returns repaired cache data without attempting a native write", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      if (cmd === "session_upsert") return Promise.reject(new Error("db locked"));
      return Promise.resolve(null);
    });

    // Cached Rust rows remain readable; repairs affect only the projection.
    const session = await getSession("s1");
    expect(session).not.toBeNull();
    expect(session?.blocks[1].text).toBe("Find files");
    expect(invoke.mock.calls.some(([cmd]) => cmd === "session_upsert")).toBe(false);
  });

  it("does not persist repairs even when the Rust store is writable", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "session_get") return Promise.resolve(codexRecord());
      return Promise.resolve(null);
    });

    const session = await getSession("s1");
    expect(session?.blocks[1].text).toBe("Find files");
    expect(
      invoke.mock.calls.some(([cmd]) => cmd === "session_upsert"),
    ).toBe(false);
  });
});
