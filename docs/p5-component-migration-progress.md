# P5 基础组件统一进度

分支：`feat/ripple-stack`。依据：`AGENTS.md`、`C:/Users/wy/.claude/plans/velvety-brewing-noodle.md` 和用户提供的 P5 五步原任务。不提交、不推送、不构建。

## 第 1、2 步：弹层与对话框

- Popover、MenuPanel、MenuSubmenu 和 Modal 已接入 Radix；保留原生宿主、可见性、退出动画、窗口标记及菜单尺寸规则。
- RemoveProjectDialog、SwitchBranchDialog、AddRemoteProjectDialog、AppViewDialog 已迁移。QuickOpen 的 Dialog 外壳已迁移，cmdk 属于第 3 步。
- ImageLightbox 是独立模态预览，已接入 Radix Dialog，保留缩放、拖动、切图、原生 Back、退出动画和隐藏状态。手势内容在 Portal 内挂载，以保证初始化时节点存在；绘制回调保持稳定，使重渲染后的待执行帧也能在卸载时取消。
- BtwSheet 是会话 pane 内的非模态侧问答面板，使用原会话的 composer、局部 Escape 与形变动画，不替换成全屏模态 Dialog。
- MobileSheet 是移动端专用表面，包含 bottom/dialog/anchor 三种呈现、拖拽、键盘避让、安全区、原生 Back 和外部输入框焦点保留；保留其平台控制器，不以通用 Dialog 覆盖。
- McpServerPicker 是 Composer 内嵌选择器，外部 composer 提供位置，不迁成独立模态弹窗。基础控件归入 sessions 批次。
- 其余 `role="dialog"` 调用主要位于已迁移的 Popover/MenuPanel 中，不能只按属性关键词重复套模态层。

兼容复核：Popover 的 `minHeight` 仅保留调用签名，旧的翻转阈值已由 Radix 根据实际尺寸进行碰撞处理替代，并非 CSS 最小高度保证。AppViewDialog 的嵌套测试使用真实 Radix Dialog；隐藏 fixture 显式设置 `tabIndex=-1`。Portal 测试查询 document，定位等待异步布局，Escape 从焦点元素冒泡，关闭后等待退出卸载及焦点恢复。

本轮验证：ImageLightbox 22、BtwSheet 17、MobileSheet 41、useMobileSheetFocus 10、Popover 21、AppViewDialog 3，共 114 条 Vitest 通过。Chromium 弹层回归 5 条通过，包含图片预览焦点限制、逐层 Escape 和焦点归还。`tsc --noEmit -p tsconfig.json` 通过；`check:arch` 仍为原任务已知的 settings/providers 10 条违规，未修改基线。WebKit 和原生桌面本轮未验收。

## 第 3 步：命令面板

- 已通过 curl 获取 `radix-nova/command.json`，手工适配 `primitives/Command.tsx`，使用项目 cn、图标、i18n 和 Dialog，未运行 shadcn CLI。
- QuickOpen 使用 Command + CommandDialog，保留 Files / Commands / Sessions / Projects、原排序、命令注册表接口、Mod+Enter、焦点恢复后执行命令。App 层传入 HarnessIcon，复用已有会话标题处理，不增加 feature UI 交叉依赖。
- SearchableSelect 使用 MenuPanel（Radix Popover）+ Command，保留 API、异步选项、禁用项、分组、Tab 提交、子菜单和菜单尺寸。cmdk 接管方向键、Home/End、Enter 和活动项。
- cmdk 1.1.1 的实例适配：CommandItem 仅在所属列表内滚动，卸载恢复实例方法；CommandList 同步受控值/异步选项变化后的 ARIA 活动项。没有修改 DOM 原型。升级 cmdk 时需重新核对这两处适配。
- 5 个相关 Vitest 文件 46 条通过，另有 quickOpen 模型测试 9 条通过。SearchableSelect 原 4 条断言保留，仅补全 ResizeObserver fixture 的 unobserve。Chromium 弹层 5 条及新增子菜单键盘回归 1 条通过。tsc 通过；架构检查仍只有已知 10 条违规。

## 第 4 步：按 feature 迁移基础控件

