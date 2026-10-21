# P9 收尾记录

日期：2026-10-21。分支：`feat/ripple-stack`。基线：`6405da3`。本轮没有提交、推送、构建或发布。

## 实现

- 普通 UI 图标统一通过 `shared/ui/icons.tsx` 使用 Lucide，默认 16px、currentColor、strokeWidth 2。删除桌面、移动端和菜单的手写 artwork 覆盖及对应样式，移除旧覆盖测试；保留共享图标契约测试。品牌、文件类型、二维码、用量环和拓扑/图表属于资产或数据绘图。
- 原始 Tailwind 色板类改用 danger、warning、success、accent 和 content。展示层 hex 改用主题变量；桌面颜色集中到 desktop-theme，移动端保留自身主题定义。二维码和色谱通过固定用途的 token 保持可扫描性和颜色选择准确性；终端 xterm 调色板保持原样。Chart 中的第三方 SVG 属性选择器不是绘制颜色，保留其匹配值。
- 补齐缺少焦点状态的 outline-none，补齐原生交互元素和共享 Button 的状态；计划预览、工具摘要、图片缩放和触摸时间线滚动条补键盘支持。只负责阻止冒泡、聚焦内部输入框和外部点击关闭的容器不伪装成额外按钮；SessionCard 的内部选择控件保留现有键盘语义。
- `VirtualRows` 使用 TanStack Virtual，复用既有滚动容器、测量行高并保留活动项。`VirtualCommandItems` 用完整数据处理跨窗口键盘导航；`CollapsingVirtualRows` 用共享 AnimatedCollapse 管理已挂载行的退出和快速反转。接入 FileTree、QuickOpen、SearchableSelect、SearchView 和侧栏会话。FileTree 查询订阅与行挂载解耦，键盘导航使用拍平模型。
- 将剩余安装、Host 目录、工作区会话、Transcript 保活池、高亮池、原生会话、编排快照、CLI 可用性、移动连接和移动列表的界面状态迁入 Zustand。已有偏好存储继续由 persist 负责；保留浏览器状态、时钟、i18n、Query 缓存和外部运行时事件的订阅接口，不以统一改名代替状态所有权迁移。
- 拖动预览样式通过序列化规则生成副本，避免给只读 CSSStyleRule.selectorText 赋值；源样式不被修改。
- 删除 AGENTS.md 的旧分隔线过渡说明。架构基线只移除 11 条已解决记录，没有使用 --update 接受新违规。

## 自动检查

运行环境：Windows，Node 24.20.0、TypeScript 5.8.3、Vitest 3.2.7。

| 检查 | 实际结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 最后代码修改后通过 |
| `npm run check:arch` | 失败；仍为 settings/ui/pages/providers 的 10 条既有违规，没有新增类型或位置；只收紧已解决的 11 条基线记录 |
| `npm run check:web` | 已运行；在上述架构检查处停止，所以另外直接运行完整 Vitest |
| HEAD 完整 Vitest 对照 | 8303 条：7679 通过、607 失败、17 跳过 |
| P9 完整 Vitest 对照快照 | 8299 条：7867 通过、348 失败、84 跳过；不能解读为全套通过 |
| 侧栏受控 HEAD 对照 | 仅应用 CSSOM 只读规则修复，137 通过、10 失败；与 P9 剩余侧栏失败的名称和错误一致 |
| 安装、Host 目录、工作区会话的针对性检查 | 25 条通过 |
| 移动快照、移动列表、编排客户端和原生会话状态 | 30 条通过 |
| 共享折叠 | 13 条通过；覆盖关闭保留、快速反转和减少动态效果 |
| 搜索、命令、选择器和图标 | 相关用例通过；增加 1000 项选择器的有限挂载、End/Enter、禁用项与 aria-activedescendant 检查 |
| 后续移动端及文件树复测（2 workers） | 165 条中 156 通过、9 失败；其中 3 条连接设置和 1 条文件拖动预览是 HEAD 既有失败；其余在下列复测中解决 |
| 设置页隔离复测 | 67 条全部通过；全量中的 67 条跳过来自 beforeAll 的 10 秒超时，单独运行使用 `--hookTimeout=30000` |
| 头像焦点与 Git/CRLF 隔离复测 | 15 条全部通过；修复头像弹窗的触发器焦点记录。真实 Git I/O 用例单独使用 `--testTimeout=20000 --hookTimeout=20000`，没有放宽断言或修改项目默认超时配置 |
| 最后侧栏边界复测 | 8 条通过，139 条因名称筛选未运行；覆盖跨虚拟窗口选择、置顶/提醒分组、行间距和展开收起 |
| `git diff --check` | 通过；修正临时编辑导致的孤立 CR，保留原有换行风格 |

全量快照之后还修复了暂停轮询时的缓存首屏、大目录创建输入框的保留优先级及头像弹窗焦点，并运行对应复测和 TypeScript。文件树最终 37 条中 36 条通过，唯一失败仍是已在 HEAD 复现的文件拖动预览；包含 1000 行导航和 300 子目录后的创建输入框测试。移动首页/抽屉、48 条会话加载用例、Agent 默认值、跨设备缓存、项目选择器等新增失败也经过隔离复测。没有以失败数下降替代回归判断，也没有把未运行的原生场景标记为通过。

目标旧实现扫描在 `src`、`package.json` 和 `package-lock.json` 中无 StatusToast、primitives/Toast、auto-animate、useAnimatedReorder、useDragResize、_shims/zustand；lucide-react 只有 icons.tsx 一个直接导入。Modal/Popover 的同名文件是 Radix 平台适配，不能仅按文件名判断为旧引擎。

HEAD 全量对照采用 `git stash -u`，完成后已恢复全部工作。HEAD 报告：8303 条测试，7679 条通过、607 条失败；另有跳过/待办项。失败范围比事先列出的既有清单更广，包括只读 CSSOM 造成的初始化失败。对照报告保存在本机临时目录的 `omnicode-p9-head.json`。

P9 全量快照为同目录下的 `omnicode-p9-final.json`，侧栏受控基线为 `omnicode-p9-sidebar-head.json`。临时迁移脚本和诊断日志已移出工作区，没有遗留调试注入。

## 人工验收

- 桌面和移动端明暗主题、各皮肤、状态色对比度，以及字体/缩放设置下的图标和焦点环。
- 真实长列表滚动、Home/End/PageUp/PageDown、输入法组合、禁用选项、子菜单、过滤后的活动项、键盘焦点恢复。
- 文件树千项目录、远程异步加载、创建/重命名、跨目录展开、拖放、隐藏文件以及展开关闭的快速反转。
- 侧栏大项目、置顶和提醒分组、归档筛选、会话重命名、跨可见窗口重排和键盘多选。
- 减少动态效果设置；真实浏览器中的滚动条、焦点可见性和动态高度。
- 原生 WebView 中分隔线连续拖动、终端实时重排，以及本机输入到呈现 P95 <50ms。当前没有原生呈现延迟数据，未验收。

## Transcript 评估

此次不虚拟化 Transcript。`AgentTranscript`、`transcript/scrollAnchor.ts`、`useTranscriptSelection` 依赖真实 DOM 几何、跨块 Range 和保留节点；流式文本、图片、异步高亮和提示词锚点又会改变行高。下一阶段需要先建立未挂载块的定位和选区策略，验证历史回看、搜索跳转、复制选区、输出期间的底部跟随和保活切换，再接入虚拟化。普通列表的验证不能替代这些验证。
