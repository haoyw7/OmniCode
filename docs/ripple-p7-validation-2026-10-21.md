# 涟漪 P7：迁移与验证记录

日期：2026-10-21。分支：`feat/ripple-stack`。对照 HEAD：`1307e62d95162c27c94b64b92bc2cab19706d19b`。

**交互实现与旧 sash 单测已迁移；原生桌面输入到呈现 P95 <50 ms 未验收。** 未提交、推送或构建。

## 实现范围

- `Sortable.tsx` 统一 dnd-kit 上下文、指针/触摸/键盘传感器、DragOverlay、目标注册和 arrayMove 排序。空格拿起，方向键移动，空格或 Enter 放下，Escape 取消；Enter 保留普通按钮激活行为。
- 替换 SessionCard、ProjectSessionSection、ProjectSection、ProjectGroupSection、ChatProjectCard、SidebarTabs、MessageQueue、SessionStatusPanel、SurfaceTabs 的旧重排控制。置顶、项目分组、工作区面板、终端 dock 和文件附件拖放共享目标路由。
- 移动队列使用 TouchSensor，保留长按阈值和返回取消；文件树内部拖动不再发送自定义窗口事件。外部文件的 HTML5/原生 WebView 拖放继续保留。
- `Resizable.tsx` 基于已安装的 react-resizable-panels **4.14.7**。Notes/Inbox 使用 Group/Panel；现有平面和网格布局使用透明控制轨道，保留正文、编辑器、终端的原 DOM 位置。PaneTree sash 同样由 v4 驱动。
- 移动时只更新临时尺寸和布局 DOM，松手才提交布局及持久化。继续复用 paneResize、局部光标层、聊天像素最小宽度、覆盖显示及终端 fit/PTY resize 去重队列。垂直分隔线同步布局模型的比例下限，避免控件和正文边界分离。处理 Escape、pointercancel、丢失捕获、失焦和卸载；直接调整期间停用相关 transition/layout 动画。
- ProjectsPage、AttachmentList 以及原 useListReorderMotion 的消费者改用 Motion layout/AnimatePresence，遵循减少动态效果。保留共享 AnimatedCollapse 的关闭生命周期。
- 删除旧 useAnimatedReorder、usePaneDrag、useQueueDrag、useDragResize、ResizeHandle、useListReorderMotion 及专属测试/样式；清理 drag/reorder 工具。卸载 `@formkit/auto-animate`，锁文件同步。

## 自动检查

以下计数来自分批执行，存在覆盖重叠，不累加成“全套测试”结果。

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 通过 |
| `git diff --check` | 通过 |
| `npm run check:arch` | 仅原有 providers 设置目录的 10 条违规；未修改基线来接受违规 |
| ProjectList / ProjectSessionSection / SidebarRename | 196 通过，7 失败；用 `git stash -u` 在 HEAD 对照得到同样 196/7 |
| FileTree / ComposerFileDrop / MessageQueue / mobile messageQueue / SidebarTabs | 100/100 通过 |
| NotesView / InboxView | 分别 33/33、18/18 通过，包括关联面板静态渲染 |
| MobileBots / MobileDrawer / MobileHome | 分别 10/10、47/47、30/30 通过 |
| ProjectsPage / AttachmentList / SessionStatusPanel / SurfaceTabs | 分别 6/6、2/2、11/11、12/12 通过 |
| sidebarPinDrop / projectGroupDrop / SidebarTransition / terminalResize / WindowResizeHandles | 分别 2/2、3/3、2/2、3/3、31/31 通过 |
| Chromium：工作区缩放 | 7 项通过：像素最小宽度、水平/垂直快速反向、dock 尺寸保持、终端/文件树/侧栏实时调整 |
| Chromium：面板拖放 | 12 项通过：两种排列、普通/减少动态效果、键盘、四种取消路径、连续第二次拖动、内容和终端实例保留 |
| Chromium：共享缩放封装及嵌套文件树 | 9 项通过：取消清理、键盘约束、延迟提交、重渲染期间尺寸保持、外层变窄后的命中位置 |
| Chromium：聊天背景几何隔离 | 1 项通过 |

