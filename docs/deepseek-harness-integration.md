# DeepSeek Harness 接入 OmniCode

更新日期：2026-10-20。已按定制桥接插件方案实现 `deepseek` provider，显示名为 **DeepSeek Harness**。
桌面与 headless Host 共用适配器；移动端通过 Host 使用同一条协议链路。

## 多会话共享运行时

同一执行机器、CLI、DSH home 和进程环境下，多个聊天共用一个 DSH 运行时，
每个聊天创建独立的根 Agent。工作目录、模型、权限模式、消息、审批、问题、
后台任务和子 Agent 按原生 session ID 隔离；各会话的控制请求分别排队，
不会因另一会话等待用户而阻塞。模型目录和账号查询也可以借用现有运行时。

Host 在应用 profile 目录启动共享进程，各 Agent 使用自己的会话工作目录。
项目环境变量不同的会话分属不同运行时，环境内容只在 Host 内参与指纹计算，
不会返回给界面或写入日志。跨机器的进程不共享。

30 分钟空闲回收仍作用于每个聊天的 Agent；回收或关闭一个 Agent 不影响其他聊天，
最后一个使用者释放后才关闭运行时。整个进程异常退出会使其承载的运行失败，
后续消息通过已保存的原生 session ID 在新运行时恢复。第一个聊天仍需冷启动，
后续新聊天无需再次加载 DSH 插件环境。

2026-10-20 使用实际 `dsh 0.2.1-rc.2` 和隔离 home、本地 fixture 模型验证：
62 项定向测试通过（含 17 项真实运行时测试），前端及 Host TypeScript 检查通过。
覆盖并发工作目录、历史、权限、审批、问题、后台任务、单会话关闭/恢复、
共享进程退出后的恢复，以及进程环境隔离。通用子进程测试在并行检查时出现
一秒输出等待超时，单独重跑后 18 项全部通过。
架构检查仍报告既有设置页面的 10 条违规，本次未调整 baseline。

启动对照在相同隔离配置、工作目录和提示下交替执行，模型仅使用本地 fixture：
每组 3 次，新进程从启动到接收提示为 4851 / 4928 / 4959 ms
（中位数 4928 ms，P95 4959 ms）；同一已启动进程创建新会话为 40 / 27 / 16 ms
（中位数 27 ms，P95 40 ms）。测量不含 Host 的版本检查、检查点准备、
真实模型推理或原生界面呈现，不代表端到端响应延迟。

## 实现与版本边界

| 项目 | 基线 |
| --- | --- |
| 官方仓库 | `deepseek-ai/deepseek-harness`，MIT，developer preview |
| 检查的源码提交 | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| 支持的 CLI | `@deepseek-ai/dsh@0.2.1-rc.2`，命令 `dsh` |
| 桥接协议 | OmniCode stdio JSON-RPC / NDJSON，版本 `1` |
| 实测环境 | Windows；Node `v24.20.0`；npm `11.19.0` |
| 上游 Node 要求 | `^22.19.0 || >=24.0.0` |

启动前检查 `dsh --version`，握手时再次核对运行时与桥接版本；不匹配会明确报错。
安装入口固定上述版本，未接入自动升级到任意最新版的通道。

桥接代码随 OmniCode 分发：Host 将模块作为文本资源嵌入，Tauri 使用 `include_str!` 嵌入同一文件。
启动时只准备应用拥有的 profile，然后调用已经安装的 CLI；聊天启动路径不执行临时 `npx` 下载。

## 使用

1. 在实际执行机器上安装匹配的 CLI：

   ```sh
   npm install -g @deepseek-ai/dsh@0.2.1-rc.2
   dsh --version
   ```

2. 使用 DSH 自身的方式配置模型路由与凭据。OmniCode 沿用该执行环境的 DSH home；
   API key 不进入会话、手机状态或启动参数。
3. 在 OmniCode 选择 **DeepSeek Harness**。模型列表动态读取 DSH 已配置的 provider/model，
   也可使用应用中的 CLI 自定义路径设置。
4. Host 场景在 Host 机器安装和配置 DSH；移动端无需安装 DSH。

默认 home 为 `~/.dsh`，支持 `DSH_HOME`；相对路径按执行 cwd 解析，`~` 按执行环境的 home 展开。
Host 准备插件时也读取该会话的环境变量，避免准备目录与子进程实际使用的目录不一致。
恢复已有会话需要保留同一 DSH home、provider session ID 和原工作目录。

OmniCode 拥有的目录为：

