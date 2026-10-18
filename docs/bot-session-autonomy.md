# Bot 自主管理会话：移动端改造说明

状态：已实现（2026-10-18，包含用户追加的任务 worktree 隔离、集成与空闲回收）。范围：移动端 Bot（助理）页面与 Host
`host/bots/thread/`。桌面端 Bots 工作区（线程切换、会话卡片、活动面板）保持现状。

## 术语

- **Bot 对话（thread）**：用户与 Bot 的聊天本身，`BotScope = { botId, threadId }`
  （`src/features/bots/model/bots.ts:6`）。移动端每台 Host 只进入一个助理对话。
- **会话（session）**：Bot 为执行任务在项目里创建或接手的智能体会话
  （Claude/Codex 等）。Bot 通过 `sessions.create` / `sessions.send` 等动作管理它们，
  Host 为每次投递生成 `session-card` 消息。

本文所说的「会话管理回归 Bot 内部」指后者：用户只和 Bot 说话，由 Bot 决定任务
落到哪个会话；前者（Bot 对话本身）仍然只有一条。

## 改造前入口与实现对照（原设计定位）

已逐个核对的入口如下（行号为 2026-10-18 工作区的大致位置）。

| # | 位置 | 文件 / 组件 | 行号 | 现在的行为 | 改造后 |
|---|---|---|---|---|---|
| 1 | Bot 页头部「⋯」→ 设置 →「助理权限」→「会话」组里的「新建会话」复选框 | `src/features/bots/ui/BotSettings.tsx` `BotSettings`：`labels` 表（`"sessions.create": "Create conversations"`） | 64–65；权限分组 82–93；分组渲染 675–707；所在折叠区 632 | 移动端设置是完整表单（`section = mobile ? "all" : panel`，382），用户能看到并勾选「新建会话 / 查看会话 / 发送消息 / 停止会话 / 重命名和归档会话 / 删除会话…」共 10 项会话权限 | 保留权限本身（它是安全边界，不是会话切换），但移动端把「会话」组折叠成一条「允许助理替我开展工作」的总开关，细项移到「更多选项」里；文案不再出现「新建会话」 |
| 2 | 同一设置页「更多选项」→「已关注会话」列表 | `BotSettings.tsx` `WatchedSessions` 组件 | 定义 1322；渲染 1047；标题与「关注所有会话」按钮 1430–1450；搜索与空状态 1577–1602 | 用户可搜索、逐条关注或移除会话，或一键「关注所有会话」 | 移动端隐藏逐条会话列表；仅保留「关注所有会话 / 按项目关注」这类范围开关。逐条关注改由「交给助理」（#6）完成 |
| 3 | 同一设置页「助理唤醒」→「会话事件」 | `BotSettings.tsx` watches 编辑 | 765（折叠区）；923–1000 | 按事件类型、项目筛选会话事件 | 保留，属于唤醒策略而非会话切换；无需改动 |
| 4 | 对话流里的会话卡片，右侧「›」按钮（打开会话） | `src/features/bots/ui/BotSessionCard.tsx` `BotSessionCard` | 7；按钮 93–107 | 显示会话标题、项目、模型与状态，点击打开该会话的完整对话 | 卡片降级为一行「进展摘要」（项目 · 状态），点击打开**只读活动时间线**（见 c），不再跳转到会话 |
| 4a | 卡片渲染分支与打开回调 | `src/features/bots/ui/BotMessages.tsx` `session-card` 分支；`src/features/bots/ui/BotChat.tsx` `open` | BotMessages 101–110；BotChat `open` 695–712，传入 1139 | `open` 校验权限后调用 `onOpen` | 移动端把 `onOpen` 换成「打开时间线」；桌面端不变 |
| 4b | 移动端打开会话的实现 | `src/mobile/app/MobileAppView.tsx` `<MobileAssistant onOpen>` | 318–332 | `openSession(ref.sessionId, ref.projectId)` 后关闭助理页，进入普通会话界面 | 移除该跳转；改为在助理页内打开时间线弹层。时间线底部保留「在会话中查看」的高级入口 |
| 4c | 卡片去重 | `src/features/bots/model/botTimeline.ts` `compactBotTimeline`；`BotChat.tsx` 257 | 5–14 | 同一会话只保留最新一张卡 | 保持；时间线再按任务聚合 |
| 5 | 头部活动胶囊文案「正在新建会话…」「正在把任务交给「{title}」…」 | `src/features/bots/model/botActivity.ts` `botActivityLabel`；`src/mobile/MobileAssistant.tsx` `MobileAssistantHeader` | botActivity 14–21；头部 75–203 | 直接说出会话这一概念及会话标题 | 改成任务语言：「正在开始处理…」「正在继续 {project} 的工作…」。仅文案，中英同步 |
| 6 | 普通会话的操作菜单「交给助理」 | `src/mobile/MobileSessionActions.tsx` | 123–127；Host `delegateSession` 在 `host/bots/thread/index.ts:635` | 把一个人工会话交给 Bot 关注并继续 | 保留，它是用户主动干预；成功后在 Bot 对话里出现对应任务即可 |
| 7 | 应用抽屉「会话」「新建对话」 | `src/mobile/MobileDrawer.tsx` | 672–702 | 用户自己的项目会话入口，不属于 Bot 页面 | 不在本次范围（用户仍可直接使用普通会话） |