侧栏的 7 条既有失败：ProjectList 的两项摘要交互、ProjectSessionSection 的摘要关闭、SidebarRename 的筛选菜单关闭、插入动画和两项 GitHub 链接。没有为迁移修改这些既有断言。

旧浏览器 fixture 另有不可用场景，未计入通过项：

- `changes trades places...`（普通/减少动态效果）和 `changes panel resizes from...`：在 HEAD 实测同样缺少 `.desktop-tools-layout`。
- `keeps the split aligned ... when file content rerenders during a drag`：在 HEAD 实测同样缺少 `[data-git-review-pane]`。
- 同类旧更改面板用例未声明通过。首次冷启动曾触发导航超时；延长相关 fixture 初始化等待后，核心面板拖放用例通过。

对照用的临时 stash 均已恢复并移除。HEAD 对照时临时恢复了依赖，返回候选后再次按锁文件移除了 auto-animate。

## 性能诊断：不是原生延迟验收

在同一 Chromium 窗口运行旧 hook 与 v4 的交替对照。每轮保留两块内容、共 1000 行，等待字体和初始化完成；120 次 pointermove，计划间隔 25 ms、三角往返轨迹，约 3 秒。采样时没有源码修改、HMR 或窗口焦点变化，两块正文各只渲染一次。

计时区间为窗口捕获监听器到末尾冒泡监听器，包含事件分发/同步处理；**不测量事件排队、后续异步布局/渲染、合成或屏幕呈现**。

| 轮次 | 实现 | 样本数 | 分发耗时 P95（ms） | 采样时长（ms） |
| --- | --- | ---: | ---: | ---: |
| 1 | HEAD 旧 hook | 120 | 0.30 | 3011.6 |
| 2 | v4 Group | 120 | 1.10 | 3005.3 |
| 3 | HEAD 旧 hook | 120 | 0.20 | 3011.5 |
| 4 | v4 Group | 120 | 1.00 | 3002.5 |
| 5 | HEAD 旧 hook | 120 | 0.20 | 3028.8 |
| 6 | v4 平面布局控制轨道 | 120 | 1.00 | 3007.2 |
| 7 | HEAD 旧 hook | 120 | 0.20 | 3003.3 |
| 8 | v4 平面布局控制轨道 | 120 | 1.00 | 3008.5 |

候选在此诊断中的同步开销增加约 0.8 ms，不能据此声称体验更快或满足 <50 ms。该采样快照之后还补充了命中边框、嵌套约束观察和退出清理；没有将表中数字冒充最终原生性能数据。旧 hook 删除后，可用 `tests/browser/resizable-dispatch.spec.ts` 比较两个 v4 接入方式；它不再保留旧实现副本。

浏览器功能测试使用真实 DOM/编辑器/xterm 和离线 RPC 桩，不等同于原生桌面或真实 PTY 的完整验收。未测 Linux WebKit，也未修改平台滚动/合成设置。采样监听器通过 finally 清理，测试页面结束后释放；没有留下运行时补丁。

## 仍需用户在目标设备验收

1. 原生桌面：长聊天、高亮完成的代码、展开的 diff 和持续输出的真实终端，在相同窗口、内容数量、展开状态和轨迹下交替测基线/候选。分别记录事件排队、处理、React 提交、渲染以及输入到本机呈现延迟的样本数/P95；目标为最后一项 <50 ms，不包含远程桌面传输。
2. 各分隔线：快速反向、第二次拖动、双击恢复、尺寸持久化、键盘、Escape/取消/失焦/卸载。确认没有光标层残留，聊天最小宽度和窄窗口覆盖行为保持；Notes 窄布局、Bot 侧栏、关联工单和讨论面板也需覆盖。
3. 终端：拖动期间按实际列数实时换行，PTY 不重启，松手后无旧异步尺寸覆盖新尺寸；验证终端在 dock 与分屏之间移动。
4. 拖放：会话/项目混排、跨项目置顶、项目分组、文件附件、面板与标签的键盘操作；真机触摸队列的滚动竞争、长按和返回取消。
5. 外部文件：系统文件管理器拖入及取消；普通与减少动态效果、暗色模式分别检查。采样期间不要热更新源码，重叠 HMR 的样本单列。

