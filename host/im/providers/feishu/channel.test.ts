import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuChannel, type FeishuChannelDependencies } from "./channel.ts";
import { ImDeliveryError } from "../../core/errors.ts";
import type { ImIncomingMessage } from "../../core/types.ts";

const config = { id: "binding-1", appId: "cli_0123456789abcdef", appSecret: "private-secret", ownerOpenId: "ou_owner" };
type SocketOptions = { onReady(): void; onError(error: Error): void; onReconnecting(): void; onReconnected(): void };

function fakeSdk() {
  const reply = vi.fn(async (_payload: unknown) => ({ code: 0, data: { message_id: "om_reply" } }));
  const create = vi.fn(async (_payload: unknown) => ({ code: 0, data: { message_id: "om_notification" } }));
  const image = vi.fn(async (_payload: unknown) => ({ image_key: "img_uploaded" }));
  const file = vi.fn(async (_payload: unknown) => ({ file_key: "file_uploaded" }));
  const download = vi.fn(async (_payload: unknown) => ({ headers: { "content-type": "image/jpeg", "content-length": "3" }, getReadableStream: () => Readable.from([Buffer.from([0xff, 0xd8, 0xff])]) }));
  const close = vi.fn();
  const request = vi.fn();
  let http: import("@larksuiteoapi/node-sdk").HttpInstance;
  let options: SocketOptions;
  let handler: (input: unknown) => Promise<void>;
  let autoReady = true;
  let nextConnectTime: number | undefined;
  class Client {
    constructor(options: { httpInstance: typeof http }) { http = options.httpInstance; }
    im = { v1: { message: { reply, create }, image: { create: image }, file: { create: file }, messageResource: { get: download } } };
  }
  class EventDispatcher {
    register(handlers: Record<string, typeof handler>) { handler = handlers["im.message.receive_v1"]; return this; }
  }
  class WSClient {
    constructor(value: SocketOptions) { options = value; }
    async start() { if (autoReady) options.onReady(); }
    close = close;
    getConnectionStatus() { return { state: "connected", nextConnectTime }; }
  }
  const dependencies: FeishuChannelDependencies = {
    loadSdk: async () => ({ Client, EventDispatcher, WSClient, defaultHttpInstance: { request } }) as unknown as Awaited<ReturnType<NonNullable<FeishuChannelDependencies["loadSdk"]>>>,
    startTimeoutMs: 100, requestTimeoutMs: 100,
  };
  return { dependencies, reply, create, image, file, download, close, request, http: () => http,
    incoming: (value: unknown) => handler(value),
    callbacks: () => options,
    setAutoReady: (value: boolean) => { autoReady = value; },
    setNextConnectTime: (value: number) => { nextConnectTime = value; },
  };
}

function event(type = "text", content: unknown = { text: "你好，原文\n" }) {
  return {
    sender: { sender_type: "user", sender_id: { open_id: "ou_owner" } },
    message: { message_id: "om_incoming", chat_id: "oc_private", chat_type: "p2p", create_time: "1720000000000", message_type: type, content: JSON.stringify(content) },
  };
}

afterEach(() => vi.useRealTimers());

