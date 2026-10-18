import { describe, expect, it, vi } from "vitest";
import {
  ImChannelRegistry,
  ImMessageRouter,
  ImRuntime,
  ImSessionMap,
  type ImChannel,
  type ImIncomingMessage,
  type ImMessageHandler,
  type ImRouteContext,
} from "../index.ts";

function message(channelId = "telegram-main"): ImIncomingMessage {
  return {
    conversation: { channelId, threadId: "thread-1" },
    messageId: "message-1",
    senderId: "user-1",
    text: "用户原文",
  };
}

function channel(id = "telegram-main") {
  let receive: ImMessageHandler | undefined;
  const result = {
    id,
    platform: "telegram" as const,
    start: vi.fn(async (handler: ImMessageHandler) => { receive = handler; }),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_thread: string, _message: { text: string }) => {}),
    receive: (incoming: ImIncomingMessage) => {
      if (!receive) throw new Error("Test channel has not started");
      return receive(incoming);
    },
  } satisfies ImChannel & { receive: ImMessageHandler };
  return result;
}

describe("IM scaffold", () => {
  it("keeps bindings separate by channel and thread without delimiter collisions", () => {
    const sessions = new ImSessionMap();
    const first = { channelId: "account:a", threadId: "b" };
    const second = { channelId: "account", threadId: "a:b" };
    const other = { channelId: "other-account", threadId: "b" };
    sessions.bind(first, "session-1");
    sessions.bind(second, "session-2");
    sessions.bind(other, "session-3");
    expect(sessions.get(first)).toBe("session-1");
    expect(sessions.get(second)).toBe("session-2");
    sessions.unbind(first);
    expect(sessions.get(first)).toBeUndefined();
    expect(sessions.get(other)).toBe("session-3");
  });

  it("routes the original message and replies through the same channel and thread", async () => {
    const channels = new ImChannelRegistry();
    const telegram = channel();
    const other = channel("other");
    channels.register(telegram);
    channels.register(other);
    expect(() => channels.register(telegram)).toThrow(/duplicate/);
    const sessions = new ImSessionMap();
    const incoming = message();
    sessions.bind(incoming.conversation, "host-session-1");
    const handler = vi.fn(async (context: ImRouteContext) => {
      expect(context.message).toBe(incoming);
      expect(context.sessionId).toBe("host-session-1");
      await context.reply({ text: "调用方提供的回复" });
    });
    const router = new ImMessageRouter(channels, sessions, handler);
    await router.receive(incoming);
    expect(telegram.send).toHaveBeenCalledWith("thread-1", { text: "调用方提供的回复" });
    expect(other.send).not.toHaveBeenCalled();
    await expect(router.receive(message("unknown"))).rejects.toThrow(/Unknown/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not start on registration and cleans up partial startup in reverse order", async () => {
    const order: string[] = [];
    const first = channel("first");
    const failing = channel("failing");
    first.stop.mockImplementation(async () => { order.push("first"); });
    failing.stop.mockImplementation(async () => { order.push("failing"); });
    failing.start.mockRejectedValue(new Error("Connection failed"));
    const runtime = new ImRuntime({ onMessage: async () => {} });
    await expect(runtime.start()).rejects.toThrow(/No IM channels/);
    expect(runtime.state).toBe("stopped");
    runtime.register(first);
    runtime.register(failing);
    expect(first.start).not.toHaveBeenCalled();
    await expect(runtime.start()).rejects.toThrow("Connection failed");
    expect(order).toEqual(["failing", "first"]);
    expect(runtime.state).toBe("stopped");
  });

  it("retains failed cleanup so stop can retry it without restarting channels", async () => {
    const failing = channel();
    failing.start.mockRejectedValue(new Error("Start failed"));
    failing.stop.mockRejectedValueOnce(new Error("Stop failed"));
    const runtime = new ImRuntime({ onMessage: async () => {} });
    runtime.register(failing);
    await expect(runtime.start()).rejects.toThrow("IM startup and cleanup failed");
    expect(runtime.state).toBe("failed");
    await expect(runtime.start()).rejects.toThrow(/while failed/);
    await runtime.stop();
    expect(failing.stop).toHaveBeenCalledTimes(2);
    expect(runtime.state).toBe("stopped");
  });

  it("rejects a mismatched source, callbacks from an old run and late replies", async () => {
    let context: ImRouteContext | undefined;
    const handler = vi.fn(async (route: ImRouteContext) => { context = route; });
    const telegram = channel();
    const runtime = new ImRuntime({ onMessage: handler });
    runtime.register(telegram);
    await runtime.start();
    expect(() => runtime.register(channel("other"))).toThrow(/while stopped/);
    await expect(telegram.receive(message("other"))).rejects.toThrow(/source/);
    await telegram.receive(message());
    const previousReceive = telegram.start.mock.calls[0][0];
    const previousContext = context!;
    await runtime.stop();
    await expect(previousContext.reply({ text: "late" })).rejects.toThrow(/no longer active/);
    await runtime.start();
    await expect(previousReceive(message())).rejects.toThrow(/not accepting/);
    expect(telegram.send).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });
});
