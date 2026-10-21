# P3 客户端状态迁移完成记录（2026-10-21）

状态：**P3 已完成**，分支 `feat/ripple-stack`。实现范围按原路线的三项执行：移除仿 Zustand、用 Zustand persist 承接偏好状态、从工作区控制器渐进拆出 slice。P4–P9 未在本阶段展开。本阶段按用户授权单独进行本地提交，未推送。

## 完成范围

| 范围 | 结果 |
|---|---|
| Zustand 基础 | 使用已安装的 Zustand **5.0.15**。旧 `_shims/zustand.ts` 已随 P2 删除，复扫没有旧 shim 调用点。 |
| 偏好持久化 | `shared/lib/persistedPreferences.ts` 提供基于 vanilla store + `persist` 的存储适配；`preferenceStorage` 直接接入，沿用 Host 路由和旧键值格式。settings、appearance、typography、agent defaults、项目/会话偏好等既有读写入口均由该适配持久化。 |
| 设置订阅 | 模型控件、Notes、Live Agents、diff、autosave、菜单栏、快捷键、邮箱遮罩、额度显示、代码主题、编辑器、侧栏区块及排序使用 Zustand 订阅。保留业务校验和原生/DOM 外观应用动作，删除对应的手写订阅集合，替换以事件为数据通知来源的实现。 |
| 项目与会话 | 项目 Provider 设置、项目树、最近/归档项目、标签名、会话文件夹与顺序、状态卡、计划跳过、正文跳转、worktree focus 已迁入 Zustand。按项目筛选通知，不因另一个项目的文件夹变化而刷新当前列表。 |
| Inbox 与通知 | 已读标记、关联会话已读、自身操作记录、CI 修复跟踪、项目通知偏好与目录采用 Zustand/persist。保留静音到期定时器、200/500 条预算，以及写入失败时的恢复信息。自身操作的消费不会递归触发通知处理。 |
| Bots / workflows | Bot 记忆草稿按 Host 工作区持有独立 vanilla store；未读水位保留失败时的单调回退。工作流确认使用 persist 保留原数组格式和 256 条插入顺序预算，删除旧已读 store，调用方使用新的确认动作。 |
| 移动端 | 输入草稿、会话投影和可见正文回执改为 Zustand。保留低 revision 拒绝、离开页面时冻结输入值、已渲染回执与网络接收分离。连接别名/图标、触觉、皮肤、Home 范围、上次位置和旧版代理默认值接入设备本地 persist。 |
| 工作区控制器 | 新增按窗口创建的 `workspaceUiStore`，组合导航/文件搜索与命令面板两个 slice。保留函数式更新和稳定动作引用，无变化更新不通知，窗口之间不共享弹层状态。 |

## 持久化与同步约定

- 不增加 Zustand JSON 外层包裹，不改键名；已有客户端、Host 字段 codec 与旧数据可继续读取。
- Host 写入先进入原有持久化 journal，再发布 Zustand 状态。普通保存失败不发布成功状态；只有明确支持临时生效的偏好保留窗口内值。
- `storage`、Host 激活和项目路由切换触发 rehydrate。外部值、缺失键和清空事件会更新订阅者，hydrate 不反向生成上传操作。
- 相同值和无关的键不通知；同步回调中再次编辑时，以最新成功写入为准，每次逻辑写入只持久化一次。
- `Map` 仅用于注册 store 身份；偏好值及订阅由 Zustand 持有。公开给 React 的 store 只暴露读取与订阅，写入经过保留原事务边界的动作。
- 保留 load/save 函数中的解析、归一化、校验和领域副作用，它们操作新的持久化状态；没有同时保留一套旧数据 store 或 shim 转发层。