工具版本：Node 24.20.0、npm 11.19.0、Vitest 3.2.7。Motion API 使用前已读项目 skill 和 motion.dev 当前免费文档；v4 API 以本机 node_modules 类型为准。

## 后续修正：排序期间保持尺寸

- Sortable 在激活时一次性读取同一列表各项的尺寸，在开始写入交互样式前完成读取。拖动期间保持宽高及 flex 占位，只应用平移，禁用缩放；父级重渲染或容器宽度变化不会覆盖尺寸。松手提交顺序后恢复布局；取消、失焦、丢失捕获及卸载均释放尺寸约束。
- 项目和侧栏分区不再因拖动临时折叠，内部内容保持挂载。项目标题操作区固定预留空间，图标和统计的显隐保留占位，避免拖动经过 hover 状态时改变内部尺寸。
- 新增 `sortable-size.spec.ts` 的 12 项 Chromium 回归检查，分批全部通过：横纵向不同高度、普通/减少动态效果、父级重渲染、内部输入框保留、松手提交、键盘、五种取消路径、第二次拖动，以及真实 ProjectList 项目和分区几何。
- 测试等待字体和展开/内容尺寸动画结束后测量；初次运行发现的浮点坐标误差以 0.001 像素精度比较，初始化中的内容尺寸动画不计作稳定拖动差异。
- 相关 Vitest：118 通过，ProjectList 原有 2 条失败（前文已在 HEAD 复核）；check:arch 仍仅原有 10 条 providers 违规。TypeScript 与 `git diff --check` 通过。
- 此修正仅完成浏览器功能验证，未重新采集原生输入到呈现延迟；性能仍为“未验收”，前述手测清单继续适用。

## 拖动预览修正（用户复测后的补充）

用户进一步确认，尺寸变化发生在跟随鼠标的预览。上一轮主要检查了原位置组件，未覆盖实际预览内容；原 DragOverlay 仍渲染压缩的文字标签，不能代表完整卡片。

- DragOverlay 现在显示原组件的完整只读呈现副本，激活时读取实际尺寸及字体、布局样式，保留滚动位置和输入值。移动路径只由 dnd-kit 更新位移，不重新测量或缩放预览，也不在预览中启动第二份 React 业务组件、编辑器或 PTY。
- 预览移除应用定位属性、事件属性及表单身份，设为 inert / aria-hidden；SVG 局部 ID 与引用重命名，避免重复 ID。预览结束后移除副本。原组件继续挂载并运行；终端测试确认拖动期间仍能显示新输出，PTY 没有重复启动或销毁。
- 工作区提升到顶栏的会话拖动手柄现在取对应完整面板作为预览来源。侧栏项目/会话、状态卡片以及编辑器/终端面板均检查了预览外框和内部内容尺寸，并检查拖动截图。
- 移除 Sortable 行内 opacity 与 Motion animate 的重复控制，修复初始侧栏条目可能持续透明的问题。
- 最终 Chromium 25 项全部通过，覆盖预览内容和几何、横纵布局、减少动态效果、键盘、取消路径、再次拖动、释放提交、编辑器保留和终端持续输出。SVG 加载旋转图标比较布局尺寸，避免把正常旋转后的路径包围盒变化误判为组件缩放。
- 最终相关 Vitest 为 274 通过、3 条既有失败（ProjectList 2 条、ProjectSessionSection 1 条，前文已有 HEAD 对照）；TypeScript 和 `git diff --check` 通过。check:arch 仍为原有 10 条 providers 违规。
- 预览副本在拾取时生成；原面板保持实时运行。这是功能修正，没有重新取得原生输入到本机呈现的 P95 数据，性能继续标记“未验收”。

## 状态卡片预览透明度与圆角

复现了预览外层的 `bg-background-base shadow-lg` 额外绘制不透明直角底色的问题：副本自身虽已保留原卡片背景 alpha 和 10px 圆角，外层底色仍会填满透明角落并改变合成效果。已移除外层背景和阴影，仅保留卡片自身捕获的外观。

