# Host 执行归属迁移

这是架构约束和删除清单，不是各阶段已完成的声明。2026-10-22 开始核对；每个切片完成后更新此页及架构基线。发生实现与目标冲突时，以当前阶段的出口条件验收，不能用目标描述替代代码证据。

## 当前状态（2026-10-23）

本节取代下方 2026-10-22 第一批记录中已过时的部分；下方内容保留作历史证据。阶段 0–6 **均未整体验收**，以 `docs/architecture-refactor-handoff.md` 的未完成清单和代码为准。

- inbox 不再是本地 submission 例外：`sessionUsesHost` 只看 cwd 是否非空且不为 `~`，inbox 提问经 `hostSessionSubmission.ts` 发往 Host，由 `host/inbox.ts`、`domain/inboxPrompt.ts` 保存来源并包装首句/续问/steer/handoff；旧 Host 缺 `sessions.inbox.v1` 时明确失败。
- 辅助文本（commit/PR 文本、worktree 分支名）走 Host `providers.auxiliary.*`；旧 `core/textHarness.ts` 已删除。
- Linear/Jira/GitLab/Azure DevOps 已由 Host `inbox.run` 提供，对应 4 个 Rust 模块已删除；GitHub Host 服务已实现，旧 Rust 注册的删除仍待验证完成。
- 架构基线（`npm run check:arch` 收紧后，未使用 `--update`）：`shared-upward` 7、`platform-upward` 1、`features-to-app` 8、`tauri-outside-platform` 13、`host-to-feature-model` 34（全部为 Bots/IM，待阶段 2 迁移）、循环涉及文件 61；`host-to-ui`、`desktop-to-mobile`、`mobile-to-app`、`feature-ui-cross`、`integrations-to-features`、`harness-core-to-providers`、`ui-local-provider-execution` 均为 0。静态 0 只证明 import 边，不证明产品功能或间接执行已收口。
- 桌面 `tsc --noEmit` 中 `sounds.ts` 的 4 项 cuelume 错误来自 node_modules 漂移：锁定的 0.2.2 包含 `bloom`/`chime`/`arrival`/`scan`，实装 0.2.8 已改名（旧名仅作 deprecated 别名并映射到不同音色）。需在无并行测试时执行 `npm ci` 恢复锁定版本，不改产品音效。
- 检查点恢复事务、MCP、CLI 管理、/operator AppService、会话重新挂接、自动化远端/提醒、附件/媒体 SSRF 等仍在进行，见交接文档第 5 节。

## 第一批状态（2026-10-22，历史）

本轮范围是阶段 0 的边界、清单与开发计数，以及阶段 1 的项目发送闸门、停止 Rust 回写、模型刷新和恢复/编排的 Host 归属保护。**阶段 1 尚未完成**，Rust 写 command、inbox、本地辅助 provider 调用及部分恢复/编排路径仍在。

- `sessionUsesHost` 现在按会话归属判断：非 inbox、cwd 非空且不为 `~` 即属于 Host，与连接是否已配置或在线无关。项目提交若没有注册的 Host actions，会显示本地化失败提示并调用失败回调，不进入本地 provider 分支。
- `sessionStore.ts` 在入口、排队操作开始及 stale-blocks 重试前检查归属；上述 Host 项目不再通过这些入口调用 `session_upsert`。这不是 Rust 数据库只读核对，也没有删除 Rust command。
- Host 未就绪时，归档、置顶、链接、删除和草稿删除不会回写 Rust 缓存；等待期间 Host 就绪则转交 Host。离线旧会话重命名明确失败，空白草稿命名仍允许。历史重命名收到持久化确认后才更新标题，不覆盖等待期间 sync 推进的正文；置顶失败回滚本次乐观状态并提示错误，不把 UI 操作失败显示成成功。项目目录重定位暂不套用这项禁止策略，见下文 `session_rebase_project` 缺口。
- 恢复时 Host 会话保留原始 blocks 和 busy，不做本地中断投影、bind、forget/reap；Rust in-flight 记录只写非 Host 会话。历史切换同样不绑定 Host。旧编排 bridge 对 Host 的 stop/steer/approve/answer 复用 run-scoped Host 命令与 outbox；无法确定会话归属时拒绝 native kill。
- 开发日志已接入 `harness_spawn`、`session_upsert`、检查点 begin/prepare/capture/finish 和恢复绑定的尝试计数；生产/Host 非 Vite 运行时不启用。日志仅含 command、reason、count，不代表调用成功或已取得真实桌面路径采样。
- 架构规则新增直接本地 provider 引用限制。使用 TypeScript 语法树识别导入、调用、计算属性、转义字符串及常量字符串拼接，并按局部符号跟踪别名；新增调用即使复用既有 import 也失败。注释和 `*.test.ts` / `*.test.tsx` / `*.test.mjs` 排除，名称仅包含 test 的产品文件不排除。当前 feature/app 直接 `spawnChild` / `harness_spawn` 产品引用为 0；间接执行路径仍存在。
- `HarnessIcon` 已移到 `src/shared/ui/HarnessIcon.tsx`，桌面和手机消费者使用同一实现，类型从静态图标资产推导，不反向依赖 feature。旧实现删除，外观不变；这是为解决现存架构违规做的单组件边界修复，不代表阶段 6 的批量迁移完成。

