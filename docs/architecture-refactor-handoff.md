# OmniCode 架构重构：接班提示词

> 快照时间：2026-10-22 11:45 America/Los_Angeles。用户因额度即将耗尽，明确要求停止并写详细交接。旧线程目标已通过 `update_goal({status:"paused"})` 暂停；不要误标 complete。下面既是接班提示词，也是工作树现状与证据索引。
>
> 当前代码是大规模迁移的中间状态，不是全阶段已完成或可发布版本。不要只看绿的架构检查就宣称结束。用户要求：**继续完成所有阶段后，再统一真机验收**。期间做相关自动测试，暂不要求用户手测。

## 1. 给接班 agent 的任务

你在 `D:\A-Projects\OmniCode` 接手一个已进入目标模式的架构重构。先读本文件、根 `AGENTS.md`，再从实际工作树核对进度。用户将本交接作为继续工作请求时，继续原目标，不缩小成“本轮改动能通过几个测试”。如果用户尚未要求恢复，只阅读交接，不擅自恢复已暂停目标。

最终形状：

```text
src/contracts/       线上 DTO、命令、能力；无业务目录、React、Tauri、provider 实现依赖
src/domain/          会话/事件/投影纯函数；仅依赖 contracts 与自身
host/                唯一会话、provider 进程、检查点执行者；项目文件/Git/服务/调度在这里
src/client/          桌面与手机共享连接、sync、chunks、outbox、命令、能力降级
src/features, app    读投影、发命令；UI 组合和桌面窗口行为
src/mobile           Capacitor、手势、安全区、原生插件与移动展示
src-tauri            窗口、托盘、更新、密钥、系统集成；不能再执行项目会话/provider
```

不引入 Effect，不换 Electron，不重写 Capacitor，不改 transcript 的 `Block[]` 外观，不把 Bots/笔记/设置/工作流全面事件溯源，不先拆 npm workspace，不增设无测量依据的 WebSocket。保持配对、SSH、WSL、编辑器和分栏。

用户原来授权 6–10 个子 agent、子 agent 使用主 agent 配置。上一批使用 8 个，后来为明确独立工作面扩为 10 个；均继承主配置，没有额外 model/reasoning override。可以继续采用同样的并行方式，但必须划清文件所有权，尤其 `host/engine.ts`、`host/server.ts`、`src-tauri/src/lib.rs`。不要假设旧子 agent 在新线程里仍存活。

## 2. 当前仓库与暂停状态

- cwd：`D:\A-Projects\OmniCode`，PowerShell，Windows。
- 当前分支：`refactor/architecture`。
- 当前 HEAD：`4974a8ba36a4cb92b8a88fca6fd85cc901110ad1`。
- 本轮没有自行提交、推送、合并、发布或产品构建。当前分支是读到的现状，不要据此自行切换、重置或新开大重构分支。
- 暂停时 `git status --porcelain` 采样为 1374 条 modified、141 条 deleted、196 条 untracked 状态项。untracked 项可能是目录，不等于文件总数；本交接文件是采样后新增。
- 改动开始前工作区就有上一批未提交工作；所有改动要保留，不能 `reset --hard`、`clean` 或批量还原。
- 9 个仍运行的子 agent 已逐一 `interrupt_agent`；client agent此前已完成。暂停后只进行了只读现状核对和本交接文档写入。
- 11:45 的 Windows 进程查询未发现仍运行的 `vitest ... run`、`cargo test/clippy`、`tsc --noEmit`。若后续工具返回旧 session handle，先验证它确实还活着，不凭旧 ID 重启/重复检查。
- 旧目标线程 ID：`01a164a5-fede-7b83-8b05-8a33bdc8faa5`，状态 paused，无 token budget。不要把中断当成目标完成。

### 必须保留的操作规则

1. 不自动构建、发布、推送、合并。`npm run test:host` 有 `pretest:host` 会触发 Host build；本次使用 `npx vitest run --config host/vitest.config.ts ...` 跑 Host 测试，避免隐式产品构建。
2. 不用 `arch-baseline --update` 接受新违规。正常 `check:arch` 会自动收紧已解决项；并行红态期间优先用 `analyze()/toBaseline()/compareBaseline()` 只读检查，避免因暂时不存在的 import 目标过早收紧。
3. Rust 会话写 command 和表必须保留至少一个正式发布版本的回退窗口；现在可以拒写，不能为了归零物理删光历史表。
4. 本机 PTY 仍可保留。未做本机输入到本机呈现测量，不得宣称 P95 <50ms，也不得先删除 Tauri PTY 再说最后补测。远程/移动 Host PTY 仍需核对实现。
5. 真机验收由用户明确延后。自动测试通过不等于真机验收，不等于所有 CLI 兼容性通过。没有执行真实 CLI 场景，不写兼容声明。
6. 保持现有 UI 尺寸/字体/图标/折叠双向动画。改 Motion API 必须读项目 Motion skill 与当前免费官方文档。纯移动不顺手改变外观。
7. 应用自有文案用英文 key + `src/shared/i18n/zh-CN.json`；provider/user 返回值不要擅自翻译改写。