describe("Feishu channel", () => {
  it("waits for the actual handshake and reports reconnect state", async () => {
    const sdk = fakeSdk(); sdk.setAutoReady(false);
    const channel = new FeishuChannel(config, sdk.dependencies);
    let started = false;
    const pending = channel.start(async () => {}).then(() => { started = true; });
    await vi.waitFor(() => expect(sdk.callbacks()).toBeDefined());
    expect(started).toBe(false);
    expect(channel.status().state).toBe("connecting");
    sdk.callbacks().onReady(); await pending;
    expect(channel.status().state).toBe("connected");
    sdk.setNextConnectTime(42); sdk.callbacks().onReconnecting();
    expect(channel.status()).toEqual({ state: "reconnecting", nextRetryAt: 42 });
    sdk.callbacks().onReconnected();
    expect(channel.status()).toEqual({ state: "connected" });
    await channel.stop();
    expect(sdk.close).toHaveBeenCalledWith({ force: true });
    sdk.callbacks().onReady();
    expect(channel.status()).toEqual({ state: "stopped" });
  });

  it("force closes a failed or timed out initial connection", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk(); sdk.setAutoReady(false);
    const channel = new FeishuChannel(config, sdk.dependencies);
    const pending = expect(channel.start(async () => {})).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(101); await pending;
    expect(sdk.close).toHaveBeenCalledWith({ force: true });
    expect(channel.status().state).toBe("failed");
    await channel.stop();
    sdk.setAutoReady(true);
    await channel.start(async () => {});
    sdk.callbacks().onError(new Error("private SDK data"));
    expect(channel.status()).toEqual({ state: "failed", error: "Feishu connection failed" });
    await expect(sdk.incoming(event())).rejects.toThrow("no longer active");
    await channel.stop();
  });

  it("bounds authentication and discovery HTTP requests and aborts them on stop", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    sdk.request.mockImplementation(async (options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await channel.start(async () => {});
    const auth = expect(sdk.http().post("/token", { app_secret: "secret" })).rejects.toThrow("aborted");
    const discovery = expect(sdk.http().request({ method: "post", url: "/endpoint", timeout: 50 })).rejects.toThrow("aborted");
    expect(sdk.request.mock.calls[0][0]).toMatchObject({ method: "post", url: "/token", timeout: 100 });
    expect(sdk.request.mock.calls[1][0]).toMatchObject({ timeout: 50 });
    await channel.stop(); await auth; await discovery;
    expect(sdk.request.mock.calls.every(call => call[0].signal.aborted)).toBe(true);
  });

  it("aborts pending HTTP requests when startup times out", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk(); sdk.setAutoReady(false);
    const channel = new FeishuChannel(config, { ...sdk.dependencies, startTimeoutMs: 10, requestTimeoutMs: 1000 });
    sdk.request.mockImplementation(async (options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const starting = expect(channel.start(async () => {})).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(0);
    const authentication = expect(sdk.http().post("/token", {})).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(11); await starting; await authentication;
    expect(sdk.request.mock.calls[0][0].signal.aborted).toBe(true);
    await channel.stop();
  });

  it("rejects invalid configuration and cancels an in-flight start", async () => {
    expect(() => new FeishuChannel({ ...config, appId: "bad" })).toThrow("configuration");
    const sdk = fakeSdk(); sdk.setAutoReady(false);
    const channel = new FeishuChannel(config, sdk.dependencies);
    const pending = expect(channel.start(async () => {})).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(sdk.callbacks()).toBeDefined());
    await channel.stop(); await pending;
    expect(channel.status().state).toBe("stopped");
    expect(sdk.close).toHaveBeenCalledWith({ force: true });
  });

  it("accepts only the configured person's private messages and awaits the durable handler", async () => {
    const sdk = fakeSdk();
    const channel = new FeishuChannel(config, sdk.dependencies);
    const messages: ImIncomingMessage[] = [];
    let commit: (() => void) | undefined;
    await channel.start(async (message) => { messages.push(message); await new Promise<void>((resolve) => { commit = resolve; }); });
    const group = event(); group.message.chat_type = "group";
    const other = event(); other.sender.sender_id.open_id = "ou_other";
    const bot = event(); bot.sender.sender_type = "bot";
    await sdk.incoming(group); await sdk.incoming(other); await sdk.incoming(bot);
    expect(messages).toHaveLength(0);
    let acknowledged = false;
    const incoming = sdk.incoming(event()).then(() => { acknowledged = true; });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(messages[0]).toEqual({ conversation: { channelId: config.id, threadId: "oc_private" }, messageId: "om_incoming", senderId: "ou_owner", text: "你好，原文\n", createdAt: 1720000000000 });
    commit!(); await incoming;
    expect(acknowledged).toBe(true);
    await channel.stop();
  });

  it("propagates inbox failures instead of swallowing them before the platform ACK", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    const receive = vi.fn(async () => {}).mockRejectedValueOnce(new Error("SQLite commit failed"));
    await channel.start(receive);
    await expect(sdk.incoming(event())).rejects.toThrow("SQLite commit failed");
    await sdk.incoming(event());
    expect(receive).toHaveBeenCalledTimes(2);
    await channel.stop();
  });

  it("normalizes rich text, image and file references without downloading", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    const receive = vi.fn(async (_message: ImIncomingMessage) => {});
    await channel.start(receive);
    await sdk.incoming(event("post", { zh_cn: { title: "原题", content: [[{ tag: "text", text: "正文 " }, { tag: "a", text: "link", href: "https://example.com" }], [{ tag: "img", image_key: "img_1" }]] } }));
    expect(receive.mock.calls[0][0]).toMatchObject({ text: "原题\n正文 link (https://example.com)\n", attachments: [{ id: "img_1", kind: "image" }] });
    await sdk.incoming(event("image", { image_key: "img_2" }));
    await sdk.incoming(event("file", { file_key: "file_1", file_name: "资料.pdf" }));
    expect(receive.mock.calls[2][0].attachments).toEqual([{ id: "file_1", name: "资料.pdf", kind: "file" }]);
    await sdk.incoming(event("audio", { file_key: "audio" }));
    expect(receive).toHaveBeenCalledTimes(3);
    expect(sdk.download).not.toHaveBeenCalled();
    await channel.stop();
  });

  it("rejects oversized rich-message resource lists without truncating them", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    const receive = vi.fn(async () => {});
    await channel.start(receive);
    const images = Array.from({ length: 21 }, (_, index) => ({ tag: "img", image_key: `img_${index}` }));
    await expect(sdk.incoming(event("post", { content: [images] }))).rejects.toThrow("Too many Feishu attachments");
    expect(receive).not.toHaveBeenCalled();
    await channel.stop();
  });

  it("sends ordinary messages directly to the conversation with stable delivery IDs", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    expect(await channel.send("oc_private", { text: "回复", deliveryId: "stable-1" })).toEqual({ messageId: "om_notification" });
    expect(sdk.create).toHaveBeenCalledWith({ params: { receive_id_type: "chat_id" }, data: { receive_id: "oc_private", msg_type: "text", content: '{"text":"回复"}', uuid: "stable-1" } });
    expect(sdk.reply).not.toHaveBeenCalled();
    await expect(channel.send("ou_other", { text: "x", deliveryId: "invalid-chat" })).rejects.toMatchObject({ kind: "permanent" });
    await expect(channel.send("oc_private", { text: "missing id" })).rejects.toMatchObject({ kind: "permanent" });
    expect(sdk.create).toHaveBeenCalledOnce();
    await channel.stop();
  });

  it("uses a quoted reply only when the originating message is explicit", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    expect(await channel.send("oc_private", { text: "回复", replyToMessageId: "om_incoming", deliveryId: "stable-1" })).toEqual({ messageId: "om_reply" });
    expect(sdk.reply).toHaveBeenCalledWith({ path: { message_id: "om_incoming" }, data: { msg_type: "text", content: '{"text":"回复"}', uuid: "stable-1" } });
    expect(sdk.create).not.toHaveBeenCalled();
    await channel.stop();
  });

  it("sends notifications only to the configured owner even if reply metadata is present", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    await channel.sendToOwner({ text: "通知", replyToMessageId: "om_incoming", deliveryId: "stable-2" });
    expect(sdk.create).toHaveBeenCalledWith({ params: { receive_id_type: "open_id" }, data: { receive_id: config.ownerOpenId, msg_type: "text", content: '{"text":"通知"}', uuid: "stable-2" } });
    expect(sdk.reply).not.toHaveBeenCalled();
    await expect(channel.sendToOwner({ text: "missing id" })).rejects.toMatchObject({ kind: "permanent" });
    await channel.stop();
  });

  it("uploads media then sends their keys, and retains large images as files", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    await channel.send("oc_private", { text: "", deliveryId: "image", attachment: { kind: "image", name: "a.png", mimeType: "image/png", bytes: Buffer.from("image") } });
    expect(sdk.image).toHaveBeenCalledOnce();
    expect(sdk.create.mock.calls[0][0]).toMatchObject({ params: { receive_id_type: "chat_id" }, data: { receive_id: "oc_private", msg_type: "image", content: '{"image_key":"img_uploaded"}', uuid: "image" } });
    await channel.send("oc_private", { text: "", deliveryId: "file", attachment: { kind: "file", name: "a.txt", mimeType: "text/plain", bytes: Buffer.from("file") } });
    expect(sdk.create.mock.calls[1][0]).toMatchObject({ params: { receive_id_type: "chat_id" }, data: { receive_id: "oc_private", msg_type: "file", content: '{"file_key":"file_uploaded"}', uuid: "file" } });
    await channel.sendToOwner({ text: "", deliveryId: "large-image", attachment: { kind: "image", name: "large.png", mimeType: "image/png", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) } });
    expect(sdk.file).toHaveBeenCalledTimes(2);
    expect(sdk.create.mock.calls[2][0]).toMatchObject({ params: { receive_id_type: "open_id" }, data: { receive_id: config.ownerOpenId, msg_type: "file", content: '{"file_key":"file_uploaded"}' } });
    expect(sdk.reply).not.toHaveBeenCalled();
    await channel.stop();
  });

  it("does not send after being disabled during an upload", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    let uploaded: ((value: { file_key: string }) => void) | undefined;
    sdk.file.mockImplementationOnce(async () => new Promise((resolve) => { uploaded = resolve; }));
    await channel.start(async () => {});
    const pending = channel.sendToOwner({ text: "", deliveryId: "file", attachment: { kind: "file", name: "a", mimeType: "application/octet-stream", bytes: Buffer.from("a") } });
    await channel.stop(); uploaded!({ file_key: "file_uploaded" });
    await expect(pending).rejects.toMatchObject({ kind: "retryable" });
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("distinguishes uncertain send outcomes from confirmed rejection without retrying", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    sdk.create.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(channel.sendToOwner({ text: "x", deliveryId: "first" })).rejects.toMatchObject({ kind: "unknown" });
    sdk.create.mockResolvedValueOnce({ code: 99991400, data: { message_id: "" } });
    await expect(channel.sendToOwner({ text: "x", deliveryId: "second" })).rejects.toMatchObject({ kind: "retryable" });
    sdk.create.mockResolvedValueOnce({ code: 230002, data: { message_id: "" } });
    await expect(channel.sendToOwner({ text: "x", deliveryId: "third" })).rejects.toMatchObject({ kind: "permanent" });
    sdk.create.mockResolvedValueOnce({ code: 0, data: { message_id: "" } });
    await expect(channel.sendToOwner({ text: "x", deliveryId: "fourth" })).rejects.toBeInstanceOf(ImDeliveryError);
    expect(sdk.create).toHaveBeenCalledTimes(4);
    await channel.stop();
  });

  it("downloads received message resources with metadata and rejects oversized or incomplete streams", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    const descriptor = { id: "img_1", name: "photo.png", kind: "image" as const };
    const result = await channel.downloadAttachment("om_incoming", descriptor);
    expect(result.bytes).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(result.mimeType).toBe("image/jpeg");
    expect(sdk.download).toHaveBeenCalledWith({ path: { message_id: "om_incoming", file_key: "img_1" }, params: { type: "image" } });
    sdk.download.mockResolvedValueOnce({ headers: { "content-type": "image/png", "content-length": "0" }, getReadableStream: () => Readable.from([Buffer.alloc(20 * 1024 * 1024), Buffer.from("x")]) });
    await expect(channel.downloadAttachment("om_incoming", descriptor)).rejects.toMatchObject({ kind: "permanent" });
    sdk.download.mockResolvedValueOnce({ headers: { "content-type": "image/png", "content-length": "8" }, getReadableStream: () => Readable.from([Buffer.from("abc")]) });
    await expect(channel.downloadAttachment("om_incoming", descriptor)).rejects.toMatchObject({ kind: "retryable" });
    await channel.stop();
  });

  it("uses image bytes to correct a misleading MIME and rejects non-image payloads", async () => {
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    await channel.start(async () => {});
    const descriptor = { id: "img_1", name: "photo", kind: "image" as const };
    sdk.download.mockResolvedValueOnce({ headers: { "content-type": "application/octet-stream", "content-length": "3" }, getReadableStream: () => Readable.from([Buffer.from([0xff, 0xd8, 0xff])]) });
    expect((await channel.downloadAttachment("om_incoming", descriptor)).mimeType).toBe("image/jpeg");
    sdk.download.mockResolvedValueOnce({ headers: { "content-type": "image/png", "content-length": "3" }, getReadableStream: () => Readable.from([Buffer.from("bad")]) });
    await expect(channel.downloadAttachment("om_incoming", descriptor)).rejects.toMatchObject({ kind: "permanent" });
    await channel.stop();
  });

  it("times out a stalled download and destroys its stream", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk(); const channel = new FeishuChannel(config, sdk.dependencies);
    const stream = new Readable({ read() {} });
    sdk.download.mockResolvedValueOnce({ headers: { "content-type": "image/png", "content-length": "1" }, getReadableStream: () => stream });
    await channel.start(async () => {});
    const pending = expect(channel.downloadAttachment("om_incoming", { id: "img_1", name: "photo", kind: "image" })).rejects.toMatchObject({ kind: "retryable" });
    await vi.advanceTimersByTimeAsync(101); await pending;
    expect(stream.destroyed).toBe(true);
    await channel.stop();
  });
});
