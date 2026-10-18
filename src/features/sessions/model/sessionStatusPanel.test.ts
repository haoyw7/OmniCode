import { describe, expect, it } from "vitest";
import type { Block, TaskListItem } from "./session";
import {
  buildSessionStatusPanelModel,
  focusedTaskWindow,
  sessionStatusSummary,
} from "./sessionStatusPanel";

const tasks = (id: string, items: TaskListItem[]): Block => ({
  id,
  role: "tasks",
  text: "",
  taskList: { items },
});
const agent = (id: string, status: string): Block => ({
  id,
  role: "tool",
  text: "Agent",
  tool: { kind: "Agent", title: "Agent", status },
  agentRun: { name: "Review the diff", steps: [] },
});

describe("session status panel", () => {
  it("is empty for a session with nothing to report", () => {
    expect(
      buildSessionStatusPanelModel({ blocks: [], busy: false }).hasContent,
    ).toBe(false);
  });

  it("uses the latest task list and hides a finished one once idle", () => {
    const blocks = [
      tasks("old", [{ text: "Old", status: "pending" }]),
      tasks("new", [{ text: "Done", status: "completed" }]),
    ];
    expect(
      buildSessionStatusPanelModel({ blocks, busy: true }).tasks?.[0].text,
    ).toBe("Done");
    expect(buildSessionStatusPanelModel({ blocks, busy: false }).tasks).toBe(
      null,
    );
  });

  it("keeps completed, running and failed subagents available", () => {
    const model = buildSessionStatusPanelModel({
      blocks: [
        agent("a", "completed"),
        agent("b", "in_progress"),
        agent("c", "failed"),
      ],
      busy: true,
    });
    expect(model.subagents.map((run) => [run.blockId, run.state])).toEqual([
      ["b", "pending"],
      ["c", "rejected"],
      ["a", "accepted"],
    ]);
    expect(sessionStatusSummary(model)).toMatchObject({
      kind: "running",
      count: 1,
    });
    const idle = buildSessionStatusPanelModel({
      blocks: [agent("a", "completed"), agent("c", "failed")],
      busy: false,
    });
    expect(idle.hasContent).toBe(true);
    expect(sessionStatusSummary(idle)).toEqual({ kind: "agents", count: 2 });
  });

  it("ignores a zero diff and prefers uncommitted changes over the current task", () => {
    expect(
      buildSessionStatusPanelModel({
        blocks: [],
        busy: false,
        git: { additions: 0, deletions: 0 },
      }).git,
    ).toBe(null);
    const model = buildSessionStatusPanelModel({
      blocks: [
        tasks("t", [
          { text: "Ship", status: "completed" },
          { text: "Verify", status: "in_progress" },
        ]),
      ],
      busy: true,
      git: { additions: 3, deletions: 1, files: 2 },
    });
    expect(sessionStatusSummary(model)).toEqual({
      kind: "git",
      additions: 3,
      deletions: 1,
      files: 2,
    });
    expect(sessionStatusSummary({ ...model, git: null })).toEqual({
      kind: "task",
      text: "Verify",
      status: "current",
    });
  });

  it("counts only child tool steps and prefers the transcript over legacy previews", () => {
    const block = agent("worker", "in_progress");
    block.agentRun!.steps = [
      { id: "message", kind: "message", text: "Working" },
      { id: "reasoning", kind: "reasoning", text: "Thinking" },
      { id: "tool", kind: "tool", text: "Read file" },
    ];
    const count = () => buildSessionStatusPanelModel({ blocks: [block], busy: true }).subagents[0].steps;
    expect(count()).toBe(1);
    block.agentRun!.transcript = [];
    expect(count()).toBe(0);
    block.agentRun!.transcript = [
      { id: "prompt", role: "user", text: "Review" },
      { id: "reply", role: "assistant", text: "Working" },
      { id: "thought", role: "reasoning", text: "Thinking" },
      { id: "read", role: "tool", text: "Read file" },
      { ...agent("nested", "completed"), agentRun: { name: "Nested", steps: [
        { id: "nested-tool", kind: "tool", text: "Do not count twice" },
      ] } },
    ];
    expect(count()).toBe(2);
    block.agentRun!.transcript.push({ id: "test", role: "tool", text: "Run tests" });
    block.tool!.status = "completed";
    expect(count()).toBe(3);
  });

  it("focuses long task lists around the active item", () => {
    const items: TaskListItem[] = Array.from({ length: 8 }, (_, i) => ({
      text: String(i),
      status: i < 4 ? "completed" : i === 4 ? "in_progress" : "pending",
    }));
    expect(focusedTaskWindow(items)).toEqual({ start: 3, end: 6 });
    expect(focusedTaskWindow(items.slice(0, 6))).toEqual({ start: 0, end: 6 });
  });

  it("keeps binary and mode-only file changes visible when no lines changed", () => {
    const model = buildSessionStatusPanelModel({
      blocks: [],
      busy: false,
      git: { additions: 0, deletions: 0, files: 1 },
    });
    expect(model.hasContent).toBe(true);
    expect(sessionStatusSummary(model)).toMatchObject({ kind: "git" });
  });
});