Rust 只读审计尚未实现：`desktop-import` 的 marker 值仅为 `"1"`，没有来源行版本或摘要，不能证明导入后 Rust 行未再次更新；Rust `session_upsert` 仍可写。`session_rebase_project` 也仍保留，以免先移动目录后缺少元数据重定位而半完成。Host 离线启动的现有缓存仅能恢复摘要，不保证有完整正文；不能把启动成功解释成离线正文缓存已经完成。

`~` 首句在创建目录前同步检查 Host 配置；未配置时立即拒绝。准备发生在本地 flush/apply 之前，创建后须成功完成 `ensureSharedProject` / `projects.open` 才改变会话 cwd 并 stage 消息；注册失败保留 `~`，异步准备期间会话被删除或切换也拒绝发送。异步拒绝通过 Composer 回调恢复正文，但仅在提交后草稿尚未被用户编辑时恢复，不能覆盖新输入。staged 接受仍不等于 Host 已持久接受。inbox 是唯一保留的本地 submission 例外；非 inbox 的空 cwd、已有消息但仍为 `~` 的异常/旧会话明确拒绝发送，不自动落入本地执行。Host 问题回答等待 sync 更新投影，不在提交时本地 apply。

后续切片先成套迁移 inbox：Host create 校验并保存来源、summary 暴露精简来源、首句/续问/handoff/steer 统一包装 inbox 指令、桌面草稿及 sync 保留标记、重新打开绑定已有 Host 会话、restart 使用 Host cancel/delete。仅删掉 `inboxAsk` 路由例外会丢失提示词和来源，并让 restart 继续调用本地停止/检查点路径。summary 不携带完整 description，避免放大 activity；旧 Host 缺能力时明确失败。本轮不开始这项尚未闭合的迁移。

模型目录的 feature/app 刷新入口已统一为 `features/providers/model/hostModelCatalog.ts` → Host `models.list`，旧 registry 本地刷新实现和导出已删除。新 Host 用 `models.refresh.v1` 能力声明 `models.list { force: true }` 的缓存失效语义：客户端仅首请求带 force，后续 pending 轮询不重复刷新；旧 Host 缺能力时提示升级并保留缓存，不退回本地探测。标题生成沿用已有 `titleModelClient` → Host 路径。尚未迁移的辅助执行包括 `useBtwConversations.ts::runHarnessTextPrompt`、`taskWorktree.ts::generateHarnessBranchName` 回退，以及 source-control 的 commit/PR 文本生成；二进制可用性检查也仍在本地。因此还不能删除全部本地辅助运行时。

本轮已执行的边界检查：