```text
<DSH_HOME>/profiles/omnicode-v1/
  package.json          # omnicodeBridge: 1 所有权标记
  cordis.patch.yml
  bridge.mjs
  omnicode.patch.yml
```

只有带应用所有权标记的 profile 可以更新。目录已被用户占用、或缺少标记却含文件时拒绝接管。
文件以临时文件加重命名方式更新；现有凭据、会话和其他 profile 保留。

## 为什么使用定制桥接

官方 ACP 当前支持持久化恢复、模型配置、取消和单次审批，但正文更新来自已提交的消息，
并未提供完整的实时 chunk、结构化提问与计划交互。SDK 也没有完整的取消与审批回传协议。
因此本实现直接接入 DSH 的插件服务，保持其核心执行、持久化和权限逻辑。

应用 profile 组合 `dsh-base` 与 `dsh-acp-app`，禁用 ACP 通信插件与 HMR，
插入 OmniCode 桥接、timed ask-user 工具及原生 Auto review。
保留 ACP startup 的参数解析和 EOF 有界关闭能力；仅桥接插件读取和写入协议 stdio。

```text
Desktop adapter / Host adapter
    → shared child backend
    → Host / Tauri prepares the application-owned profile
    → installed dsh --profile omnicode-v1 --patch <owned patch>
    → OmniCode bridge
    → DSH Agent / Session / Tools / Questions / Permissions / Attachments
```

## 能力映射

| 能力 | 已实现处理 |
| --- | --- |
| 会话 | new/resume/configure；绑定并保存原生 session ID；校验恢复 cwd |
| 实时输出 | 订阅 `agent/assistant-stream`；正文、思考、工具参数计时；按 attempt/index 去重并检测缺失 chunk |
| 持久化事实 | `session/event` 为权威记录；补齐尚未流出的尾部，避免重复追加完整消息 |
| 完成时机 | prompt 回执仅表示接收；独立 `run.completed` 等待 root、受管子代理、所属后台 job 和输出落盘 |
| 插话 | 原生 `agent.steer()`，不创建第二个并发 prompt |
| 取消与关闭 | 取消交互、root、所属 job；关闭排空后代并释放 Agent；适配器回收进程与监听 |
| 模型 | provider/model 路由保存为 opaque JSON tuple；支持同名模型分属不同 provider |
| 思考强度 | 动态读取模型 efforts；保留空字符串表示 provider default，不替换 provider 自带标签 |
| 工具 | 过程、结果、错误、文件/命令预览和结构化 diff；工具 ID 按来源 session 隔离 |
| 审批 | 原生审批请求回传；借助缓存的工具事实补足标题和预览；取消时关闭待决请求 |
| 提问 | 原生题目、选项、自由输入、完整 detail 与 plan-review intent；支持倒计时、操作保留、超时继续 |
| 迟到回答 | 持久化 native question ID；恢复后调用 `userQuestions.answer()`，保留原问题关联 |
| 计划审阅 | DSH 原生 plan mode 与 `exit_plan_mode`；完整计划显示在问题及历史中，回答原生选项；不额外生成第二次 Build 审批 |
| 图片 | 按精确模型路由能力校验输入；通过 attachment store 接收输出；桌面保存到应用文件，Host 交给现有附件持久化 |
| 子代理 | 实时文本、思考、工具步骤、状态和原生 session 关联；其图片附到对应子代理 |
| 后台 job | 展示活动任务，非消费式等待结束；保留 DSH 自身的完成通知，取消时停止所属任务 |
| Todo 与用量 | 原生 todo 快照；累加本轮已报告的请求 token；首末输出时间来自真实流式 chunk，不把审批等待计入生成速度 |

问题 detail、intent、native question ID 均为可选字段，旧 provider 和旧历史保持兼容。
Host 的 keepQuestionOpen 命令包含 session/run/request 三层关联，拒绝过期设备命令。
桌面远程会话与移动端均通过该命令停止倒计时。

## 执行模式

| OmniCode 模式 | DSH 设置与额外行为 |
| --- | --- |
| supervised | 原生 workspace-write；在原生规则允许之后，对修改/执行及未知工具追加人工审批 |
| auto-accept-edits | workspace-write；允许原生规则已放行的 write/edit，其他有副作用的调用仍审批 |
| auto | 原生 Auto preset：Full access + ask，由原生 Auto review 对每个调用审查，拒绝再交人工 |
| full-access | 原生 danger-full-access preset；不追加应用审批 |

桥接先尊重 DSH 的既有决策，不把原生 deny/ask 改成 allow，也不绕过文件变更保护。
plan mode 是原生规划指导和审阅流程，不能当作额外的强制只读沙箱。

