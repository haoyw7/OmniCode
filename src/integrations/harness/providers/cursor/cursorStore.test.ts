import { expect, it, vi } from "vitest";
import { readStoredCursorSubagentRuns } from "./cursorStore";
import type { StoredCursorSubagentRun } from "./cursorStore";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../core/child", () => ({
  hasHeadlessChildBackend: () => true,
  readProviderRecords: read,
}));

it("uses the Host reader and polls nested runs even when their parent's revision is unchanged", async () => {
  const parent: StoredCursorSubagentRun = {
    agentId: "child",
    toolCallId: "spawn",
    revision: "1",
    steps: [
      {
        id: "child:tool:spawn-inner",
        toolCallId: "spawn-inner",
        kind: "tool",
        text: "Explore",
        toolName: "Task",
      },
    ],
  };
  const nested: StoredCursorSubagentRun = {
    agentId: "grandchild",
    toolCallId: "spawn-inner",
    revision: "2",
    steps: [{ id: "answer", kind: "message", text: "Full answer" }],
  };
  read.mockImplementation(async (_command, args) => {
    const run = args.sessionId === "native-parent" ? parent : nested;
    return args.knownRevisions?.[run.agentId] === run.revision ? [] : [run];
  });
  expect(
    await readStoredCursorSubagentRuns("native-parent", ["spawn"]),
  ).toEqual([parent, nested]);
  nested.revision = "3";
  nested.steps.push({ id: "late", kind: "message", text: "Latest" });
  expect(
    await readStoredCursorSubagentRuns("native-parent", ["spawn"], {
      child: "1",
      grandchild: "2",
    }),
  ).toEqual([nested]);
  expect(read).toHaveBeenLastCalledWith(
    "cursor_subagent_runs",
    expect.objectContaining({
      sessionId: "child",
      toolCallIds: ["spawn-inner"],
    }),
  );
});