- `node --test scripts/arch-baseline.test.mjs`：9 项通过，覆盖新增调用、别名、作用域遮蔽、计算引用及测试排除。
- `npm run check:arch`：通过，自动收紧 20 条既有豁免，没有运行 `--update`；最终复查仍通过。当前基线为 615 条去重边、120 个循环涉及文件；`integrations-to-features` 141、`host-to-feature-model` 127、`feature-ui-cross` 166、`tauri-outside-platform` 141、`ui-local-provider-execution` 0。仍有 `harness-core-to-providers` 4、`host-to-ui` 3、`desktop-to-mobile` 1，后续阶段出口尚未满足。报告中的逐条 import 命中数可能高于去重基线数，不能混用两种计数。
- `tsc --noEmit -p host/tsconfig.json`：通过。桌面 `tsc --noEmit` 在当前依赖环境下失败于未修改的 `src/features/settings/model/sounds.ts` 的 4 项 cuelume `SoundName` 错误（`bloom`、`chime`、`arrival`、`scan`）。这些值已在 HEAD 中存在；`package.json` 要求 `^0.2.2`、锁文件为 `0.2.2`，当前 node_modules 实装为 `0.2.8`，未验证锁定版本是否出现同样错误。本轮未安装或升级依赖，也未改音效。
- UI 相关回归通过：Composer 67 项、粘贴 2 项、quick-composer 入口 2 项、移动通知 16 项、SurfaceTabs 6 项、共享图标 3 项、RemoteSession 77 项及编排错误文案 1 项。RemoteSession 仅隔离测试环境的 AutoAnimate 底层引擎，保留真实 React hook；最终进程正常退出，无 unhandled error，既有 act warning 未屏蔽。submission 两组回归共 21 项通过。
- App.appViews 在第一轮修改后 106 项通过；后续追加历史重命名/置顶修复及 5 个用例后，最终定向执行 8 项通过，另 103 项未重跑，不能将当前 111 项记成全部通过。
- 提交 hook 回归 9 项通过；移动 client/multiDevice/sessionActions 共 76 项通过；Host mobile-client/client-state 共 19 项通过，另 1 项 Windows symlink 测试跳过，不能记为已验收。
- 切片定向回归通过：启动 main/sharedHost/remoteProjects 共 29 项；持久化 8 个文件共 101 项；诊断 3 个文件共 25 项；生命周期/Host 控制 3 个文件共 35 项；模型 Host 11 项、新客户端 7 项及其他定向 25 项。这些是各切片执行记录，不用于推断未运行场景或全库通过。
- `git diff --check`：通过。各行为切片另跑其相关测试；阶段 1 的桌面/手机同会话和重启续跑手工出口尚未验收。

## 不变量与过渡边界

| 对象 | 最终唯一所有者 | 迁移期间允许的现状 | 删除前提 |
| --- | --- | --- | --- |
| 会话与 `Block[]` 持久化 | 本机或对应远端 Host 的 `host/store.ts` | Rust `session_store.rs` 留旧行、导入源与尚未迁出的本地路径；Host 会话不得回写 Rust | 阶段 1 全部出口、未导入行核对、至少一个已发布版本的回退窗口 |
| provider 进程与事件投影 | Host 组合根启动 provider；domain 只做纯投影 | `harness/core/child.ts` 仍可经 Rust 启动，controller 仍有本地提交/恢复链 | 阶段 1 删除产品本地提交与恢复；阶段 2 才搬纯投影 |
| 检查点 | Host | `session-checkpoints.ts` / `turn-checkpoints.ts` 与 Rust `checkpoint.rs` 并存 | 阶段 5 证明旧桌面快照可读取，或对无法恢复的历史明确报错 |
| 线上命令、能力、同步类型 | `src/contracts/` | 当前为 `features/connections/model/protocol.ts`，直接依赖 Session/Block | 阶段 2 按命令和 sync、投影、各 provider 分批迁移 |
| 连接、outbox、sync | `src/client/` | 桌面 connections 与 `src/mobile/client.ts` 并存 | 阶段 3 平台端口分离、两端共用测试 |
| 窗口、托盘、更新、系统集成 | Tauri | 继续保留；本机 PTY 在测量前保留 | 不因执行迁移删除壳职责 |

目标依赖：contracts 不依赖其他业务目录；domain 只依赖 contracts；Host 依赖 contracts、domain 和自己的运行时；client 不依赖 app、mobile、Tauri 或具体 provider。provider 只输出事件，Host 调用投影。迁移中的既有违规逐项消减，不用 `--update` 接受新违规。

不改 transcript 外观、SQLite 投影列形状或 Bots/工作流的存储模型。不引入 Effect，不更换 Electron/Capacitor，不先拆 workspace。事件表仍是同步日志，不能在这一迁移中默认为唯一真相。

## 已有机制与仍需追踪的路径

已有机制不能重复实现：