## 主要文件

- `src/integrations/harness/providers/deepseek/bridge/bridge.mjs`：进程内插件与协议。
- `deepseek.ts`、`deepseekProtocol.ts`、`deepseekCatalog.ts`、`deepseekAdapter.ts`：共享 provider。
- `host/deepseek-bridge.ts`、`src-tauri/src/deepseek.rs`：执行环境内的 profile 准备。
- `src/integrations/harness/register.ts`：组合层注册；从 core 移出，避免 core 依赖具体 provider。
- `host/engine.ts`、`host/providers.ts`：远程控制、原生迟到回答与生命周期。
- `userQuestion.ts`、`questionHistory.ts`、QuestionForm/QuestionHistoryCard：兼容的问题与历史展示。

Harness 身份、默认模型、图标、可用性、Windows npm shim、安装入口与 Host 模型发现均已注册。
会话列表沿用现有 `HarnessIcon` 与 `sessionDisplayTitle`。

## 初次接入验证（2026-10-19）

真实 DSH 进程使用隔离 home、含中文和空格的 workspace，以及本地测试模型；
不使用真实服务凭据，不发起付费推理。`fixture.test.mjs` 仅由测试注入，不随插件部署。

已验证：实时多轮、模型请求失败回传、审批允许/拒绝、四种模式、完整计划审阅、todo、问题超时/保留/迟到回复、
运行取消后继续、图片输入/输出与非视觉路由拒绝、steer、跨进程 resume、子代理时间线、后台 job 排空与取消、正常 EOF 退出。
另有适配器测试覆盖提前完成通知、错误回传、配置期间取消、来源隔离和取消后的图片保存清理。

实际检查结果：

| 检查 | 结果 |
| --- | --- |
| `npm run check:arch` | 通过；没有新增违规，组合层调整消除 10 条既有边并收紧 baseline |
| 前端与 Host `tsc --noEmit` | 均通过 |
| provider、注册、问题模型/历史/表单定向测试 | 60 项通过 |
| 真实 DSH bridge 与 profile 准备 | 17 项通过，其中 12 项使用实际 CLI 进程；包含跨进程迟到回答 |
| Windows/npm launcher 定向文件 | 5 项通过、2 项按平台跳过；包含 dsh shim |
| Host 问题控制与迟到回答场景 | 4 项通过；同时验证现有 Codex 行为 |
| 移动端 DeepSeek 问题保留命令 | 1 项定向测试通过 |
| `npm run check:rust` | fmt、Clippy 通过；573 项通过、1 项忽略 |
| `git diff --check` | 通过 |

相关命令：

```sh
npm run check:arch
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p host/tsconfig.json
node node_modules/vitest/vitest.mjs run src/integrations/harness/providers/deepseek/ src/features/sessions/model/questionHistory.test.ts
node node_modules/vitest/vitest.mjs run --config host/vitest.config.ts host/deepseek-bridge.test.ts host/deepseek-live.test.ts
npm run check:rust
```

真实运行时测试需通过 `OMNICODE_TEST_DSH` 指向已经安装的 dsh 可执行文件或 Node entry。
Rust 检查在缺少桌面打包资源的工作树中使用 `TAURI_CONFIG={"bundle":{"resources":[]}}`；
测试临时目录放在用户 home 之外，避免既有 MCP 发现测试继承本机祖先目录的配置。

## 尚未验收或未开放的能力

- 真实远程模型认证、计费推理、原生桌面 UI 与真实手机操作尚未做端到端验收。
- Linux、macOS 与独立 Linux/WSL Host 未在本次实际运行；共享 WSL Host 明确返回不支持，未承诺跨系统共享凭据与 home。
- 未增加独立的原生 DSH 历史枚举/导入、fork、rewind、手动 compact、专用账户管理或每轮 Host MCP 注入。
  现有 DSH 配置由 DSH 自己管理，OmniCode 继续恢复自己绑定的会话。
- 未运行应用构建、APK 构建、发布或 push；分支合并状态以 Git 历史为准。

## 上游依据

- [官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [ACP 的能力边界](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md)
- [ACP profile](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/acp-app/cordis.patch.yml)
- [Agent streaming 合约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/runtime-types.ts)
- [用户问题服务](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-questions/src/index.ts)
- [计划模式](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/plan/plan-mode/README.md)
- [权限 preset](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/permission-presets/README.md)
- [原生 Auto review](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/auto-review/src/index.ts)
