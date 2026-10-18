import { useEffect, useMemo, useReducer, useState } from "react";
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
  // Keep completed pages across foreground changes and reconnects. Unlike chat
  // history, the badge only needs revisions newer than the read acknowledgement.
  const feed = useMemo(() => ({
    revision: hostKey ? assistantReadRevision(hostKey) : 0,
    messages: [] as AssistantMessage[],
  }), [hostKey, rpc]);
  const [state, setState] = useState<{ feed: typeof feed; messages: AssistantMessage[] }>();
  const [, refreshRead] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeAssistantRead(refreshRead), []);
  useEffect(() => {
    if (!hostKey || !active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let delay = 2000;
      try {
        const assistant = await rpc<AssistantView | null>("assistant.get");
        if (disposed) return;
        if (!assistant) {
          feed.messages = [];
          setState({ feed, messages: feed.messages });
          return;
        }
        let page: AssistantMessages;
        do {
          feed.revision = Math.max(feed.revision, assistantReadRevision(hostKey));
          page = await rpc<AssistantMessages>("assistant.messages", {
            afterRevision: feed.revision,
            limit: 100,
          });
          // Ignore late responses before advancing the cursor or fetching another
          // page, so a paused request cannot resume against a different Host.
          if (disposed) return;
          feed.revision = page.nextRevision;
          feed.messages = unreadAssistantMessages(
            hostKey, mergeAssistantMessages(feed.messages, page.entries),
          );
          setState({ feed, messages: feed.messages });
        } while (page.hasMore);
      } catch {
        // Retain the last count through transient connection failures.
        delay = 30000;
      } finally {
        if (!disposed) timer = setTimeout(refresh, delay);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [hostKey, rpc, active, feed]);
  return hostKey && state?.feed === feed
    ? unreadAssistantMessages(hostKey, state.messages).length
    : 0;
}
