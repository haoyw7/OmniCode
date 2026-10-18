# OmniCode Personal Fork Development

This repository is the user's personal fork. Follow direct user instructions and
the existing architecture. Upstream issues, pull requests and maintainer approvals
are not prerequisites for local work.

## Project Rules

- Preserve unrelated work and use focused changes; avoid unsolicited refactors.
- Provider protocols live under `src/integrations/harness/providers/`; shared
  contracts live under `src/integrations/harness/core/`.
- Pi and OMP share `piFamily.ts`; verify both when changing shared behavior.
- Desktop and headless Host reuse adapters, but runtime image persistence differs.
- Keep optional question/image fields compatible with existing consumers and history.
- Localize application-owned text through `src/shared/i18n/`, using English UI text
  as keys and `zh-CN.json` for Chinese translations; preserve provider/user values.
- Session lists, including archived conversations, must show the corresponding
  agent icon before the display title instead of an agent-name text prefix.
  Reuse `HarnessIcon` and `sessionDisplayTitle` on desktop and mobile; strip only
  application-added prefixes for display, preserving stored titles and user text.
- Expand/collapse interactions MUST animate in both directions. Reuse
  `src/shared/ui/AnimatedCollapse.tsx` for vertical disclosure content and the
  exported `useCollapseMotion` plus `animated-collapse-size` styles for grid-sized
  panels; do not reimplement fold state/timers per view. Grid panels keep stable
  zero-sized tracks while closed and disable transitions during direct resizing.
  Running terminals stay mounted while hidden so collapsing never kills a PTY.
  Keep content mounted until closing finishes, disable hidden/closing interaction
  and portals, handle rapid reversal, and respect `prefers-reduced-motion`.
  Apply this rule to new or modified disclosure UI as a standing requirement;
  it does not need to be restated in each feature request.


## UI architecture

- Separate business logic, shared control behavior, and platform presentation.
  `src/shared/ui/` must not depend on features, business stores, Host, or Tauri.
- Import form controls directly from `src/shared/ui/forms/` and class utilities
  from `src/shared/lib/cn.ts`. Do not recreate workflow-local controls, forwarding
  exports, legacy button wrappers, or compatibility aliases. Compound controls
  and Radix surfaces live in `src/shared/ui/primitives/`; Select and InputGroup
  belong to `shared/ui/forms/`. The workflow-local `components/ui/` is removed.
- Use shared `SearchableSelect` for option lists; pass icons, loading callbacks,
  and menu presentation through props rather than duplicating keyboard/focus logic.
  Shared `PrivateEmail` receives `masked`; consumers read the preference. Shared
  surfaces import `GlassBackdrop` from shared UI, never from the app shell.
- Menu option heights are already standardized. Before adding or changing a
  dropdown, picker, or menu, inspect the shared control, `desktop-tokens.css`,
  and `desktop-controls.css`; reuse the existing menu density and
  `--desktop-menu-*` tokens for row height, line height, and padding. Composer
  environment options must match the project-folder picker option height.
  Do not add feature-local `height`, `min-height`, line-height, padding, or token
  overrides that change option height merely to match a reference screenshot.
  Screenshots do not override the shared sizing rules. Unless the user explicitly
  requests a different size, preserve the unified dimensions; remove obsolete
  local overrides instead of layering new overrides on top.
- Messaging presentation primitives live in `src/shared/ui/messaging/`: navigation
  items, assistant status, app headers/surfaces and loading skeletons accept slots
  and native props. Features own destinations, provider copy, loading and actions.
  Never apply app-card geometry to unrelated question/approval cards.
- OMB styles, components, tokens, and layout conventions have been removed. Do
  not reintroduce `shared/ui/omb`, `omb-*.css`, `--omb-*`, OMB layout classes, or
  a replacement global layer that overrides unrelated feature layouts.
- Desktop colors belong to `src/styles/desktop-theme.css`, dimensions and
  semantic control tokens to `desktop-tokens.css`, controls to `styles/controls/`,
  and surface layout to the corresponding `desktop-*.css` module. Mobile owns
  its presentation under `src/mobile/`; do not import desktop CSS into mobile.
- Style shared controls through explicit `data-ui` identities, with `variant`
  and `size` describing the control. Do not infer identity from `input.border`,
  generic ARIA roles, or unrelated utility classes. Business callbacks stay in
  their feature, and shared controls own keyboard, focus, state, and accessibility.
- Typography is shared in `src/shared/styles/fonts.css` and `typography.css`.
  Use bundled Source Sans 3 for UI, Source Serif 4 for serif reading, and
  JetBrains Mono for code. Keep their OFL licenses with the assets. Reuse semantic text/heading
  scales and normal/medium/semibold/bold weights; preserve user font settings
  and Chinese/terminal-icon fallback fonts. Do not duplicate platform font stacks.