- search 批次完成：SearchView 的搜索框、筛选与结果按钮迁入 Input/Button，类名改为 cn。目录 6 个测试文件、48 条通过，tsc 通过；架构检查只有已知 10 条。
- notifications 批次完成：3 个 UI 文件的剩余控件迁入 Input/Button，类名改为 cn。分类展开面板按站立规则接入 AnimatedCollapse，覆盖打开、关闭、快速反向切换、关闭期间 inert 与退出卸载。测试不再读取尚未展开的隐藏控件；Escape 从焦点元素冒泡。
- notifications 目录 76 条中 74 条通过，`projectNotificationFlow.test.ts` 的以下 2 条在独立 HEAD `6c29f15` 检查目录同样失败，断言位置与结果一致，并非本轮引入：`restores a timed mute from storage on remount and expires without replaying missed sounds`（198 行）；`bulk mutes through Settings and resumes just one project without losing unread items`（222 行）。两者均为 `isInboxEntryUnseen` 期望 true、实际 false。独立目录已清理，未 stash 或改动用户已有工作。tsc 通过。
- automations 批次完成：16 个按钮、3 个输入框与 8 处模板 className 已迁移；删除操作按钮的旧样式常量，菜单行使用共享尺寸，补齐菜单与触发器子菜单的 Escape 焦点归还。目录 37 条 Vitest 及 2 条样式边界检查通过；Chromium 深浅色各 1 条通过，覆盖模板卡片、运行历史网格、标题输入、24px 菜单行及关闭后的焦点。tsc 通过。
- notes 批次完成：11 个按钮、3 个输入框、1 个文本框与 4 处模板 className 已迁移。目录 60 条 Vitest、tsc 通过；Chromium 深浅色各 1 条通过，验证源码输入与高亮的起点、字体、行高及切换预览后草稿保留。
- skills 批次完成：12 个按钮、2 个输入框、1 个文本框与 7 处模板 className 已迁移；保留创建表单、斜杠菜单键盘/鼠标选择和预览折叠控制器。菜单行删除局部高度、内边距，使用共享 menu token；范围按钮增加 aria-pressed。目录初跑 79 条中 78 条通过，旧定位测试改为等待 Portal、分别查询 Radix 定位层与弹层宽度后，该文件 3 条全部通过。tsc 通过。已读项目 Motion skill，并通过 `https://motion.dev/llms.txt` 阅读免费 Motion component、AnimatePresence、Accessibility 文档；本批未改写动画实现。
- providers 批次完成：4 个按钮、9 处模板 className 已迁移。运行 UI、harnessUpdates 与 accountUsage 相关 4 个测试文件，20 条全部通过；tsc 通过。没有执行 CLI 更新或账号操作。
- workflows / terminal 批次完成：workflows 的 12 个按钮、3 处模板 className 已迁移，保留共享 AnimatedCollapse、会话图标/标题处理及业务回调；terminal 只将 1 处类名拼接改为 cn。workflows 目录 47 条、ProjectTerminalDock 的 10 条，共 57 条 Vitest 通过，覆盖终端折叠期间保持挂载及禁用隐藏交互；tsc 通过。

共享控件适配：Button 新增 `size="content"`，卡片/网格行/菜单保留调用方布局，复用主题、禁用、焦点和选中反馈；常规操作仍使用标准尺寸。Input 的 `variant="inline"` 用于标题及嵌入式搜索；Textarea 的 `variant="editor"` 保留编辑器尺寸、高亮叠层及手动自适应逻辑。桌面表单规则按明确变体分流，不再强制这些控件采用普通表单的背景、内边距、字体和高度。浏览器夹具位于 `tests/browser/p5-controls.*`，RPC 仅返回离线数据。

本轮六个目录及样式边界共覆盖 255 条 Vitest，最终均通过（不重复计算重跑项）；清理旧图标按钮样式后，3 个相关 UI 文件的 66 条回归也通过。各批架构检查均仅报告既有 settings/providers 10 条违规，没有更新基线。最终 tsc 通过。Chromium 合并回归首次为 3/4：首个用例在 page.goto 的开发服务器冷加载阶段超时，trace 同时包含行尾整理触发的样式热更新，未执行控件断言；完成所有源码整理、结束类型检查后，在无源码修改的重跑中 4/4 全部通过。此结果不代表 WebKit、原生桌面或性能延迟验收。

### 接续批次与验证

