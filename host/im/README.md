# IM 渠道

独立的 IM 渠道接口、飞书个人私聊渠道与按需加载的 npm 适配器。飞书通过
官方 Node SDK 的 WebSocket 连接；Telegram、微信和 QQ 仍只有加载入口。
导入模块不会建立连接。

```text
host/im/
  core/
    types.ts              # 渠道、消息与路由处理契约
    registry.ts           # 按渠道配置实例注册
    router.ts             # 消息交付和原渠道回复
    sessionMap.ts         # 内存会话绑定
    runtime.ts            # 显式注册、启停和失败清理
    errors.ts             # 发送失败分类
    im.test.ts            # 骨架回归
  providers/
    feishu/adapter.ts      # 飞书 SDK 工厂按需加载与配置类型
    feishu/channel.ts      # 本人私聊、收发、附件与连接状态
    feishu/registration.ts # 浏览器创建/绑定个人机器人
    telegram/adapter.ts    # Telegram SDK 工厂按需加载与配置类型
  index.ts                # 公共接口、渠道注册与运行时启停
  index.mjs               # 兼容先前 JS 加载入口
  package.json
  package-lock.json
```

## 使用边界

`ImChannel` 声明 `start(onMessage)`、`stop()` 和 `send(threadId, message)`。
平台实现负责认证、原生协议收发与消息转换。`ImRuntime` 管理调用方显式
注册的渠道，导入或注册均不自动启动连接。
未注册渠道时调用 `start()` 会报错。

通过 `new ImRuntime({ onMessage })` 注入消息处理函数，再用 `register(channel)`
注册实际渠道实现、`start()` / `stop()` 显式控制生命周期。消息处理函数收到
原始消息、可选 sessionId 和 reply 函数；reply 使用消息原来的渠道与 thread。
没有自动回复、agent 或机器人业务逻辑。

`runtime.sessions.bind({ channelId, threadId }, sessionId)` 建立绑定；get 和
unbind 查询或移除。channelId 区分多个平台账户 / 配置实例，不能只用平台名。
映射仅保存在内存中，不创建或持久化 OmniCode 会话。

启动失败按逆序清理已尝试启动的渠道，清理失败可再调用 stop 重试。
启停期间拒绝重入；关闭后或旧运行期的消息与回复被拒绝。

## 飞书个人私聊

设置页通过「一键绑定飞书」生成官方授权链接，在浏览器完成授权（飞书页面可能
要求客户端扫码）后自动连接，无需手填 App ID、App Secret 或 open_id。
`registration.ts` 使用官方 `@larksuite/openclaw-lark-tools@1.0.47` 的个人机器人
注册协议：`https://accounts.feishu.cn/oauth/v1/app/registration` 的 init、begin、poll。
这不是单独的用户 OAuth 登录；它会返回机器人凭证及授权人的 open_id。
此流程不再追加文档、日历等用户 OAuth 授权。

Host 的 `im.bind` 接受 `start`（可附界面语言）或 `cancel`（附本次绑定 ID），
通过 `im.get.binding` 返回链接、有效期和状态；客户端依赖 `im.feishu.binding.v1`
能力。device_code 仅保留在 Host 内存，App Secret 只保存到原有 Host 配置。
不需要公网回调地址；Host 负责按服务端间隔轮询、限流退避和过期处理。
取消、失败或过期不改写当前配置，Host 关闭会中止请求；新授权成功后才替换
旧连接并停止旧绑定的待投递消息。原有配置和 `im.configure` 接口继续可用。
支持飞书账号；Lark 账号会明确报错，不会误连到飞书消息接口。

`FeishuChannel({ id, appId, appSecret, ownerOpenId })` 只接收指定 `open_id`
用户发送的私聊文本、富文本、图片和文件；群聊和机器人消息不会交给处理器。
`id` 应使用当前绑定的唯一标识。私聊 `threadId` 为飞书 `chat_id`。
应用需启用机器人能力并订阅 `im.message.receive_v1` 长连接事件。

`start(handler)` 等待真实 WebSocket 握手；连接状态通过 `status()` 查询。
SDK 负责连接中断后的重连，启动总超时为 30 秒，停止会强制关闭连接。
认证、发现及媒体 HTTP 请求均有限时，停止或启动失败会取消尚未结束的请求。
handler 必须先持久化来信再返回：其异常会直接传播至官方 SDK 的失败 ACK。
下载、助理执行和回复应放在持久队列中，避免延迟来信 ACK。

来信 `attachments` 保留资源 key；`downloadAttachment(messageId, descriptor)`
按消息下载资源，限制 20 MiB 和 30 秒。富文本最多 20 个不同图片资源。
图片 MIME 根据文件签名确定；非图片响应会作为附件失败显示。
`send(threadId, message)` 默认向对应 `chat_id` 发送普通消息；仅显式传入
`replyToMessageId` 时使用飞书引用回复。`sendToOwner(message)`
始终向配置的本人发送主动通知。每次传入稳定的 `deliveryId` 作为平台 UUID。
文本和附件分条发送；附件一次一个。图片超过 10 MiB 时按文件发送，文件上限
20 MiB。send 返回平台 `messageId`，不在内部重试。

`ImDeliveryError.kind` 区分 `retryable`（已确认的临时失败）、`permanent`
（明确拒绝）和 `unknown`（平台可能已接收）。Host 不应自动重发 `unknown`
消息。平台 UUID 的有效期未在真实平台验证，不承诺跨时间窗口的唯一送达。
连接凭据及队列持久化由 Host 管理，本包不写入凭据文件。

## 按需加载

从仓库根目录的模块使用：

```ts
import { loadFeishuAdapter, loadTelegramAdapter } from "./host/im/index.ts";

const createFeishuAdapter = await loadFeishuAdapter();
// 只有调用相应 loader 时才加载对应 SDK；此时还没有创建适配器或连接。
```

Telegram 使用 loadTelegramAdapter。通用 `loadImAdapter(platform)` 继续支持
telegram、feishu、lark（feishu 别名）、weixin 和 qq。微信和 QQ 当前只保留原有
npm 包和加载函数，尚未建立 ImChannel 实现。

## 依赖与安装


| 包 | 版本 | 用途 |
| --- | --- | --- |
| `chat` | 4.41.1 | 适配器必需的公共运行时与类型 |
| `@chat-adapter/telegram` | 4.41.1 | Telegram |
| `@larksuite/vercel-chat-adapter` | 0.3.0 | 飞书 / Lark |
| `@larksuiteoapi/node-sdk` | 1.74.0 | 飞书私聊 WebSocket 与媒体收发 |
| `chat-adapter-weixin` | 0.1.4 | 微信 iLink |
| `@amatsuka/chat-adapter-qq` | 0.1.13 | QQ 官方机器人 |

使用 Node 24 原生加载 TypeScript；本次环境为 Node.js v24.16.0、npm 12.0.1。
依赖安装在此目录 node_modules，由仓库原有规则忽略。原上游源码已移出仓库。
平台 SDK 依赖集中安装在此目录。

从仓库根目录安装和运行骨架测试：

```sh
npm ci --prefix host/im --no-audit --no-fund
npx vitest run --config host/vitest.config.ts host/im/core/im.test.ts host/im/providers/feishu/channel.test.ts
```

实现记录及实际验证结果见 `specs/026-im-channel-scaffold/`。
该目录记录的是最初骨架阶段；飞书 provider 测试使用 fake SDK，不代表实际平台
认证、权限、网络代理或真实消息收发已通过。