- Mobile consumes the same shared form controls; appearance belongs to
  `src/mobile/styles/controls/` and `src/mobile/theme/controls.css`. Keep native
  keyboard, safe-area and gesture behavior in mobile controllers. MobileSelect
  owns the sheet presentation and uses shared Radio semantics. Do not recreate
  MobileSwitch, private icon buttons, bubble helpers, or catch-all form CSS.
  Conversation, composer and drawer styles belong to their existing surface
  modules; do not add a second override sheet for the same geometry.
- Remove obsolete call sites and styles when replacing a component; do not keep
  old implementations or forwarding layers for compatibility.

## 动画

- 编写 Motion 相关代码前，先阅读项目内的官方
  [Motion skill](.agents/skills/motion/SKILL.md)，并通过 Motion MCP
  (`https://mcp.motion.dev`) 或 `https://motion.dev/llms.txt` 查询并阅读当前文档，
  不要凭记忆编写 API。Skill 是操作指引，不能替代实时文档。
- 只使用免费、MIT 许可的 Motion；不引入 Motion+ 付费功能，跳过 `llms.txt`
  及 MCP 结果中标记为 paid 的页面和功能。本项目规则优先于 skill 中的通用建议。
- React 引入路径使用 `motion/react`，不使用旧的 `framer-motion`。
- 列表增删和排序使用 `@formkit/auto-animate`；hover、按压和 loading 点使用 CSS。
- 缓动曲线统一为 `[0.22, 1, 0.36, 1]`（CSS 为
  `cubic-bezier(0.22, 1, 0.36, 1)`）；时长：消息 `0.18s`、弹出 `0.2s`、面板 `0.24s`。
- 必须支持减少动态效果：Motion 使用 `useReducedMotion()` 或
  `<MotionConfig reducedMotion="user">`；CSS 和列表动画同样遵循
  `prefers-reduced-motion`，不要禁用 AutoAnimate 默认的减少动态效果支持。
- 展开/折叠仍遵循上面的共享 `AnimatedCollapse` / `useCollapseMotion` 规则。

## 面板拖动与重排性能

- 分隔线拖动复用 `ResizeHandle`、`useDragResize` 和 `paneResize` 的共享机制。
  临时尺寸放在 ref 中，移动时直接写 DOM 的 `flex`、`width` 或布局使用的 CSS
  属性；松手后才提交 React 布局状态和持久化。不得在每次移动时更新上层业务
  store 或重渲染聊天、文件树、审查列表。React 重渲染不得覆盖正在拖动的尺寸。
- 按下时缓存起始坐标、容器尺寸、比例和尺寸约束；移动路径以计算和必要的样式
  写入为主，避免写样式后立即读取几何信息。尺寸未变化时不重复写入。不得把
  debounce 或额外一层 rAF 当作默认优化；确需合并任务时，验证其输入延迟。
- 起始几何读取也必须在交互样式写入之前。统一光标和禁止文字选择复用
  `beginResizeInteraction` 的局部光标层；不得通过根节点继承变量或
  `html.is-resizing *` 改写全页面样式，以免按下瞬间重算所有正文和代码 token。
- 直接拖动期间关闭相关尺寸 transition 和 Motion 布局动画，结束后恢复；不得
  全局关闭正常展开/折叠动画。保留聊天最小宽度及既有覆盖显示行为。
- 使用指针捕获并处理松手、`pointercancel`、丢失捕获、Escape、窗口失焦和组件
  卸载；所有退出路径均须恢复光标、文字选择、临时样式和共享 resize 状态。
  验证分隔线命中区域、快速反向拖动和连续第二次拖动，避免残留遮罩或监听器。
- 终端拖动时保持 PTY 和终端实例挂载，文字必须随实际列数实时重排。fit、渲染
  尺寸样式及 PTY resize 应跳过无变化更新；异步 resize 应保留最新尺寸并避免
  旧请求覆盖新尺寸。不得以缩放截图、冻结内容或只在松手后重排作为性能修复。
- 聊天正文、语法高亮 token 和 diff 等密集内容的祖先不应随意增加尺寸查询
  container、继承型动态宽度变量或额外滚动容器；这些变化必须测量其重排成本。
  简单响应式断点优先复用 `useInlineBreakpoints`。审查 hunk 标题宽度复用
  `reviewSeparatorLayout`，使用 ResizeObserver 提供的尺寸并去重写入，避免
  为读取尺寸引入同步布局。不得盲目移除确有功能用途的 containment。
- 审查优化必须保留代码换行、语法高亮、行号对齐、上下文展开和操作按钮。
  控制虚拟列表 overscan 的渲染量，同时验证滚动和展开行为；不得靠漏渲染、
  折叠内容或隐藏正文取得性能数字。第三方内部补丁须局限于实例并可清理，
  不得全局修改 DOM 原型；升级依赖时重新验证补丁适用性。

### 性能验证与诊断

