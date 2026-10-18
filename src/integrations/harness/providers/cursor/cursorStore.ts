import { invoke } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend, readProviderRecords } from "../../core/child";

export type StoredCursorToolCall = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type StoredCursorSubagentRun = {
  toolCallId: string;
  agentId: string;
  revision: string;
  agentType?: string | null;
  model?: string | null;
  prompt?: string | null;
  partial?: boolean;
  steps: Array<{
    id: string;
    kind: "message" | "reasoning" | "tool";
    text: string;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    status?: string;
    output?: string;
  }>;
};

// Keep ancestry separately from the payload revision: unchanged parents can have active children.
const ancestry = new Map<string, Map<string, StoredCursorSubagentRun>>();
export async function readStoredCursorSubagentRuns(
  sessionId: string, toolCallIds: string[], knownRevisions: Record<string, string> = {},
): Promise<StoredCursorSubagentRun[]> {
  let cache = ancestry.get(sessionId);
  if (!cache) {
    cache = new Map(); ancestry.set(sessionId, cache);
    if (ancestry.size > 64) ancestry.delete(ancestry.keys().next().value!);
  }
  const output: StoredCursorSubagentRun[] = [];
  const visited = new Set<string>();
  const visit = async (parent: string, ids: string[]) => {
    if (visited.has(parent) || !ids.length) return;
    visited.add(parent);
    const revisions = Object.fromEntries(Object.values(knownRevisions).length
      ? [...cache!].filter(([id]) => knownRevisions[id] !== undefined).map(([id, run]) => [id, run.revision]) : []);
    for (let offset = 0; offset < ids.length; offset += 256) {
      const read = hasHeadlessChildBackend() ? readProviderRecords : invoke;
      const runs = await read<StoredCursorSubagentRun[]>("cursor_subagent_runs", {
        sessionId: parent, toolCallIds: ids.slice(offset, offset + 256), knownRevisions: revisions,
      });
      for (const run of runs) {
        cache!.set(run.agentId, { ...run, prompt: undefined,
          steps: run.steps.filter((step) => step.kind === "tool" && /^(agent|task|subagent)$/i.test(step.toolName ?? "")) });
        output.push(run);
      }
    }
    for (const run of cache!.values()) {
      if (!ids.includes(run.toolCallId)) continue;
      const children = run.steps.filter((step) => step.kind === "tool" && /^(agent|task|subagent)$/i.test(step.toolName ?? ""))
        .flatMap((step) => step.toolCallId ? [step.toolCallId] : []);
      await visit(run.agentId, children);
    }
  };
  await visit(sessionId, toolCallIds);
  return output;
}

export function readStoredCursorToolCalls(
  sessionId: string,
  toolCallIds: string[],
): Promise<StoredCursorToolCall[]> {
  if (hasHeadlessChildBackend()) return Promise.resolve([]);
  return invoke<StoredCursorToolCall[]>("cursor_tool_calls", {
    sessionId,
    toolCallIds,
  });
}
