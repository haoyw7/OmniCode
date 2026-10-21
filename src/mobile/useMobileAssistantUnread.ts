import { useEffect, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../shared/lib/queryClient";
import { botPanelKey } from "../features/bots/model/botPanelQueries";
import type { BotMessage as AssistantMessage, BotMessages as AssistantMessages, BotConfiguration as AssistantView } from "../features/bots/model/botView";
import { mergeBotMessages as mergeAssistantMessages, type BotRpc as AssistantRpc } from "../features/bots/model/botRpc";
import {
  botReadRevision as assistantReadRevision,
  subscribeBotRead as subscribeAssistantRead,
  unreadBotMessages as unreadAssistantMessages,
} from "../features/bots/model/botUnread";

/** Keep the current Host's unread messages ready for the drawer. */
export function useMobileAssistantUnread(
  hostKey: string | undefined,
  rpc: AssistantRpc,
  active: boolean,
) {
  type Feed = { revision: number; messages: AssistantMessage[] };
  const queryKey = [...botPanelKey(rpc), "mobileUnread", hostKey] as const;
  const [, refreshRead] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeAssistantRead(refreshRead), []);
  const read = useQuery<Feed>({
    queryKey, enabled: !!hostKey && active,
    refetchInterval: active ? query => query.state.status === "error" ? 30000 : 2000 : false,
    queryFn: async ({ signal }): Promise<Feed> => {
      const key = hostKey!;
      const previous = queryClient.getQueryData<Feed>(queryKey);
      let revision = previous?.revision ?? assistantReadRevision(key), messages = previous?.messages ?? [];
      const assistant = await rpc<AssistantView | null>("assistant.get");
      signal.throwIfAborted();
      if (!assistant) return { revision, messages: [] };
      let page: AssistantMessages;
      do {
        const afterRevision = Math.max(revision, assistantReadRevision(key));
        page = await rpc<AssistantMessages>("assistant.messages", { afterRevision, limit: 100 });
        signal.throwIfAborted();
        if (page.hasMore && page.nextRevision <= afterRevision) throw new Error("Conversation is unavailable");
        revision = page.nextRevision;
        messages = unreadAssistantMessages(key, mergeAssistantMessages(messages, page.entries));
        queryClient.setQueryData(queryKey, { revision, messages });
      } while (page.hasMore);
      return { revision, messages };
    },
  }, queryClient);
  useEffect(() => { if (!active) void queryClient.cancelQueries({ queryKey }, { revert: false }); }, [active, rpc, hostKey]);
  return hostKey ? unreadAssistantMessages(hostKey, read.data?.messages ?? []).length : 0;
}
