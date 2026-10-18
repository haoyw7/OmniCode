/**
 * CreateWorkflow 工具入参的读取规则。
 *
 * 从 `create-workflow.tsx` 拆出：这些是纯函数，而卡片组件本身随 run 态/诊断/图交互线性增长，
 * 两者叠在一处后该文件越过 oxlint max-lines(400)（`rows.ts → toolDisplay.ts`、
 * `ToolCallBlocks.tsx → resolveRenderer.ts` 是同一先例）。本文件不含 JSX，也不碰渲染。
 *
 * 一处定义、三处消费——聊天卡片、运行确认窗、run 详情页——所以同一份入参在任何一个面上
 * 都不会被各自解析出不同的结果。
 */

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** CreateWorkflow 工具入参里的可选展示名；聊天卡片与运行确认窗共用同一读取规则。 */
export function readWorkflowName(input: unknown): string | undefined {
  if (isPlainRecord(input) && typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

/** CreateWorkflow 工具入参里的脚本原文；聊天卡片与运行确认窗共用同一读取规则。 */
export function readWorkflowScript(input: unknown): string | undefined {
  if (isPlainRecord(input) && typeof input.script === "string" && input.script.length > 0) {
    return input.script;
  }

  return undefined;
}

/**
 * AmendWorkflow 入参里被修订的前驱 run（`run_id`）。在场即本次是 supersede：以新脚本铸新 run，从这个前驱导入缓存，
 * 前驱还在跑就先停下它。
 *
 * 与 `readWorkflowScript` 同一条纪律：走**入参通道**而不是 display，所以 lineage 事实零新
 * 载荷。只对 AmendWorkflow 行有意义——CreateWorkflow 的入参没有 `run_id`。
 */
export function readWorkflowAmendTarget(input: unknown): string | undefined {
  return isPlainRecord(input) ? readTrimmedString(input.run_id) : undefined;
}

/**
 * AmendWorkflow 入参里由 CLI `resolveInput` 回填的前驱事实块：确认窗据 `status` 决定要不要说「仍在运行，将被停止」。只读确认窗
 * 会用到的两个字段；权限判定读的 `owned_by_this_session` 在 CLI 侧，UI 不看它。
 */
interface WorkflowAmendPredecessor {
  status: string | undefined;
  name: string | undefined;
}

export function readWorkflowAmendPredecessor(input: unknown): WorkflowAmendPredecessor | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.predecessor)) {
    return undefined;
  }
  const predecessor = input.predecessor;
  return {
    status: readTrimmedString(predecessor.status),
    name: readTrimmedString(predecessor.name),
  };
}

/**
 * `max_concurrency`：用户要求这次 run 最多同时跑几个子代理。Create 与 Amend 是同一个字段名，所以读取规则也只有一份。
 *
 * 只认正整数：Amend 的 `null`（去掉上限）与缺席在确认窗里是同一件事——没有上限可说，不摆这一行。
 * 到这里的值**已经是会生效的那个**：两个工具的 `resolveInput` 在开确认窗之前就把超过天花板的
 * 请求 clamp 过了。所以这里不重做 clamp——它既拿不到天花板，也不需要拿到。（run 跑起来之后
 * run 头的并发芯片显示的是 min(这条界, 共享 cap)，那是另一回事。）
 */
export function readWorkflowMaxConcurrency(input: unknown): number | undefined {
  if (!isPlainRecord(input)) {
    return undefined;
  }
  const value = input.max_concurrency;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * `subagent_model`：这次 run 的**子代理**跑在哪个模型上。
 * 与 `max_concurrency` 同一条纪律：Create 与 Amend 是同一个字段名，读取规则也只有一份。
 *
 * 只认非空字符串：Amend 的 `null`（退回会话模型）与缺席在确认窗里是同一件事——子代理跟随
 * 会话模型，没有第二个模型可说，不摆这一行。到这里的值**已经是会生效的那个**：两个工具的
 * `resolveInput` 在开确认窗之前就把用户给的名字解析成了规范串 `providerId/modelId[$level]`，
 * 解析不了的调用根本走不到窗前。所以这里不做任何形状校验——UI 不是第二个解析器。
 */
export function readWorkflowSubagentModel(input: unknown): string | undefined {
  return isPlainRecord(input) ? readTrimmedString(input.subagent_model) : undefined;
}

/**
 * 这次修订沿用前驱的脚本。
 * 两个面各有一条证据，读法只有这一份：
 *
 *   - 确认窗读的是 CLI `resolveInput` 回填过的入参：脚本已经在里面，`predecessor.script_inherited`
 *     说它是沿用来的；
 *   - 聊天卡读的是**模型发出的**入参（行的 input 来自流式参数，回填发生在那之后）：两个脚本来源
 *     `script` 与 `path` **都**没有，才是省略了脚本。只缺 `script` 不算——`path` 修订（「Script
 *     files」的常态）同样不带 `script`，而它交上来的正是一份改过的脚本。
 *
 * 第二条只在入参**写完之后**成立——流式中脚本可能还没到，调用方负责只在非 `inputStreaming` 时问。
 * 入参不是记录（快照裁剪成预览、形状不明）时什么都不断言。
 */
export function readWorkflowAmendScriptInherited(input: unknown): boolean {
  if (!isPlainRecord(input)) {
    return false;
  }
  if (isPlainRecord(input.predecessor) && input.predecessor.script_inherited === true) {
    return true;
  }
  return readWorkflowScript(input) === undefined && readTrimmedString(input.path) === undefined;
}

/** 前驱仍在飞（pending / running）：修订会先停下它。 */
export function isWorkflowAmendPredecessorLive(
  predecessor: WorkflowAmendPredecessor | undefined,
): boolean {
  return predecessor?.status === "running" || predecessor?.status === "pending";
}

/**
 * CreateWorkflow 归一化入参里的 saved 来源（可复用工作流 spec 的「归一化形状」：
 * `{name, script, saved: {name, args, path, scope}}`）。
 *
 * 与 `readWorkflowScript` 同一条纪律：这些字段走的是**入参通道**而不是 display，
 * 所以聊天卡片与运行确认窗共用这一份读取规则，两处不各自解析。`saved` 缺席就是内联提交，
 * 不是降级——内联路径逐字保持今天的样子。
 */
export interface WorkflowSavedSource {
  name: string;
  path: string | undefined;
  scope: string | undefined;
  /** 校验回填后的实参袋。缺席或形状不符时为空对象，绝不是 undefined。 */
  args: Record<string, unknown>;
}

export function readWorkflowSaved(input: unknown): WorkflowSavedSource | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.saved)) {
    return undefined;
  }

  const saved = input.saved;
  // 名字是这条来源的身份：读不出名字就当作没有来源，而不是渲染一个空徽标。
  const name = typeof saved.name === "string" ? saved.name.trim() : "";
  if (name.length === 0) {
    return undefined;
  }

  return {
    name,
    path: readTrimmedString(saved.path),
    scope: readTrimmedString(saved.scope),
    args: isPlainRecord(saved.args) ? saved.args : {},
  };
}

/**
 * 实参 / 默认值的展示形态：字符串原样（引号只会给中文实参添噪），其余走 JSON
 * ——声明的四种类型（string / number / boolean / json）由此都可读。
 */
export function formatWorkflowArgValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // 循环引用等不可序列化的值不该让整块确认窗崩掉。
    return String(value);
  }
}
