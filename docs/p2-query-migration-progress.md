# P2 数据层迁移完成记录（2026-10-20）

状态：**P2 已完成**。工作分支：`feat/ripple-stack`。本文件替代之前的“待迁移 / 待复核”清单；P3–P9 仍按原计划继续，不能把 P2 完成理解为整个技术栈迁移完成。

依据：`AGENTS.md`、用户指定的 `C:/Users/wy/.claude/plans/velvety-brewing-noodle.md` 及“包括底层 fileIndex 缓存及其他读取、写操作链”的补充要求。本次保留进入时的改动，按用户后续授权将 P0、P1、P2 分别本地提交；属于 P3 的改动保留在工作区。未推送、构建或发布。

## 数据层约定

- 桌面 `src/main.tsx`、移动端 `src/mobile/main.tsx`、quick-composer 入口均挂载 `QueryClientProvider`，复用 `src/shared/lib/queryClient.ts` 的唯一实例。hook 仍显式传入第二参数 `queryClient`。
- Query 拥有远程/文件读取的数据、去重、错误、加载和轮询；命令式读取通过同一 client 的 `fetchQuery`，非 React 订阅通过 `QueryObserver`。外部变化统一沿 `invalidateAfterChange` 失效。
- 写操作由 mutation 承接，沿用 Sonner 和已有内联错误。保留用户草稿、确认步骤、命令 ID、失败重试与不可重复执行的事务边界；不把轮询失败变成重复的弹出通知。
- 原生 IPC 取消不等于物理中止后端操作。身份、修订和 AbortSignal 检查继续阻止迟到结果覆盖新 Host、新工作区或已确认写入。
- Query 不进入 Host、provider runtime 或共享协议实现。原生资源、离线写入日志、编辑状态和纯计算缓存的保留范围见后文。

## 按 feature 的完成清单