桌面端对照（本次不改）：`BotChat.tsx:328` 中 `botsLayout = desktopBots && !mobile && …`，
因此 `BotThreadSwitcher`（`DesktopBotsWorkspace.tsx:318`）和「新建对话」菜单项
（`DesktopBotsChrome.tsx:125`，`botThreads.create`）只在桌面出现。移动端 Bot 页面里
没有 Bot 对话（thread）的切换器或新建按钮。用户已确认其所指入口是桌面的
`BotThreadSwitcher` / `DesktopBotsChrome`，本次不修改；移动端 #1 仅为设置中的权限复选框。

## a) 默认隐藏会话切换

原则：移动端 Bot 页面里不出现「选择 / 切换 / 打开会话」的操作；会话只作为 Bot 工作的
**结果**被描述。

- #4/#4a/#4b：会话卡片不再是跳转入口，改为打开时间线。
- #2：移除逐条会话的关注列表；范围开关保留。
- #1：权限仍可配置，但用户看到的是「允许助理开展工作」，而不是「新建会话」。
- #5：活动文案改用任务语言。
- 桌面端与普通会话界面（#7）不受影响。

实现上只在移动端（`mobile` 为真）分支调整，避免改动桌面渲染路径。

## b) 自动路由规则

### 判断依据

Bot 处理一条用户消息时，把它归入以下三种情况之一：

1. **复用当前会话**（同一件事的后续），满足任一条件：
   - 用户回复（滑动回复）的是某个任务的卡片或该任务期间的 Bot 消息；
   - 消息指向同一项目、同一目标的修正或追加（「再加个测试」「改成蓝色」「刚才那个报错」），
     而且该任务的会话仍在运行、排队，或最近一次活动距今不超过续接窗口（1 小时）；
   - 会话正在运行时，后续消息优先 `sessions.steer` / `sessions.queue` 而不是新建。
2. **新建会话**（不相干的新任务），满足任一条件：
   - 目标项目与所有活跃任务都不同；
   - 同一项目但目标无关，且原任务已完成（已提交或已明确结束）；
   - 原会话已不可用（`unavailable`、被删除或归档），或超过续接窗口；
   - 用户说了强制新建指令（见 d）。
3. **并行开多条**：
   - 一条消息里列出多个互相独立的任务，且它们分属不同项目或不同工作副本；
   - 同一工作副本**不并行**两个会写文件的会话（避免互相覆盖），改为排队；
   - 并行上限10 条，超出部分排队并告诉用户。

无法确定时按「复用」处理，并在回复里用一句话说明（「我接着刚才的改」），让用户用 d
里的指令纠正。

### 实现层建议：Host

在 Host（`host/bots/thread/`）实现，前端不参与判断。理由：

- 判断依赖 Host 才有的状态：会话运行状态、队列、动作账本（`BotAction`，
  `store.putAction`，`store.ts:516`）、Bot 创建的会话（`createdSession`，`store.ts:505`）；
- IM 等非移动端渠道的消息也走 `receiveMessage`（`index.ts:309`），只有放在 Host 才能
  覆盖所有渠道；
- 前端可能离线，路由不能依赖它。

分两层：

1. **语义判断交给 Bot 模型**：在 `buildBrainPrompt`（`host/bots/thread/prompt.ts`）的
   Situation 中增加「当前任务」清单：每个任务的项目、会话、状态、最后活动时间、是否已提交，
   并写入上面的规则。现在提示词只有 `Tasks you delegated: N running, M queued`
   （约 200 行）和动作说明（235 行），没有复用或新建的规则。