- orchestration 完成控件与 cn 迁移，任务详情、代理详情和额外任务接入 AnimatedCollapse。目录 98 条通过；补充关闭保留、inert、快速反向与退出卸载断言后，OrchestrationFlow 的 10 条再次通过。tsc 通过。
- connections 完成控件与 cn 迁移，保留文件树键盘、重命名、编辑器几何和菜单 token。UI 首跑 195 条中 184 条通过、11 条失败；独立 HEAD `6c29f15` 在 `.tmp/p5-head-check` 完整复现同 11 条失败。面包屑测试补齐 QueryClient 缓存隔离后 4/4 通过，修复其中 2 条测试污染问题；最终为 186 条通过、9 条既有失败：RemoteTranscriptPacing 2 条（137 行）、FilePaneNavigation 3 条（165 / 226 行）、FileEditorCrlfGit 4 条（144 / 162 / 178 / 194 行，5000ms 超时）。最后按钮样式清理后的 9 条针对性回归通过；tsc 通过。独立检查目录已在核对路径与 node_modules junction 后清理，保留主工作区依赖。
- projects 完成控件与 cn 迁移；排序使用 SearchableSelect，新增真实排序结果测试；背景强度使用共享 Slider，并验证键盘调整和保存。更新旧 Modal 查询后，相关 21 条测试通过；tsc 通过。Slider 按 radix-nova registry 和当前 Radix 文档适配，位于 `shared/ui/forms/Slider.tsx`，保留值域、键盘、触摸与 ARIA 值文本。
- quick-composer 完成控件与 cn 迁移；推理强度复用 Slider，删除 QuickModelSelector 的原生 range 样式。112 条相关测试最终通过：修正遗漏的 cn 导入，Escape 测试从焦点元素冒泡，图片粘贴测试由固定 30ms 改为等待实际结果（该项独立 HEAD 13/13 通过，繁忙首跑暴露原固定等待的不稳定）。tsc 通过。

- workspace 完成控件与 cn 迁移，工作树开关使用共享 Checkbox。126 条相关测试最终通过；修正 SessionTitleMenu 在 RHF 提交回调内重复检查 isSubmitting 而跳过实际重命名的问题。测试按 Portal、完整点击序列、焦点冒泡 Escape 和退出卸载验证，tsc 通过。
- source-control 完成控件与 cn 迁移，统一菜单行尺寸；UnifiedDiffView 的文件披露接入共享 AnimatedCollapse，保留审查内容和虚拟化。147 条相关测试最终通过；修正旧弹层尺寸、Escape、RHF 异步断言和过宽文件夹选择器。521 条提交分页单项延长到 15 秒后约 5.3 秒通过，未减少内容；其他失败项复跑通过。tsc 通过，架构仍仅既有 10 条。


- settings 完成控件与 cn 迁移，滑块使用共享 Slider 并删除原生 range 样式；Checkbox 和 MCP 范围选择使用共享控件。126 条中最终 111 条通过，15 条既有失败在独立 HEAD 完整复现：QuickComposerShortcutEditor 8 条、SettingsView 6 条、ProviderAccounts 1 条。修正新复选框导致的测试按钮索引、ResizeObserver fixture 与失效节点查询后，9 条针对性测试通过；tsc 通过。
- bots 完成桌面控件与 cn 迁移，Checkbox / Radio / 团队负责人选择复用共享控件；头像对话框初始焦点改用 Portal 挂载后的 onOpenAutoFocus。210 条中最终 203 条通过，7 条 BotChat / attachments 既有失败在独立 HEAD 完整复现；对话框、团队、权限与关注项目回归通过，另有 Modal 相关检查通过。保留隐藏文件上传 input 和 BotSettings 的移动端原生 select 回退；未修改移动端目录。
- inbox 完成控件与 cn 迁移，项目选择使用 SearchableSelect，移除 inboxActions 旧按钮样式层；详情/描述/评论高度使用共享折叠逻辑。92 条中最终 87 条通过，5 条 InboxNotificationIndicators 未读指示器失败在独立 HEAD 同样复现。修正 Portal 搜索焦点和旧同步 RHF 断言后，45 条针对性回归通过；tsc 通过。

- sessions 完成控件与 cn 迁移；保留 Composer、模型/权限/内嵌 MCP 选择器、问题提交和转录逻辑，额外代理、长消息/插话和 CI 上下文复用 AnimatedCollapse。包含 Worktrees 的首跑共 854 条（73 文件）：810 通过、40 失败、4 跳过；修正结构/菜单密度/Portal 断言后，迁移相关失败均已消除。粘贴重发测试改为等待实际附件结果，SessionStatusUsage 补齐 QueryClient 隔离；最终 822 条通过、28 条既有失败、4 条跳过。既有失败为 Composer.pasteImage 22 条（git_branches 测试桩结构缺失）、AgentTranscript.promptRise 6 条（动画断言），均在独立 HEAD 6c29f15 复现；原 SessionStatusUsage 的 1 条缓存污染同样在 HEAD 复现，隔离后通过。最终针对性 4 文件 93 条通过。

### 最终 AST 数量


