import type { AgentStep, Block } from "./session";

export function agentStepBlock(step: AgentStep): Block {
  if (step.kind !== "tool")
    return {
      id: step.id,
      role:
        step.kind === "reasoning"
          ? "reasoning"
          : step.kind === "user"
            ? "user"
            : "assistant",
      text: step.text,
    };
  return {
    id: step.id,
    role: "tool",
    text: step.text,
    tool: {
      callId: step.id,
      title: step.text,
      kind: step.toolKind,
      status: step.status,
      detail: step.detail,
      preview: step.preview,
    },
  };
}

export function agentTranscript(block: Block): Block[] {
  return (
    block.agentRun?.transcript ??
    block.agentRun?.steps.map(agentStepBlock) ??
    []
  );
}

/** Count the child's own tool calls; prose and mirrored previews are not extra steps. */
export function agentStepCount(block: Block): number {
  return block.agentRun?.transcript?.filter((row) => row.role === "tool").length
    ?? block.agentRun?.steps.filter((step) => step.kind === "tool").length
    ?? 0;
}

/** Paths are block identities, not snapshots; an open panel always reads live data. */
export function resolveAgentBlock(
  blocks: Block[],
  path: readonly string[],
): Block | undefined {
  let current: Block | undefined;
  for (const id of path) {
    current = blocks.find((block) => block.id === id);
    if (!current) return undefined;
    blocks = agentTranscript(current);
  }
  return current;
}

/** Only update a uniquely identified call. Explicit paths disambiguate reused IDs. */
export function updateAgentTool(
  blocks: Block[],
  callId: string,
  update: (block: Block) => Block,
  path?: readonly string[],
): Block[] {
  if (path !== undefined) {
    const indices = blocks.flatMap((block, index) =>
      block.tool?.callId === callId ? [index] : [],
    );
    if (indices.length !== 1) return blocks;
    const index = indices[0];
    const block = blocks[index];
    let next: Block;
    if (!path.length) next = update(block);
    else {
      const transcript = agentTranscript(block);
      const children = updateAgentTool(
        transcript,
        path[0],
        update,
        path.slice(1),
      );
      if (children === transcript) return blocks;
      next = {
        ...block,
        agentRun: {
          name: block.text,
          steps: [],
          ...block.agentRun,
          transcript: children,
        },
      };
    }
    if (next === block) return blocks;
    const rows = blocks.slice();
    rows[index] = next;
    return rows;
  }
  let matches = 0;
  const count = (rows: Block[]) => {
    for (const block of rows) {
      if (block.tool?.callId === callId) matches++;
      if (block.agentRun?.transcript) count(block.agentRun.transcript);
    }
  };
  count(blocks);
  if (matches !== 1) return blocks;
  const visit = (rows: Block[]): Block[] => {
    let changed = false;
    const next = rows.map((block) => {
      if (block.tool?.callId === callId) {
        const result = update(block);
        changed ||= result !== block;
        return result;
      }
      if (!block.agentRun?.transcript) return block;
      const transcript = visit(block.agentRun.transcript);
      if (transcript === block.agentRun.transcript) return block;
      changed = true;
      return { ...block, agentRun: { ...block.agentRun, transcript } };
    });
    return changed ? next : rows;
  };
  return visit(blocks);
}

export function* walkTranscript(blocks: readonly Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if (block.agentRun?.transcript)
      yield* walkTranscript(block.agentRun.transcript);
  }
}