2. **确定性约束由 Host 强制**：在 `control.ts` 执行 `sessions.create` / `sessions.send`
   的位置（卡片生成在 775–800 行附近）检查：强制指令、同一工作副本的并发写、并行上限。
   违反时返回明确错误，让模型改用正确动作，而不是静默改写。

需要新增的持久状态：线程内的「任务」记录（taskId → 会话引用、项目、状态、开始时间、
最后活动、来源 wakeup）。可以从现有动作账本与 `session-card` 推导，第一版不必新增存储表。

## c) 只读活动时间线

入口：会话卡片（#4）以及头部「⋯」菜单新增的「工作记录」。展示为助理页内的底部弹层，
不提供会话列表、切换或发送。

每个任务一组，按时间排列：

- **开始**：时间、用户的原始请求（截断）、项目；
- **进行中**：当前状态（排队 / 运行 / 等待批准 / 等待回答），复用 `botActivityLabel` 的任务语言；
- **改了什么**：变更文件数与 +/- 行数，可展开文件名（只读，不打开 diff 编辑）；
- **有没有提交**：提交短哈希与信息、是否已推送；
- **结束**：完成、失败（附错误原因）或已停止。

数据来源：

- 动作账本 `BotAction`（`src/features/bots/model/botView.ts:287`）：动作、状态、
  `targetRef`、`origin.wakeupId`；
- `session-card` 状态；
- `git.read` / `git.action` / `git.publish` 动作的结果，以及会话工作副本的 Git 状态；
- 桌面已有的 `botThreads.runs`（`host/bots/manager.ts:268`，`DesktopBotActivity.tsx`）
  只覆盖 Bot 自身的运行，不含会话变更。

建议在 Host 新增只读 RPC `assistant.timeline`（分页，按任务聚合）。新 RPC 需要检查
能力标识，旧 Host 不支持时隐藏入口，不报错。

## d) 两句强制指令（逃生口）

| 指令 | 含义 | 效果 |
|---|---|---|
| 「接着上次那个继续」 | 强制复用 | 本条消息必须投递到最近一个任务的会话（运行中则 steer/排队） |
| 「这事儿单独开一条」 | 强制新建 | 本条消息必须新建会话，不得 `sessions.send` 到已有会话 |

识别与传递：

- **由 Host 识别**，位置在 `receiveMessage`（`index.ts:309`），与现有的停止指令
  `isStopCommand`（`index.ts:74–78`，`STOP_COMMANDS`）同处。不同于停止词，这两句通常
  夹在任务描述里，所以匹配句首或句尾的固定短语表（中英文各几种说法），而不是整句相等。
- 识别结果作为 wakeup 字段 `routing: "reuse-last" | "new"` 持久化；提示词中以硬性要求
  呈现；`control.ts` 对该 wakeup 产生的动作强制检查（见 b 第 2 层）。
- 消息原文保留在聊天记录中，不剥离用户文字。
- 不新增 `assistant.send` 字段：`receiveMessage` 用 `fields(raw, ["commandId", "text",
  "attachments"])` 严格校验，新字段会让旧 Host 拒绝（`delegateSession.ts` 已有同类
  兼容处理）。纯文本识别还能覆盖 IM 渠道。

前端轻量入口（可选，建议做）：

- 回复某个任务卡片或消息即视为「接着这个继续」，由 Host 根据回复关系确定会话，比
  「上一次」更精确；
- 输入框「+」菜单增加两个快捷项，点击后把标准短语插入输入框，不改协议。

## 文件级改动清单

风险：低 = 纯样式、纯 UI、文案；中 = 移动端交互或数据读取变更；高 = 路由或 Host 状态。