- `src/main.tsx` 已在 `loadBootWorkspace()` 前等待 `initializeSharedHost()`；quick-composer 的独立入口也等待初始化。
- `sharedHost.ts` 允许曾成功配对的本机 Host 在启动/传输失败时使用经过身份匹配的缓存；认证、身份、撤销或协议错误不进入该回退。无有效缓存时启动失败。
- `host/desktop-import.ts` 以只读 SQLite 连接导入，每个源行有 marker/tombstone；已有 Host 会话不被覆盖。`~`、remote 路径和 `inbox_ask` 被排除。
- `sessionStore.ts::shouldPersistSession` 在原有 remote/shared backend/inbox/`~` 排除上新增稳定的 Host 归属判断，并在排队与重试前复查。初始化前的正常项目同样归 Host；Rust 写命令和导入核对尚未删除或完成。
- Host 已有 delta、分块同步、回执和能力列表；本地共享 Host 的文件/Git 路由仍可能是原生路径，不能从会话归属推断项目 I/O 已迁移。
- Host 的 `turn-checkpoints.ts` 已使用 `refs/omnicode/checkpoints/...`；不能把全部 Host 检查点描述成仅拷文件。内容快照回退仍在 `session-checkpoints.ts`。

以下列出阶段 0 发现的路径及本轮收口状态；被闸门拒绝不等于实现已删除：

| 来源/原因 | 入口和判断 | 后续本地动作 | 验证重点 |
| --- | --- | --- | --- |
| Host 未就绪/未配置 | `sessionUsesHost` 已改为不依赖连接配置；项目 submission 没有 Host actions 时明确失败 | 本轮已阻止该入口退回本地 provider 和 Rust 项目正文写入 | 检查其他 controller 是否仍把临时路由/连接状态当作归属；已有 actions 的离线错误由 Host 客户端处理 |
| `~` 空白聊天 | 创建前同步检查 Host 配置；`projects.open` 成功后才改变 cwd 并 stage | 未配置立即拒绝；准备先于本地 flush/apply；注册失败、会话删除/切换均拒绝，回调仅恢复尚未编辑的草稿 | 不覆盖用户新输入；只有注册成功才能 stage；staged 接受不等于 Host 已持久接受 |
| 空 cwd / 非空 `~` 历史 | 非 inbox 会话没有有效执行目录 | 明确拒绝发送，不进入本地 submission | 需要修复来源/目录后再恢复发送，不能用本地执行掩盖归属错误 |
| inbox 提问 | 2026-10-23：`sessionUsesHost` 不再排除 `inboxAsk`，经 Host 提交（`sessions.inbox.v1`） | 不再进入本地 provider | 旧 Host 缺能力时明确失败；来源、续问与 restart 走 Host |
| 恢复绑定 | appLifecycle/history/workspace controller 及 orchestration bridge 的 Host 归属闸门 | Host 不做本地 bind/forget/reap 或中断投影；inbox/`~` 本地恢复分支仍留 | 归属不由网络在线状态决定；不能因 Host 仍 busy 而在 WebView 重新 spawn |
| 编排任务停止 | `useOrchestrationBridge.ts` → `hostSessionControl.ts` | Host 会话使用带 runId 的 `commands.dispatch`；只有已知的本地会话保留 native kill | cancel 回执不是进程已退出证明：旧 bridge 对 Host worker integrate/cleanup 明确拒绝并保留 worktree；正常 Host 编排沿用自己的 controlRun |
| 模型探测、标题、文本补全 | 模型刷新已走 Host `models.list`，force 受 `models.refresh.v1` 保护；标题生成已有 Host 路径 | BTW、分支名回退和 commit/PR 文本生成仍可经 provider/core 间接到 `harness_spawn` / `harness_exec`；本地可用性检查保留 | 旧 Host 缺 force 能力不回退本地探测；静态直接引用为零不代表辅助执行已全部迁走 |
| 本地回合检查点 | submission/事件处理 → `sessions/model/checkpoint.ts` | begin/prepare/capture/finish 等 Rust command | Host route 只覆盖部分 UI 动作；未挂载路由不可静默改用 Rust |
| 排队持久化 | `enqueueSessionWrite` 开始和 `writeSession` 每次尝试均重新检查 | 本轮已阻止归属变更后继续向 Rust 写 Host 项目；旧 writer 实现仍保留 | 正常项目不依赖 backend 配置；异常空 cwd 和 Rust 直接调用仍需后续核对 |

开发计数在调用前记录 `harness_spawn`、`session_upsert`、`session_checkpoint_capture` 等尝试，使用固定原因枚举：`host-not-ready`、`home-draft`、`inbox`、`restore-binding`、`utility`、`legacy-local`。无法从上下文细分的调用保留 `legacy-local`，不能把枚举已定义当作所有原因均已被实际观测。重叠的临时原因支持任意清理顺序并恢复仍有效的作用域；native spawn 即使失败也计数，Host backend 不计入本地执行，跳过的 checkpoint 调用不计数。只记录命令、原因、计数；不记录会话 ID、用户正文、附件、路径、账户或 provider 启动参数。通过 `[local-execution]` 开发日志读取，生产构建不启用；尝试次数不是成功次数。