## 3. 暂停时重新核对的架构计数

这是暂停后实际运行只读 `analyze()` 的结果，不是先前 agent 的估计。已存基线 78 条边，实际 76 条；没有新增违规，仅 child 的两条 Tauri import 已消失但尚未自动收紧。已存 cycleFiles 为 61。

| 规则 | 已存基线 | 实际 |
|---|---:|---:|
| contracts-upward | 0 | 0 |
| domain-upward | 0 | 0 |
| client-upward | 0 | 0 |
| integrations-to-features | 0 | 0 |
| harness-core-to-providers | 0 | 0 |
| feature-ui-cross | 0 | 0 |
| ui-local-provider-execution | 0 | 0 |
| shared-upward | 7 | 7 |
| platform-upward | 1 | 1 |
| features-to-app | 10 | 10 |
| desktop-to-mobile | 1 | 1 |
| mobile-to-app | 1 | 1 |
| mobile-desktop-css / mobile-tauri | 0 | 0 |
| tauri-outside-platform | 22 | 20 |
| host-to-ui | 1 | 1 |
| host-to-feature-model | 35 | 35 |

明确残余：

- `host/workspace-commands.ts -> src/platform/tauri/fs.ts`：还没达到 Host→UI/platform 为零。
- `src/features/source-control/ui/ReviewSourceSelect.tsx -> src/mobile/relativeTime.ts`：desktop→mobile 尚未零。
- `src/mobile/MobileAppUpdates.tsx -> src/app/model/releaseNotes.ts`：移动仍依 app。
- 35 条 Host→feature 中绝大多数是 Bots/IM（可按阶段 2 计划列为尚未迁移项），但 `host/engine.ts -> src/features/sessions/model/session.ts` 仍有一条，必须查实际用的符号并迁掉，不能把它算进 Bots 豁免。
- 非 platform Tauri 的实际残余主要在 editorResource、session reminders、provider updates/identity/binary paths/Pi usage、search、sessionStore、checkpoint、MCP、registry、Codex/Cursor/Pi 适配器，以及 main 两个壳启动 import。child.ts 两条已实际移除。
- 静态规则只证明 import/ref 边；不能证明没有间接执行、死代码、缺模块或被 UI 禁用的功能。

`docs/host-execution-migration.md` 仍主要是**第一批状态**，其中“inbox 还是本地例外”“615 条基线”等当前已过时。不要用它覆盖新工作；完成整合后更新它。本文件优先说明本次暂停快照，最终以代码和新验证为准。

## 4. 已落地的主线与权威文件

### 4.1 contracts/domain（阶段 2）

- `src/contracts/session.ts`：完整 Session/Block 和嵌套 DTO，保持界面投影结构。
- `src/contracts/protocol.ts`：HostCommand、HostSession/summary/sync/chunks/receipt/descriptor 等，`HOST_PROTOCOL_VERSION` 保持 1。
- `src/contracts/harness.ts`：HarnessEvent 等。
- `src/contracts/provider.ts`、`workflow.ts`、`submission.ts`、`inbox.ts`、`checkpoint.ts`、workspace/skills/nativeCommands/hostState/titleModel/各服务 DTO。
- 旧 `features/connections/model/protocol.ts` 等纯类型文件已删除，consumer 直接导入新位置，不恢复 forwarding 层。
- `src/domain/` 已迁纯会话函数、投影及大量 helpers：session、apply、titlePolicy、questionHistory、agentTranscript、plan、taskList、turnTiming、contextUsage、handoff、secondOpinion、btw prompt、notes prompt、skills、orchestration Runtime/Plan/State、sharedPreferenceSchema、Git prompts、JSON 文本等。
- 投影使用显式 `createSessionProjection` context（clock / id / model），不让 domain 读客户端全局 model catalogue、localStorage 或 Tauri。
- Cursor 原生子代理恢复返回事件，由 Host 读取/engine折叠；desktop sessionStore 的直接恢复/apply 已删除。
- 原 nativeSessionParser 实现迁到 `host/native/parser.ts`，core 仅保留解析接口。Host workspace/skills 的 fs DTO 改从 contracts。
- `integrations/harness` 对 feature 的生产 import 已归零；dynamic model catalogue/preferences 改为 core runtime ports，由客户端配置，Host 注入运行时。
- workflow contracts 与原 Zod validator 的输出类型做过严格等价编译验证，不是仅手写一个近似 DTO。