| 范围 | 已完成的读取 / 缓存 / 写操作链 |
|---|---|
| connections/files | `fileIndex` 去除数据 Map 与 in-flight 缓存；Query 共享索引并保留 8 项 LRU。目录树、文件内容/字节、编辑器、搜索与提及统一消费 Query；目录变化、创建、重命名、删除和保存沿同一失效链处理。保留 CRLF、watcher、文件资源租约与草稿。 |
| connections | 机器列表、Host 描述符/渐进模型目录、在线探测、环境列表、配对地址、设备列表和目录浏览迁入 Query。SSH 设置轮询、配对签发/撤销、环境创建、项目打开使用 Query/Mutation。 |
| connections/session | `connections.ts` 的机器缓存、会话历史 Map、请求 Map、历史及在线状态轮询均已移除。折叠会话历史从 Query / 持久化快照恢复；换项目/Host 拒绝迟到结果。会话同步分块的请求共享由 Query 管理，仍按 revision 串行；RemoteSession 的命令、显式刷新、附件上传/读取均覆盖。 |
| source-control | branches、worktrees、diff stats、file statuses、PR/HEAD/range、提交详情、审查文件索引与 diff 缓存迁入 Query。GitGraphDialog 使用 infinite query 保留分页深度、重复页检测与 HEAD 变化保护；ReviewSourceSelect 的提交菜单共享读取。分支切换、worktree 创建/删除、stage/discard、Keep/Undo 使用 mutation。 |
| sessions | 图片、笔记图片、链接预览、模型/技能/MCP 提及目录、Worker 会话与原生会话 discovery/access 接入 Query。Composer 附件处理、登录、额度重置、添加账户、后台任务停止、历史问答、消息队列和保存笔记接入 mutation。会话正文仍通过既有快照投影更新，保留流式渲染性能。 |
| sessions/data + app/model | `sessionCache` 和 `WorkspaceSessionData` 的保留会话/加载缓存改为 Query；保留 12 条 / 32 MiB 预算、请求共享和自动保存竞态防护。`projectHistoryLoader` 使用 Query。原生会话发现和所有权探测使用 Query/QueryObserver，导入/同步操作由 mutation 承接。 |
| bots | BotChat、DesktopBotsWorkspace、活动、内存、委派、IM、运行设置、线程设置、房间、团队、自动化、接收者、话题笔记均已覆盖 Query/Mutation。BotRoom 增量消息、旧页读取和取消轮次保留游标保护。未读/桌面入口轮询、Bot 来源解析和附件落盘缓存迁入 Query；重试使用原命令 ID。 |
| inbox | InboxView/Detail、评论/讨论、PR 概览/检查/证据源代码、修复工作流与关联事项刷新已覆盖。GitHub、Linear、Jira、GitLab、Azure DevOps 底层列表及详情缓存去除手写 Map/in-flight；账号切换取消旧读。媒体缓存保留 32 MiB 预算与 active observer 保护；未读通知使用 Query 轮询并保留通知去重投影。 |
| notes / skills / search | 笔记、技能 catalog 和文件索引的外层、底层均使用 Query；NotesView 保存/删除/加入聊天接入 mutation，自动保存串行队列保留。QuickOpen、SearchView、ProjectSearch 与 Composer 提及不再建立第二份加载缓存。 |
| providers | 额度/账号使用量、身份、共享账号元数据、DeepSeek 状态、CLI 可用性/版本/安装计划与更新检查迁入 Query。共享账号去除 loading Promise，使用 QueryObserver；保留 revision 防回退和离线公共身份缓存。设置写入、登录、CLI 安装/卸载/更新由 mutation 管理。 |
| settings / projects | MCP discovery/health/inspection、TitleModel、系统字体、GeneralPage 版本/更新/权限、Inbox 集成设置与项目删除计数已覆盖 Query。TitleModel、MCP、集成设置、项目删除上层写操作已覆盖 mutation。背景资源下载去掉 Promise 去重缓存；原始背景图片读取也使用 Query，资源与 Worker 生命周期保留。 |
| notifications | `useSessionReminders` 的列表读取、配置、schedule/cancel/open 已覆盖 Query/Mutation；配置修订与串行提交顺序保留。项目通知偏好和已读标记属于客户端偏好，见保留范围。 |
| workflows | 三条产物 hook（列表、bytes、增量 data）、保存工作流列表/运行历史/详情迁入 Query；删除旧 `savedWorkflowStore.ts`，不留转发层。启动、元数据保存、删除、移动、提升、运行取消/恢复/配置由 mutation 承接。Host 会话监视器移除数据 Map、ref-count 手写定时器，以 QueryObserver lease 管理。 |
| mobile | Host 探测、目录、共享连接、配对连接、Bot 列表/创建、归档、笔记、文件、项目选择、工作区选择、账号使用量、默认模型、技能、更新、活动和未读使用 Query/Mutation。Git 索引/单文件 diff、会话 Keep/Undo 亦已覆盖。 |
| mobile/client + controller | 模型/项目/摘要/会话/图片预览的数据与加载 Map 已迁入 Query，保留有界 LRU、离线持久化和 epoch 防串 Host。活动、会话投影、原生所有权与连接心跳轮询使用 Query；仅更新协议投影的轮询关闭无用状态通知。UI 写操作（含 transient queue dispatch）、连接切换、上传、worktree、会话元数据均由 mutation 承接。 |
| app / quick-composer | 三端 Provider 完成；自动更新探测/安装、托盘会话读取、默认工作目录、项目移除和 quick-composer 提交/附件链已覆盖。托盘只在菜单实际变化时调用原生更新，安装前取消旧更新探测，防止迟到结果覆盖下载进度。 |

## 复扫后保留的状态及原因

原审计的“82 / 88 个文件”是静态关键词命中，不是尚未完成的文件数。本轮继续扫描 `setLoading/setChecking/setPending/setBusy`、异步 effect、Promise/Map 缓存、定时器以及实际 fetch/invoke/RPC 调用链；以下命中不再列作 P2 待迁移项。