`ui-local-provider-execution` 过渡规则限制 feature/app 新增 `spawnChild` / `harness_spawn` 产品引用；现有引用入基线，测试桩排除。基线按文件、目标和引用序号计数，移动行号不增加豁免，新增引用会失败。此规则不是全程序数据流分析：跨文件转发、运行时生成的命令和间接 provider 调用仍须结合上述路径与运行计数审查，不能据静态计数宣称 provider 只由 Host 执行。

## Rust command 删除与替代清单

清单按 `src-tauri/src/lib.rs` 注册名核对。Host 方法以 `host/server.ts` 当前注册为准；“内部”表示 Host 自己调用，客户端不能直接转发该 Rust command 名。

### 会话、provider 与检查点

| Rust command | 现有 Host 替代/缺口 | 删除条件 |
| --- | --- | --- |
| `session_upsert` | `commands.dispatch` 的 `create` / `send` 等命令，由 engine/store 自己持久化；没有任意快照 upsert API | 阶段 1 先停调用、核对导入，再保留一个发布版本后物理删除 |
| `session_get`, `session_list_by_project`, `session_list_linked` | `sessions.get`, `sessions.sync`, `sessions.list`（linked 需要客户端选择/过滤） | 保留旧缓存读取直到回退窗口结束 |
| `session_search`, `cancel_session_search` | shared backend 基于 `sessions.list` + `sessions.get/sync` 的搜索与客户端取消版本 | 不假设有同名 Host 搜索端点 |
| `session_delete` | `sessions.delete` | 校验 Host tombstone、alias 与 outbox 清理 |
| `session_set_archived`, `session_set_pinned`, `session_set_linked_work_item` | `sessions.update` 对应元数据 | 改走已绑定的 Host 身份，不写旧行 |
| `session_rebase_project` | 无已确认等价的 Host 批量重定位 API | **阶段 5 之前不动**；先明确项目移动和已有会话路径的语义 |
| `session_set_in_flight`, `session_list_in_flight`, `session_take_in_flight` | Host 运行状态/`sessions.activity` + sync；不再由 WebView 接管 provider | 阶段 1 恢复链迁移后审查退出流程；不能简单映射成新进程启动 |
| `harness_spawn`, `harness_write`, `harness_kill` | Host child backend/provider adapter 内部；客户端用 `commands.dispatch` 的 `send` / `approve` / `answer` / `cancel` | 本地提交、inbox、恢复、探测和补全全部收口后 |
| `harness_kill_all` | Host 自己管理生命周期；不应把关窗口解释为停止 Host 所有回合 | 阶段 1 之后核对退出/更新语义 |
| `harness_http`, `harness_sse_open`, `harness_sse_close`, `harness_exec`, `harness_free_port` | `host/child-backend.ts` 等运行时内部能力；没有通用公开 Host shell 透传接口 | 等所有 provider 与辅助调用迁出，不能只按主聊天判断 |
| `harness_resolve_*`, `harness_resolve_configured`, `harness_runtime_binary_paths`, `harness_prepare_deepseek_bridge` | `models.list` 覆盖模型发现；Host provider runtime/backend 内部做解析与准备 | UI 安装、登录、更新等剩余使用须逐一迁移；无等价功能的 **阶段 5 之前不动** |
| `harness_read_claude_title` | Host 原生会话/标题导入处理；`titleModel.generate` 是生成，不能冒充等价读取 | **阶段 5 之前不动**，先核对所有原生标题读取方 |
| `claude_mcp_list`, `pi_mcp_list`, `claude_mcp_add`, `claude_mcp_remove`, `mcp_provider_login` | 未确认公开 Host 等价 API | **阶段 5 之前不动** |
| `session_checkpoint_begin_turn`, `session_checkpoint_finish_turn`, `session_checkpoint_ensure`, `session_checkpoint_prepare`, `session_checkpoint_capture` | `host/session-checkpoints.ts` 的 `beginTurn`, `finishTurn`, `ensure`, `prepare`, `capture`，由 Host 内部调用 | 阶段 5 移除本地回合后删除调用，再删实现 |
| `session_checkpoint_status`, `session_checkpoint_file_diff`, `session_checkpoint_undo`, `session_checkpoint_keep` | `sessions.checkpoint`，action 为 `status`, `diff`, `undo`, `keep` | 需要 `sessions.checkpoint` 能力；验证旧快照和 provider 回滚先行约束 |
| `session_checkpoint_apply`, `session_checkpoint_cleanup_safe` | 无一对一公开 Host API；不能用文件复制冒充安全还原 | **阶段 5 之前不动**，先迁移历史回滚和安全清理调用 |
| `session_checkpoint_forget` | Host 内部 `SessionCheckpoints.forget`，由会话生命周期管理 | 核对删除/清理流程及旧快照后移除 |

