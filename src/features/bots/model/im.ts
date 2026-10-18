import type { BotScope } from "./bots";

/** Public IM configuration and delivery status. Credentials stay on the Host. */
export type ImView = {
  configured: boolean;
  config?: {
    appId: string;
    ownerOpenId: string;
    secretConfigured: boolean;
    enabled: boolean;
    language?: "en" | "zh-CN";
  };
  status: {
    state: "stopped" | "connecting" | "connected" | "reconnecting" | "failed";
    error?: string;
    nextRetryAt?: number;
  };
  bindingId?: string;
  /** Host-owned default Bot/Thread target; distinct from the IM channel thread. */
  scope?: BotScope;
  pending: number;
  deliveries: Array<{
    id: string;
    state: "failed" | "unknown";
    summary: string;
    error?: string;
    createdAt: number;
  }>;
};

export type ImConfigure = {
  appId: string;
  ownerOpenId: string;
  /** Omit to keep the saved secret. It is never returned by im.get. */
  appSecret?: string;
  language?: "en" | "zh-CN";
};

export type ImControl =
  | { action: "enable" | "disable" | "reconnect" }
  | { action: "retry" | "discard"; deliveryId: string };
