import type { HostDescriptor } from "../../../contracts/protocol";
import type { TurnOrigin } from "../../../contracts/session";
import type { BotRpc } from "./botRpc";
import type { BotConfiguration } from "./botView";
import type { BotsSnapshot } from "./bots";

/** Resolve historical assistant records against the message's own Host. */
export async function resolveBotOrigin(origin: TurnOrigin, rpc: BotRpc) {
  const descriptor = await rpc<HostDescriptor>("environment.describe");
  if (!descriptor.capabilities?.includes("bots.v1")) {
    const bot = await rpc<BotConfiguration | null>("assistant.get");
    if (!bot || bot.id !== (origin.botId ?? origin.assistantId)) throw new Error("Unavailable Bot");
    return { bot, threadId: undefined, defaultScope: true };
  }
  const snapshot = await rpc<BotsSnapshot>("bots.list");
  const bot = snapshot.bots.find(item => item.id === (origin.botId ?? origin.assistantId) && !item.archivedAt);
  const threadId = origin.threadId ?? bot?.defaultThreadId;
  const thread = snapshot.threads.find(item => item.botId === bot?.id && item.id === threadId && !item.archivedAt);
  if (!bot || !thread) throw new Error("Unavailable Bot");
  return { bot, threadId: thread.id, defaultScope: bot.id === snapshot.defaultBotId && thread.id === snapshot.defaultThreadId };
}
