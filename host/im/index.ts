import { ImChannelRegistry } from "./core/registry.ts";
import { ImMessageRouter } from "./core/router.ts";
import { ImSessionMap } from "./core/sessionMap.ts";
import { loadFeishuAdapter } from "./providers/feishu/adapter.ts";
import { loadTelegramAdapter } from "./providers/telegram/adapter.ts";

export { ImChannelRegistry, ImMessageRouter, ImSessionMap };
export { loadFeishuAdapter, loadTelegramAdapter };
export { FeishuChannel } from "./providers/feishu/channel.ts";
export type { FeishuChannelConfig, FeishuChannelStatus, FeishuChannelDependencies } from "./providers/feishu/channel.ts";
export { ImDeliveryError } from "./core/errors.ts";
export type * from "./core/types.ts";
export type { FeishuAdapterConfig } from "./providers/feishu/adapter.ts";
export type { TelegramAdapterConfig } from "./providers/telegram/adapter.ts";

/** Keep the previous lazy loader API; lark is an alias for feishu. */
export async function loadImAdapter(
  platform: "feishu" | "lark" | "telegram" | "weixin" | "qq",
) {
  switch (platform) {
    case "feishu":
    case "lark":
      return loadFeishuAdapter();
    case "telegram":
      return loadTelegramAdapter();
    case "weixin":
      return (await import("chat-adapter-weixin")).createWeixinAdapter;
    case "qq":
      return (await import("@amatsuka/chat-adapter-qq")).createQQAdapter;
    default:
      throw new TypeError(`Unsupported IM platform: ${platform}`);
  }
}

export { ImRuntime } from "./core/runtime.ts";
export type { ImRuntimeState } from "./core/runtime.ts";