注意：当前协议没有 `sessions.stop` HTTP 方法。普通回合停止使用 `commands.dispatch` 的 `cancel`（带 `commandId`, `sessionId`, `runId`）；编排停止/取消任务使用 `orchestration` 命令；后台任务另有 `sessions.stopBackgroundTask`。实现必须使用已存在的语义，不能依据计划中的简称造出调用。

### 项目文件、Git、PTY 与外部服务

`remoteCommands.ts::HOST_COMMANDS` 内以下 Rust 命令已有 `workspace.run { command, args, machine? }` 对应实现，登记于 `host/workspace-commands.ts`。阶段 5 才将**本机项目**也统一改走该端口；应用自身数据目录另行保留壳访问。

- 文件：`list_dir`, `list_project_files`, `read_text_file`, `read_binary_file`, `read_file_preview`, `write_text_file`, `stat_files`, `create_path`, `rename_path`, `delete_path`, `copy_path`, `move_path`, `search_project`。
- Git diff/历史：`git_diff_index`, `git_diff_files`, `git_diff_stats`, `git_file_diff`, `git_history`, `git_commit_files`, `git_commit_file_diff`, `git_base_diff_files`, `git_base_file_diff`, `git_staged_context`, `git_range_context`, `git_head_message`。
- Git 写入与分支：`git_stage_contents`, `git_stage_file`, `git_unstage_file`, `git_discard_file`, `git_discard_all`, `git_stage_all`, `git_unstage_all`, `git_commit`, `git_push`, `git_pull`, `git_sync`, `git_pr_status`, `git_pr_create`, `git_branches`, `git_checkout`, `git_create_branch`, `git_stash`, `git_worktrees`。

| 剩余命令组 | 替代/处理条件 |
| --- | --- |
| `pty_spawn`, `pty_write`, `pty_resize`, `pty_status`, `pty_kill`, `pty_kill_all` | 未确认 Host 对等 PTY 协议；**阶段 5 之前不动**。本机 PTY 即使阶段 5 开始也须等真实输入到显示延迟测量，不能以 rAF 间隔替代 |
| `git_github_status`, `git_github_repo`, `git_github_repositories`, `git_github_work_item`, `git_github_work_items`, `git_github_work_item_details`, `git_github_work_item_thread`, `git_github_work_item_comment`, `git_github_pr_action`, `git_github_pr_diff`, `git_github_pr_checks`, `git_github_check_details` | 不在上述 workspace allowlist；**阶段 5 之前不动**，不能因为名称以 git 开头就按现有 workspace 支持删除 |
| （2026-10-23 已由 Host `inbox.run` 替代，Rust 模块已删除）`gitlab_status`, `gitlab_set_config`, `gitlab_repo`, `gitlab_list_work_items`, `gitlab_list_todos`, `gitlab_work_item_details`, `gitlab_work_item_thread`, `gitlab_work_item_comment`, `gitlab_mr_diff` | 无已确认 Host 等价服务；**阶段 5 之前不动** |
| （2026-10-23 已由 Host `inbox.run` 替代，Rust 模块已删除）`azure_devops_status`, `azure_devops_set_config`, `azure_devops_repo`, `azure_devops_list_work_items`, `azure_devops_list_todos`, `azure_devops_work_item_details`, `azure_devops_work_item_thread`, `azure_devops_work_item_comment`, `azure_devops_mr_diff` | 无已确认 Host 等价服务；**阶段 5 之前不动** |
| （2026-10-23 已由 Host `inbox.run` 替代，Rust 模块已删除）`linear_status`, `linear_set_token`, `linear_list_teams`, `linear_list_issues`, `linear_issue_details`, `linear_issue_thread`, `linear_issue_comment` | 无已确认 Host 等价服务；**阶段 5 之前不动** |
| （2026-10-23 已由 Host `inbox.run` 替代，Rust 模块已删除）`jira_status`, `jira_set_config`, `jira_list_projects`, `jira_list_issues`, `jira_issue_details`, `jira_issue_thread`, `jira_issue_comment` | 无已确认 Host 等价服务；**阶段 5 之前不动** |
| `clone_repo`, `inspect_paths`, `read_file_base64`, `write_attachment`, `save_generated_image`, `delete_generated_images`, `omp_session_interjections`, `omp_active_assistant_texts`, `claude_shell_commands` | 不在上述 workspace allowlist；附件部分已有 `attachments.upload/read`，但不是全组一对一替代。**阶段 5 之前不动**，分别核对项目/应用目录和原生协议语义 |
| `resolve_project_location`, `open_path_with_default_app`, `reveal_path` | 涉及系统集成，不因项目 I/O 迁移机械删除；区分 Host 路径解析和本机打开/显示 |