统计生产 `.tsx` 的 JSX 原生标签与直接模板字符串 className，排除 test/spec；统计器位于 `.tmp/p5-control-inventory.mjs`，详细文件结果位于 `.tmp/p5-control-inventory.json`。此表为 JSX 原始数量，已区分文件上传、原生平台回退和共享控件实现。

| feature | button | input | select | textarea | 模板 className |
|---|---:|---:|---:|---:|---:|
| automations | 0 | 0 | 0 | 0 | 0 |
| bots | 0 | 1 | 1 | 0 | 0 |
| connections | 0 | 0 | 0 | 0 | 0 |
| inbox | 0 | 0 | 0 | 0 | 0 |
| notes | 0 | 0 | 0 | 0 | 0 |
| notifications | 0 | 0 | 0 | 0 | 0 |
| orchestration | 0 | 0 | 0 | 0 | 0 |
| projects | 0 | 0 | 0 | 0 | 0 |
| providers | 0 | 0 | 0 | 0 | 0 |
| quick-composer | 0 | 0 | 0 | 0 | 0 |
| search | 0 | 0 | 0 | 0 | 0 |
| sessions | 0 | 0 | 0 | 0 | 0 |
| settings | 0 | 0 | 0 | 0 | 0 |
| skills | 0 | 0 | 0 | 0 | 0 |
| source-control | 0 | 0 | 0 | 0 | 0 |
| terminal | 0 | 0 | 0 | 0 | 0 |
| workflows | 0 | 0 | 0 | 0 | 0 |
| workspace | 0 | 0 | 0 | 0 | 0 |
| 合计 | 0 | 1 | 1 | 0 | 0 |

features 剩余原生控件共 2 个、直接模板 className 0 处。例外：DesktopBotsLegacyChrome 的隐藏文件上传 input 保留文件选择能力；BotSettings 的 mobile Picker 原生 select 作为平台回退保留，移动端传入的专用 Picker 仍优先。已减少用户接续清单中的 628 个裸控件和 343 处模板 className。

feature 外未纳入本轮：app 35 个原生控件 / 37 处模板 className，mobile 154 / 4，shared 22 / 6（含共享控件内部原生实现）。全 src 原始计数为 213 个原生控件、47 处模板 className；不能把这些计作本轮尚未迁移的 feature 控件。

## 第 5 步：收尾

第 1–4 步的 feature 迁移和原生例外分类已完成。Slider 直接复用 Radix，无新增依赖；原生 range 的旧样式已删除。表单使用 shared/ui/forms，布局卡片/行使用 Button 的 content 尺寸；应用文字保持 i18n，移动端/Host 原有修改保留。

最终验证：tsc 与 git diff --check 通过；check:arch 仍报告原有 settings/providers 10 条违规，未接受新基线。相关 Vitest 按目录执行，既有失败的 HEAD 对照与修复的测试污染已逐批记录；未运行全仓库测试。

Chromium 14 个回归用例最终全部通过：8 条控件用例覆盖深浅色、滑块键盘与提交、Checkbox、cmdk 菜单及焦点、额外代理/CI 上下文/统一 diff 双向折叠和 reduced-motion；6 条弹层回归覆盖嵌套 Escape、退出卸载、焦点恢复和原生宿主布局夹具。初轮为 13/14，首个自动化用例在点击前滚动阶段超时，trace 同页出现 Vite 客户端重连；不能据此断言具体根因。未改自动化组件，单独重跑该用例通过（43.8 秒）。截图另发现 Bots 群聊输入框沿用普通表单最小高度，改为 editor 变体并增加高度/透明背景断言后，深浅色均通过；复跑共 3/3，截图已人工检查。

最后一次 tsc 和 git diff --check 通过。浏览器使用 Vite 开发服务器，未执行构建。WebKit、原生桌面运行时和真实输入到呈现延迟仍未验收。

所修改代码保持 CRLF。未推送、构建。独立 HEAD 检查工作树已清理；已有 host/server.ts、host/server.test.ts、移动端抽屉/样式及 mobile-reference.verify.mjs 改动不属于本轮迁移，保留原样。

视觉跟进：按用户截图移除转录顶层/内层活动、思考、子代理、工具详情等折叠标题的悬浮及展开背景；状态卡标题同样处理。右侧 PromptOutline 只保留定位短横线，去除按钮在悬浮和 aria-current 状态下的背景。保持焦点提示与普通菜单按钮反馈。新增真实 WorkFoldLine、ActivityPhases、SessionStatusPanel、PromptOutline 夹具，Chromium 深浅色 2 条通过；AgentTranscript 37 条、tsc、git diff --check 通过。此前仅测通用标记样式，未覆盖内层组件和定位条，已补齐。
