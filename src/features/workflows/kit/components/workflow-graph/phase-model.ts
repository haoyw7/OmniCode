import { hasPhaseVocabulary } from "./participant-model.js";
import type {
  WorkflowCausalityGraphData,
  WorkflowStepData,
} from "./types.js";

/**
 * 阶段层的纯选择器。阶段是图**上面的一层商**：
 * 这里一个字都不改图本身，只按 `Step.phase` 把 step 分桶。第二层（参与者与交接）的选择器在
 * participant-model.ts；旧的下钻过滤（`filterGraphToPhase`）与名册（`phaseActors`）随
 * step 级渲染退役。
 *
 * 无 React、无 DOM。
 */

export { hasPhaseVocabulary };

/**
 * 阶段 id → 成员 step，按 `phases` 的顺序建桶（阶段表的顺序就是画面上的先后语义）。
 * 跨阶段拷贝各自算它所在阶段的成员。
 */
export function phaseMembers(graph: WorkflowCausalityGraphData): Map<string, WorkflowStepData[]> {
  const members = new Map<string, WorkflowStepData[]>(
    (graph.phases ?? []).map((phase) => [phase.id, []]),
  );
  for (const step of graph.steps) {
    if (step.phase === undefined) continue;
    members.get(step.phase)?.push(step);
  }
  return members;
}

