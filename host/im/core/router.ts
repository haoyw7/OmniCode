import type { ImChannelRegistry } from "./registry.ts";
import type { ImSessionMap } from "./sessionMap.ts";
import type { ImIncomingMessage, ImRouteHandler } from "./types.ts";

/** The caller supplies message handling; the router contains no agent logic. */
export class ImMessageRouter {
  private readonly channels: ImChannelRegistry;
  private readonly sessions: ImSessionMap;
  private readonly onMessage: ImRouteHandler;

  constructor(
    channels: ImChannelRegistry,
    sessions: ImSessionMap,
    onMessage: ImRouteHandler,
  ) {
    this.channels = channels;
    this.sessions = sessions;
    this.onMessage = onMessage;
  }

  async receive(
    message: ImIncomingMessage,
    isActive: () => boolean = () => true,
  ): Promise<void> {
    if (!isActive()) throw new Error("IM route is no longer active");
    const { channelId, threadId } = message.conversation;
    const channel = this.channels.get(channelId);
    await this.onMessage({
      message,
      sessionId: this.sessions.get(message.conversation),
      reply: async (reply) => {
        if (!isActive()) throw new Error("IM route is no longer active");
        await channel.send(threadId, reply);
      },
    });
  }
}
