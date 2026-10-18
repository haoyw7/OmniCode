# 本机开发环境重启与 APK 局域网发布

在 Linux 图形桌面的系统终端运行（不要在 MonoCode 内置终端运行，因为重启会关闭它）：

```bash
cd /home/wy/projects/monocode
npm run dev:refresh -- --dry-run  # 只检查并显示步骤、待关闭的桌面进程
npm run dev:refresh              # 实际执行完整流程
```

也可以直接运行 `bash scripts/dev-refresh.sh`。脚本从自身位置定位仓库，
无需固定当前工作目录。要求 Node.js 24+、已安装项目依赖、Rust 与 Android
构建环境，以及运行当前仓库 Host 的 `monocode-host.service` 用户服务。
执行前先通过本次改动对应的检查。

脚本依次执行：

1. `npm run host:build`，包含 Host 类型检查。
2. `systemctl --user restart monocode-host.service`，等待 Host 接受请求。
3. 关闭当前仓库的桌面开发进程，后台启动 `npm run tauri:stable`，
   等待本机桌面程序和 Vite 启动。这个模式不会因后续源码改动自动重启。
4. `npm run mobile:publish`，构建 APK 并发布到现有局域网更新源。
   手机端源码未变且对应 APK 仍是最新发布时，复用已有发布。

任一步失败都会停止后续步骤；Host 构建失败时不会重启服务或桌面。
Host 重启会中断正在运行的智能体任务；桌面重启会关闭开发窗口。
已完成的重启不会因后续 APK 构建失败而回滚。
桌面启动检查确认原生进程存在且 Vite 可访问，不替代界面功能验收。
停止旧桌面时先发送 `SIGTERM`；5 秒后仍未退出的进程收到 `SIGHUP`，
以关闭会忽略 `SIGTERM` 的内置终端 Shell。再等 3 秒后才强制结束剩余进程。
清理仅针对本次识别出的旧桌面进程树，并核对进程启动时间以防 PID 被复用。

Host 使用现有 systemd 配置及默认的 `~/.monocode-host` 数据目录。
脚本不修改服务配置、历史记录或配对信息。它检查服务的构建入口属于当前仓库；
使用已安装发行包的其他服务不能通过这个检查。

并发调用会被锁拒绝；同一锁也避免桌面局域网发布与本次开发编译重叠。
APK 发布继续使用原有并发锁和源码指纹检查。运行期间不要另外启动
`mobile:apk`、Android Studio 构建或直接 Tauri 构建。

排查日志：

```bash
journalctl --user -u monocode-host.service -n 100
tail -f build/dev-refresh/desktop.log
```

桌面启动默认最多等待 600 秒，可用
`MONOCODE_DESKTOP_START_TIMEOUT_SECONDS=1200 npm run dev:refresh` 调整。
APK 地址和发布结果由 `mobile:publish` 输出。脚本不发布桌面安装包，
也不自动给手机安装更新。

脚本的定向检查：

```bash
bash -n scripts/dev-refresh.sh
node --test scripts/dev-refresh.test.mjs
```