| 文件 | 改动 | 风险 |
|---|---|---|
| `src/features/bots/ui/BotSessionCard.tsx` | 移动端卡片改为进展摘要，按钮语义从「打开会话」改为「查看进展」 | 低 |
| `src/mobile/styles/assistant.css` | 摘要卡与时间线弹层样式，使用移动端既有 token，不引入桌面 CSS | 低 |
| `src/features/bots/model/botActivity.ts` | 活动文案改为任务语言 | 低 |
| `src/shared/i18n/zh-CN.json` | 新增和调整文案 | 低 |
| `src/features/bots/ui/BotSettings.tsx` | 移动端：会话权限折叠为总开关；隐藏 `WatchedSessions` 的逐条列表 | 中（影响权限可见性，需确认不会误改已有权限） |
| `src/features/bots/ui/BotChat.tsx` | 移动端 `open` 改为打开时间线；桌面路径不变 | 中 |
| `src/mobile/app/MobileAppView.tsx` | 移除 `onOpen` 中的 `openSession` 跳转 | 中 |
| `src/mobile/MobileAssistant.tsx` | 头部菜单新增「工作记录」；时间线弹层（`MobileSheet` + `AnimatedCollapse`）；「+」菜单的两个快捷短语 | 中 |
| `src/features/bots/model/botTimeline.ts` | 增加按任务聚合的纯函数 | 中 |
| `host/bots/thread/index.ts` | 新增 `assistant.timeline` 只读 RPC；`receiveMessage` 识别强制指令并写入 wakeup | 高 |
| `host/bots/thread/store.ts` | wakeup 增加 `routing` 字段；任务记录推导与读取 | 高（持久状态，需兼容旧数据） |
| `host/bots/thread/prompt.ts` | 「当前任务」清单与路由规则；强制指令的硬性要求 | 高（影响所有 Bot 的行为） |
| `host/bots/thread/control.ts` | `sessions.create` / `sessions.send` 的强制约束：指令、同一工作副本并发写、并行上限 | 高 |
| `src/features/bots/model/botView.ts` | `BotTimeline` 类型；wakeup 的 `routing` 类型 | 中 |
| 对应测试：`host/bots/thread/index.test.ts`、`prompt.test.ts`、`control.test.ts`、`src/features/bots/ui/BotChat.test.ts`、`BotMessages.test.ts`、`src/mobile/MobileAssistant.test.ts` | 指令识别、约束、移动端不再跳转 | — |

建议顺序：先做低风险的 UI 和文案（a、c 的前端部分，时间线先用已有消息数据），再做
Host 的 `assistant.timeline`，最后做路由规则与强制指令。

## 已确认决策与实施差异

- 桌面呈现保持不变；入口 #1 仅改移动端设置权限呈现，不增加移动端线程切换或新建入口。
- 并行上限固定为 10 条执行会话，超出使用现有会话消息队列，并产生用户可见的排队提示。
  Host 在首次投递和队列出队时检查，释放名额后恢复；Bot 自身 brain 不占这 10 个名额。
- 续接窗口为 **1 小时**，由 `BOT_CONTINUATION_MS` 统一定义；活跃/排队/等待输入任务可继续，
  不可用任务不可继续。强制续接是用户明确的例外；任务目标仍由模型判断。
- 只读卡片打开工作记录；旧 Host 无 `assistant.timeline` 能力时隐藏卡片按钮与工作记录菜单，
  不尝试调用新 RPC。高级「在会话中查看」入口仅在时间线底部，不是卡片的常规操作。
- 移动端会话权限总开关不自动重写部分勾选状态；仅用户操作开关时批量更新原有权限。
  已关注会话的逐条列表隐藏，按项目/全部范围关注和唤醒规则保持原有语义。
- 聚合纯函数和新契约放在 `src/integrations/harness/core/botAutonomy.ts`，而非把 Host 的新依赖
  指向 feature model。`botTimeline.ts` 继续负责原来的卡片去重；未放宽架构基线。
- 第一版按精确 session 引用聚合任务；续接沿用同一任务。任务、worktree 所有权、合并证据及
  清理状态都保存在既有动作账本的可选字段中，不增加持久化表。旧卡片缺少 wakeup 或时间字段时
  保留可读状态，不虚构用户请求和 Git 成果。
- 活动事件来自动作账本；正在进行的 Git 信息明确标为「当前工作副本快照」，不能把其他任务或用户
  的提交当作该任务成果。受管任务经验证集成后保存提交及差异摘要，回收目录后仍可阅读。
- 新 RPC 分页 cursor 使用稳定的任务开始时间与身份，读取前后检查项目与读取权限；Git 信息另检查
  `git.read`。Git/工作副本不可用时仍返回可读活动。时间线打开期间刷新，关闭或后台停止刷新。
- 强制指令在 Host 入站识别，原文不变，`routing` 与续接目标一起写入 wakeup。
  含强制指令的输入不合并进其他 wakeup，也不直接 steer 到正在执行的 Bot brain，防止硬约束丢失。
  支持文档标准短语、中文同义说法及英文边界短语；引用区不作为用户新指令，明显否定不会误触发。
