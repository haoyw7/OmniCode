import type { BotRpc } from "./botRpc";
import type { BotScope } from "./bots";
import type { HostDescriptor } from "../../connections/model/protocol";

/** Adapt the existing chat renderer without changing the Host connection identity. */
export function scopedBotRpc(rpc: BotRpc, scope: BotScope, defaultScope: boolean): BotRpc {
  return async <T,>(method: string, params?: object): Promise<T> => {
    if (method === "environment.describe") {
      const descriptor = await rpc<HostDescriptor>(method, params);
      return {
        ...descriptor,
        capabilities: defaultScope ? descriptor.capabilities : descriptor.capabilities?.filter((capability) => !capability.startsWith("im.")),
      } as T;
    }
    if (method === "assistant.configure")
      return rpc<T>("bots.configure", { ...params, botId: scope.botId });
    if (method === "assistant.memory")
      return rpc<T>("botMemory.get", { ...params, ...scope });
    if (method === "assistant.memoryTopic")
      return rpc<T>("botMemory.topic", { ...params, ...scope });
    if (["assistant.get", "assistant.messages", "assistant.send", "assistant.respond", "assistant.control"].includes(method))
      return rpc<T>(method.replace("assistant.", "botThreads."), { ...params, ...scope });
    if (method === "attachments.read")
      return rpc<T>(method, { ...params, ...scope });
    // Never fall through to the old default assistant from a different Bot.
    if (method.startsWith("assistant.") || (!defaultScope && method.startsWith("im.")))
      throw new Error("This operation is unavailable for this bot.");
    return rpc<T>(method, params);
  };
}

/** Copy the default conversation's local state once, preserving old mobile keys. */
export function migrateDefaultBotCache(environmentId: string, cacheKey: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const marker = `monocode.bot-cache-migrated:${cacheKey}`;
  try {
    if (storage.getItem(marker)) return;
    for (const kind of ["draft", "reply", "outbox", "read", "notification"])
      if (storage.getItem(`monocode.assistant-${kind}:${cacheKey}`) === null) {
        const value = storage.getItem(`monocode.assistant-${kind}:${environmentId}`);
        if (value !== null) storage.setItem(`monocode.assistant-${kind}:${cacheKey}`, value);
      }
    storage.setItem(marker, "1");
  } catch { /* Local drafts remain usable if persistent storage is unavailable. */ }
}
