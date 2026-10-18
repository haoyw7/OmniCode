import { ImDeliveryError } from "../../core/errors.ts";
import type {
  ImAttachmentDescriptor, ImChannel, ImIncomingMessage, ImMessageHandler, ImOutgoingMessage,
} from "../../core/types.ts";

type Sdk = Pick<typeof import("@larksuiteoapi/node-sdk"), "Client" | "WSClient" | "EventDispatcher" | "defaultHttpInstance">;
type RecordValue = Record<string, unknown>;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;
const silentLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

export type FeishuChannelConfig = {
  id: string;
  appId: string;
  appSecret: string;
  ownerOpenId: string;
};

export type FeishuChannelStatus = {
  state: "stopped" | "connecting" | "connected" | "reconnecting" | "failed";
  error?: string;
  nextRetryAt?: number;
};

/** Test seams; production always loads the pinned SDK lazily. */
export type FeishuChannelDependencies = {
  loadSdk?: () => Promise<Sdk>;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
};

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue : undefined;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resourceName(value: unknown, fallback: string): string {
  // A display name only: resource names never become local paths.
  return string(value).replace(/[\u0000-\u001f]/g, "").slice(0, 255) || fallback;
}

function contentObject(value: unknown): RecordValue | undefined {
  if (typeof value !== "string") return undefined;
  try { return record(JSON.parse(value)); } catch { return undefined; }
}

/** This deliberately preserves only the four supported message kinds. */
function normalize(config: FeishuChannelConfig, event: unknown): ImIncomingMessage | undefined {
  const input = record(event);
  const sender = record(input?.sender);
  const ids = record(sender?.sender_id);
  const message = record(input?.message);
  if (message?.chat_type !== "p2p" || sender?.sender_type !== "user" || ids?.open_id !== config.ownerOpenId) return;
  const messageId = string(message.message_id);
  const chatId = string(message.chat_id);
  const content = contentObject(message.content);
  if (!messageId || !chatId || !content) return;
  const attachments: ImAttachmentDescriptor[] = [];
  const addImage = (key: unknown) => {
    const id = string(key);
    if (id && !attachments.some((item) => item.id === id)) {
      attachments.push({ id, kind: "image", name: `${messageId}-${attachments.length + 1}` });
    }
  };
  let text = "";
  switch (message.message_type) {
    case "text": text = string(content.text); break;
    case "image": addImage(content.image_key); break;
    case "file": {
      const id = string(content.file_key);
      if (id) attachments.push({ id, kind: "file", name: resourceName(content.file_name, "attachment") });
      break;
    }
    case "post": {
      const post = Array.isArray(content.content) ? content
        : record(content.zh_cn) ?? record(content.en_us) ?? Object.values(content).map(record).find((item) => Array.isArray(item?.content));
      if (!post || !Array.isArray(post.content)) return;
      const lines: string[] = [];
      if (typeof post.title === "string" && post.title) lines.push(post.title);
      for (const row of post.content) {
        if (!Array.isArray(row)) continue;
        let line = "";
        for (const value of row) {
          const item = record(value);
          if (!item) continue;
          if (item.tag === "text" || item.tag === "md") line += string(item.text);
          else if (item.tag === "a") {
            const label = string(item.text);
            const href = string(item.href);
            line += label && href && label !== href ? `${label} (${href})` : label || href;
          } else if (item.tag === "at") line += `@${string(item.user_name) || string(item.user_id)}`;
          else if (item.tag === "img") addImage(item.image_key);
        }
        lines.push(line);
      }
      text = lines.join("\n");
      break;
    }
    default: return;
  }
  // Do not silently truncate a rich message and send incomplete context to the assistant.
  if (attachments.length > MAX_ATTACHMENTS) throw new Error("Too many Feishu attachments");
  if (!text && !attachments.length) return;
  const createdAt = Number(message.create_time);
  return {
    conversation: { channelId: config.id, threadId: chatId },
    messageId, senderId: config.ownerOpenId, text,
    ...(attachments.length ? { attachments } : {}),
    ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
  };
}