### 4.2 Host-only 提交、恢复、后台命令（阶段 1）

- `useSessionSubmission.ts` 已从约 1500 行本地执行分支缩为 Host 提交。
- `features/connections/model/hostSessionSubmission.ts`：不依赖会话面板挂载的 create/configure/upload/worktree/send、durable outbox、onSettled、stop/delete。
- `~` 首句先建目录并在 Host 注册，Host 接受后才发布 cwd；失败恢复 composer 草稿，不覆盖用户新的输入。
- 旧 `stageRemoteSessionSubmission` 等“等 pane 挂载才能发送”机制已删，不应恢复。
- inbox 现在有 `sessions.inbox.v1`、`contracts/inbox.ts`、`host/inbox.ts`、`domain/inboxPrompt.ts`。Host保存来源并包装首句/续问/steer/handoff；summary只包含精简来源，不带完整description。raw slash按原语义处理。
- `host/session-submissions.ts`、`host/btw.ts`：SubmissionMetadata（CI、second opinion、note/handoff、appRequestId 等）、Host-owned BTW线程、stream blocks、恢复中断、turnOutcome。
- Host支持 buildTarget / resendEdited；provider rewind保持原账号/环境，具体兼容测试见对应文件。
- `commands.outcome` + `sessions.outcome.v1` 返回命令结果摘要；后台 onSettled观察它，不在隐藏 pane 上轮询 transcript，必要时完成后单次sync。
- `stopHostConversation` 必须等实际 idle；如果取消后出现新的 busy run，明确拒绝继续删除工作树。cancel receipt仅是接受，不能当进程已退出。
- WorkspaceController 的 HarnessEventQueue、apply、native bind/forget、TitleCoordinator、自动 Continue、旧本地 queue已大量删除；生命周期仅保存 workspace 导航/处理壳与 PTY，不重写会话 blocks、不重新spawn。
- 旧 `useOrchestrationBridge.ts` 和 WebView scheduler 已删除，默认 UI runtime改 Host cache/commands。继续检查外围 hooks 是否仍有 native forget/stop 或另一个 scheduler。
- 暂停前 frontend owner 正在清理这 5 类外围残留：IdleSessionDetach、WorkspacePaneActions、SessionComposerActions、ProjectTerminalActions、SessionWorktreeActions；`harnessFlush.ts` 已无生产消费者，待确认后删除。
- **尚需完整收口的关键功能**：worktreeRemoved 会话原 ID/历史重新挂接不能仅在 UI 改 providerSessionId。需要 Host `sessions.relocate` 或等价 canonical 操作，验证 idle/project/worktree、release bindings、handoff、持久revision。不要“新建聊天”替代恢复旧聊天。
- `useBtwConversations.ts` 曾仍引用已删除的 applyBtwHarnessEvent / sealBtwResponseBlocks；最终是否完全接上 Host BTW UI要重新核对。不要只因 Host有 BTW service就算前端功能完成。

### 4.3 Rust 禁写核对与离线完整缓存

- `host/desktop-import.ts` receipt/audit v2：fingerprint + sourceUpdatedAt。旧 marker `"1"` 必须核对 source transcript 确实保留在 Host、源时间不更新才升级；冲突保留双方，不覆盖已有 Host。
- `src-tauri/src/session_store.rs` / `local_host.rs`：prepare时 `BEGIN IMMEDIATE`，核对manifest一致后写 durable ownership gate；接管后拒绝 upsert/archive/pin/link/delete/rebase。保留写 command与表用于发布回退窗口。
- 旧墓碑若没有可证明来源版本，会显式报核对冲突，不复活删除会话。
- `src-tauri/src/host_projection_cache.rs`：独立缓存表和IPC，完整projection，不是session_upsert；按machine/environment/endpoint/credential hash隔离。request前身份witness防止换绑过程中串写。token/hash不被当成用户正文输出。
- `host/desktop.ts` 私有bootstrap response含完整projections供Rust缓存；renderer不接收私有凭据。首次导入后没打开过的会话也有离线正文。
- sharedHost只在明确offline故障时读缓存，401/403、身份/endpoint变化不得回退。
- Host删除不再回写Rust session_delete；只清对应客户端cache、保留源表。

### 4.4 共享客户端（阶段 3/4）