- 输入框「+」菜单已提供两条标准路由短语，作为普通文本插入草稿，不改变发送协议。
  可选的结构化“回复某张任务卡片”关系未新增：普通助理消息仍采用原有文本引用，具体任务匹配由
  模型结合当前任务清单处理；明确的强制续接目标由 Host 固定并约束。
- 当前 provider 执行模式均可能写文件，没有可强制验证的只读会话模式，因此共享目录任务也保守串行。
  独立 worktree 的修改任务可以并行。普通用户会话导航和桌面会话卡片保持原状。

## e) Bot 任务 worktree 的派生、集成与回收

### 复用本项目原有派生规则

普通任务复用 `HostEngine.generateWorktreeName` → `generateWorktreeBranch` /
`availableWorktreeBranch` → `createHostWorktree`，与 `git.worktreeName` / `git.worktreeCreate`
及普通 `createTaskWorktree` 的流程一致：先用已配置标题模型、再尝试所选 provider 生成名称，
使用既有 `mc/…` 命名清理和冲突后缀；名称生成失败不另造随机命名策略。

派生基点是所选源工作副本的 HEAD。源目录默认为项目当前工作副本，指定 `executionCwd` 时必须
是该项目已有注册 worktree。实际目录由现有 `hostWorktrees().defaultRoot` 和
`createHostWorktree` 的 `wt-…` 规则确定。记录真实源目录、创建时目标分支和基点 SHA，
不硬编码 main，也不随目标 checkout 后来的切换改写目标。

普通任务创建入口只继承所选提交，**不复制源目录未提交或未跟踪文件**；这些用户文件原样保留。
已有编排 worker 的 `HostOrchestrationWorkspace.createWorker` 有独立的文件基线继承/检查点机制，
本次不改变或重新实现它。确实需要未提交内容的任务可明确选择共享目录，或继续使用既有编排机制。

`sessions.create` 默认隔离 Git 修改任务；非 Git 项目保留现有目录。只读或明确适合共享的任务可传
`workspace: "shared"` 和 `sharedReason`。所有实际 Git 写操作仍要求原有 `git.write` 权限。
同一任务的 `sessions.send` 复用原会话及 worktree，不为追加消息另建分支。

### 验证和串行集成

Bot 让任务 agent 在独立分支完成必要验证和提交，随后通过已有会话读取能力检查验证结果，调用
`sessions.integrate`，传入最新已完成 run 的成功 tool block ID 和实际验证摘要。Host 拒绝运行中、
排队、等待审批/问答、缺失验证证据、未提交/未跟踪成果、变更目标分支或脏目标目录。

Host 复用 checkout guards 的 integration reservation，按实际 Git 仓库串行集成（即使多个项目引用同一仓库）。先执行 `git diff --check`、
基点祖先检查及 `git merge-tree --write-tree` 冲突预检，再合并已经验证的提交到记录的目标分支。
冲突预检不改目标文件；失败会保留 worktree/分支并显示原因。不会自动 push、强制 reset、覆盖用户
未提交内容、改目标分支或删除分支。验证命令由 Bot 根据任务选择，Host 校验成功证据与 Git 状态，
不以统一的全量测试替代项目验证。

### 独立的空闲清理计时

`worktreeIdleMinutes` 默认 **60 分钟**，移动端更多选项可设置 0–10080；0 禁用回收。
这与 1 小时续接窗口是不同字段和时钟：清理计时从确认集成且无活跃关联任务后开始，续做会立即
使旧验证/空闲资格失效，需要再次完成验证与集成。

仅回收账本明确记录为 Bot 创建、已完成并确认合并、Git 工作树干净、没有活跃/排队/等待输入
关联任务的 worktree。新增提交、未提交/未跟踪（含 ignored）文件、冲突、占用的文件/终端、
目标身份变化、无权限或机器不可用均保留。源分支的目标引用必须仍包含已合并提交。

复用 `withCheckoutRemoval`，先阻止新投递，再释放空闲 provider 句柄，删除前重新检查 Git 身份、
路径边界、关联任务和所有权；只调用非强制 `git worktree remove`。重启依据账本中的 integrating /
removing 状态与真实 Git 结果恢复，不根据超时猜测成功。回收仅标记会话工作副本已移除，保留会话
历史、任务记录和分支；手工创建的 worktree 没有所有权记录，永不自动清理。

