// ============================================================
// workflowRuns 的键级增量：diff（生产侧）、apply（消费侧）与规范键序
// ============================================================
// 为什么存在：`workflowRuns` 是一个**高频**状态键，而 `state.updated` 的语义是键级整体替换。
// 一条引擎事件只改一个节点，却要把整张表重发一遍——每事件 O(N) 字节、一条 run 全程 O(N²)。
// 节点/子代理被压在 256 上、宽 fan-out 一撞界就静默丢实例，根子都在这里。本模块把「这一步
// 改了什么」算出来，让线上的字节数与**改动量**成正比，而不是与状态大小成正比。
//
// 三条结构性事实，读下面的代码前先知道，否则几处会像兜底：
//   1. reducer 只在表满时**淘汰**终态条目，绝不重排（workflow-runs-eviction.ts）。所以 diff 的
//      快路径仍然是按下标对齐比较，只在对不齐时才退到键化路径算出「哪些走了」；真遇到重排
//      它认不出来，只能整键重发（见 RESYNC）。
//   2. reducer 只给**变化的那条 run** 造新对象，其余 run 与未改动的条目保持引用不变。所以
//      diff 的第一道闸是引用比较，深比较只发生在真正动过的那条 run 上。
//   3. 正确性绝不依赖引用：引用相等只是快路径，不等时一律退回结构比较。
//
// 契约：对任意一对 reducer 产出的 (prior, next)，
// `JSON.stringify(applyAll(带 prior 的快照, diff(prior, next)).workflowRuns) === JSON.stringify(next)`
// ——**逐字节**，不只是深相等。键序因此是本模块的一等公民，见 {@link canonicalWorkflowRun}。

// OmniCode port: only canonical key order + structural equality are kept; the
// ZCode wire-delta diff/apply half is dropped because OmniCode syncs whole sessions.

import { workflowRunSchema, type WorkflowRunState } from "./workflow-runs.js";

/**
 * run 对象的**规范键序** = `workflowRunSchema` 的声明序。
 *
 * 逐字节一致里唯一不靠「值相等」保证的一环就是键序：reducer 用 `{...run, 新键: v}` 推进状态，
 * 新出现的可选键（reports / phases / concurrency…）因此按**到达顺序**缀在对象尾部，而 apply
 * 重建 run 时没有那段历史。两边各自按这张表重排一次，序就对齐了——这也是为什么 reducer 的
 * 出口同样要走一遍本函数（那是一处，不是两处）。
 *
 * 键序从 schema 派生，避免独立维护字段表导致生产者和消费者使用不同的 run 结构。
 */
const WORKFLOW_RUN_KEYS = Object.keys(workflowRunSchema.shape) as (keyof WorkflowRunState)[];
const WORKFLOW_RUN_KEY_SET: ReadonlySet<string> = new Set<string>(WORKFLOW_RUN_KEYS);

/**
 * 按规范键序重建一个 run 对象（浅重建：嵌套值原样搬运引用，它们本来就来自同一份事实）。
 *
 * `undefined` 值的键按缺席处理，与 `JSON.stringify` 的语义对齐——协议线上只有「键在场」与
 * 「键缺席」两态，没有第三态。schema 之外的键按原序缀在尾部：本模块没有资格替调用方丢数据。
 */
export function canonicalWorkflowRun(run: WorkflowRunState): WorkflowRunState {
  const source = run as unknown as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of WORKFLOW_RUN_KEYS) {
    const value = source[key];
    if (value !== undefined) canonical[key] = value;
  }
  for (const key of Object.keys(source)) {
    if (WORKFLOW_RUN_KEY_SET.has(key)) continue;
    const value = source[key];
    if (value !== undefined) canonical[key] = value;
  }
  return canonical as unknown as WorkflowRunState;
}

/**
 * JSON 值的结构相等。reducer 的幂等判据（原来是整条 run 的 `JSON.stringify` 比对，每事件
 * O(N) 字节）与 diff 的「这个键/条目变了吗」共用这一份，两处判据不会再各说各话。
 *
 * 与 `JSON.stringify` 的差别只有两处，两处都是**更**准确：键序不参与判定；`undefined` 值的键
 * 与缺席等同（stringify 也会丢掉它们）。
 */
export function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonValueEqual(item, b[index]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let present = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    present += 1;
    if (!jsonValueEqual(value, right[key])) return false;
  }
  let expected = 0;
  for (const key of Object.keys(right)) if (right[key] !== undefined) expected += 1;
  return present === expected;
}

/** reducer 的幂等判据：同一条事件重放后内容无变化即不产 delta、不抬 revision。 */
export function workflowRunUnchanged(previous: WorkflowRunState, next: WorkflowRunState): boolean {
  return jsonValueEqual(previous, next);
}

