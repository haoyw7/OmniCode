import { useEffect, useReducer, useRef } from "react";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import type { BotHistory, BotMessage, BotMessages } from "./botView";
import { mergeBotMessages, type BotRpc } from "./botRpc";
import { botReadRevision, subscribeBotRead, unreadBotMessages } from "./botUnread";
import { botCacheKey, type BotThread } from "./bots";
import { botPanelKey } from "./botPanelQueries";

type ThreadFeed = { revision: number; messages: BotMessage[] };
export function botUnreadQuery(environmentId: string, thread: BotThread, rpc: BotRpc) {
  const scope = { botId: thread.botId, threadId: thread.id }, key = botCacheKey(environmentId, scope);
  const queryKey = [...botPanelKey(rpc), "unread", key] as const;
  return queryOptions({ queryKey, queryFn: async ({ signal }): Promise<ThreadFeed> => {
    const cached = queryClient.getQueryData<ThreadFeed>(queryKey);
    let revision = cached?.revision ?? botReadRevision(key), messages = cached?.messages ?? [];
    if (!cached) {
      const preview = await rpc<BotHistory>("botThreads.messages", { ...scope, latest: true, limit: 1 });
      signal.throwIfAborted();
      messages = mergeBotMessages(messages, preview.entries);
    }
    let more = thread.chatRevision > Math.max(revision, botReadRevision(key));
    while (more) {
      const afterRevision = Math.max(revision, botReadRevision(key));
      const page = await rpc<BotMessages>("botThreads.messages", { ...scope, afterRevision, limit: 100 });
      signal.throwIfAborted();
      if (page.hasMore && page.nextRevision <= afterRevision) throw new Error("Conversation is unavailable");
      revision = page.nextRevision; messages = mergeBotMessages(messages, page.entries); more = page.hasMore;
    }
    return { revision, messages };
  } });
}

/** Keep read markers local, while Query owns transport-scoped message deltas. */
export function useBotUnread(environmentId: string, threads: BotThread[], rpc: BotRpc, active: boolean) {
  const [, readChanged] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeBotRead(readChanged), []);
  const feeds = useQueries({ queries: threads.map(thread => ({ ...botUnreadQuery(environmentId, thread, rpc), enabled: active && !thread.archivedAt })) }, queryClient);
  const signature = JSON.stringify(threads.map(({ botId, id, chatRevision, archivedAt }) => [botId, id, chatRevision, archivedAt]));
  const previous = useRef(signature);
  useEffect(() => {
    const changed = previous.current !== signature;
    previous.current = signature;
    if (!active) return;
    for (const thread of threads) {
      if (thread.archivedAt) continue;
      const options = botUnreadQuery(environmentId, thread, rpc), state = queryClient.getQueryState<ThreadFeed>(options.queryKey);
      const read = botReadRevision(botCacheKey(environmentId, { botId: thread.botId, threadId: thread.id }));
      if (state?.status === "error" || (changed && !state?.data) || (state?.data && thread.chatRevision > Math.max(state.data.revision, read))) void invalidateAfterChange(options.queryKey);
    }
  }, [environmentId, signature, threads, rpc, active]);
  return new Map(threads.map((thread, index) => {
    const key = botCacheKey(environmentId, { botId: thread.botId, threadId: thread.id });
    const messages = feeds[index]?.data?.messages ?? [];
    const latest = [...messages].reverse().find(message => (message.kind === "assistant" || message.kind === "user") && (message.text.trim() || message.attachments?.length));
    return [key, { count: unreadBotMessages(key, messages).length, latest, messages }] as const;
  }));
}
