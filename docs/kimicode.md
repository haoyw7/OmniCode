# Kimi Code

OmniCode 通过官方 `kimi acp` 接入 Kimi Code CLI。Provider ID 为 `kimicode`，
命令名为 `kimi`，桌面端、移动端连接的 Host 和工作流使用同一协议适配器。

安装当前 TypeScript 版 CLI（需要 Node.js 22.19 或更新版本）：

```sh
npm install -g @moonshot-ai/kimi-code
kimi login
```

也可以在设置的 Agent CLIs 中安装 Kimi Code，或配置现有 `kimi` 可执行文件的绝对路径。
完成登录后刷新 CLI 和模型列表，在模型选择器中选择 Kimi Code。
模型列表来自 CLI 配置；思考选项来自当前会话，切换模型后随 CLI 更新。
已有自定义 API 配置也可直接使用，无需 OAuth 登录。

支持文本和图片附件、流式回复和思考、工具状态、权限审批、原生提问表单、计划模式、
原生标题、取消、暖进程复用及停放后的会话恢复。恢复失败会报告错误并保留原会话绑定。
运行中的插入消息暂不支持，界面按现有机制排队。

权限映射：监督模式使用 Kimi 的 `default`；自动接受编辑也使用 `default`，只在
OmniCode 中自动允许读写类审批，命令仍需确认；完全访问使用 `yolo`；计划使用 `plan`。
用户问题与计划审批始终交给用户。Windows 与 WSL 共享凭据和会话尚未验证，因此暂不开放
共享 WSL Host；可以使用单独安装并配置 CLI 的原生 Host。

实际验证版本为 `@moonshot-ai/kimi-code` **2.2.0**。旧 Python `kimi-cli` 未验收。
本地模拟模型验证不使用真实账号，不代表已验收 OAuth 或云端模型调用。

运行协议回归：

```sh
npx vitest run src/integrations/harness/providers/kimicode
```

设置 `KIMI_CODE_ENTRY` 为官方 npm 包内 `dist/main.mjs` 的绝对路径，可额外运行真实 CLI
与本地模拟模型的测试。测试使用独立临时配置、模拟凭据与临时项目，并在结束时清理。

协议与安装依据：[官方 ACP 文档](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)、
[官方入门文档](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started)。

验证记录（2026-10-19）：

- `npm run check:arch`：通过，无新增依赖违规，注册入口迁移后收紧了 10 条旧基线。
- `tsc --noEmit`、`tsc --noEmit -p host/tsconfig.json`：通过。
- Kimi Code 的 15 项协议、生命周期和真实 CLI 测试：通过。真实 CLI 使用本地模拟模型，
  覆盖流式回复、用户提问、编辑审批、模型探测和重启恢复。
- 模型、注册表、原生标题、CLI 路径、图标、Host provider、技能与 WSL 限制的相关回归：通过。
  增补后的 ACP Host 传输测试覆盖 Cursor、Grok、fx、Hermes、Antigravity 和 Kimi Code，六项均通过。
- Rust 格式检查与 Clippy：通过。应用库首次测试为 568 通过、2 失败、1 忽略；两项既有 MCP
  测试因系统临时目录位于用户目录内而读入了本机 `node_repl` 配置，改用仓库内隔离临时目录后
  两项均通过。没有修改 MCP 源码或用户配置。Rust 检查临时使用
  `TAURI_CONFIG={"bundle":{"resources":[]}}`，跳过尚未生成的桌面 Host 打包资源。
  其余 workspace crate、主程序与文档测试目标均通过。
- Android 通知图标已检查渲染；当前环境未找到可用 JDK，Android Java 单测未运行。
  未构建 APK 或桌面安装包。
