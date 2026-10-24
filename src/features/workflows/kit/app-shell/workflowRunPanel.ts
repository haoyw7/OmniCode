/**
 * workflow run 详情页的纯逻辑：Cancel 可用性、结果/失败面板判定、事件日志行摘要。
 *
 * 抽成纯函数是因为详情页里唯一有"规则"的部分就是这些，而它们全都能被穷举单测，
 * 不必渲染一张 React Flow 画布。组件只负责把这里的结果贴到 DOM 上。
 */
import { readWorkflowRunStopReason, type WorkflowRunStopReason } from "../components/workflow-graph/run-status-presentation.js";
import type { WorkflowRunActor, WorkflowRunState } from "../_shims/protocol.js";
import type { WorkflowAgentAvatar } from "../../model/workflowAgentAvatar";

/**
 * Cancel 只在 `running` 上可用。
 *
 * 取消走的是既有的 v4 `cancelBackgroundWork {workId: runId}`（三个入口一个实现，
 * 没有第二条 cancel RPC），而它对已终结的任务本来就是 noop——按钮在终态禁用是为了
 * 不给出一个点下去毫无反应的控件，不是为了兜底。run 缺席（被 8-run 上限淘汰或冷启动
 * 尚未投影）时同样不可取消：此时我们对它的在飞状态一无所知。
 */
export function isWorkflowRunCancellable(run: WorkflowRunState | undefined): boolean {
  return run?.status === "running";
}

/**
 * Resume 可用性。**一个信源**：投影 run 的 `resumable` 状态位——由 CLI 在 `run-settled`
 * 载荷上按 resume 门的**同一个谓词**算好（live 与冷回放同一条铸造链），UI 绝不自行按
 * status + failureCode 推导（两处谓词会漂移：按钮亮着但命令被拒）。
 *
 * 投影缺席（被 8-run 上限淘汰）一律不可恢复：宁可少一个按钮，不给出一个点下去必被拒的控件。
 */
export function isWorkflowRunResumable(run: WorkflowRunState | undefined): boolean {
  return run?.resumable === true;
}

type WorkflowRunResultView =
  /** run 不在投影里：不可能有结果可言。 */
  | { kind: "absent" }
  /** pending / running：还没有结果面板。 */
  | { kind: "none" }
  /**
   * 完成。`preview` 本阶段**恒缺席**——脚本产物只在 `RunSettlement.artifact` 里，既不在
   * `run-settled` 事件上（它只携 status 与 error），也不在 journal 里。所以完成态只能指向
   * 会话里那条后台结果轮，绝不编造一个结果视图。schema 保留了该字段，真填上时如实展示。
   */
  | { kind: "completed"; preview?: string }
  /**
   * errored / stopped。`message` 是投影给出的预格式化
   * 原文（schema 里就是一个 string）；`stopReason` 只在 stopped 且投影带该键时在场。
   */
  | {
      kind: "error";
      status: "errored" | "stopped";
      stopReason?: WorkflowRunStopReason;
      message?: string;
    };

export function workflowRunResultView(run: WorkflowRunState | undefined): WorkflowRunResultView {
  if (!run) return { kind: "absent" };
  if (run.status === "errored" || run.status === "stopped") {
    const stopReason = readWorkflowRunStopReason(run);
    return {
      kind: "error",
      status: run.status,
      ...(stopReason === undefined ? {} : { stopReason }),
      ...(run.error ? { message: run.error } : {}),
    };
  }
  if (run.status === "completed") {
    return { kind: "completed", ...(run.resultPreview ? { preview: run.resultPreview } : {}) };
  }
  return { kind: "none" };
}

// ── Transcript 入口：step 卡片 → actor 实例──

/**
 * 一个可打开的 actor 实例。
 *
 * `siteId` + `ordinal` 是身份（journal 的键），`name` 只是展示；`sessionId` 是那条真实持久
 * 会话的 id，也是嵌套只读 SessionPane 唯一需要的东西。
 *
 * `sessionId` **可缺席**（schema-optional）：进度事件可能先于 actor 会话落库到达，老 run
 * 也可能根本没有；还没启动的槽位
 * 更是从来没有。缺席的实例照样开 tab——tab 的身份是 (runId, siteId, ordinal)，会话 id 只是
 * 随行的订阅目标，缺席时 tab 里是「尚未启动」占位。
 */
export interface WorkflowActorInstance {
  avatar?: WorkflowAgentAvatar;
  siteId: string;
  ordinal: number;
  name?: string;
  sessionId?: string;
  status: WorkflowRunActor["status"];
}