新增明暗主题回归，以面板透明度 0.42 比较源卡片与预览的背景、opacity、圆角和阴影，同时断言外层完全透明且无额外阴影。两个新增用例修复前均失败、修复后通过，并已检查截图；连同会话/状态卡片预览几何共 4 项浏览器检查通过。SessionStatusPanel 11 项单测、TypeScript、`git diff --check` 通过；本次没有跨模块导入变更。

## 状态卡片放到列表末尾

复现了两类命中问题：最后一项本身被候选过滤排除，拖到末尾释放仍会被移到倒数第二位；末张卡片展开较高时，旧的卡片中心距离会忽略鼠标已进入的可见标题，错误命中前一张卡片。键盘返回最初位置也受排除当前项影响。

共享碰撞检测现在保留当前列表项作为合法目标；指针/触摸优先命中指针所在卡片，间隙再按指针位置选择最近目标，外部放置目标仍保持优先。键盘保留几何方向选择。移动路径复用 dnd-kit 的缓存矩形，不新增同步 DOM 测量；业务顺序仍只在释放时提交。

新增四种来源拖到末尾并重载验证持久化、展开的高末项标题命中、键盘到末尾再返回原位共 6 项检查。Sortable 浏览器检查共 22 项分批通过；首次整批的一项 Vite 页面加载超时单独重跑通过，键盘逐步检查等待实际位置播报后再继续输入。相关 Vitest 274 通过、3 条既有失败，TypeScript 与 `git diff --check` 通过；无跨模块导入变更，原生性能验收状态不变。

## 工作区插入线

根据用户截图复现：现有分屏目标仅在面板内部绘制区域提示，完整拖动预览会遮挡它，且没有独立插入线。新增共享 `DropInsertionLine`，通过 portal 在 body 的 `LAYER.dragHint` 层绘制 3px 插入线，高于 DragOverlay，避免面板裁剪和隔离层遮挡。

分屏四个方向以及终端停靠目标均接入插入线。位置来自 dnd-kit 已缓存的目标矩形；四个分区通过比例还原面板边界，不在移动路径读取 DOM 几何。退出由目标/拖动生命周期直接卸载标记，不增加监听器或临时全局样式。

14 项 Chromium 拖动检查分批通过：四边与快速反向、普通/减少动态效果、预览重叠处的实际绘制层级、释放、Escape、pointercancel、失焦、丢失捕获、第二次拖动、键盘、顶栏手柄和终端停靠。检查了插入线截图，停靠线对齐可见卡片内部边界，排除外部 gutter 和边框。初轮发生过 Playwright trace 文件丢失，最终使用独立输出目录复核。

相关 Vitest 114 通过、1 条既有 ProjectSessionSection 失败；TypeScript 与 `git diff --check` 通过。插入线绘制放入 shared UI 供工作区和终端复用，最终 check:arch 仍仅原有 10 条 providers 违规。原生输入到呈现延迟仍未验收。

## 移除分屏区域提示

按用户要求，移除面板拖动时标有“分屏视图”的半屏区域遮罩，四个方向仅通过插入线提示放置位置，保留完整拖动预览及原有命中区域。删除不再使用的分屏提示区域配置；终端停靠仍复用其现有提示组件。

10 项相关 Chromium 检查全部通过，覆盖四边插入线及遮罩缺席、普通/减少动态效果、鼠标和键盘放置、横向工具布局，以及编辑器和终端保持挂载。已检查拖动截图。SurfaceTabs 的 12 项 Vitest、TypeScript 与 `git diff --check` 通过；本次无跨模块导入变更。原生输入到呈现 P95 继续标记“未验收”。

## 拖动刚激活时的开销

用户反馈起拖瞬间有卡顿。分段测量确认，完整预览逐节点读取并重复解析长行内样式，是激活时的同步开销之一。保留全部样式读取及完整内容，在单次捕获内按元素命名空间、标签和完整样式复用已解析的浅层模板；每个副本仍独立复制属性、表单当前值、SVG 局部引用和滚动位置。模板仅存活于本次捕获，不跨拖动缓存，不新增定时器、预热任务或业务组件实例。