- `src/client/`：ports、hostProtocol、sessionSync、polling、commandOutbox、command outcome观察、modelCatalogLoad 等。
- `src/domain/sessionSync.ts`：纯 merge/apply sync。
- desktop `connections.ts` 与 mobile `client.ts` 使用这些共用实现；桌面 Tauri HTTP/outbox适配在 platform，手机 Capacitor transport在 mobile。
- 原 `features/connections/model/remoteOutbox.ts` 移到 `src/platform/tauri/remoteOutbox.ts`。
- HTTP、outbox storage、app lifecycle、device四类端口已接线。client不import React/features/platform/mobile/provider。
- 隐藏会话不再10s轮询正文；打开会话按能力使用长轮询，多个 pane共享pending sync。
- 修复 create receipt绑定导致 pane bindingVersion改变而中止首条 send的竞态；首次消息恢复继续用稳定ID，不能重复创建。
- command journal统一持久化/重放；不支持的命令/确定性失败不无限重试。相同id不同payload的Host拒绝仍需最终逐条审计（create/send/approve/answer/BTW/辅助作业各路径）。
- 本次未增加WebSocket。没有执行请求数/delta字节/手机前台补齐时间测量；这些应在统一验收清单里。

### 4.5 UI边界（阶段 6）

- 实际 `feature-ui-cross` 已为0，但只代表静态边界，最终统一类型/UI集成检查未完成。
- 纯控制/展示迁 shared：HarnessIcon、文件类型/错误/菜单、Markdown模式、TerminalSpinner、DropTargetHint、项目图标、账号展示、通知日期控件、MessageQueue/FilePreview等。
- 应用组合壳迁 `src/app/ui/`：SettingsView、PaneTree、FilePane、SurfaceTabs、SessionSurfaceToolbar，以及明确的page/presentation providers；具体业务feature未整体塞shared。
- `SessionPresentationProvider`、`TranscriptServices`、Inbox/Workflow/Automation等注入外部feature UI；手机用 `mobile/MarkdownServices.tsx` 对应组合。
- `shared/ui/markdown` 和 `shared/ui/attachments` 通过服务/context注入原生copy/open、图片、code theme/highlighter；共享层无feature/platform/Tauri依赖。
- 高亮仍用原worker/cache，保留line numbers、tokens、文件链接与Inbox媒体白名单。更新了6个browser fixtures供以后统一验收，不代表做过性能/真机测试。
- quick-composer入口迁到 `src/app/quick-composer/main.tsx`，`quick-composer.html` 已更新。不要重新引用已删除的 feature入口。
- 新的 `tests/helpers/sessionPresentationRoot.ts` 给直接渲染session组件的测试注入与AppView一致的composition；不要通过mock归属判断为false来掩盖Host路径。

## 5. 阶段 5 服务迁移：已实现与半成品

### 已较完整、已有定向验证的部分

1. **项目普通文件/Git**：本机项目也走 `workspace.run`，不在线不回退Rust；应用私有数据暂存仍是壳职责。
2. **项目移动**：`host/project-moves.ts` 持久journal，fs/checkpoint/store一起更新；失败回滚、启动恢复、nested注册项目、外置/嵌套worktree Git repair。恢复必须在engine恢复队列前，在通用cli启动完成，不能仅desktop做。
3. **worktree生命周期**：`host/worktree-lifecycle.ts`，检查/删除/关联（含归档、独立注册checkout）归属处理，`HostStore.save` SQL已更新project_id，避免snapshot与DB列不同。`git.worktreeLifecycle.v1`。
4. **Linear/Jira/GitLab/Azure DevOps**：现有命令全套Host服务，contracts DTO、`inbox.run`、每服务capability、管理员才可改凭据、registered project/WSL scope。`host/inbox-credentials.ts` 私有存储、旧desktop文件一次性导入，disconnect null不能再次复活旧token。
5. 对应4个Rust模块已删除：`azure_devops.rs`、`gitlab.rs`、`jira.rs`、`linear.rs`，`lib.rs`去掉32个注册。旧凭据数据文件没有删除。不要恢复它们，也不要据此删尚未替代的其他模块。
6. **辅助文本生成（root亲自完成）**：`host/auxiliary-provider.ts` + `provider-text.ts` + contracts/providerAuxiliary；server的 providers.auxiliary.start/read/cancel、设备隔离、同ID内容冲突、超时/cancel tombstone。`features/providers/model/providerAuxiliary.ts`驱动Git commit/PR文本和taskWorktree分支名；旧core/textHarness.ts已删、barrel删除。已有4 Host +1 server RPC +28 client/UI tests通过。
7. **模型刷新**：Host models.list + models.refresh.v1，force只首个progressive请求，旧Host明确错误且保留cached目录，绝不本地spawn兜底。
8. **登录与usage**：Host provider login、Claude/Codex usage、OpenCodeGo配置解析、Codex reset幂等签名已移Host。CLI管理还在完善，见下。
9. **Notes**：Host独立notes.db，旧desktop notes/assets只读导入；桌面notes/noteImages走现有 notes.*，56 UI/data+2 client、Host12+RPC1等定向通过。

