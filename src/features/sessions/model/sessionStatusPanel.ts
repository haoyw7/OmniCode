import type { Block, TaskListItem } from "./session";
import { legacyTaskListFromText } from "./taskList";
import { planTitle } from "./plan";
import { agentStepCount } from "./agentTranscript";
import {
  isSubagentBlock,
  subagentModelName,
  subagentName,
  toolCallState,
  type ToolCallState,
} from "./transcriptActivity";

export type SessionStatusGit = {
  additions: number;
  deletions: number;
  branch?: string;
  /** Binary, mode-only and empty-file changes can have zero changed lines. */
  files?: number;
};

export type SessionStatusPanelModel = {
  git: SessionStatusGit | null;
  tasks: TaskListItem[] | null;
  /** Newest first. */
  plans: { blockId: string; title: string; streaming: boolean }[];
  /** Running first, newest first within each group. */
  subagents: {
    blockId: string;
    name: string;
    model?: string;
    state: ToolCallState;
    steps: number;
  }[];
  background: string[];
  hasContent: boolean;
};

export type SessionStatusSummary =
  | { kind: "task"; text: string; status: "current" | "done" }
  | { kind: "git"; additions: number; deletions: number; files: number }
  | { kind: "progress"; completed: number; total: number }
  | { kind: "plan"; text: string }
  | { kind: "agents"; count: number }
  | { kind: "running"; count: number; agents: boolean; background: boolean };

export function buildSessionStatusPanelModel(input: {
  blocks: readonly Block[];
  backgroundTasks?: readonly string[];
  busy: boolean;
  git?: SessionStatusGit | null;
}): SessionStatusPanelModel {
  let tasks: TaskListItem[] | null = null;
  const plans: SessionStatusPanelModel["plans"] = [];
  const subagents: SessionStatusPanelModel["subagents"] = [];
  for (let i = input.blocks.length - 1; i >= 0; i--) {
    const block = input.blocks[i];
    if (block.role === "tasks") {
      if (!tasks && block.taskList?.items.length) tasks = block.taskList.items;
    } else if (block.role === "plan") {
      if (block.orchestration || !block.text.trim()) continue;
      if (legacyTaskListFromText(block.text)) continue;
      plans.push({
        blockId: block.id,
        title: planTitle(block.text),
        streaming: !!block.streaming,
      });
    } else if (isSubagentBlock(block)) {
      subagents.push({
        blockId: block.id,
        name: subagentName(block),
        model: subagentModelName(block),
        state: toolCallState(block),
        steps: agentStepCount(block),
      });
    }
  }
  subagents.sort((a, b) => Number(b.state === "pending") - Number(a.state === "pending"));
  // A finished list stays useful while the turn wraps up, then gets out of the way.
  if (tasks && !input.busy && !tasks.some(isOpenTask)) tasks = null;
  const background = [...(input.backgroundTasks ?? [])];
  const git =
    input.git &&
    (input.git.additions + input.git.deletions > 0 ||
      (input.git.files ?? 0) > 0)
      ? input.git
      : null;
  return {
    git,
    tasks,
    plans,
    subagents,
    background,
    hasContent: Boolean(
      git || tasks || plans.length || subagents.length || background.length,
    ),
  };
}

function isOpenTask(item: TaskListItem): boolean {
  return item.status === "pending" || item.status === "in_progress";
}

/**
 * The single line the collapsed capsule shows.
 * Uncommitted changes win, so a busy task list cannot hide the diff.
 */
export function sessionStatusSummary(
  model: SessionStatusPanelModel,
): SessionStatusSummary | null {
  if (model.git) {
    return {
      kind: "git",
      additions: model.git.additions,
      deletions: model.git.deletions,
      files: model.git.files ?? 0,
    };
  }
  const tasks = model.tasks ?? [];
  const current =
    tasks.find((item) => item.status === "in_progress") ??
    tasks.find((item) => item.status === "pending");
  if (current) return { kind: "task", text: current.text, status: "current" };
  const done = [...tasks].reverse().find((item) => item.status === "completed");
  if (done) return { kind: "task", text: done.text, status: "done" };
  if (tasks.length) {
    const actionable = tasks.filter((item) => item.status !== "cancelled");
    return {
      kind: "progress",
      completed: actionable.filter((item) => item.status === "completed")
        .length,
      total: actionable.length,
    };
  }
  if (model.plans.length) return { kind: "plan", text: model.plans[0].title };
  const runningAgents = model.subagents.filter(
    (agent) => agent.state === "pending",
  ).length;
  const count = runningAgents + model.background.length;
  if (count) {
    return {
      kind: "running",
      count,
      agents: runningAgents > 0,
      background: model.background.length > 0,
    };
  }
  if (model.subagents.length)
    return { kind: "agents", count: model.subagents.length };
  return null;
}

/** Long lists keep the active neighbourhood visible and fold the rest. */
export function focusedTaskWindow(
  items: readonly TaskListItem[],
  limit = 6,
): { start: number; end: number } {
  if (items.length <= limit) return { start: 0, end: items.length };
  const active = items.findIndex(isOpenTask);
  const center = active < 0 ? items.length - 1 : active;
  const start = Math.max(0, Math.min(center - 1, items.length - 3));
  return { start, end: start + 3 };
}