对照使用同一 1600×1000 Chromium 窗口、相同展开状态及内容，基线为本轮修改前的预览实现。长聊天 722 个子元素、编辑器 228 个子元素，先等待字体和有限动画结束，再按基线／候选／基线／候选顺序采样。源码修改与测试初始化均在采样之前完成，采样期间不改源码。第一轮尝试按布局类型减少样式字段，长聊天改善不稳定，已撤销，仅保留模板复用。

| 测量对象 | 每组样本数 | 基线 P95（两轮，ms） | 候选 P95（两轮，ms） |
| --- | --- | --- | --- |
| 长聊天预览捕获函数 | 10 | 100.0 / 97.3 | 66.7 / 69.3 |
| 长聊天预览挂载及同步布局 | 10 | 46.2 / 45.1 | 30.7 / 31.2 |
| 编辑器预览捕获函数 | 10 | 23.9 / 23.8 | 22.2 / 25.2 |
| 编辑器预览挂载及同步布局 | 10 | 12.0 / 13.5 | 12.7 / 12.6 |
| 长聊天实际起拖的 pointermove 事件派发区间 | 10 | 74.1 / 73.4 | 62.7 / 61.9 |

各实现每个场景合计 20 个样本；表中列出两轮各自 P95，不把不同阶段 P95 相加。实际起拖保持同一手柄和 8px 横纵位移，随后 Escape 取消；全程节点和文字数量相同，采样页持续聚焦，未记录到 HMR 或焦点切换。离线 fixture 无远端后台刷新。事件派发区间从 window 捕获监听器到冒泡监听器，仅反映该区间的主线程处理，未单独量化事件排队、全部 React 提交、浏览器绘制或原生输入到屏幕呈现；编辑器小面板没有稳定改善，不外推为所有场景提速。记录保存在本地 `test-results/drag-preview-templates-fixed.log` 和 `test-results/drag-start-profile.log`。

26 项相关 Chromium 功能检查分批通过，覆盖侧栏项目/分区/会话、状态卡片透明度和圆角、工作区预览、内部尺寸、四向插入线、取消及再次拖动、编辑器保留和终端实时输出。键盘用例曾过早发送方向键，现等待拿起后的当前位置播报，再检查目标位置与释放提交，单独复核通过。增加表单副本独立性、SVG 命名空间/引用和连续捕获更新的回归测试；相关 Vitest 共 14 项通过，TypeScript 和 `git diff --check` 通过。无跨模块导入变更。

临时性能测试、基线副本及所有事件监听器已清理。原生输入到呈现 P95 仍为“未验收”；仍需在桌面应用复测长聊天、展开项目、状态卡片和终端面板首次及连续第二次起拖的实际手感，不能据上述浏览器局部数据宣称达到 50ms 目标。

## 起拖事件处理 P95 <5 ms

本轮按上一轮使用的“起拖事件处理 P95”指标继续优化；该指标与原生输入到屏幕呈现分别记录。

预览仍使用 dnd-kit DragOverlay，改为在私有 ShadowRoot 内复用预先解析的样式表。起拖时读取根尺寸、滚动位置和交互状态，再复制完整 DOM，不再逐节点读取、序列化几十项 computed style。保留原组件尺寸、内部排版、透明度、圆角、表单当前值、Canvas 和嵌套 ShadowRoot（包含 diff 的代码、高亮、行号与样式）。原编辑器、终端和 PTY 继续运行；预览不会启动第二份 React 业务组件。样式缓存随实际样式变化更新，包含 xterm 的 body 内样式和 CodeMirror 的 CSSOM 新规则；旧预览保留自己的样式快照。监听器随最后一个拖拽 Provider 卸载而清理。标准 API 依据 [CSSStyleSheet](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/CSSStyleSheet) 与 [adoptedStyleSheets](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets) 当前文档核对。

