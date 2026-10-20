# WorkBuddy 接入 OmniCode 调研

调研日期：2026-10-19，验证更新至 2026-10-20。OmniCode 基线：`057ba2e`。
状态：已实现 Windows/macOS 本地 provider。Windows 两地区真实用例与 Mac 中国版用例已分批通过；
Mac 国际版目录、问答/恢复/取消及文件审批已复验通过，但 Fast 模型识图多次失败，也有通过样本，
尚不能认定识图稳定；Balanced 单次识图通过。原登录文件首次变化及只读复验结果见末节。

## 建议

对于当前个人 fork，优先做 **WorkBuddy 内置引擎的 `stream-json` provider 原型**。
本机已验证双向初始化成功，并分别借用 WorkBuddy AI 国际版和 WorkBuddy 中国版的现有登录完成真实模型请求。
设计上可沿用 OmniCode 的子进程基础设施，让任务在本机项目目录执行；下一步验证工具审批和用户提问，再接完整聊天和文件操作。

如果目标是使用 **WorkBuddy 官方云端任务及跨端会话**，走 **Open API + ACP over SSE**。
这条路线有公开文档，但需要处理平台应用权限、服务端授权、云沙箱文件同步和新的网络传输。
公开平台文档对应中国站；不能据此认定本机 WorkBuddy AI 的账号、额度或服务区域兼容。