### 正在写、不能算完成的部分（重点）

#### A. 检查点安全恢复事务

已存在：

- `host/checkpoint-rebase.ts`：metadata路径重定位，manifest/turn-review/turns，machine隔离、幂等、rollback保护后续写。4 tests通过。
- `host/legacy-checkpoint-import.ts`：一次性复制旧desktop snapshots到Host，原源保留；不覆盖现有Host记录；receipt防undo/keep后重新导入；损坏明确错误。2 tests通过，接在desktop import之后。
- `contracts/checkpoint.ts` 已迁权威类型。

**中断时刚写、尚未收敛验证**：

- `host/checkpoint-undo-plan.ts`：durable plan descriptor / plan.json。
- `SessionCheckpoints.prepareUndo/applyUndo`、`TurnCheckpoints.prepareUndo/applyUndo`。
- `host/checkpoint-restoration.ts`：SQLite metadata journal，phase为 prepared / provider-uncertain / provider-rewound / workspace-failed / completed。
- `HostEngine.sessionCheckpoint` 已接这些方法；`HostProvider.checkpointRewind`仅Codex/Pi/OMP。

完成要求：

1. 预验所有文件、symlink、checkout并发与Git index保护，然后才执行provider对话回滚；provider失败不能先改文件。
2. plan必须持久化且可重启，逐文件重试仅接受原after或已经恢复的before状态；不能把partial失败吞掉或重试时再rewind一次provider。
3. provider不确定失败保留journal并禁继续执行，不能丢证据。
4. OpenCode既有 session/revert可能同时改文件，不能当“纯对话回滚”；未证明专用实现前明确拒绝checkpoint undo。其他不支持provider同样拒绝，文件不变。
5. 非Git snapshots原来可能跨多turn，必须有可信turn边界；旧/多turn无法关联则明确拒绝，但保留review和源文件。
6. `wholeTurnUndoOnly`、`undoUnavailableReason`、`restorePending`、`restoreMessage`需要桌面SessionReview及mobile消费；截至暂停未确认接完。
7. Rust checkpoint调用/实现尚未全删。只在替代完成且旧记录可读/明确拒绝之后删除。

#### B. MCP

- 仅完成Rust功能盘点、官方transport/lifecycle核对、`contracts/mcp.ts`等准备。
- 暂停时 `host/mcp*.ts` 主服务尚未确认实现；不要把设计当落地。
- 需要保持Claude/Codex/Cursor/OpenCode/Pi/ClaudeDesktop配置发现、作用域、写配置、stdio、Streamable HTTP、legacy SSE、分页与provider login。
- 旧Rust约2000行；McpSettings/mcpInspect/mcpSettingsCache仍有Tauri产品调用。
- 计划用Host-owned `mcp.start/status`作业避开30秒HTTP超时，登录保留180/330秒语义，WSL走machine-io；配置/环境变量留Host。

#### C. CLI安装/更新/卸载与provider剩余Tauri

- `host/provider-management.ts`、`provider-npm-installation.ts`与runtimeInspect/Info/Plan/Latest/ClaimUpdateCheck/Start/Status服务已写入。
- 不能用简单npm install替代旧Rust的npm备份/失败rollback/launcher保护。
- `core/child.ts`两条Tauri import已消失，但registry、Codex、CursorStore、PiImages及provider identity/binary paths等仍需审计真实调用，不能泛化“所有provider只Host”已完成。
- 该片被中断在实现与测试收尾，需重新看文件与编译错误。
- `host/server.ts`原本仍手写discoverModels/resolveBinary全表。阶段2计划要求provider登记/组合根；检查是否已迁，否则必须完成，不仅把表搬个文件名。

#### D. GitHub、worktree重新挂接

- `host/github.ts`、`github-queries.ts`已有实现并接 inbox.run：状态、repo/fork parent、issues/PRs、threads/comments、PR actions、diff/checks/annotations、backoff。
- gh账号保留Host，正文用stdin，WSL只用于项目Git。
- 暂停时正在跑/补fake gh/Git runner与UI/RPC回归，未收到完整最终通过报告。
- 原生worktree进度事件改成Host完成响应返回logs，pending UI保留；需评估实时进度是否应补Host job/progress端点，不能默默减掉原功能。
- `sessions.relocate`/旧会话重新attach尚缺，见4.2；必须保持session id和历史。

