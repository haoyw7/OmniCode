// ============================================================
// CreateWorkflow Tool - typecheck a dynamic-workflow script and start a background run
// ============================================================

import { z } from "zod";

/**
 * OmniCode: the agent runtime for workflow subagents. Each field is optional and
 * falls back to the next layer: per-agent UI override, the script's `agent()` persona,
 * these run defaults, then the launching session's provider and model.
 */
export const WorkflowAgentRuntimeSchema = z
  .object({
    provider: z.string().trim().min(1).optional().describe("Agent runtime id: pi, codex, claude, omp, opencode, cursor, grok, hermes, fx, antigravity or kimicode."),
    model: z.string().trim().min(1).optional().describe("Model id for that provider."),
    thinking: z.string().trim().min(1).optional().describe("Thinking / reasoning level, for example low, medium, high, xhigh or max."),
    speed: z.string().trim().min(1).optional().describe("Speed tier: default or fast where supported."),
    /** Exact provider settings picked in OmniCode's model picker (effort, fast, serviceTier…). */
    modelSettings: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type WorkflowAgentRuntime = z.infer<typeof WorkflowAgentRuntimeSchema>;

// Causality graph 是 display 通道的有界投影，但直接在工具输出边界限长：持久化的 tool
// output 与实时 display 载荷共用同一个契约，避免两处各自演化出不同的截断语义。
// 载荷只装 GUI 真正读的字段：边是
// `{from, to, back?}` 一种形状，region / certainty / 边种类都留在分析器里。第二层
// 是子代理导向：每阶段的参与者卡 + 交接边；
// step 级边因此不再进载荷（没有读者），step / 车道留作运行状态与检视器的键。
export const CREATE_WORKFLOW_GRAPH_MAX_STEPS = 64;
export const CREATE_WORKFLOW_GRAPH_MAX_LANES = 32;
export const CREATE_WORKFLOW_GRAPH_MAX_PARTICIPANTS = 64;
export const CREATE_WORKFLOW_GRAPH_MAX_HANDOFFS = 256;
export const CREATE_WORKFLOW_GRAPH_MAX_HANDOFF_TYPES = 8;
export const CREATE_WORKFLOW_GRAPH_MAX_PHASES = 32;
export const CREATE_WORKFLOW_GRAPH_MAX_PHASE_EDGES = 128;
export const CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS = 64;
export const CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS = 128;

export const CREATE_WORKFLOW_STEP_KINDS = ["ask", "world-read"] as const;

// 名字只在运行时成形（`` agent(`研究员${i + 1}`) ``）时静态能拿到的那部分：第一个洞之前的
// 字面量（head）与最后一个洞之后的字面量（tail）。两者至少有一个在场——分析器拿不到就整个
// 字段缺席，不会发空 pattern。**只搬数据**：把它渲染成「研究员…」的省略号是渲染层的决定。
export const CreateWorkflowNamePatternSchema = z
  .object({
    head: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS).optional(),
    tail: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS).optional(),
  })
  .strict();

export type CreateWorkflowNamePattern = z.infer<typeof CreateWorkflowNamePatternSchema>;