另将点击抑制回调固定，缓存未变化的列表项内容，只关闭相关列表的 Motion 布局动画。PaneTree 使用稳定 ref 判断拖动期间是否允许重排，拾取状态由单个面板和分隔线订阅，避免重渲染整棵工作区。新增单测验证布局协调器不会因起拖更新，原内容仍能接收业务更新；浏览器验证取消后分隔线能够立即继续实时调整。

最终在同一 1600×1000 Chromium 页面，等待字体、初始高亮和有限动画完成后，按基线／候选／基线／候选交替测试。每轮 20 次完整拾取与 Escape 取消，指针从相同手柄移动相同的横纵 8px，等待清理后再进行下一次。每类场景每个实现共 40 个样本，候选合计 240 个样本；采样期间没有源码修改、HMR 或焦点切换。两种实现的文本和元素数量逐次比对一致；样式表节点属于非呈现元数据，两边统一从内容计数中排除。离线 RPC 数据不做后台刷新。

| 场景 | 子元素数 | 基线 P95（两轮，ms） | 候选 P95（两轮，ms） | 候选单次最大值（ms） |
| --- | ---: | ---: | ---: | ---: |
| 长聊天 | 722 | 59.8 / 55.3 | **4.5 / 3.8** | 5.1 |
| 编辑器 | 228 | 18.8 / 18.8 | **2.3 / 2.0** | 2.4 |
| 终端 | 154 | 29.3 / 21.9 | **2.8 / 2.1** | 2.9 |
| 侧栏项目 | 33 | 5.6 / 4.6 | **1.1 / 1.0** | 2.0 |
| 侧栏会话 | 14 | 2.6 / 2.2 | **0.7 / 0.8** | 1.5 |
| 会话状态卡片 | 32 | 5.8 / 5.1 | **1.0 / 0.8** | 1.6 |

六类场景的两轮 P95 均低于 5 ms；这不是“每一次调用都低于 5 ms”的保证，长聊天有一个 5.1 ms 样本。原始记录位于本地 `test-results/drag-start-5ms-final/*/samples.json`、`test-results/drag-start-5ms-terminal/*/samples.json`，汇总为 `test-results/drag-start-5ms-summary.json`。终端首轮夹具初始化超时，没有计入样本；延长等待至终端内容就绪后，完整重跑其两轮对照。

此计时区间从 window 捕获监听器到末尾冒泡监听器；同时记录了浏览器 event.timeStamp 到捕获监听器的间隔，后者约 12.5–17.6 ms，不能当成原生输入队列延迟。另用 Chrome 时间线区分 React render/commit、样式计算、布局和绘制，确认这些阶段仍有成本；追踪中的工作区正文更新已被隔离，但单次 trace 的耗时不作为 P95 验收，也不把嵌套阶段耗时相加。**原生输入到本机屏幕呈现仍为未验收，未宣称整体呈现达到 5 ms 或 50 ms。**

本轮验证：

- 33 项相关 Chromium 功能回归通过，包括普通/减少动态效果、原尺寸与内部尺寸、透明度/圆角、完整 diff、终端实时输出、键盘、取消/卸载、再次拖动、分隔线恢复、聊天像素最小宽度及横纵反向调整。
- DragPreview、Sortable、SurfaceTabs 共 17 项 Vitest 通过。CSSOM 的动态样式测试使用真实浏览器验证，避免 happy-dom 对 selectorText 只提供 getter 的限制。
- TypeScript 与 `git diff --check` 通过；check:arch 仍仅原有 providers 的 10 条违规，未更新基线接受违规。
- 补齐桌面浏览器夹具与主应用一致的 NuqsAdapter；富 diff 等待真实语法着色完成后测量，避免把初始 Worker 高亮接管导致的 token 增加误判为拖动变化。
- `PaneTreeResize.test.ts` 初次运行的 15 项失败已适配并全部通过：使用 v4 Separator 本身作为手柄，补齐 happy-dom 缺失的尺寸、偏移、ResizeObserver 与 ariaDisabled 反射，按 v4 的 10px 命中区域及 document 指针监听验证真实库逻辑。保留像素约束、快速反向、第二次拖动、Escape、丢失捕获、卸载、延迟提交、流式重渲染、最新回调和正文不重渲染的断言。与上面的 17 项合计 32 项相关单测通过。