新增实现集中于 `host/bots/taskWorktrees.ts`、`host/bots/thread/routing.ts`、
`host/bots/thread/timeline.ts`；`host/engine.ts` 的投递/出队路径强制执行并发约束，
`host/bots/manager.ts` 使用现有 tick 恢复队列及检查回收。无需新增定时持久化表。

## 验证记录

- `npx tsc --noEmit`：通过。
- `npx tsc --noEmit -p host/tsconfig.json`：通过。
- `npm run check:arch`：通过，没有新增违规或放宽基线。
- `npx vitest run src/features/bots/model/botTimeline.test.ts src/features/bots/model/botActivity.test.ts src/features/bots/ui/BotMessages.test.ts src/features/bots/ui/BotChat.test.ts src/mobile/MobileAssistant.test.ts`：5 文件、86 项通过。卡片整行点击最终调整后又针对 BotMessages / MobileAssistant 验证 47 项通过。
- `npx vitest run --config host/vitest.config.ts host/bots/thread/index.test.ts host/bots/thread/control.test.ts host/bots/thread/prompt.test.ts host/bots/thread/store.test.ts host/bots/thread/routing.test.ts host/bots/taskWorktrees.test.ts host/queue.test.ts host/store-reads.test.ts`：8 文件、170 项通过；最后新增清理期间撤销回收的边界后，`host/bots/taskWorktrees.test.ts` 单文件 15 项通过（这组最终合计 171 个唯一用例）。
- `npx vitest run --config host/vitest.config.ts host/server.test.ts -t 'advertises assistant RPC'`：1 项通过，覆盖新能力、只读 RPC、参数校验和撤销设备鉴权。
- 原有未提交的上下文展示/移动样式改动另行验证：`npx vitest run src/mobile/MobileSessionStatus.test.ts src/mobile/MobileSheet.test.ts src/features/sessions/model/contextBreakdown.test.ts`，3 文件、60 项通过，已按用户授权独立整理提交。
- `git diff --check`：通过。运行版本：Git 2.55.0.windows.5、Node v24.21.0、TypeScript 5.8.3、Vitest 3.2.7。

Host 的 worktree 回归使用本机临时真实 Git 仓库；队列/provider 测试使用测试 provider，包含 Pi 和 OMP 队列路径，未宣称实际 provider CLI 兼容验收。原生移动设备、WSL/Linux/macOS 真机环境及视觉体验没有在本轮实机验证。部分既有 MobileSheet 测试产生 React `act(...)` 警告，但没有失败。没有运行应用/APK 构建，没有推送或发布。


## 实际改动文件（按模块）

- Host 任务与路由：`host/bots/taskWorktrees.ts`、`host/bots/taskWorktrees.test.ts`、
  `host/bots/thread/routing.ts`、`host/bots/thread/routing.test.ts`、`host/bots/thread/timeline.ts`、
  `host/bots/thread/control.ts`、`host/bots/thread/index.ts`、`host/bots/thread/index.test.ts`、
  `host/bots/thread/policy.ts`、`host/bots/thread/prompt.ts`、`host/bots/thread/store.ts`。
- Host 调度与 RPC：`host/bots/manager.ts`、`host/engine.ts`、`host/store.ts`、`host/server.ts`、`host/server.test.ts`。
- 契约与 Bot 展示：`src/integrations/harness/core/botAutonomy.ts`、
  `src/features/bots/model/botActions.ts`、`botActivity.ts`、`botView.ts`、`botTimeline.test.ts`；
  `src/features/bots/ui/BotChat.tsx`、`BotChatChrome.ts`、`BotMessages.tsx`、`BotMessages.test.ts`、
  `BotSessionCard.tsx`、`BotSettings.tsx`。
- 移动端与文案：`src/mobile/MobileAssistant.tsx`、`MobileAssistant.test.ts`、`MobileAssistantTimeline.tsx`、
  `src/mobile/app/MobileAppView.tsx`、`src/mobile/styles/assistant.css`、`src/shared/i18n/zh-CN.json`。
- 说明：`docs/bot-session-autonomy.md`。
- 原有改动独立提交：`src/mobile/MobileSessionStatus.tsx`、`src/mobile/styles/08-sheets.css`、
  `src/shared/ui/messaging/ContextBreakdown.tsx`；另一个样式提交包含
  `src/mobile/styles/app-surfaces.css`、`src/mobile/theme/controls.css`。
