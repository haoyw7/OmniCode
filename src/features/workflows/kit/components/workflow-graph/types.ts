import type { ToolCallCreateWorkflowCausalityGraph } from "../../_shims/protocol.js";

/**
 * The graph the renderer consumes is exactly the bounded display payload from the
 * CreateWorkflow tool — one vocabulary from analyzer to pixels. A future live runtime
 * view reuses the same component by feeding `statuses` (and flipping `animatedEdges`);
 * absence of both renders the static analysis picture.
 *
 * The whole visual vocabulary, deliberately small
 *
 *   a module = a phase · a card = a participant (a subagent, or the workspace, in that
 *   phase) · a collapsed module = a deck of its participants' cards · an arrow = "runs
 *   after" · a terminal dot = the returned artifact
 * Hand-off arrows inside a module are causality facts quotiented by participant; arrows
 * between modules are control flow (the CFG's phase quotient); both are the same arrow.
 * `back` marks a loop's back edge for ranking only — same ink. Steps and lanes stay in the
 * payload as the run-status join key and the inspector's material; neither is drawn.
 */
export type WorkflowCausalityGraphData = ToolCallCreateWorkflowCausalityGraph;
export type WorkflowStepData = WorkflowCausalityGraphData["steps"][number];
export type WorkflowLaneData = WorkflowCausalityGraphData["lanes"][number];
export type WorkflowParticipantData = WorkflowCausalityGraphData["participants"][number];
export type WorkflowHandoffData = WorkflowCausalityGraphData["handoffs"][number];

/** Per-step run state for the live-execution view; keyed by step id. */
export type StepRunStatus = "pending" | "running" | "done" | "failed";

/**
 * 按 step id 索引的状态表。**偏表**：没有观察到实例的 step 没有条目。缺席与 `pending` 是两件事——前者是
 * 「这里什么都没发生」，后者是「一个真实的实例在排队」；把两者写成同一个值会让控制流没走的
 * 分支站点把整站拖成 pending。
 */
export type StepStatusTable = Partial<Record<string, StepRunStatus>>;

/** The single lane every `files.*` read runs in. */
export const WORKSPACE_LANE_ID = "workspace";
/** Lane of an ask whose receiver the analysis could not resolve to an actor site. */
export const UNKNOWN_LANE_ID = "unknown";
/**
 * 兜底阶段：首个 `phase()` 标记之前发出的 step 的家，也是无标记脚本的隐式唯一阶段
 * （分析器的参与者恒带 `phase: "unphased"`）。保留 id，且**没有 name**——显示名由 UI
 * 本地化，与 `workspace`/`unknown` 车道同一模式（见 phase-name.ts）。
 */
export const UNPHASED_PHASE_ID = "unphased";
/**
 * 无标记脚本的隐式唯一模块的 id（UI 合成，见 participant-model.ts 的 `withImplicitPhase`）。
 * 与 `unphased` 分开：那个词在有标记的脚本里意味着「首个标记之前」（Ungrouped），而隐式
 * 模块就是整个工作流（Workflow）。
 */
export const IMPLICIT_PHASE_ID = "workflow";

/**
 * What a lane IS, which is the only thing colour encodes in this view. `workspace` is
 * not an actor (no mailbox, hence no `fifo`) and `unresolved` is an ask whose receiver
 * the analysis could not site — both are real distinctions. Per-actor identity is
 * carried by the name on the card, not by a tint.
 *
 * It lives here, next to the ids it is derived from, because both the projection and the
 * naming policy (lane-name.ts) key on it.
 */
export type LaneClass = "agent" | "workspace" | "unresolved";

export function laneClassOf(laneId: string): LaneClass {
  if (laneId === WORKSPACE_LANE_ID) return "workspace";
  if (laneId === UNKNOWN_LANE_ID) return "unresolved";
  return "agent";
}