// 一个 step = 一次要等待的 facade 操作（ask / files.*）。lane 是执行它的 actor（或
// workspace / unknown）；lanes 只在接收者是 may-set 时出现，此时该 step 已按候选车道展开成
// 每车道一份拷贝（各带 source）。repeat 区分两种多重性线索：stack（实例共存，画叠卡）与
// serial（实例相继，已由闭环箭头表达）。
// certainty / region 不进载荷：GUI 不画它们。
export const CreateWorkflowStepSchema = z
  .object({
    id: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    kind: z.enum(CREATE_WORKFLOW_STEP_KINDS),
    label: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS),
    /** `label` 只拿到兜底串（内联 `agent()` receiver）时，那个名字的静态形状。 */
    labelPattern: CreateWorkflowNamePatternSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    lane: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    lanes: z
      .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS))
      .max(CREATE_WORKFLOW_GRAPH_MAX_LANES)
      .optional(),
    /**
     * 展开自的站点 id，只在 may-set 车道展开的拷贝上出现（拷贝 id 形如 `ask#2~actor#1`）。
     * 它是实时叠加的关联键：运行时实例报的是站点 id，所以带 source 的卡片按
     * `(node.siteId === source, node.actorSiteId === lane)` 收状态。刻意不参与引用完整性
     * 收敛——它指向的是被拷贝替换掉的那个站点，图里没有这个节点。
     */
    source: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS).optional(),
    /**
     * 作者用 `phase("…")` 标记划入的阶段（`phase#2`，或保留的 `unphased`）。与图的
     * `phases` / `phaseEdges` / `exits` 同进同退：四者要么全在场（此时**每个** step 都带一个，
     * 划分是全的），要么全缺席（零标记脚本）。
     */
    phase: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS).optional(),
    repeat: z.enum(["stack", "serial"]).optional(),
  })
  .strict();

export type CreateWorkflowStep = z.infer<typeof CreateWorkflowStepSchema>;

// Lane = 一个 actor（外加一条 workspace 车道）。多重性不再挂在车道上（曾是 families →
// nesting）：车道不再渲染，家族的成员数由参与者的 `member` / `many` 表达。
export const CreateWorkflowLaneSchema = z
  .object({
    id: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    name: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS).optional(),
    /** `name` 缺席而 `agent()` 首参是带洞的模板串时的静态形状；与 `name` 互斥。 */
    namePattern: CreateWorkflowNamePatternSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
  })
  .strict();

export type CreateWorkflowLane = z.infer<typeof CreateWorkflowLaneSchema>;

// 边只表示一件事：runs after。阶段边与交接边同一形状。`back` 标记循环回边——画法与其他
// 边完全相同、不标注，只有布局排秩（回边不参与列序）与帧头 cycle 计数读它。分析器的
// kind / certainty / exact 不进载荷；两层边都做过统一的传递归约。
export const CreateWorkflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    to: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    back: z.literal(true).optional(),
  })
  .strict();

export type CreateWorkflowEdge = z.infer<typeof CreateWorkflowEdgeSchema>;

// 参与者 = 板面第二层的一张卡：某阶段里在某条车道上有 step 的那个子代理（或工作区 /
// 未解析）。fan-out 家族按字面量基数展开时每成员一张（`member`），基数未知时一张 `many`
// 卡代表全部成员。`steps` 是它在本阶段的 step——运行状态由此聚合，检视器由此列 ask。
// 数组顺序就是交接序（分析器定）：折叠面自上而下、展开面自左而右，第一张是开局者。
export const CreateWorkflowParticipantSchema = z
  .object({
    /** `${phase}:${lane}`，家族成员 `${phase}:${lane}[${index}]`。 */
    id: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    /** 阶段 id；脚本无阶段词汇时恒为 `unphased`（此时 `phases` 缺席）。 */
    phase: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    lane: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    steps: z
      .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS))
      .min(1)
      .max(CREATE_WORKFLOW_GRAPH_MAX_STEPS),
    member: z
      .object({
        index: z.number().int().nonnegative(),
        of: z.number().int().positive(),
      })
      .strict()
      .optional(),
    many: z.literal(true).optional(),
  })
  .strict();

export type CreateWorkflowParticipant = z.infer<typeof CreateWorkflowParticipantSchema>;

// 交接 = 参与者之间的 runs after（归约后 happens-before 按卡取商）。`types` 是跨越这条边的
// 产物类型（站点图 data 边），只进检视器，不上箭头。
export const CreateWorkflowHandoffSchema = CreateWorkflowEdgeSchema.extend({
  types: z
    .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS))
    .min(1)
    .max(CREATE_WORKFLOW_GRAPH_MAX_HANDOFF_TYPES)
    .optional(),
}).strict();