| 保留项 | 归属与原因 |
|---|---|
| `hostWorkspace`、`hostConnections`、`sharedPreferences/hostPreferences`、移动端 pending journal | 跨设备同步/离线 outbox：保存未确认操作、revision、串行写入、重试与持久化。定时任务包含补交写入，并非 UI 读取缓存；偏好 store 的 Zustand 迁移属于 P3。 |
| `remoteProjects` 的本地项目身份映射/正在注册项目、`remoteSessionActions`、`remoteOutbox` | 地址/身份绑定、命令投递与幂等注册协调。普通机器、项目历史和会话读取已转 Query，不能删除写操作协调来替代缓存迁移。 |
| `useWorkspaceNavigation`、`useMobileAppController` 的 navigation/restore/loading、Sidebar 搜索/展开/hover 待办集合 | 客户端导航事务、恢复屏障与按需调度；实际数据读已沿 `WorkspaceSessionData`、`projectHistoryLoader`、MobileClient、远程历史 Query 执行。保留会话确认/可写性、旧页面切换和输入草稿状态，避免把“导航结束”误等同于单次 RPC 结束。 |
| `sessionStore` 自动保存队列、NotesView 保存队列、checkpoint 队列、Agent App/quick-composer 启动回执 | 写入顺序、编辑版本和投递幂等，不缓存可 refetch 的远程读取结果；不改原有命令确认协议。 |
| `rateLimitsQueries/mcpSettingsQueries` 的 queuedRefreshes | 仅合并“当前请求完成之后再执行一次强制探测”的刷新屏障。数据、普通请求、错误与订阅均由 Query 管理；屏障不是原来的数据缓存。 |
| native lease expiry、编辑资源 claim/release、PTY/终端、CLI 安装/登录任务、桌面窗口 IPC | 原生资源/进程生命周期；释放、租约期限和事务内状态查询不由 UI 查询 GC 代替。UI 发起的安装/登录操作已在 mutation 内。 |
| 图片 Blob URL、背景 Worker / 高亮 / Mermaid / 动态模块加载缓存、代码主题 palette | 本地资源与纯计算缓存。原始文件/背景/媒体读取已由 Query 管理；保留 URL 回收、Worker 请求 ID、3 个背景版本的计算预算和模块初始化去重。 |
| 未读标记、通知发送去重、session snapshot/list 投影、provider streaming/catalog registry、orchestration runtime | 客户端展示状态、事件投影或 Host 共用运行协议。不能把协议状态改成可随时丢弃的查询结果，也不能把 Query 引入 Host 层。 |
| 表单草稿、校验、确认弹层、剪贴板即时捕获、选中项、展开/折叠、拖动/布局状态 | 非远程读取；表单与客户端状态继续按 P3/P4 及后续阶段迁移。没有借 P2 改动布局、动画 API 或拖动算法。 |

## 行为回归与验证

只运行相关 vitest 与 TypeScript/架构检查，没有运行全仓测试或构建。Vitest 实际版本为 **3.2.7**。下表是相应范围的最终通过结果，多个批次存在重叠，不能直接相加作为全仓用例数。

| 范围 | 结果 |
|---|---|
| 前序 fileIndex、fileTree、mentions、NotesView、SessionReview、Worker、连接及环境批次 | 已记录的 16 文件 / 235 用例通过；后续变化继续按相关文件验证。 |
| 前序图片、附件、登录、字体、项目计数、workflows 产物、CI/讨论批次 | 已记录的 20 文件 / 302 用例通过。 |
| Bot 设置/协作/习惯 | 21 用例通过；Bot 未读 2、桌面入口 8 通过。 |
| BotChat / MobileAssistant | BotChat 除用户已知 uncertain-settings-save 用例外 40 个通过；MobileAssistant 40 个通过。未将已知失败计为迁移新增。 |
| DesktopBots 附件/导航 | 7 用例通过，包含同 ID 不同线程附件隔离和旧 Host 接口。 |
| inbox 数据源 | GitHub 41、repositories 5、providers 24、Jira 7、Linear 4 通过；最后补查的 githubWorkItemFreshness 5 通过，覆盖账号切换及 PR 状态写回。 |
| inbox 媒体/未读/检查 | media 13、unseen 10、InboxPrChecks 16 通过。 |
| 远程连接 | remoteProjectSessions 16、remoteSessionSync 2、RemoteSession 77、remoteHostMetadata 4、ConnectionsPage 7、NewEnvironmentDialog 2 通过。 |
| 会话与原生数据 | WorkspaceSessionData 15、sessionCache 4、projectHistoryLoader 5、nativeSessions 11、NativeSessionsPanel 4 通过。 |
| 桌面写操作 | Composer 64、MessageQueue 13、UsageProviderChip 18、QuestionForm 12 通过。 |
| Git / 审查 | worktrees 41、BranchPicker 8、GitReviewPane 20、reviewDiff 20、useReviewSource 12、GitGraphDialog 8、ReviewSourceSelect 6 通过。 |
| providers / settings | providerAccountCredentials 16、TitleModelSettings 5、harnessUpdates 4、HarnessUpdateNotice 1、preferenceAssets 6、背景处理 4、项目背景处理 1 通过。 |
| MobileClient | clientLoading 22、clientOfflineCache 3、clientHosts 5、client 53 通过。 |
| 移动端目录/设置 | MobileBots 10、MobileProjectPicker 16、connectionSettings 25、MobileProviderAccounts 11、updates 22、assistant unread 5、agentDefaultsFlow 15 通过。 |
| 移动端状态/操作 | activityNative 10、activityUi 29、sessionActions 9、projectPickerFlow 5、multiDevice 14、MobileSessionActions 5 通过。 |
| 移动端本轮收尾 | sessionLoading 45、connectionStatus 8、useMobileSkills 8、useMobileGitIndex 3、mobileGit 5、MobileGitReview 22 通过。 |
| workflows / automations | 新增 SavedWorkflowDetailView 3、workflowSessionWatch 3 通过；WorkflowRunSidePane 6、automations model 15、view 3 通过。 |
| app 入口 / 更新 | 新增 useUpdateStatus 2、traySessions 3、BootRecovery 2、quick-composer main 2 通过。 |

