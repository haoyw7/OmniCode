import type { ImConversation } from "./types.ts";

/** In-memory bindings only; creating and persisting Host sessions comes later. */
export class ImSessionMap {
  private readonly sessions = new Map<string, string>();

  private key(conversation: ImConversation): string {
    return JSON.stringify([conversation.channelId, conversation.threadId]);
  }

  bind(conversation: ImConversation, sessionId: string): void {
    this.sessions.set(this.key(conversation), sessionId);
  }

  get(conversation: ImConversation): string | undefined {
    return this.sessions.get(this.key(conversation));
  }

  unbind(conversation: ImConversation): void {
    this.sessions.delete(this.key(conversation));
  }
}