#### E. Automation、reminder

- `contracts/automations.ts`、`domain/automationSchedule.ts`、`host/automations.ts`已经有Host store/scheduler、definitions/runs/claims、稳定commandId、worktree创建、启动恢复。
- 桌面自动claim/recover/submit loop已删，桌面只打开Host投影；4 Host +34原前端tests通过的是本机初片。
- **未完成**：remote:// definition必须迁到对应Host执行，不能在本机误执行；WSL需要machine身份；Host自行采集inbox事件，不能要求窗口常开才触发。
- **reminder未完成**：仍有 reminder_* Rust产品调用、sessionReminders/useSessionReminders。计划Host调度与存储，Rust只负责OS通知/窗口打开，不读写业务表。
- Rust remote_request名单刚加notes.*和automations.*，reminders.*仍待随服务实现。

#### F. /operator AppService

- 旧WebView control scheduler已删；`useAgentAppBridge`现在意图只消费Host UI投递，不执行会话/notes/worktree业务。
- `features/connections/model/desktopAppCommands.ts`有lease、同ID回执/幂等、卸载后不执行晚到请求，3文件12tests通过。
- Host `host/app-desktop.ts`刚实现DesktopAppCommands lease/delivery基础。
- **尚需确认服务完整接线**：host/control-cli.ts原来仅允许control/workflow/assistant，拒绝app；需要Host AppService控制真实会话/notes，再将tab/split/reveal等纯视图动作发桌面。不要恢复Rust control_*或删/operator功能。
- 暂停时读取server没有看到明确desktop app poll/respond完成注册的证据；需查contracts/app.ts、server/control/engine/CLI与桌面consumer是否匹配。

#### G. 项目附件/网络媒体

- 新 `contracts/hostMedia`、host/public-http.ts、media.ts、binary-transfers.ts，media.inbox/media.chunk/links.preview已加server。
- registered项目inspect_paths/read_file_base64迁workspace.run并分块；用户本机任意picker选中的非项目文件仍允许系统壳读取/暂存，不能把本机路径误发远程Host。
- 首轮相关frontend43tests通过；SSRF/重定向/token隔离/大文件/错误Host路由测试仍在写。
- 保持逐跳公网DNS/IP检查，GitHub token只发允许的github附件host，不传给CDN；数据大小/跳转/超时有界。
- 独立quick-composer入口是否已安装正确的本机项目Host路由，要单独检查。
- Rust网络模块/commands暂仍有注册，服务验证后再删无消费者实现。

### 一个极易漏掉的端到端问题：Rust RPC白名单

`src-tauri/src/remote.rs::supported_remote_method` 必须与新Host方法同步。暂停时只读搜索确认有 projects.rename/rebase、notes.*、automations.*，但未找到所有新providers.auxiliary、providers.runtime、provider login、inbox.run、media/links、commands.outcome、desktop app等的显式匹配。需完整读函数看是否有合法前缀分派，再逐项确认。

**Node HTTP测试通过不证明桌面调用经过Rust允许。** 不要为了省事放开任意method；逐条新增并做白名单/端到端的focused测试。

## 6. 已执行验证、已知失败与可靠性边界

不要把各轮通过数量相加成“全库通过”：文件有重跑、代码持续变化，以下仅定位证据。

### 可靠的定向证据

- root：架构规则新增contracts/domain/client约束，`node --test scripts/arch-baseline.test.mjs` 10通过。
- root：checkpoint-rebase 4、legacy-checkpoint-import 2、auxiliary-provider 4、auxiliary RPC筛选1、auxiliary/client/taskWorktree/SwitchBranch/GitChanges 28通过。
- contracts/domain：大量pure特征测试逐片通过（apply等141、contracts/helper多组97/24/76/184），workflow DTO精确类型等价检查通过。
- client：共用outbox/polling/sync、mobile及桌面命令定向多批通过；session UI批次230/232，两个测试已修并定向复验；额外composition30、model catalog7通过。
- frontend：lifecycle/workspace snapshot/removal/inFlight/submission 5文件127通过；App bridge consumer 12；submission service等20通过。最后外围hooks清理在暂停前仍进行。
- inbox Host最初6例通过；Host submit/BTW/usage新用例先10、后13及restart scheduler1通过；原engine3个默认1秒wait超时单独复跑通过，需稳定环境下最终回归。
- Rust/import/cache：Host import10、sharedHost18、restore3、Rust cache2/import3通过；fmt与clippy多次通过。
- 四第三方服务：Linear5、Jira7、GitLab8、Azure12，共32 Host tests通过，另RPC/client/UI对应定向通过。
- Project move/worktree lifecycle：真实Git目录变更、失败rollback、crash恢复、嵌套worktree等多组通过（8 lifecycle、16 client、移动早期5→8等）。
- Notes：Host12、RPC1、desktop notes/data/image56、notesHost2通过。
- Markdown/attachments展示：25文件272项，271通过，剩一个既有remend断言见下；新增app服务注入验证高亮tokens/行号/native copy/Inbox媒体限制。
- platform shell ports：窗口/quit/QuickComposer/SSH/Hostcache/popup等多批49/81/25/29/23等通过；不是完整全库结果。