function deliveryError(error: unknown, sending: boolean): ImDeliveryError {
  if (error instanceof ImDeliveryError) return error;
  const response = record(record(error)?.response);
  const status = Number(response?.status);
  if (status === 429) return new ImDeliveryError("retryable", "Feishu rate limit reached", "429");
  if (status >= 400 && status < 500 && status !== 408) return new ImDeliveryError("permanent", "Feishu rejected the request", String(status));
  return new ImDeliveryError(sending ? "unknown" : "retryable", sending ? "Feishu delivery status is unknown" : "Feishu attachment transfer failed");
}

function checkResponse(value: unknown, sending: boolean): RecordValue {
  const result = record(value);
  const code = result?.code;
  if (code !== undefined && Number(code) !== 0) {
    const retryable = [99991400, 99991401, 230020].includes(Number(code));
    throw new ImDeliveryError(retryable ? "retryable" : "permanent", retryable ? "Feishu rate limit reached" : "Feishu rejected the request", String(code));
  }
  if (!result) throw deliveryError(undefined, sending);
  return record(result.data) ?? result;
}

/** Keep the independent channel package free of desktop image-viewer imports. */
function imageMime(bytes: Buffer): string | undefined {
  const hex = bytes.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("424d")) return "image/bmp";
  if (hex.startsWith("00000100")) return "image/x-icon";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "image/tiff";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return undefined;
}

export class FeishuChannel implements ImChannel {
  readonly id: string;
  readonly platform = "feishu" as const;
  private readonly config: FeishuChannelConfig;
  private readonly dependencies: FeishuChannelDependencies;
  private currentStatus: FeishuChannelStatus = { state: "stopped" };
  private client?: InstanceType<Sdk["Client"]>;
  private socket?: InstanceType<Sdk["WSClient"]>;
  private httpAbort?: AbortController;
  private generation = 0;
  private cancelStart?: () => void;

  constructor(config: FeishuChannelConfig, dependencies: FeishuChannelDependencies = {}) {
    if (!config.id.trim() || !/^cli_[0-9a-fA-F]{16}$/.test(config.appId) || !config.appSecret.trim() || !/^ou_[A-Za-z0-9_-]+$/.test(config.ownerOpenId)) {
      throw new Error("Invalid Feishu channel configuration");
    }
    this.id = config.id;
    this.config = { ...config };
    this.dependencies = dependencies;
  }

  status(): FeishuChannelStatus {
    const snapshot = this.socket?.getConnectionStatus();
    const nextRetryAt = snapshot?.nextConnectTime;
    return { ...this.currentStatus, ...(nextRetryAt && this.currentStatus.state === "reconnecting" ? { nextRetryAt } : {}) };
  }

