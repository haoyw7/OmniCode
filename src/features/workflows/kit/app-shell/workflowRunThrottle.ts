/**
 * dwf run 详情页的自适应并发观察面：
 * run 头的并发/冷却读数，以及事件日志里 `node-waiting` / `node-executing` / `concurrency-changed` /
 * `run-caps-changed` 四条事件的行。子代理徽标**不在**这里：它只有三态一个词，直接由协议
 * actor 状态渲染。
 *
 * 展示规则与 workflowRunPanel.ts 共用事件类型，另在本地记录状态的**首次收到时刻**。
 * 协议只带相对量（`cooldownMs`——引擎无时钟），deadline 只能由 UI 按
 * "第一次见到这份状态的时刻"推。登记按对象身份（WeakMap）：归约对未变的 `concurrency` 保留同一对象
 * 引用，一被新事件替换就是新对象、重新登记。不放进协议，是因为它是本地观察，不是引擎事实。
 */
import type { WorkflowRunConcurrency } from "../_shims/protocol.js";

// ── 收到时刻登记 ──

const concurrencyReceivedAt = new WeakMap<WorkflowRunConcurrency, number>();

function stamp<T extends object>(registry: WeakMap<T, number>, subject: T, now: number): number {
  const seen = registry.get(subject);
  if (seen !== undefined) return seen;
  registry.set(subject, now);
  return now;
}

// ── run 头 ──

interface WorkflowRunConcurrencyView {
  /**
   * 芯片上那个数：**实际**并发 `min(cap, limit)`——共享桶的 cap 与本 run 自己的 limit 取小。用户看到的是这次 run
   * 此刻真能有几个子代理在飞，两条界里哪一条在起作用不是读数要回答的问题。
   */
  cap: number;
  ceiling: number;
  /** 冷却 deadline（epoch ms）；无冷却或已过期时缺席。 */
  cooldownUntil?: number;
}

/**
 * run 头的并发读数。只在**实际并发 < ceiling** 时在场：跑在天花板上的 run 没有可说的。
 * 冷却按收到时刻 + `cooldownMs` 推 deadline，过期即缺席——UI 不显示一个已经过去的时间。
 */
export function workflowRunConcurrencyView(
  concurrency: WorkflowRunConcurrency | undefined,
  now: number,
): WorkflowRunConcurrencyView | undefined {
  if (concurrency === undefined) return undefined;
  const effective = Math.min(concurrency.cap, concurrency.limit ?? concurrency.cap);
  if (effective >= concurrency.ceiling) return undefined;
  const view: WorkflowRunConcurrencyView = { cap: effective, ceiling: concurrency.ceiling };
  if (concurrency.cooldownMs !== undefined) {
    const until = stamp(concurrencyReceivedAt, concurrency, now) + concurrency.cooldownMs;
    if (until > now) view.cooldownUntil = until;
  }
  return view;
}

