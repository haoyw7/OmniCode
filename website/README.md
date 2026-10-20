# OmniCode 官网

独立静态官网，版式参考 DeepSeek Harness 官网：居中首屏与柔光背景、滚动后浮起的胶囊导航、可交互的应用窗口、带循环演示的功能卡片和粒子收尾区。内容聚焦多智能体与 Bots。沿用 OmniCode 单色品牌，默认深色，浅色跟随系统，支持中英文。内容来自本仓库 README、CHANGELOG 与智能体列表，不依赖桌面或 Host 运行时。

## 本地预览

在仓库根目录执行：

```sh
node website/serve.mjs
```

访问 http://127.0.0.1:4175 。通过 `PORT` 环境变量可更改端口，Ctrl+C 停止服务。无需安装依赖或构建；也可直接打开 `index.html`。

## 内容与资源

- `index.html`：中文默认内容与 `data-en` 英文翻译。
- `styles.css`：样式、明暗主题令牌、响应式布局与全部 CSS 动画。
- `site.js`：中英文切换、入场与滚动显现、浮动导航、桌面端窗口缩放与语言同步、粒子球和命令复制。语言偏好保存在 `localStorage`，不可用时回退为中文。
- `assets/`：应用标志（同 `public/omnicode.svg`）、智能体图标（`providers/`）、Source Sans 3 和 JetBrains Mono（附 OFL 许可）。

## 桌面端窗口（`app-window/`）

首屏窗口是应用本身的静态快照，以 iframe 按 1282×802 原尺寸绘制后缩放到页面宽度：

- `index.html` 中的 DOM 来自 `tests/browser/desktop-visual.html` 夹具渲染的真实组件（空会话、运行中、已完成三种状态，以及模型选择器的全部服务商列表），中英文各一份。
- `app.css` 只保留应用样式表中与这份 DOM 匹配的规则，包含 midnight（深色）与 daylight（浅色）皮肤，随系统明暗切换。字体为应用自带的 Source Sans 3、Source Serif 4、JetBrains Mono（附 OFL）。
- 布局按真实窗口截图对齐：侧栏 224px、标题栏内的会话标签、更多按钮、更新徽标、置顶 / 聊天 / 工作流分组；输入栏显示本地、`~`、完全访问和 Codex GPT-6-Astra。
- `app.js` 只播放静态数据：打开模型选择器依次切换全部智能体并回到 Codex，输入问题并发送，回复逐字出现，会话以 Codex 图标出现在“聊天”下并显示未读点。弹出层 0.2s、消息 0.18s，缓动与项目一致；页面不可见时暂停，减少动态效果时直接显示完成状态。
- 模型选择器的每个服务商列表都是静态模拟数据：用夹具中真实的选中行与普通行结构生成，先列出 `src/features/sessions/model/models.ts` 中的内置模型，再补充应用里由实时目录提供的模型（Codex 的列表完全由 app-server 提供，夹具无法运行）。当前模型为 Codex 的 GPT-6-Astra。列表定义在 `app.js` 的 `harnessModels`。
- 侧栏会话行按 SessionCard 的紧凑布局放置未读点，并标记为当前会话。

应用界面改版后重新生成：

1. 运行 `npm run dev`，另开终端执行 `node website/tools/app-window/capture-server.mjs <捕获目录>`（仅监听 127.0.0.1:4199）。
2. 在浏览器打开 `http://localhost:1420/tests/browser/desktop-visual.html?page=workspace&mode=chat&state=running&theme=dark&lang=zh-CN`，把 `.desktop-session-pane` 的 outerHTML 存为 `run-pane.html`；`state=conversation` 存为 `conv-pane.html`；在 `desktop-pages.html` 中把侧栏会话行（`div.group`）存为 `session-row.html`。英文用 `lang=en`，文件名加 `-en`。
3. 在 `state=empty` 页面导入 `/src/integrations/harness/core/availabilityState.ts`，把全部服务商设为可用并标记已探测，然后执行 `picker.js`；刷新后执行 `assemble.js`。两种语言各做一次。
4. 在仓库根目录执行 `node website/tools/app-window/build.mjs <捕获目录>`。