### 已知失败或未复核项

1. **依赖环境漂移**：package.json cuelume `^0.2.2`，package-lock为0.2.2，node_modules实装0.2.8；未改sounds.ts的 bloom/chime/arrival/scan有4个类型错误。不要先改产品音效绕过。统一依赖后再判断（没有验证锁定版本同样失败）。
2. `streamingMarkdown.test.ts` incomplete emphasis期望 `First **unfinished**`，当前remend给 `First **unfinished\n\n**`。迁移后解析源码与HEAD归一化换行后完全相等；可能依赖漂移，未修产品行为。
3. 完整Rust检查先578pass/2fail/1ignored，删除4模块后523pass/2fail/1ignored；2失败在未改mcp.rs，当前机器额外MCP配置（Pi多1、Codex node_repl）污染预期。新MCP迁移后应重新评估；不能说Rust全绿。
4. FilePaneNavigation 8个测试单独重跑仍失败，多为happy-dom selectionchange→CodeMirror重入更新及旧toolbar计数。尚未判定全是既有问题，不可直接改断言放行。
5. MCP/Worktrees一些UI批次断言通过但StatusToast teardown异步错误；不能将“assert pass”当整个进程通过。
6. RemoteSession以前77断言都过但AutoAnimate定时器在环境销毁后报requestAnimationFrame未定义。已仅在该测试mock底层AutoAnimate引擎，保留真实React hook，复跑exit0；仍有既有act warning未屏蔽。
7. 原Host orchestration在并发迁移期有10失败1过，host_execution把engine.ready加workflows.ready，单个 plans-in-Host 已过；11测试整文件仍需稳定后复核。不要重复已过的无关全套。
8. 新的Checkpoint prepare/apply + engine restoration事务尚未拿到整合后的自动测试通过报告。
9. 全局Web/Host类型检查在并行修改中多轮出现缺export/错误import/unused/返回值类型等。最近曾报：useBtwConversations旧apply exports、PaneTree UserQuestionReply来源、checkpoint未用import、provider-management未用import、media headers undefined、workspace-commands BinaryTransferChunk非Promise、HostWorktrees.find不存在。部分已被owner修，**不要拿这些旧日志当当前准确错误列表**；先重新跑类型检查。
10. 没有真机、真实第三方账号、真实各provider CLI全组合、PTY输入到呈现性能的验收；按用户要求最后统一做。

### 临时日志

仓库根仍有 `.tmp-client-*.json/.txt`、`.tmp-frontend-host-*.txt`、`.tmp-host-media-tsc.txt` 和 `.tmp/`。它们是证据线索，有些是修复前日志，不能据此判断最新代码。整理后删除本任务明确创建的临时产物或移仓库外，不提交。不要盲删整个 `.tmp/`，先确认内容归属与绝对路径。

## 7. 接手后优先顺序

### 第一轮：建立一致的当前快照

1. `git status --short`、HEAD、根AGENTS；保留工作区。
2. 核对子agent/测试进程真实状态。旧线程已暂停，不要假设仍有人替你修文件。
3. 先只读分析architecture，再跑 `npx tsc --noEmit` 与 `npx tsc --noEmit -p host/tsconfig.json`，分别收集明确错误。此时允许临时红态，但要给每个错误定owner。
4. 检查package-lock与node_modules版本，安排无并行测试时的依赖一致性窗口。不要在大家测试时删node_modules，不盲目改源代码适配漂移依赖；不要触发未经请求的产品build/postinstall构建。
5. 逐个核对新RPC在server/HostMachines/Tauri allowlist/client capability/DTO这五处接线。优先修“后台服务有实现但桌面请求到不了”。

### 第二轮：闭合最高正确性风险

