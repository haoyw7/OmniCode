# OmniCode 官网

独立静态官网，参考 DeepSeek Harness 的蓝色柔光背景、居中首屏和产品演示布局。内容基于本仓库 README，复用现有 OmniCode 品牌，不依赖桌面或 Host 运行时。

## 本地预览

在仓库根目录执行：

```sh
node website/serve.mjs
```

访问 http://127.0.0.1:4175 。通过 `PORT` 环境变量可更改端口，Ctrl+C 停止服务。无需安装额外依赖或构建；也可直接打开 `index.html`，复制按钮会在剪贴板不可用时选中命令供手动复制。

## 内容与资源

- `index.html`：中文默认内容、英文翻译、产品说明和真实的 GitHub 下载 / 文档链接。
- `styles.css`：官网独立样式、响应式布局和减少动态效果支持。
- `site.js`：中英文切换、语言偏好保存与命令复制。
- `assets/`：仓库现有标志、Omi、桌面及移动截图、Source Sans 3 和 JetBrains Mono（附 OFL 许可）。

首屏是标明“工作区示意”的静态说明，不运行智能体，也不包含交互式会话。功能文案不承诺尚未验证的模型或平台兼容性；安装包以 Releases 的实际附件为准。网站字体独立打包，保持项目现有字体品牌。

静态托管时上传 `index.html`、`styles.css`、`site.js` 和 `assets/` 即可，支持子目录部署。`serve.mjs` 仅供回环地址本地预览。没有添加发布流水线，本次不执行构建或发布。