功能卡片分别演示智能体选择、多个会话并行、Bot 记忆，以及 Bot 习惯与 Chief 团队委托。Bot 头像使用 `design/omnicode-brand-v10/expressions-8/` 中的 Omi 表情（静止），与应用的 Bot 头像一致。

智能体图标与应用的 `HarnessIcon` 同源，来自 `src/assets/providers/`：彩色图标（Claude Code、Codex、omp、Antigravity）复制为 `assets/providers/*.svg`；单色图标（Cursor、Grok Build、OpenCode、Pi、fx、Hermes Agent）内联为 `<symbol>`，以 `currentColor` 适应明暗主题。

## 动画

- 只用 CSS 与原生 JS，不引入动画库。缓动统一为 `cubic-bezier(0.22, 1, 0.36, 1)`，时长沿用项目约定：消息 0.18s、弹出 0.2s、面板 0.24s；功能卡片演示和背景为数秒的循环。
- 桌面端窗口与粒子球只在进入视口且标签页可见时推进，离开后暂停。
- `prefers-reduced-motion: reduce` 时关闭所有动画与过渡，桌面端窗口直接显示完成状态，粒子球只绘制一帧。
- 未运行 JS 时页面内容全部可见，桌面端窗口显示空会话（按原尺寸裁切）。

## 更新

发布新版本时同步更新首屏版本链接；应用界面改版时按上文重新生成 `app-window/`。智能体列表对应 `src/features/sessions/model/session.ts` 中的 `HARNESS_TITLE`，新增智能体时同时补充图标。下载链接指向 GitHub Releases，可用安装包以实际附件为准。

静态托管时上传 `index.html`、`styles.css`、`site.js`、`assets/` 和 `app-window/` 即可（`tools/` 只用于重新生成），支持子目录部署。`serve.mjs` 仅供回环地址本地预览。未添加发布流水线。

## VPS 部署

官网部署在本机 SSH 配置的 `vps` 主机，通过 [https://omnicode.ddlzyyy.top/](https://omnicode.ddlzyyy.top/) 访问。Cloudflare Tunnel 将这个主机名转发到 `http://127.0.0.1:80`，Nginx 仅监听本机回环地址，并已设置开机启动；官网不再提供公网 IP 直连入口，VPS 的 443 端口继续由原有服务使用。

- 站点配置：`/etc/nginx/sites-available/omnicode`，由 `sites-enabled/omnicode` 启用。
- 网站根目录：`/var/www/omnicode/current`，软链指向 `releases/<UTC 时间>/` 中的发布文件。
- 文件 SHA-256 清单：`/var/www/omnicode/manifests/`；首次部署前的 Nginx 配置备份：`/var/backups/omnicode/`。
- 访问与错误日志：`/var/log/nginx/omnicode.access.log` 和 `/var/log/nginx/omnicode.error.log`。
- Tunnel：复用 `claude-vps`（`cloudflared-claude.service`），仅追加官网路由，保留 `cp.ddlzyyy.top` 和 `api.ddlzyyy.top` 的原有路由。DNS 为 Cloudflare 自动创建的代理 CNAME，指向 `4b9cef6e-f30b-4209-bcf0-cc6367ed99f1.cfargotunnel.com`。
- Tunnel 接入前的 Nginx 配置、路由和服务状态备份，以及接入后的验证记录，保存在 `/var/backups/omnicode/tunnel-<UTC 时间>/`。SSH 和其他服务的公开入口保持原样，Tunnel 的保护范围是官网。

后续更新仍需手动发布：先校验静态资源引用与 JavaScript 语法，再上传上述静态文件至新的发布目录，核对文件校验值后原子切换 `current` 软链。修改 Nginx 配置时，先运行 `nginx -t`，通过后执行 `systemctl reload nginx`，等待新配置就绪并验证公网资源。无需构建桌面应用，也未配置自动发布钩子。