重点回归包括：换 Host/工作区后迟到读取、命令不确定响应的原 ID 重试、写后旧读回退、局部目录失败、离线公共缓存、重复分页、翻页期间刷新、历史 turn 隔离、折叠时停止轮询、保留未编辑/已编辑草稿的不同刷新行为，以及流式正文更新不提交移动端应用壳。

新增的工作流详情测试覆盖后台刷新不覆盖脏草稿、切换工作流/工作区清除旧草稿、保存失败后重试、不同 service 的数据隔离和运行历史局部失败。新增会话监视器测试覆盖多 lease 共享请求、最后一次 release 停止轮询、离线旧快照、审批后刷新及迟到响应。新增更新测试覆盖首次失败后重试不触发自动安装，以及安装过程中拒绝旧探测覆盖。

最后一次读写链复核补齐 Inbox 的跨层失效：账号切换清除所有 provider 的底层数据，同时清空列表/详情和聊天 GitHub 预览的旧数据，取消旧读取并重新验证活跃视图；保留刚确认的 integration 连接结果。PR 写操作同步匹配链接预览的状态，并失效其详情。新增 3 个回归用例，JiraSettings 2、InboxIntegrationSettings 2、UserLinkPreview 4 及 providers/repositories 专项均通过。

- `npx tsc --noEmit -p tsconfig.json`：各批执行，收尾检查通过。
- `git diff --check`：通过。清理了本轮文件末尾多余空行；恢复重建的 useBotUnread 和新增测试的 CRLF。前序已经存在的其他 LF 文件没有为消除 Git 提示而批量改写。
- `npm run check:arch`：退出码 1，仍只有用户已知的 providers 设置目录 10 条（9 条 feature UI 跨层、1 条 Tauri 跨层）；没有新增违规，没有用 `--update` 放宽基线。
- 用户已知的 quick-composer 首条测试使用旧的固定组件层级。本次增加 Provider 后改为跨包装层检查 QuickWindow，仍验证 Host preferences/accounts 就绪前不能启用控件；两条现已通过。
- BotChat 的已知 uncertain-settings-save 失败保留。contrast、SidebarRename、App.appViews 等其余用户提供的既有失败不在本轮收尾测试范围内，未声称修复或重新验收。
- 部分既有集成用例会输出 act 或 Git IPC mock 返回 undefined 的警告；失败分支也会输出预期的错误日志。记录以最终测试退出码为准，没有屏蔽真实断言失败。
- 未做原生桌面/移动真机端到端验收、provider CLI 兼容性验收或拖动输入到呈现 P95 测量；未宣称这些场景已经达标。

## 后续阶段与维护注意

P2 的功能剩余项为零。后续按原计划处理 P3 客户端状态、P4 表单及 P5–P9；不要把上面的协议/资源状态误报为“遗漏的远程加载”，也不要恢复已经删除的 cache/store 转发层。

1. 复用同一全局 client；新增外部事件沿已有失效函数传递，避免同时添加第二个刷新入口。
2. Query 测试需隔离全局缓存；命中相同 key 的 fixture 在 beforeEach 中清理 client。通知调度为微任务，异步结果断言应等待 act/flush。
3. mutation 的 onSuccess 会收到多个参数，单参数业务回调用 lambda 包装，不直接透传。
4. 原生不可中止请求必须保留身份/修订防护。暂停/隐藏既不应杀掉 PTY，也不应让旧查询解锁原生会话写入权限。
5. 不为每条动态 query key 调用 setQueryDefaults；LRU 命中需显式更新访问元数据。数据缓存和计算/资源缓存的预算不要互相替代。
6. 用户随后已授权将 P0、P1、P2 分别提交；该授权不包含推送或构建。提交拆分保留属于 P3 的工作流已读状态和 worktree focus 改动。