`workspace_set_snapshot/get_snapshot` 与 `remote_outbox_list/put/delete` 不等于会话正文写入。工作区已有 `workspaces.read/save`；outbox 属于客户端持久化端口，阶段 3 明确本机存储归属前保留。`shared_host_prepare`、配对、窗口、托盘、更新和退出协调继续属于壳；Windows 更新仍需先停 Host 再覆盖文件。此清单不是删除这些壳 command 的授权。

## 切片出口与回退

| 阶段 | 可验收的出口 | 仍不能据此声称 |
| --- | --- | --- |
| 0 | 文档和调用来源可查；开发计数可读；新增直接本地 provider 引用被拒；`check:arch` 通过 | 没有直接引用不等于没有间接本地执行 |
| 1 | 新会话仅在 Host；Host 不可用发送明确失败；`~`/inbox 收口；主/quick-composer 入口均无本地恢复/提交；桌面重启由 sync 跟进 Host 回合；相关 Host/sessionStore/sharedHost/移动端测试及手工发送停止审批提问通过 | Rust command 尚在回退窗口时不能声称实现已删除；未手测不能标手工通过 |
| 2 | 命令/sync 迁 contracts；纯投影事件序列保持相同 Block[]；每个 provider 迁移；core→provider 为零；剩余 integration/Host→feature 豁免仅列明的 Bots/工作流 | 不更换投影外观和 SQLite 列，不将同步事件日志升级为唯一真相 |
| 3 | 两端共用 client 的 sync/outbox/能力降级测试；隐藏会话停止 transcript 轮询，多 pane 共享 pending sync；desktop→mobile 为零 | 手机 UI 不必迁到桌面组件 |
| 4 | 相同 commandId/相同内容复用回执，内容不同拒绝且不重执行；新旧能力组合测试；activity 无 blocks | 未测请求数/delta 字节/补齐时间不增设 WebSocket |
| 5 | 项目文件/Git 无 Tauri 产品调用；Host→UI 为零；仅壳启动项保留 Tauri 豁免并逐条说明；旧检查点可读或明确拒绝；文件/Git/终端实际操作验收 | 未测原生输入到呈现延迟不宣称 PTY 性能达标 |
| 6 | feature→其他 feature/ui 为零；不改布局和文案 | 不因为控件搬家重构业务 |

阶段 1 按启动闸门、停止回写、`~`/inbox、辅助 provider 调用、删除本地恢复/提交、Rust 只读核对依次切片。阶段 2 的 apply 搬家等本地 apply 消失；阶段 3 等 contracts；阶段 4 等单一 client；阶段 5 等阶段 1；阶段 6 可在执行路径收口后与 4/5 并行。

每个切片跑最小相关既有测试和 `npm run check:arch`；降低豁免时提交收紧后的基线。不自动构建、发布、推送、合并或用 `--update` 接受违规。记录实际执行的检查结果，未执行的场景列为待验收。

Rust 旧表保留期间，旧桌面只能读旧行；Host 单向导入不会把新会话倒灌回 Rust，因此回退不保证看到升级后的新消息。核对新旧未导入行后先拒绝写入，至少跨一个正式发布版本再删除 command/更新路径，表更晚删除。阶段 2 回退只回退程序，不迁库；阶段 4 能力加法保持旧命令可读；阶段 5 不静默丢弃可还原的历史检查点。