export type CreateWorkflowHandoff = z.infer<typeof CreateWorkflowHandoffSchema>;

// Phase = 作者用 `phase("…")` 标记出的一组 step。名字是键（同名的两处标记是同一个阶段），
// 所以 `name` 就是作者原词；合成兜底阶段 `unphased` **无 name**，显示名由 UI 本地化
// （与 workspace/unknown 车道同一模式）。loc 是首个标记的位置。
export const CreateWorkflowPhaseSchema = z
  .object({
    id: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS),
    name: z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_NAME_CHARS).optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    /**
     * 进入本阶段时**还在跑**的其他阶段：它们 fan-out 出去的 strand 当时尚未 join。阶段表序，
     * 列出的阶段 id，不含自己，为空时整个字段缺席（与词汇表同进同退）。
     *
     * 它是**节点事实**而不是边——控制并没有从那些阶段转移过来，两边是同时在场的，所以它既不
     * 进 `phaseEdges` 也不参与边的归约（归约会把它当成 runs after，砍掉真正的边）。
     * 读者是时间轴：把由它串起来的相邻阶段折成一条分叉的「带」，主线之上再起支线轨道；
     * 侧栏迷你轨道据此画双线段。
     */
    alongside: z
      .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS))
      .min(1)
      .max(CREATE_WORKFLOW_GRAPH_MAX_PHASES)
      .optional(),
  })
  .strict();

export type CreateWorkflowPhase = z.infer<typeof CreateWorkflowPhaseSchema>;

// 名字沿用历史（它曾只装因果图）。三层：step 层是站点（运行状态的键，不再画）；参与者层
// 是每阶段的卡与交接（因果事实按卡取商）；阶段层是控制流事实（控制流图的阶段商）。层间的桥
// 是 `Participant.phase` / `Participant.steps`、`Step.phase` 与 `exits`。
export const CreateWorkflowCausalityGraphSchema = z
  .object({
    steps: z.array(CreateWorkflowStepSchema).max(CREATE_WORKFLOW_GRAPH_MAX_STEPS),
    lanes: z.array(CreateWorkflowLaneSchema).max(CREATE_WORKFLOW_GRAPH_MAX_LANES),
    participants: z
      .array(CreateWorkflowParticipantSchema)
      .max(CREATE_WORKFLOW_GRAPH_MAX_PARTICIPANTS),
    handoffs: z.array(CreateWorkflowHandoffSchema).max(CREATE_WORKFLOW_GRAPH_MAX_HANDOFFS),
    /**
     * 阶段词汇表，与 `phaseEdges`、`exits`、`Step.phase` **全有或全无**：零标记脚本四者全
     * 缺席，UI 的视图切换条件就是「词汇表在场与否」。超界时也是整体缺席（+ `truncated`）
     * ——裁一半的阶段图会说谎。零成员的阶段（只有标记、没有 step）也在表里：控制流会经过它。
     */
    phases: z.array(CreateWorkflowPhaseSchema).max(CREATE_WORKFLOW_GRAPH_MAX_PHASES).optional(),
    phaseEdges: z
      .array(CreateWorkflowEdgeSchema)
      .max(CREATE_WORKFLOW_GRAPH_MAX_PHASE_EDGES)
      .optional(),
    /**
     * 控制流可以在其后正常完成的阶段（控制流图阶段商里指向 sink 终端的边的源），阶段表序。
     * 阶段视图的「阶段 → 返回物」箭头读它，让那张画面上的每条箭头都是控制流。组内可为空
     * （脚本没有正常完成路径），组外不得单独出现。
     */
    exits: z
      .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS))
      .max(CREATE_WORKFLOW_GRAPH_MAX_PHASES)
      .optional(),
    /** 返回物由哪些 step 供给（数据事实，下钻用）；脚本无返回时缺省。 */
    sink: z
      .array(z.string().min(1).max(CREATE_WORKFLOW_GRAPH_MAX_ID_CHARS))
      .max(CREATE_WORKFLOW_GRAPH_MAX_STEPS)
      .optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export type CreateWorkflowCausalityGraph = z.infer<typeof CreateWorkflowCausalityGraphSchema>;

