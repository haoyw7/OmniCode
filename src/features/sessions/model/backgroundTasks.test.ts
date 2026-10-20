import { describe, expect, it } from "vitest";
import { backgroundTaskItems } from "./backgroundTasks";
import type { Block } from "./session";

const task = (id: string, status: string, extra: Partial<Block["tool"]> = {}): Block => ({
  id, role: "tool", text: id, startedAt: 1000,
  tool: { background: true, backgroundTaskId: id, kind: "execute", status, ...extra },
});

describe("background task history", () => {
  it("keeps failed and stopped history, with command, output and timing", () => {
    const items = backgroundTaskItems([
      task("done", "completed", { preview: { kind: "shell", title: "npm test", output: "Tests passed" } }),
      { ...task("failed", "failed", { detail: "exit code 1" }), durationMs: 1200 },
      task("stopped", "cancelled"),
      task("running", "in_progress", { input: JSON.stringify({ command: "sleep 30" }) }),
      { id: "foreground", role: "tool", text: "npm run check", tool: { status: "completed" } },
    ], ["sleep 30"]);
    expect(items.map(({ id, state }) => [id, state])).toEqual([
      ["running", "running"], ["stopped", "stopped"], ["failed", "failed"], ["done", "completed"],
    ]);
    expect(items[0]).toMatchObject({ command: "sleep 30", taskId: "running", startedAt: 1000 });
    expect(items[2]).toMatchObject({ output: "exit code 1", durationMs: 1200 });
    expect(items[3]).toMatchObject({ command: "npm test", output: "Tests passed" });
  });

  it("supports old description-only Hosts without duplicating live rich rows or subagents", () => {
    expect(backgroundTaskItems([], ["Build"])).toMatchObject([{ title: "Build", state: "running" }]);
    expect(backgroundTaskItems([task("build", "in_progress")], ["Build"])).toHaveLength(1);
    expect(backgroundTaskItems([{ ...task("agent", "in_progress"), tool: { background: true, kind: "agent", status: "in_progress" } }], ["Explore"])).toEqual([]);
  });
});
