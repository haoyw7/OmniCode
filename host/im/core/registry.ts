import type { ImChannel } from "./types.ts";

export class ImChannelRegistry {
  private readonly channels = new Map<string, ImChannel>();

  register(channel: ImChannel): void {
    if (!channel.id || this.channels.has(channel.id)) {
      throw new Error(`Invalid or duplicate IM channel: ${channel.id}`);
    }
    this.channels.set(channel.id, channel);
  }

  get(channelId: string): ImChannel {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Unknown IM channel: ${channelId}`);
    return channel;
  }

  list(): ImChannel[] {
    return [...this.channels.values()];
  }
}