/**
 * run 的声明阶段表：因果图里**有名**的
 * 阶段，按声明序。运行状态只知道已进入的阶段，侧栏迷你轨道要画"前方还有哪些站"就得在提交时把这张表
 * 交给引擎记进 `run-launched`。两条提交路径（`CreateWorkflow` 工具、中枢直接启动）共用本函数，
 * 于是同一份脚本在两条路上画出同一条轨道。无图 / 无阶段词汇表 / 只有合成的 `unphased` → `undefined`
 * （字段整个缺席，而不是空数组：UI 据缺席画一个隐含站点）。
 */
export function createWorkflowPhaseNames(
  graph: Pick<CreateWorkflowCausalityGraph, "phases"> | undefined,
): string[] | undefined {
  return namedPhases(graph)?.map((phase) => phase.name);
}

/**
 * 与 {@link createWorkflowPhaseNames} **按位置对齐**的「同时在跑」表：`out[i]` 是声明表里第 i
 * 个有名阶段被进入时，strand 仍在跑的其他阶段的下标（同一张有名阶段表里的下标）。
 *
 * 下标空间是**有名阶段**的，不是因果图原阶段表的：无名阶段（合成的 `unphased`）被跳过，
 * 指向它、指向未列出阶段、或指向自己的引用一并丢掉——侧栏拿到一个越界下标就会把「同时在跑」
 * 连到错误的站上。它随 `DynamicWorkflowRunSubmitRequest.phaseAlongside` 进入 `run-launched`，
 * 侧栏迷你轨道据此把带内相邻的两站画成双线段。
 *
 * 无图 / 无阶段词汇表 / 没有任何阶段带 alongside → `undefined`（字段整个缺席，而不是一串空
 * 数组：缺席就是「这条轨道是一条直线」）。
 */
export function createWorkflowPhaseAlongside(
  graph: Pick<CreateWorkflowCausalityGraph, "phases"> | undefined,
): number[][] | undefined {
  const named = namedPhases(graph);
  if (named === undefined) return undefined;
  const indexOf = new Map(named.map((phase, index) => [phase.id, index]));
  let any = false;
  const out = named.map((phase, self) => {
    const indexes: number[] = [];
    for (const id of phase.alongside ?? []) {
      const index = indexOf.get(id);
      if (index === undefined || index === self || indexes.includes(index)) continue;
      indexes.push(index);
    }
    any = any || indexes.length > 0;
    return indexes;
  });
  return any ? out : undefined;
}

/** 有名阶段（声明序，截到上界），`name` 已收窄。 */
type CreateWorkflowNamedPhase = CreateWorkflowPhase & { name: string };

/**
 * 上面两个函数共用的那张表：因果图里**有名**的阶段，声明序，截到
 * `CREATE_WORKFLOW_GRAPH_MAX_PHASES`。抽成一个函数正是为了让它们走同一条过滤、落在同一个
 * 下标空间里——`phaseAlongside[i]` 说的必须是 `phaseNames[i]` 这一站。
 */
function namedPhases(
  graph: Pick<CreateWorkflowCausalityGraph, "phases"> | undefined,
): CreateWorkflowNamedPhase[] | undefined {
  if (graph?.phases === undefined) return undefined;
  const named: CreateWorkflowNamedPhase[] = [];
  for (const phase of graph.phases) {
    const name = phase.name;
    if (name === undefined) continue;
    named.push({ ...phase, name });
    if (named.length >= CREATE_WORKFLOW_GRAPH_MAX_PHASES) break;
  }
  return named.length === 0 ? undefined : named;
}