测试适配另发现首次挂载的约束初始化问题：父节点 ref 在子组件布局 effect 之后才就绪，Sash 原先可能错过初次测量。现在通过已挂载的 sizing group 获取父节点，首次即建立像素约束和观察器。该修复在上述性能采样之后完成，只改变首次约束初始化，没有改动起拖预览或事件处理路径。重跑 4 项相关 Chromium 回归：dock 尺寸保持及横纵反向调整通过；窄窗口最小宽度用例在并行检查时触及 30s 总时限，单独改用 60s 总时限后以 22.1s 完整通过。TypeScript 再次通过。记录为 `test-results/pane-resize-v4-final.json`、`test-results/pane-resize-v4-browser.log`、`test-results/pane-resize-v4-minimum.log` 和 `test-results/drag-scope-tsc-final.log`。

临时原型、基线代码副本及 trace 采样脚本已删除，未保留运行时注入。保留默认跳过的 `tests/browser/drag-start-performance.spec.ts`，可显式设置 `RIPPLE_DRAG_PERFORMANCE=1` 后复测候选；性能检查不进入默认测试。未提交、推送或构建。

## 关闭堆叠文件面板时聊天抖动

复现“左侧长聊天，右侧上下两个工具面板，关闭其中的文件面板”。关闭前后聊天、背景、输入框和终端 DOM 均保持挂载，但网格由两行变为一行时，React 先更新了聊天的跨行位置，Motion 仍短暂保留旧的两行尺寸。浏览器逐帧记录中，聊天高度曾缩小 479px（约一半），随后恢复，引发正文重排和滚动位置抖动。

PaneTree 现在区分网格拓扑变化和同一网格内的尺寸动画：面板增删或跨行/列位置变化时，在布局 effect 中停止旧轨道动画并同步设置新轨道，让轨道与面板位置在同次提交中对应。原有展开、最大化和完整视图动画继续保留，直接拖动的临时尺寸路径不变。

新增 `pane-close-stability.spec.ts`，覆盖文件在上方/下方、聊天滚动在中部/底部、普通/减少动态效果。关闭后的 650ms 内逐帧检查聊天位置、尺寸、滚动偏移和滚动范围，变化均小于 1px；背景、草稿和节点保持，终端行数随剩余空间增加且没有新建 PTY。此处是浏览器功能回归，不是原生输入到呈现延迟验收。

验证：4 项新增浏览器回归及 2 项原有展开/折叠回归通过；PaneTreeSurfaces、PaneTreeEnter、PaneTreeResize 合计 45 项 Vitest 通过。Surfaces 的样式预览初始化使用桩绕过 happy-dom 只读的 selectorText，真实样式行为仍由已有浏览器测试覆盖；旧手柄的 transition 断言合并进 Resize 的横纵两项 v4 回归，没有删除行为覆盖。check:arch 仍仅已知 providers 的 10 条违规。记录见 `test-results/pane-close-baseline.log`、`test-results/pane-close-final.log`、`test-results/pane-close-unit-final.json`。

`npx tsc --noEmit -p tsconfig.json` 与 `git diff --check` 通过。未提交、推送或构建；原生客户端的实际呈现仍未验收。

## 状态卡片预览不携带聊天背景

用户反馈卡片拖动时把聊天壁纸一并缩进预览。私有 ShadowRoot 中的祖先包装用于保留样式上下文；虽然使用 display:contents，祖先的 ::before/::after 仍会生成内容，导致聊天背景再次绘制。现在仅禁止这些祖先包装的伪元素生成内容，卡片自身和整块工作区内部的装饰不变。没有新增起拖时的几何读取或遍历。

浅色/深色状态卡片用例先复现失败，再验证父级壁纸不进入预览、原页面壁纸保持、卡片底色/透明度/圆角保持；另验证完整面板自身背景、富 diff 及动态样式缓存。5 项 Chromium 回归、5 项相关 Vitest 通过。记录见 `test-results/card-background-baseline.log`、`test-results/card-background-final.log`、`test-results/card-background-unit.json`。