  async start(onMessage: ImMessageHandler): Promise<void> {
    if (this.currentStatus.state === "connected" || this.currentStatus.state === "reconnecting") return;
    if (this.currentStatus.state !== "stopped") throw new Error("Feishu channel must be stopped before starting");
    const generation = ++this.generation;
    const active = () => this.generation === generation;
    this.currentStatus = { state: "connecting" };
    try {
      const sdk = await (this.dependencies.loadSdk?.() ?? import("@larksuiteoapi/node-sdk"));
      if (!active()) throw new Error("Feishu channel start cancelled");
      // Avoid mutating the SDK's process-wide HTTP singleton.
      const timeout = this.dependencies.requestTimeoutMs ?? 30_000;
      const httpAbort = new AbortController();
      this.httpAbort = httpAbort;
      const httpInstance = new Proxy(sdk.defaultHttpInstance, {
        get(target, property) {
          const request = (options: RecordValue = {}) => {
            const requestedTimeout = Number(options.timeout);
            const budget = requestedTimeout > 0 ? Math.min(timeout, requestedTimeout) : timeout;
            const signal = AbortSignal.any([
              httpAbort.signal, AbortSignal.timeout(budget),
              ...(options.signal instanceof AbortSignal ? [options.signal] : []),
            ]);
            return target.request({ ...options, timeout: budget, signal });
          };
          if (property === "request") return request;
          // TokenManager calls post() directly; wrapping only request() leaves
          // that authentication request unbounded and alive after stop().
          if (["get", "delete", "head", "options"].includes(String(property))) {
            return (url: string, options: RecordValue = {}) => request({ ...options, method: String(property), url });
          }
          if (["post", "put", "patch"].includes(String(property))) {
            return (url: string, data: unknown, options: RecordValue = {}) => request({ ...options, method: String(property), url, data });
          }
          return Reflect.get(target, property);
        },
      // The SDK's Axios response interceptor unwraps the response body, but its
      // exported Axios type does not reflect its own HttpInstance contract.
      }) as unknown as import("@larksuiteoapi/node-sdk").HttpInstance;
      this.client = new sdk.Client({ appId: this.config.appId, appSecret: this.config.appSecret, logger: silentLogger, httpInstance });
      const dispatcher = new sdk.EventDispatcher({ logger: silentLogger }).register({
        "im.message.receive_v1": async (event) => {
          if (!active()) throw new Error("Feishu channel is no longer active");
          const message = normalize(this.config, event);
          // The caller commits its inbox here. Rejection must reach the SDK's 500 ACK.
          if (message) await onMessage(message);
        },
      });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.cancelStart = undefined;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error("Feishu connection timed out")), this.dependencies.startTimeoutMs ?? 30_000);
        this.cancelStart = () => finish(new Error("Feishu channel start cancelled"));
        this.socket = new sdk.WSClient({
          appId: this.config.appId, appSecret: this.config.appSecret, httpInstance,
          logger: silentLogger, autoReconnect: true, handshakeTimeoutMs: 15_000,
          wsConfig: { pingTimeout: 30 },
          onReady: () => {
            if (!active()) return;
            this.currentStatus = { state: "connected" };
            finish();
          },
          onError: () => {
            if (!active()) return;
            this.currentStatus = { state: "failed", error: "Feishu connection failed" };
            if (settled) {
              ++this.generation;
              this.httpAbort?.abort();
              this.socket?.close({ force: true });
              this.client = undefined;
            }
            finish(new Error("Feishu connection failed"));
          },
          onReconnecting: () => { if (active()) this.currentStatus = { state: "reconnecting" }; },
          onReconnected: () => { if (active()) this.currentStatus = { state: "connected" }; },
        });
        void this.socket.start({ eventDispatcher: dispatcher }).catch(() => finish(new Error("Feishu connection failed")));
      });
    } catch (error) {
      this.cancelStart?.();
      if (active()) {
        this.httpAbort?.abort();
        this.httpAbort = undefined;
        this.socket?.close({ force: true });
        this.socket = undefined;
        this.client = undefined;
        ++this.generation;
        this.currentStatus = { state: "failed", error: error instanceof Error ? error.message : "Feishu connection failed" };
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    ++this.generation;
    this.cancelStart?.();
    this.cancelStart = undefined;
    this.httpAbort?.abort();
    this.httpAbort = undefined;
    this.socket?.close({ force: true });
    this.socket = undefined;
    this.client = undefined;
    this.currentStatus = { state: "stopped" };
  }

  private requireClient(): InstanceType<Sdk["Client"]> {
    if (!this.client || !["connected", "reconnecting"].includes(this.currentStatus.state)) {
      throw new ImDeliveryError("retryable", "Feishu channel is not connected");
    }
    return this.client;
  }

  async send(threadId: string, message: ImOutgoingMessage): Promise<{ messageId: string }> {
    if (!threadId.startsWith("oc_")) throw new ImDeliveryError("permanent", "Invalid Feishu conversation");
    return this.deliver(message, threadId);
  }

  async sendToOwner(message: ImOutgoingMessage): Promise<{ messageId: string }> {
    return this.deliver(message);
  }

  private async deliver(message: ImOutgoingMessage, threadId?: string): Promise<{ messageId: string }> {
    const client = this.requireClient();
    const generation = this.generation;
    if (!message.deliveryId || message.deliveryId.length > 50) throw new ImDeliveryError("permanent", "A stable Feishu delivery ID is required");
    let msgType = "text";
    let content = JSON.stringify({ text: message.text });
    const attachment = message.attachment;
    if (attachment) {
      if (!attachment.bytes.byteLength || attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new ImDeliveryError("permanent", "Invalid Feishu attachment size");
      // Large images remain intact and are delivered as files.
      msgType = attachment.kind === "image" && attachment.bytes.byteLength <= MAX_IMAGE_BYTES ? "image" : "file";
      try {
        const bytes = Buffer.from(attachment.bytes);
        const result = msgType === "image"
          ? checkResponse(await client.im.v1.image.create({ data: { image_type: "message", image: bytes } }), false)
          : checkResponse(await client.im.v1.file.create({ data: { file_type: "stream", file_name: resourceName(attachment.name, "attachment"), file: bytes } }), false);
        const key = string(result[msgType === "image" ? "image_key" : "file_key"]);
        if (!key) throw new ImDeliveryError("retryable", "Feishu attachment upload did not return a resource key");
        content = JSON.stringify(msgType === "image" ? { image_key: key } : { file_key: key });
      } catch (error) { throw deliveryError(error, false); }
    } else if (!message.text) throw new ImDeliveryError("permanent", "Cannot send an empty Feishu message");
    if (generation !== this.generation) throw new ImDeliveryError("retryable", "Feishu channel is no longer active");
    try {
      const data = { msg_type: msgType, content, uuid: message.deliveryId };
      const result = threadId && message.replyToMessageId
        ? await client.im.v1.message.reply({ path: { message_id: message.replyToMessageId }, data })
        : await client.im.v1.message.create({
          params: { receive_id_type: threadId ? "chat_id" : "open_id" },
          data: { ...data, receive_id: threadId ?? this.config.ownerOpenId },
        });
      const messageId = string(checkResponse(result, true).message_id);
      if (!messageId) throw new ImDeliveryError("unknown", "Feishu delivery status is unknown");
      return { messageId };
    } catch (error) { throw deliveryError(error, true); }
  }

  async downloadAttachment(messageId: string, descriptor: ImAttachmentDescriptor): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const client = this.requireClient();
    let stream: ReturnType<Awaited<ReturnType<typeof client.im.v1.messageResource.get>>["getReadableStream"]> | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const download = async () => {
        const response = await client.im.v1.messageResource.get({ path: { message_id: messageId, file_key: descriptor.id }, params: { type: descriptor.kind === "image" ? "image" : "file" } });
        stream = response.getReadableStream();
        if (expired) { stream.destroy(); throw new Error("Feishu attachment download timed out"); }
        const headers = record(response.headers);
        const declaredSize = Number(headers?.["content-length"]);
        if (declaredSize > MAX_ATTACHMENT_BYTES) throw new ImDeliveryError("permanent", "Feishu attachment exceeds 20 MB");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_ATTACHMENT_BYTES) throw new ImDeliveryError("permanent", "Feishu attachment exceeds 20 MB");
          chunks.push(bytes);
        }
        if (declaredSize > 0 && size !== declaredSize) throw new Error("Incomplete Feishu attachment");
        const bytes = Buffer.concat(chunks, size);
        const mimeType = descriptor.kind === "image" ? imageMime(bytes)
          : string(headers?.["content-type"]).split(";")[0].trim() || descriptor.mimeType || "application/octet-stream";
        if (!mimeType) throw new ImDeliveryError("permanent", "Feishu returned an unsupported image resource");
        return { bytes, mimeType };
      };
      return await Promise.race([
        download(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { expired = true; stream?.destroy(); reject(new Error("Feishu attachment download timed out")); }, this.dependencies.requestTimeoutMs ?? 30_000);
        }),
      ]);
    } catch (error) { throw deliveryError(error, false); }
    finally { if (timer) clearTimeout(timer); stream?.destroy(); }
  }
}
