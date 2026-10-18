import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCursorSubagents } from "./cursor-subagents";

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});
it("reads full child histories, associates exact parents and observes live WAL updates", async () => {
  const root = mkdtempSync(join(tmpdir(), "monocode-child-test-"));
  roots.push(root);
  const directory = join(root, "acp-sessions", "child");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "store.db"));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE meta(key TEXT, value TEXT); CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB)",
    );
    db.prepare("INSERT INTO meta VALUES ('0', ?)").run(
      Buffer.from(
        JSON.stringify({
          agentId: "child",
          subagentInfo: {
            parentAgentId: "parent",
            toolCallId: "call-123456\nfc_123456",
          },
        }),
      ).toString("hex"),
    );
    const insert = (id: string, value: unknown) =>
      db
        .prepare("INSERT INTO blobs VALUES (?,?)")
        .run(id, Buffer.from(JSON.stringify(value)));
    insert("prompt", {
      role: "user",
      content: [
        { text: "<user_query>" + "Task".repeat(1000) + "</user_query>" },
      ],
    });
    for (let i = 0; i < 305; i++)
      insert(`m${i}`, {
        role: "assistant",
        content: [
          { type: "text", text: i === 0 ? "x".repeat(5000) : `message ${i}` },
        ],
      });
    insert("tool", {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool",
          toolName: "Shell",
          args: { command: "pwd" },
        },
      ],
    });
    insert("result", {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool",
          result: "output".repeat(2000),
        },
      ],
    });
    const args = { sessionId: "parent", toolCallIds: ["fc_123456"] };
    const run = (await readCursorSubagents(args, root))[0];
    expect(run.prompt).toHaveLength(4000);
    expect(run.steps).toHaveLength(306);
    expect(run.steps[0].text).toHaveLength(5000);
    expect(run.steps.at(-1)).toMatchObject({
      toolCallId: "tool",
      status: "completed",
      output: "output".repeat(2000),
    });
    expect(
      await readCursorSubagents(
        { ...args, knownRevisions: { child: run.revision } },
        root,
      ),
    ).toEqual([]);
    expect(
      await readCursorSubagents({ ...args, sessionId: "unrelated" }, root),
    ).toEqual([]);
    insert("late", {
      role: "assistant",
      content: [{ type: "text", text: "Latest" }],
    });
    expect(
      (await readCursorSubagents(
        { ...args, knownRevisions: { child: run.revision } },
        root,
      ))[0].steps.at(-1)?.text,
    ).toBe("Latest");
  } finally {
    db.close();
  }
});