TypeScript 与差异检查通过；本次未改跨模块导入，未提交、推送或构建。

## 鼠标拖动立即激活并跟随首次位移

用户反馈会话、状态卡片和工作面板需要长按约 1 秒才响应。核对已安装的 dnd-kit 6.3.1 实现及 [Pointer Sensor 文档](https://dndkit.com/legacy/api-documentation/sensors/pointer/) 后，确认鼠标路径原先没有延时计时器，但需要超过 5px 位移，而且距离传感器在激活的那次 pointermove 中只调用 onStart，未转发该事件的坐标。基线浏览器测试复现：单次 1px 移动始终不激活；单次 12px 移动激活后，预览仍留在原位置，等待第二次移动。

现在仅鼠标改为有非零位移即激活，静止按下/松开仍是点击；通过仅在待激活期间存在的捕获监听器记录首次位移，在 onStart 后立即交给 dnd-kit 的 onMove，使预览跟随同一事件。激活、放下、取消及放弃手势均移除该监听器。触摸队列的 400ms 长按、触笔原有阈值及键盘操作保持。

6 项新增 Chromium 回归覆盖三种来源各自的 1px/12px 单次鼠标移动，无长按和第二次移动；2 项键盘回归和 5 项取消清理回归通过，合计 13 项功能回归。Sortable 与移动消息队列共 23 项 Vitest 通过，包括纯点击、触摸长按、滚动竞争及取消。移动队列样式测试使用与其他 happy-dom 测试相同的预览样式观察桩，避免 selectorText 只读限制，不修改生产兼容路径。TypeScript 和差异检查通过；check:arch 仍仅已知 providers 的 10 条违规。

完成其他检查后，单独运行三类场景的起拖事件处理诊断，各两轮、每轮 20 次，总共 120 个候选样本。窗口、内容数量和手势轨迹固定；没有 HMR 或焦点切换。本轮仅复测候选，不将其当成新的交替基线对照。

| 场景 | 起拖事件处理 P95（两轮，ms） |
| --- | --- |
| 长聊天工作面板 | 3.6 / 3.2 |
| 侧栏会话 | 0.9 / 0.7 |
| 状态卡片 | 0.9 / 0.8 |

三类 P95 均小于 5ms；长聊天首个样本为 5.5ms，并非所有单次都小于 5ms。事件处理区间仍不包含完整 React 提交、绘制和原生屏幕呈现；原生客户端约 1 秒的体感延迟未取得测量证据，继续标记未验收。原始数据在 `test-results/drag-activation-performance/*/samples.json`，功能/单测记录为 `test-results/drag-activation-candidate.log`、`test-results/drag-activation-cancel.log`、`test-results/drag-activation-unit-final.json`。未提交、推送或构建。

## 文件区单栏视图残留竖线

竖线来自 FileExplorerFrame 的 ResizableRegion：窄窗口、仅文件树或树已折叠时，原实现只禁用了控件，仍绘制其分隔线。现在只在有文档、宽度达到双栏断点且文件树展开时挂载调整控件。原网格、文件树与编辑器继续保留；再次展开沿用已保存的树宽度，不影响未保存编辑。

浏览器基线先复现单栏仍存在分隔线。修复后普通/减少动态效果两项回归覆盖单栏文档、返回文件树、重新打开文档、宽屏拖动、折叠/展开和编辑器保留；另验证双栏缩窄后按最大宽度约束调整、分隔线对齐和再次拖动。旧宽度约束用例不再把窗口拖过单栏断点后要求分隔线仍存在，而是先增大树宽度，再缩窄到仍显示双栏的 760px，以继续验证真实约束行为。3 项 Chromium、4 项 FileExplorerFrame 单测、TypeScript 与差异检查通过。记录见 `test-results/file-divider-baseline.log`、`test-results/file-divider-final.log`、`test-results/file-divider-constraint.log`、`test-results/file-divider-unit.json`。无跨模块导入变更，未提交、推送或构建。