- 优先采用减法和单变量对照：同一窗口、内容、展开状态、尺寸轨迹和采样时长，
  交替运行基线与候选方案，记录样本数和 P95。HMR、Worker 初始化或虚拟化导致
  内容数量变化时，先核对实际渲染内容；内容缺失的采样无效。
- 测量真实拖动前先完成并清理源码注入，等待热更新和初始化稳定；采样期间
  不修改源码。记录 HMR、窗口焦点、后台刷新与输入事件的同一时间线，将重叠
  的热更新样本单列，不作为稳定拖动的验收数据。先区分事件排队、处理函数、
  React 提交和浏览器渲染耗时，再修改已证实的瓶颈；局部耗时下降不等于问题解决。
- 明确区分事件处理耗时、事件排队、rAF 帧间隔和输入到屏幕呈现延迟。浏览器
  自动化或脚本改尺寸不能证明原生桌面的真实呈现延迟；不得以帧间隔代替延迟
  验收。当前目标为本机输入到本机呈现 P95 <50ms，不包含远程桌面传输；未取得
  对应测量证据时必须明确标记未验收，不得宣称达标。
- 原生 WebView 的滚动、合成和驱动设置须在目标运行时逐项对照后再修改，保留
  平台范围和回退路径，不得把某一环境的结果推广为所有平台结论。复查或修改
  Linux WebKit 配置时检查 `src-tauri/src/linux_webview.rs`，避免无依据地恢复
  已验证会导致拖动回退的线程化滚动配置。
- 临时采样器、样式覆盖、运行时补丁和源码注入必须可停止，并在完成、取消或
  异常后清理和恢复。用户不方便手测时继续可行的自动验证，不反复要求拖动；
  清楚记录仍需人工验收的部分。功能测试须等待异步高亮初始化完成，不把正常
  的首次 Worker 切换误判为拖动重建，也不掩盖稳定运行后的异常重建。

## Dependency baseline

- `npm run check:arch` (`scripts/arch-baseline.mjs`) checks layer rules against
  `docs/architecture-baseline.json`: shared/platform/integrations must not depend
  on features or app, features not on app, desktop and mobile not on each other,
  Tauri APIs only in `src/platform/`, host not on UI, plus file-level cycles.
- New violations fail. Resolved entries tighten the baseline locally; in CI a
  stale baseline fails, so commit the updated JSON. Do not run `--update` to
  accept new violations without the user's approval. Use `--report <file>` for
  a readable list with line numbers.

## Android APK 构建与发布

- 用户要求构建或发布 APK 时，默认构建 Release 并使用 2026-10-18 首次正式发布
  （0.1.0，build 3）的同一把 OmniCode 正式签名密钥；除非用户明确要求调试包，
  不得交付 debug 签名包。不得自行重新生成、替换或轮换正式密钥。
- 交付和发布的 APK 文件名固定为 `OmniCode.apk`，大小写保持一致，不添加版本号、
  build 编号、日期或其他后缀；应用显示名保持 `OmniCode`。
- 密钥 alias 为 `omnicode`，证书 SHA-256 为
  `E4:81:24:FA:A8:1F:5B:60:F4:3E:5C:54:43:BC:E1:11:61:81:E2:DE:87:26:FF:F7:B2:42:6E:69:CC:80:EB:00`。
  密钥位置与恢复说明见 [移动端签名说明](mobile/README.md#release-signing-key)。
  密钥不可用时应明确报告阻塞，不能退回调试签名或新建密钥替代。
- 密钥与密码必须保留在仓库外，不得提交、上传至 Release 或打印到日志。
  发布前验证 Release 调试开关已关闭、签名证书匹配、APK 对齐及 SHA-256；
  `mobile-latest.json` 的 `downloadPath` 固定为 `/OmniCode.apk`，并匹配实际产物的
  versionCode、versionName、大小和校验值。后续构建继续递增 versionCode。
- 构建与发布仍是独立授权操作；仅构建的请求不授权发布，也不配置自动发布钩子。

## Verification

Keep verification proportional to the change and minimize unnecessary testing.

- Run `npm run check:arch` when changing imports across modules.

- Run the smallest relevant existing tests for changed behavior; do not run full
  suites by default.
- Documentation-only changes do not require tests. For reversible, low-risk
  presentation changes, use a focused inspection or check instead of adding tests.
- Add tests only for meaningful behavior or regression risks; avoid tests that
  merely mirror the implementation.
- Once relevant checks pass, do not repeat or broaden them unless further changes,
  failures, or unresolved risks justify it.
- Use `npm run check:web`, `npm run test:host` and `npm run build` only when their
  scope is relevant or the task explicitly requires them; run `npm run check:rust`
  when Rust changes.
- Record the checks actually run and their results, and actual CLI versions when
  verifying provider compatibility.

Never mark tasks complete or claim compatibility for an unrun scenario.
Publishing, pushing and merging into main are separate scoped operations.

Do not configure automatic publication hooks or build/publish at the end of a
turn. Run builds or publication only when the user explicitly requests them,
after relevant checks pass.