如果目标只是增加腾讯的本地编程 Agent，可独立接 **CodeBuddy Code CLI 的 ACP**。
它是官方支持的编辑器集成路径，但不能把该产品的登录、计费和会话等同于 WorkBuddy。
官方明确记载 WorkBuddy 使用 CodeBuddy 引擎，并提醒两者共存时隔离配置目录。
参见 [CodeBuddy 安装指南](https://www.codebuddy.cn/docs/cli/installation)及
[ACP 集成文档](https://www.codebuddy.cn/docs/cli/acp)。

## 接入路线对比

| 路线 | 执行位置与接入方式 | 对 OmniCode 的意义 | 当前证据与限制 |
| --- | --- | --- | --- |
| WorkBuddy 内置引擎 | 本机，子进程 `stream-json` | 最适合先做个人本地 provider 原型 | 初始化、现有登录复用与一次文本生成通过；内部入口随桌面版本变化，工具执行待验证 |
| 独立 CodeBuddy Code | 本机，`codebuddy --acp` | 官方支持的本地编程 Agent 路线 | 文档确认；本机没有独立 CLI，未实测，不能视为复用 WorkBuddy 额度 |
| WorkBuddy 云端任务 | Open API 创建任务，再连接 ACP SSE | 正式的 WorkBuddy 云端会话集成 | 文档确认；需要应用权限、授权后端、传输与文件同步 |
| WorkBuddy 本地助理 API | 经 WorkBuddy 云服务向在线 PC 助理发消息、轮询历史 | 可做远程委派或桥接 | 文档未提供独立多会话的完整控制契约，不宜直接当作项目 provider |
| 分享 / deeplink | 唤起 WorkBuddy，预填任务输入 | 可做“交给 WorkBuddy”入口 | 分享成功不代表任务提交，没有完整会话回传契约 |
| MCP + Skill 连接器 | WorkBuddy 调用 OmniCode 暴露的工具 | 适合反向集成 | 方向是 WorkBuddy → OmniCode，不能替代 OmniCode 的 Agent provider |

官方来源：[Open API](https://open.workbuddy.cn/docs/openapi)、
[第三方应用与分享](https://open.workbuddy.cn/docs/third-party-app)、
[连接器](https://open.workbuddy.cn/docs/connector)。表中的优先级与适配判断是结合本仓库架构作出的推断。

## 本机实测

### 环境与边界

- Windows，Node.js `v24.20.0`。
- 国际版 WorkBuddy AI `5.8.4`，可执行文件产品版本为 `5.8.4.0`，安装目录为 `%LOCALAPPDATA%/Programs/WorkBuddyAI`。
- 中国版 WorkBuddy `5.8.3`，官方安装包版本 `5.8.3.41334564`，安装目录为 `%LOCALAPPDATA%/Programs/WorkBuddy`；已安装并完成登录，可与国际版并存。
- 内置 CLI：`resources/app.asar.unpacked/cli/bin/codebuddy`。
- 内置 bundle：`resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs`。
- 两版的 `bin/codebuddy --version` 均实际返回 **`2.161.0`**。包根 `version` 为 `0.0.0`，发布版本位于 `publishConfig.customPackage.version`，不能只读根版本。
- `Get-Command workbuddy,codebuddy` 未发现 PATH 中的独立命令。

最初的国际版初始化和直接 ACP 探测使用临时配置，不读取现有登录凭证，也不发送模型请求。
后续登录验证按用户要求，分别在内存中解读两版的现有 access token 并发起极小模型请求，见下节。
所有验证均使用临时工作目录，隔离 `CODEBUDDY_CONFIG_DIR` 与 `WORKBUDDY_CONFIG_DIR`，
关闭自动更新，没有修改 WorkBuddy 安装内容。登录验证额外启用仅内存凭证模式。
探测进程已退出，临时脚本、配置与日志在调研后清理。

### `stream-json`：初始化通过

在子进程环境设置 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`，执行：

```text
node <WorkBuddyAI>/resources/app.asar.unpacked/cli/bin/codebuddy \
  -p --input-format stream-json --output-format stream-json --verbose
```

以上为参数示意；Windows 应按参数数组启动，不经 shell 拼接。向保持打开的 stdin 写入一行：

```json
{"type":"control_request","request_id":"omnicode-research-init","request":{"subtype":"initialize"}}
```

收到对应的 `control_response`，`response.subtype` 为 `success`，
`response.request_id` 匹配。响应内容包含 `commands`、`output_style`、
`available_output_styles`、`models`、`account`、`currentModelId`。
stdout 没有非 JSON 行，stderr 为空；收到初始化响应后终止该探测子进程。

这个初始化探测只验证控制协议；登录和文本生成的进一步验证见下节。完整工具审批、
会话恢复与附件仍需单独验证。官方
[SDK 权限文档](https://www.codebuddy.cn/docs/cli/sdk-permissions)提供动态审批和
`AskUserQuestion` 的接入机制，可作为下一阶段实现依据。

### 现有登录可借用并完成模型请求

**Windows 当前用户下，WorkBuddy AI 5.8.4 国际版和 WorkBuddy 5.8.3 中国版的现有登录，
均可以借给各自的内置 CLI 2.161.0，无需重新登录或创建 API Key。** 两站均使用各自的个人账号验证。

| 配置 | 国际版 | 中国版 |
| --- | --- | --- |
| 服务域名 | `www.workbuddy.ai` | `www.workbuddy.cn` |
| 产品认证标识 | `workbuddy-desktop-ai` | `workbuddy-desktop` |
| 登录文件名 | `workbuddy-desktop-ai.info` | `workbuddy-desktop.info` |
| 原应用配置目录 | `%USERPROFILE%/.workbuddy-ai` | `%USERPROFILE%/.workbuddy` |
| 初始化返回模型数 | 4 | 9 |

两份登录记录均位于 `%LOCALAPPDATA%/CodeBuddyExtension/Data/Public/auth/`，
`auth.accessToken` 与 `auth.refreshToken` 使用 `$wbEncrypted` 封装，不能当作明文 token 直接读取。
已安装 WorkBuddy 的 Electron 37.10.3 / Node.js 22.21.1 运行时，在
`ELECTRON_RUN_AS_NODE=1` 模式下可提供其原生存储入口。验证使用该入口与原程序的解密实现，
只在内存中解读 access token，未解密或使用 refresh token。

| 验证 | 国际版实际结果 | 中国版实际结果 |
| --- | --- | --- |
| 登录记录解读 | access token 可解密，JWT 主体匹配，尚未过期 | 同样通过，issuer 为中国站 |
| OpenID 身份验证 | 身份发现及 userinfo 均 HTTP 200，身份匹配 | 身份发现及 userinfo 均 HTTP 200，身份匹配 |
| 内置 CLI 初始化 | 控制初始化成功，返回 4 个模型及账号字段 | 控制初始化成功，返回 9 个模型及账号字段 |
| 真实模型请求 | `fast-model`、禁用工具，返回 `WB_AUTH_OK`；`success` 且 `is_error=false` | 相同设置，返回 `WB_CN_AUTH_OK`；`success` 且 `is_error=false` |
| 原登录文件 | 验证前后的 SHA-256 一致 | 验证前后的 SHA-256 一致 |
| 临时文件 | 检查 25 个文件，未发现明文 access token | 检查 16 个文件，未发现明文 access token |

国际版请求报告 `input_tokens=219`、`output_tokens=5`；中国版为 `input_tokens=41`、`output_tokens=92`。
两次请求的 CLI `total_cost_usd` 均为 `0`，
但没有核对 WorkBuddy 积分账单，不能据此认定没有积分消耗或独立 CodeBuddy 共享相同额度。

传给引擎的关键配置如下；token 只进入子进程环境，不放在命令行参数或持久化配置中：

```text
CODEBUDDY_AUTH_TOKEN=<仅在内存中取得的现有 access token>
CODEBUDDY_CREDENTIALS_IN_MEMORY=1
CODEBUDDY_FORCE_LITE_WB_BUNDLE=1
ACC_PRODUCT_CONFIG_PATH=<WorkBuddy 安装目录>/resources/app.asar.unpacked/cli/product.json
CODEBUDDY_CONFIG_DIR=<OmniCode 隔离配置目录>
WORKBUDDY_CONFIG_DIR=<OmniCode 隔离配置目录>
```

`CODEBUDDY_AUTH_TOKEN` 是官方 [身份和访问管理文档](https://www.codebuddy.ai/docs/cli/iam)
支持的既有 Bearer token 输入方式。取得加密登录记录的原生入口及仅内存凭证开关则属于
当前版本的内部能力，后续 adapter 应检测版本和入口是否可用，不能作为跨版本稳定接口。
两版均使用已安装 WorkBuddy 的 Node 模式，不启动新的 WorkBuddy 窗口。
产品配置、认证文件与身份接口必须匹配同一区域；本次没有将一站凭证发送给另一站，也未验证跨站账号或额度互通。

接入时适合增加一个本机认证桥：读取原登录、在内存中交给引擎、使用 OmniCode 独立配置。
遇到 401 时先重新读取由 WorkBuddy 维护的登录记录；刷新及重新登录继续由 WorkBuddy 管理，
避免双方操作同一 refresh token。初始化响应中的 `account` 含 `token` 字段，
必须在记录诊断或保存会话前剔除。移动端经 Host 使用该能力，凭证保留在执行端。

### 内置 bundle 的直接 ACP stdio：本次探测未通过

同一隔离配置下启动：

```text
node <WorkBuddyAI>/resources/app.asar.unpacked/cli/bin/codebuddy \
  --acp --agent cli --permission-mode default
```

向 stdin 发送标准 ACP `initialize`，未收到 JSON-RPC 响应；进程自行以 `0` 退出。
隔离日志包含 `No acp-connection-id in request headers` 和
`Cannot get AcpAgent, aborting render`。因此，**内置 lite bundle 的 help 虽列出
`--acp`，仍不能据此认定它可直接作为独立 ACP stdio server 使用**。
这个结果仅限上述启动方式和版本，不否定独立 CodeBuddy CLI 的官方 ACP 能力，
也未验证 WorkBuddy 自己的宿主启动流程。

WorkBuddy 宿主会向引擎传入产品配置、配置目录及区域等环境信息。
上节已验证显式传入产品配置与借用的 token 可以执行文本生成；仅设置配置目录仍不足以完成登录集成。

## 本地 provider 如何接进现有架构

现已新增独立 `workbuddy` provider，保持 WorkBuddy 与 Claude 的身份、配置和会话分离。
两者都有 `control_request` / `control_response` 外形，但不代表协议与启动参数完全兼容。

| 位置 | 接入内容 |
| --- | --- |
| `src/integrations/harness/providers/workbuddy/` | adapter、生命周期、消息/控制协议解析、动态模型目录及执行侧认证桥 |
| `src/integrations/harness/core/registry.ts`、`types.ts` | 复用 `HarnessAdapter` 与 `HarnessEvent`，映射消息、工具、问题、审批、图片和完成事件 |
| `src/integrations/harness/core/child.ts` | 复用 spawn / watch / write / kill，不在 UI 直接管理进程 |
| `src/integrations/harness/providers/workbuddy/workbuddyProtocol.ts` | 独立处理 WorkBuddy 的 `allowed` 响应、字符串请求 ID 和启动参数 |
| `src/integrations/harness/register.ts`、`core/availability.ts` | 注册 provider，分别检查安装与运行能力；与 DSH 共用主树注册入口，入口位于 core 之外 |
| `src/features/sessions/model/session.ts`、`models.ts` | 扩展 `HarnessId`、显示名、模型和默认选择；模型目录可基于初始化响应解析 |
| `src/integrations/harness/core/provider.ts`、`host/process.ts`、`src-tauri/src/harness.rs` | 补 Host/provider 身份、Windows/macOS 路径与启动器解析；探测已安装引擎和 Node，不复制内置引擎进安装包 |
| `src/features/providers/model/providerAccounts.ts`、`host/provider-accounts.ts` | 增加本机登录桥，隔离配置、仅在内存中传递 token，处理登录变更并验证与 WorkBuddy 共存 |
| `src/features/sessions/ui/HarnessIcon.tsx`、`src/shared/i18n/` | 加图标及本地化；桌面和移动端复用 `HarnessIcon` / `sessionDisplayTitle` |

实现时需要保留的行为边界：

1. **审批与提问**：保留 provider 的字符串 `request_id`，通过映射关联 OmniCode 的数字请求 ID；区分普通工具审批和 `AskUserQuestion`，保留多选、自填答案。取消和关闭时结束待处理请求。
2. **参数差异**：本机 lite bundle 没有 `--permission-prompt-tool`，不能照搬 Claude 的 `--permission-prompt-tool stdio`。先验证 SDK 控制通道的审批协商，不靠默认跳过权限来通过验证。
3. **会话生命周期**：验证原生 `session_id`、继续、重启恢复、取消和空闲停驻；不把退出码当作长连接中的回合结束信号。
4. **后台任务**：持续读取流，不在第一个 `result` 后停止。官方 [headless 文档](https://www.codebuddy.cn/docs/cli/headless)说明后台任务可能在本轮结果后继续推送完成事件。
5. **能力声明**：模型、运行中追加消息、压缩、回退和附件都按实际能力开放；未验证的功能不能因为其他 provider 支持而默认开启。
6. **桌面与 Host**：复用同一协议 adapter，分别验证运行环境、附件路径与生成图片持久化；移动端通过 Host 使用，不能直接启动 PC 引擎。
7. **配置与分发**：Windows 当前版本的国际站和中国站个人登录复用均已通过；按安装版本匹配区域，使用独立 OmniCode 配置，其他平台及额度行为分别验证。不要直接改写 WorkBuddy 的设置、加密认证存储或原生历史。

## 官方云端方案的额外工作

官方 [Open API 文档](https://open.workbuddy.cn/docs/openapi)给出的核心链路是：

```text
用户授权 → 创建/查询任务取得 link、token → GET SSE 接收消息
         → POST JSON-RPC，关联 Acp-Connection-Id
         → initialize → session/load(task_id) → session/prompt
```

`session/update` 承载流式事件，`session/request_permission` 承载需要应答的用户交互；
`session/prompt` 的 response 是本轮结束信号。断线或凭据过期需要重新查询任务并重建连接。

对照源码，当前 `AcpClient` / `JsonRpcClient` 的发送路径绑定 `writeChild`；
桌面与 Host 的 `harness_http` / `harness_sse_open` 限制为本地 HTTP，SSE 接口也没有
返回建连响应头。因此这不是换一个 URL 就能接通的方案，需要：

- 新增有范围约束的 HTTPS/SSE transport，取得并维护连接 ID；保留现有 localhost 通道的限制。
- 把 JSON-RPC 调度与传输解耦，或先在 WorkBuddy provider 中隔离实现；保留请求 ID 原类型，避免 `AcpClient` 当前的数字转换破坏服务端请求。
- 对接授权后端。平台要求应用凭据，不能把共享 `client_secret` 打包到桌面或移动端；可使用受信任的自托管 Host 或独立授权服务。
- 明确本地仓库如何进入云沙箱、产物如何回收；云端的 `/workspace` 不能直接解释为本机项目路径。
- 验证取消、历史回放去重、审批超时和附件；确认创建任务中的初始 prompt 是否已触发执行，避免后续重复发送。文档存在产物 URL 示例不一致、token 有效期描述不一致等细节，应以实际响应及后续联调为准。

平台 [第三方应用文档](https://open.workbuddy.cn/docs/third-party-app)当前把完整 API 权限主要列在
“硬件接入”类型下，通用桌面客户端能否取得任务权限需要确认。这是官方云 API 的准入问题，
不影响个人 fork 继续验证本地引擎原型。该文档描述的是需要密钥的授权流程，不能把
“WorkBuddy 作为 MCP 客户端时支持 PKCE”误当成“Open API 已支持无密钥桌面公共客户端”。

本地助理 API 可用于委派，但已公开的发送参数没有项目目录或独立会话选择项，
消息通过历史轮询获取；多 OmniCode 会话隔离、明确终态和取消语义尚无足够证据。
分享入口则只预填输入，不能作为完整 provider 的替代。

## 本地 provider 实现与验收（2026-10-19）

现已新增独立 `workbuddy` provider。Windows 桌面和 Windows Host 共用
`workbuddyRuntime.cjs`：按安装产品配置识别中国版与国际版，在执行机器上解密既有登录，
凭证仅经子进程环境传给内置引擎，不进入 UI、Host 协议或应用账号缓存。
配置与原生会话放在 OmniCode 自己的账号目录；不改写 WorkBuddy 登录、设置或原生历史。
认证桥依赖当前安装版本的内部入口，升级后不兼容时会报错，不能自动换账号或地区。

已接入的功能：

- 按地区发现模型及只读账号；模型与账号地区必须一致，既有会话锁定原账号。
- `stream-json` 初始化、增量正文/推理、工具结果、允许/拒绝审批，以及单选、多选和自由回答。
- 拒绝工具时，WorkBuddy 原生引擎可能取消同批并行工具；适配器逐项回传决策，不自动重试。
  工具结果早于开始声明时先缓存结果，避免拒绝后的工具卡片停留在运行状态。
- 多轮常驻进程、停止后原生 `--resume` 恢复、取消后继续；过滤恢复回放与子任务的父会话终态。
- 图片以原始字节发送；ImageGen/ImageEdit 结果在执行机器读取后传递。
  桌面等待资产保存，Host 使用普通私有附件持久化；支持 PNG、JPEG、WebP。
- 桌面、移动端账号展示和 WorkBuddy 图标；沿用现有会话标题显示及共享菜单尺寸。
  新增应用文案提供中文翻译，供应商模型名和用户文本保持原样。
- 本节记录 Windows 首轮验收；2026-10-20 新增的 macOS 接入和实测范围见下一节。
  WSL 和 Linux 执行环境仍不可用。

本机实际版本：WorkBuddy 中国版 `5.8.3`、国际版 `5.8.4`，两版内置 CLI 均为 `2.161.0`。
通过真实 Host 后端验证了两版的提问、多轮、停止后恢复、取消后再次发送和原登录文件校验值不变。
两版真实文件读写、允许/拒绝审批、红色 JPEG 识图均已通过；中国版 ImageGen 生成后保存为 Host 附件也已通过。
真实用例分批运行。最终文件测试将允许和拒绝拆成独立轮次，避免原生并行批次取消语义影响断言；
中国版一次超时后补上按阶段超时诊断并复验通过。适配器同时补齐无工具 ID 的审批活动识别，
防止将拒绝后的零 API 时长终态误判为启动空结果。

已运行的检查与结果：

| 检查 | 结果 |
| --- | --- |
| WorkBuddy 协议、运行时和生命周期测试 | 23 项通过；含账号读取/进程启动期间取消、连续发送、迟到图片清理和乱序工具结果 |
| 账号、移动默认值、图片校验、本地化、认证、registry、apply 定向测试 | 分别 17、17、9、7、8、18、87 项通过 |
| Host 发现、附件、子进程与账号测试 | 分别 3、6、17、5 项通过 |
| 真实 Windows Host 用例 | 双地区目录 1 项、双地区问答/恢复/取消 2 项、双地区文件/识图 2 项、中国版生成图片 1 项，均已分批实测通过 |
| `npm run check:arch` | 通过；636 条既有基线边，无新增违规 |
| TypeScript：应用与 Host 的 `tsc --noEmit` | 通过 |
| Rust 格式及 Clippy | 通过；本次检查用临时 `TAURI_CONFIG` 将 `bundle.resources` 设为 `[]`，避开尚未构建的 `build/desktop-host`，未修改打包配置 |
| Rust 应用测试 | 原环境 569 项通过、2 项 MCP 发现测试失败、1 项既有 SSH 用例跳过；两项失败在隔离临时目录中复验通过 |
| Rust supervisor / process-tree 测试 | supervisor 2 项通过；Windows 下其余对应测试目标为 0 项 |

上述 MCP 失败与本轮未改动的 `src-tauri/src/mcp.rs` 有关：Windows 用户临时目录位于真实用户目录下，
发现逻辑沿父目录读到了用户自己的 `node_repl` MCP 配置。复验只为测试指定带 `.git` 边界的独立
`TEMP` / `TMP`，未改动用户 MCP 配置、未修改该模块，也未将原始整次 Rust 检查记为全绿。

自动验证入口：

```powershell
# 常规测试不访问真实登录或模型。
npm exec -- vitest run src/integrations/harness/providers/workbuddy
npm exec -- vitest run --config host/vitest.config.ts host/workbuddy.test.ts

# 显式启用本机真实登录和模型请求；ImageGen 另行启用，会产生真实图片请求。
$env:OMNICODE_WORKBUDDY_LIVE = '1'
$env:OMNICODE_WORKBUDDY_IMAGEGEN = '1'
npm exec -- vitest run --config host/vitest.config.ts host/workbuddy-live.test.ts
```

未进行桌面/手机界面的真实点击验收、登录过期后的真实刷新及积分账单核对。
生成图片恢复后的界面引用、ImageEdit、其他权限模式也未作真实验收。
本次不构建安装包、不发布、不提交或推送。

## macOS 接入与 Devin CLI 验证（2026-10-20）

桌面 Rust 启动器与 Host 的共同桥现已识别 macOS 安装。依次发现
`~/Applications`、`/Applications` 下的 `WorkBuddy.app` 和 `WorkBuddy AI.app`，
也接受手动配置的 `.app` 或内部可执行文件。两版实际的主程序名都是
`Contents/MacOS/Electron`；从 bundle 中识别唯一主程序，并校验 CLI 产品的地区/认证 ID 配对，
不按应用文件夹名猜测账号地区。

资源目录为 `Contents/Resources`，内置 CLI 位于 `app.asar.unpacked/cli`。
按[官方 FAQ](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/FAQ)，
登录发现使用 `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/`；
同时核对当前安装包的 `FilePathServiceImpl.getBasePath/sharedDataPath` 和认证存储路径，确认该目录仍在使用。
OmniCode 自己的默认配置位于 `~/Library/Application Support/OmniCode/workbuddy/`。
Windows 的既有数据路径保持不变。认证代码仍只在执行机器解密，账号/地区锁定规则共用。

通过本机已登录的 Devin CLI `3000.11.92 (7f4e64980e22)` 创建并连接了
[macOS 验证会话](https://app.devin.ai/sessions/b5bc92070f85464eb2051393c760bc22)。
实际环境为 macOS `26.6.2`（`25G83`）、`arm64`，测试进程 Node `24.21.0`，
WorkBuddy 自带 Electron Node `22.21.1`。从两站官方公开更新入口取得 macOS 安装包，
安装后验证实际 CLI `--version`。首轮使用合成登录；后续由用户在同一验证会话中完成
中国版、国际版客户端登录，继续真实请求验收，全程未转移 Windows 凭证。

| 项目 | 中国版 | 国际版 |
| --- | --- | --- |
| 实际应用版本 | `5.8.3`，官方更新版本 `5.8.3.41334564` | `5.8.4`，官方更新版本 `5.8.4.41366630` |
| 内置 CLI 实际版本 | `2.161.0` | `2.161.0` |
| `.app` / 主程序 / CLI 发现 | 通过 | 通过 |
| `ELECTRON_RUN_AS_NODE=1` | 通过 | 通过 |
| 原生 `electron_browser_workbuddy_storage` 与对称加密能力 | 可用 | 可用 |
| 合成字段加密/解密往返 | 通过 | 通过 |
| 无登录的原生 stream-json 初始化 | 成功，9 个模型 | 成功，4 个模型 |
| 完整桥：合成登录解密、模型目录、流式初始化、凭证脱敏 | 通过 | 通过 |
| 真实登录后的模型目录 | 通过，9 个模型 | 通过，4 个模型 |
| 真实问答、多轮、恢复、取消后继续 | 通过 | 禁止测试进程写登录目录后复验通过；首次登录文件校验失败，见下文 |
| 真实文件读写、允许/拒绝审批 | 通过 | 通过 |
| 真实图片识别 | 通过 | Balanced 单次通过；Fast 存在成功及失败样本，稳定性未通过 |
| 真实 ImageGen 与 Host 附件保存 | 通过 | 未运行 |

原生认证模块在两版 Mac 包中均使用 `D/G/R/K` 导出；`R` 在调用 `D()` 后才初始化，
现有桥已按该顺序加载。完整桥验证使用实际应用原生加密接口创建合成 JWT 字段，
仅写入独立临时 HOME，并用 `sandbox-exec` 禁止网络访问；没有发出模型请求。
桥返回 13 个带地区前缀的模型，输出不含合成 access/refresh token，合成登录文件校验值不变。
这证明当前 Mac 安装版本的启动、解密和协议初始化路径可运行，不能替代真实用户登录与对话验收。

本轮其他检查：

- 同一份源码在 Devin Mac 上的 WorkBuddy 运行时/协议/生命周期与 Host 发现测试：32 项通过。
  使用只包含依赖源码的隔离测试目录，Vitest `3.2.7`；未构建或发布应用。
- Windows 对应测试：29 + 3 项通过；双地区真实登录模型目录复验 1 项通过，5 项其他真实用例未重跑。
- 应用与 Host 的 `tsc --noEmit` 通过。
- `npm run check:rust` 通过：格式、Clippy、573 项应用测试、2 项 supervisor 测试；1 项既有用例跳过。
  使用带 `.git` 边界的隔离 `TEMP/TMP` 避免读取用户 MCP 配置，临时 `TAURI_CONFIG` 关闭资源检查，
  未修改打包配置。新增 2 项 Rust 发现测试覆盖两平台目录、Mac bundle、地区不匹配和缺失 CLI。
- `git diff --check` 通过。

用户登录中国版后，使用相同源码和真实 Host 后端（Node provider guard）继续验证：

- 读取到中国版只读账号并成功解密既有登录；真实模型目录返回 9 个地区匹配的模型，无初始化错误。
- 问答、多轮、停止后原生恢复、取消待答问题后继续发送：1 项通过，约 36.4 秒。
- 文件读取、允许写入、拒绝写入、红色 JPEG 识别：1 项通过，约 38.1 秒。
- 实际 ImageGen 生成一张图片并保存成 Host 私有附件：1 项通过，约 23.6 秒。
- 问答用例和生图用例前后的中国版登录文件校验值均未改变；临时会话和测试目录正常清理。

真实用例分两次定向运行：先运行中国版问答与文件/识图用例（2 项通过，4 项跳过），
再运行中国版生图用例（1 项通过，5 项跳过）。没有把跳过的双地区目录或国际版用例计为通过。
测试时再次核对版本：中国版 `5.8.3`、国际版 `5.8.4`，两版内置 CLI 均为 `2.161.0`。

```sh
OMNICODE_WORKBUDDY_LIVE=1 npm exec -- vitest run --config host/vitest.config.ts host/workbuddy-live.test.ts -t '^runs cn'
OMNICODE_WORKBUDDY_LIVE=1 OMNICODE_WORKBUDDY_IMAGEGEN=1 npm exec -- vitest run --config host/vitest.config.ts host/workbuddy-live.test.ts -t 'receives and persists an actual generated image'
```

用户登录国际版后，继续使用相同版本和真实 Host 后端验证：

- 双地区模型目录通过：合计 13 个模型，账号和地区匹配，无凭证字段泄漏。
- 首轮国际版定向运行：1 项通过、2 项失败、3 项跳过。问答、恢复、取消等行为断言通过，
  但最终国际版登录文件 SHA-256 发生变化；另一项在识图断言失败，回复没有收到图片。
  原始结果保留在 Devin 验证目录的 `live-global.log`，不记为整轮通过。
- 用 `sandbox-exec` 对测试进程及其子进程禁止写入原登录目录后，原问答/恢复/取消用例复验通过，
  约 17.6 秒，登录文件校验值一致（`global-questions-readonly.log`）。此规则仅作用于本次测试进程树，
  不修改系统设置。后续独立图片探测的登录文件也保持不变。
- 原文件审批/识图用例在未注入诊断代码时复验通过，约 15.2 秒（`global-files-recheck.log`）；
  文件读取、允许写入和拒绝写入均通过，拒绝的目标文件未创建。

首次登录文件变化发生在首轮测试开始后约 4 秒。WorkBuddy GUI 日志存在认证存储写入记录，
但尚未取得足以归因到这次变化的时间证据；后续空闲采样未再变化。只读复验说明适配器在禁止
写原登录目录时仍能完成上述流程，不能用它抹去首次失败，也不能断言首次变化一定来自 GUI。

国际版图片对照使用相同账号，未传输凭证。原始夹具是 16×16、634 字节的纯红色 JPEG：

| Mac 国际版探测 | 实际结果 |
| --- | --- |
| Fast，全新会话，原始 JPEG | 回复没有图片；后续独立会话又将红色答成 Green |
| Fast，全新会话，另行生成的 256×256 红色 PNG | 同样回复没有图片，不能只归因于原始小图 |
| Balanced，全新会话，原始 JPEG | 回复 Red，单次通过，约 9.0 秒 |
| Fast，临时原生请求探针下的原始 JPEG | 回复 Red；探针只记录到加载，未取得实际 API 请求内容，不能据此判断转发原因 |
| Fast，恢复原始运行时后的既有文件/识图用例 | 回复通过识图断言，但此前和之后仍有失败样本 |

适配器发出的图片内容块及引擎回显均含正确 MIME 和完整字节数，图片输入没有在 Host 到引擎之间丢失；
尚未确认引擎到服务端的实际图片转发情况，根因仍未定位。安装产品配置将这些模型声明为支持图片，
本轮未据单次失败硬编码模型能力、切换默认模型或放宽现有识图断言。
同账号 Windows Fast 对照识别为 Red，但该临时探测在目录清理时遇到 `EPERM`，整项不记为通过；
残留目录随后已清理。Mac 最后一次三次重复探测仅首例真正发送了请求，另外两例因临时测试桥
生命周期配置错误在发送前失败，未计入模型样本。

诊断完成后已移除临时测试、原生预加载脚本和残留测试目录，恢复 Mac 运行时，并核对其 SHA-256
与当前本地源码一致。诊断日志保留在 Devin 会话的 `/Users/devin/omnicode-workbuddy-validation/`。
本轮未修改生产代码；国际版 Fast 图片稳定性仍待解决，不能宣称 Mac 国际版全部兼容。

Apple Silicon 的上述范围已实测。国际版 ImageGen、Intel Mac、OmniCode Mac 桌面 UI、
Rust 的 Mac 目标整项目检查、ImageEdit 仍未验收。
`host/workbuddy-live.test.ts` 已允许 macOS；在执行机器登录两地区账号后，可用
`OMNICODE_WORKBUDDY_LIVE=1 npm exec -- vitest run --config host/vitest.config.ts host/workbuddy-live.test.ts`
运行既有真实用例，ImageGen 仍需单独设置 `OMNICODE_WORKBUDDY_IMAGEGEN=1`。

## 与已接入 DSH 的 main 合并验证（2026-10-20）

以主树 `4915c75` 为基线合入 WorkBuddy，保留 DeepSeek 的注册、模型设置、桥接启动及常驻会话行为。
两者共用 `src/integrations/harness/register.ts`，移除重复入口；Host 既有 raw 资源加载器同时接受
DSH 的 `.mjs` 和 WorkBuddy 的 `.cjs`。联合注册断言确认两者各注册一次，保留不同的执行中追加消息能力。

- 应用与 Host 的 TypeScript 检查通过；架构检查通过，636 条基线边，无新增违规。
- 两 provider 及共享 registry、会话、模型、账号、图片、移动默认值的定向测试：11 个文件、232 项通过。
  新增联合注册断言后，registry 的 18 项复验通过。
- `npm run check:rust` 通过：格式、Clippy、574 项应用测试、2 项 supervisor 测试；1 项既有用例跳过。
  继续使用隔离临时目录及进程级 `TAURI_CONFIG`，未修改打包配置。
- Host 定向组首次为 158 项通过、15 项失败、4 项跳过；WorkBuddy 发现、DSH 桥准备、附件及进程解析组通过。
  失败集中在会话启动/进程等待、Git 工作树和 checkpoint。停止并行 Rust 检查后定向复验：
  6 项通过、10 项失败。使用 main 原始 `host/engine.ts`、`host/server.ts` 及对应测试进行对照，
  11 项中 3 项通过、8 项失败，复现 checkpoint 的 `undoLocked` 断言差异及 Git 等待失败；
  部分等待用例结果随运行变化。此 Host 组不能记为全绿，未为本次合并修改无关的撤销或工作树实现。
- 临时基线文件已清理，未构建或发布安装包，也未重跑真实付费模型请求。

以上检查针对待合并的已提交代码组合；主工作树原有的其他未提交开发内容另行保留，不纳入此合并提交。