1. Checkpoint durable plan + provider journal + file restore retry + UI能力/恢复状态。
2. MCP完整Host service，停止客户端实际provider执行与Tauri fallback。
3. /operator Host AppService完整CLI/control/server/desktop lease回执链。
4. session relocate/重新挂接：canonical Host state，保留ID/history、工作树和native binding，不是换新聊天。
5. 自动化远端/WSL/事件采集与reminders完整Host调度。
6. BTW、second opinion、handoff、edited resend、CI、managed callbacks在真实UI入口的接线；不要只测Host函数。
7. 剩余Tauri产品调用/旧实现和Host→platform、desktop→mobile两个已知边。

### 第三轮：关闭各阶段出口

- 阶段0：文档不变量、诊断、不打印正文、禁止新增本地provider ref规则。
- 阶段1：所有发送与恢复由Host，inbox/~无例外进程，Rust已安全拒写，新会话只在Host SQLite，重启仅sync；写command和表按发布窗口保留。
- 阶段2：contracts独立、domain纯context、provider只events、Host统一fold、native parser Host组合根、catalog/binary provider注册，事件序列投影不变。
- 阶段3：desktop/mobile共用解析/outbox/能力与四端口，多pane共享sync、隐藏无transcript轮询、outcome单独观察。
- 阶段4：版本1/能力加法兼容，旧/新组合测试，send/approve/answer等同ID同payload复用、异payload拒绝不重执行，activity不含blocks。不凭感觉加WebSocket。
- 阶段5：Host检查点/项目文件Git/外部服务/后台调度；只剩明确壳Tauri例外；旧checkpoint可读或明确拒绝，Windows更新仍先停Host。Host PTY与本机保留条件明确。
- 阶段6：cross-feature UI边0且实际界面行为/组合完整，不能用不渲染或删功能达成0。

### 第四轮：统一验收与目标状态

- 自动检查按改动范围运行，必要时在代码稳定后扩大覆盖，而不是每个小改动跑全库。
- 真机流程等所有实现阶段完成后再统一安排，遵守用户最后指示。
- 正式发布窗口没经过，不物理删除Rust会话写command/源表；PTY没测，不删本机Tauri PTY或宣称延迟达标。
- 不因多数测试绿或额度不足标goal complete。目标只能在原始完整要求逐项有证据时完成；若真实外部门槛最终阻塞，按目标工具三次连续阻塞审计规则处理，不自行暂停。

## 8. 建议的下一轮并行职责

在用户授权恢复后，仍可用8–10个继承主配置agent，按完整闭合切片分工：

1. 类型与integration总协调、最终arch/type错误（不放宽baseline）。
2. Checkpoint Host engine/provider journal。
3. Checkpoint文件plan/retry/legacy/移动交互。
4. MCP + CLI管理/剩余provider runtime。
5. /operator AppService +桌面consumer +relocate。
6. automations/reminders/remote事件调度。
7. GitHub/worktree及外部服务遗留Rust注册。
8. attachments/media/SSRF/项目读取/独立窗口接线。
9. UI/current failing fixtures/边界余项（如需）。
10. client/compatibility/outbox/隐藏poll与API allowlist集成审查（如需）。

`host/server.ts`仅由一个整合owner管理结构，其他人通过独立service+精确小patch；`host/engine.ts`同理。Rust `lib.rs`注册删除只给一个owner，别让多人同时跑完整Cargo套件造成锁等待。

## 9. 便于起步的命令（不包含构建）

```powershell
git status --short
git rev-parse HEAD
Get-Content AGENTS.md

# 类型检查：源码稳定时，分别保留输出，不将旧日志当新结果
npx tsc --noEmit
npx tsc --noEmit -p host/tsconfig.json

# 基线检查只能收紧，不可--update接受新增
npm run check:arch
node --test scripts/arch-baseline.test.mjs

# 根据正在完成的切片选现有测试；不要一开始全库
npx vitest run --config host/vitest.config.ts host/checkpoint-rebase.test.ts host/legacy-checkpoint-import.test.ts
npx vitest run --config host/vitest.config.ts host/session-submissions.test.ts host/inbox.test.ts
npx vitest run src/features/connections/model/hostSessionSubmission.test.ts src/app/controller/useSessionSubmission.test.ts

# Rust有更改时按AGENTS要求；先确认没有其它cargo检查进程
npm run check:rust

git diff --check
```

最后提醒：这个任务最容易犯的错误，是把“原来本地路径现在被guard挡住”“按钮被隐藏”“旧测试mock改了”“没有静态跨边”当成实现完成。必须确认Host替代可达、产品功能仍存在、持久化和故障路径正确、旧数据可恢复，以及最终自动/真机证据范围与声明一致。