实现前查阅了当前官方 [persist 文档](https://github.com/pmndrs/zustand/blob/main/docs/reference/middlewares/persist.md) 和 [slices 文档](https://github.com/pmndrs/zustand/blob/main/docs/learn/guides/slices-pattern.md)，并核对了本地安装版本的类型与实现。

## 保留的边界

以下不是另一个待迁移的偏好 store，也不以剩余 `useSyncExternalStore` 的关键词数量判定 P3 是否完成：

- `SharedPreferenceStore`、Host workspace/connection journal、离线 outbox：承担 revision、操作 ID、重试、持久化优先和协议路由。客户端偏好使用其 storage 适配，不改写同步协议。
- Query/QueryObserver 的远程数据、会话投影调度、原生会话访问租约、CLI 安装任务、文件 watcher、PTY 和 Worker 池：各自保留资源与订阅生命周期，不引入一份 Zustand 远程数据副本。
- 键盘几何、resize 清理、时钟、媒体查询、流式正文调度以及已应用主题/原生 zoom 的事件：是浏览器/原生资源或展示副作用。主题机制本身仍属于 P8，拖动算法与性能验收属于 P7。
- 表单交互草稿、组件内部临时状态仍使用 useState。控制器中的 sessions/tabs、原生资源和异步导航事务继续由原有领域 hook 协调，按路线渐进拆分，没有把整个控制器搬进进程级单例。
- JSON 解析、主题 palette、图片/高亮等纯计算缓存可保留；它们不是另一份可编辑的全局客户端状态。

## 验证

只运行相关 vitest（**3.2.7**）及类型/架构检查。以下批次有重叠，不应直接相加作全仓用例数：

| 专项 | 最终结果 |
|---|---|
| 持久化适配、Host 偏好集成、sharedPreferences、settings flags、displayPrefs、窗口 slice | 6 文件 / 154 用例通过。覆盖旧格式、删除、跨窗口、Host 切换、无回写、quota、非 DOM 环境、写入先于发布以及同步重入。 |
| 设置、代码主题、语言、项目 Providers、模型目录、通知和 Inbox 数据模型 | 对应相关用例通过；通知/项目树测试补充了真实外部值变化和同值去重。 |
| 项目树、recents、tabGroups、sessionFolders、通知目录、Bot 未读 | 相关专项通过；sessionFolders 36、recents 20、tabGroups 28、通知偏好 7、通知目录 7、Bot unread 2。 |
| Host 偏好及草稿 | hostPreferences 5、DesktopBotMemory 3、sessionSnapshotStore 4、MobileHapticSettings 3 通过。 |
| 工作流、worktree | 工作流确认新增 2、WorkflowSidebarSection 6、worktreeFocus 3、SidebarWorktreeSwitcher 13 通过。 |
| 项目背景 | 本地 7、共享 Host 3 通过；覆盖多个订阅者只推进一次图片 revision。 |
| 桌面控制器 | App.appViews 仅运行侧栏设备隔离、导航展开/折叠与 Search Escape 三条，均通过；未宣称其完整套件通过。 |
| 移动端与编辑器 | multiDevice 14、sessionLoading 45、agentDefaults 20、DesktopBotsButton 8、FilePane.appView 1 通过。流式文本更新不提交应用壳的既有断言通过。 |
| Host 协议 | 直接运行 `npx vitest run --config host/vitest.config.ts host/client-state.test.ts`：6 用例通过。 |

- `npx tsc --noEmit -p tsconfig.json`：通过。
- `git diff --check`：通过。
- `npm run check:arch`：仍只有用户已知的 providers 设置目录 10 条违规，没有新增或放宽基线。
- `connectionSettings.test.ts`：24 条通过，扫码配对一条失败。已用 `git stash -u` 在干净 HEAD `a7a45bc` 上对照，得到相同的 `host.connect` 调用次数断言失败；恢复全部工作区改动后删除临时 stash，未把它计为 P3 新增失败。
- 首次调用 `npm run test:host` 时发现其 `pretest:host` 会进入构建链，立即中止，改用上面的直接 vitest 命令。未将前置步骤计作构建验证，没有打包、发布或推送。
- 未做原生桌面/移动真机端到端验收或拖动输入到呈现 P95 测量，不宣称这些场景已验收。

后续按原路线继续 P4；P3 没有待处理的迁移项。上述协议、资源和组件局部状态边界应保留，不要为了消除关键词继续重写它们。
