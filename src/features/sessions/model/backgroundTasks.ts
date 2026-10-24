import type { Block } from "../../../contracts/session";
import { isSubagentBlock, toolCallState } from "./transcriptActivity";

export type BackgroundTaskItem = {
  id: string;
  taskId?: string;
  title: string;
  command?: string;
  output?: string;
  state: "running" | "completed" | "failed" | "stopped";
  startedAt?: number;
  durationMs?: number;
};

/** The transcript owns task history; clearing the panel never deletes messages. */
export function backgroundTaskItems(blocks: readonly Block[], waiting: readonly string[] = []): BackgroundTaskItem[] {
  const items: BackgroundTaskItem[] = [];
  for (const block of blocks) {
    if (block.role !== "tool" || !block.tool?.background || isSubagentBlock(block)) continue;
    const tool = block.tool;
    const status = tool.status?.toLowerCase();
    const state = ["cancelled", "canceled", "killed", "stopped"].includes(status ?? "") ? "stopped"
      : toolCallState(block) === "pending" ? "running"
      : toolCallState(block) === "rejected" ? "failed" : "completed";
    let command = tool.preview?.kind === "shell" ? tool.preview.title : undefined;
    if (!command && tool.input) {
      try {
        const input: unknown = JSON.parse(tool.input);
        if (input && typeof input === "object" && "command" in input && typeof input.command === "string") command = input.command;
      } catch { /* Older histories can contain a plain tool input. */ }
    }
    items.push({
      id: block.id, taskId: tool.backgroundTaskId,
      title: tool.title || block.text,
      command, output: tool.output ?? tool.preview?.output ?? tool.detail,
      state, startedAt: block.startedAt, durationMs: block.durationMs,
    });
  }
  // Older Hosts publish only descriptions. Rich rows already represent these
  // tasks, while subagents have their own card and conversation.
  if (!items.some((item) => item.state === "running") && !blocks.some((block) => isSubagentBlock(block) && toolCallState(block) === "pending")) {
    waiting.forEach((title, index) => items.push({ id: `waiting:${index}:${title}`, title, state: "running" }));
  }
  return items.reverse();
}
