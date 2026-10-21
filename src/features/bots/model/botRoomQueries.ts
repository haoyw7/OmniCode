import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { botPanelKey } from "./botPanelQueries";
import type { BotRpc } from "./botRpc";
import type { BotRoomMessage, BotRoomMessages, BotRoomState } from "./botRooms";

type RoomConversation = { state: BotRoomState; messages: BotRoomMessage[]; page: BotRoomMessages; revision: number };
const merge = (left: BotRoomMessage[], right: BotRoomMessage[]) => [...new Map([...left, ...right].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
export function botRoomConversationQuery(rpc: BotRpc, roomId: string) {
  const queryKey = [...botPanelKey(rpc), "roomConversation", roomId] as const;
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<RoomConversation> => {
      const current = queryClient.getQueryData<RoomConversation>(queryKey);
      const state = await rpc<BotRoomState>("botRooms.get", { roomId });
      signal.throwIfAborted();
      if (state.room.id !== roomId) throw new Error("Conversation is unavailable");
      if (current && state.room.chatRevision <= current.revision) return { ...current, state };
      const known = current?.messages.at(-1)?.sequence;
      let before: BotRoomMessages["next"], result: BotRoomMessages, incoming: BotRoomMessage[] = [];
      do {
        result = await rpc<BotRoomMessages>("botRooms.messages", { roomId, limit: 30, ...(before ? { before } : {}) });
        signal.throwIfAborted();
        incoming = merge(result.messages.filter(message => message.roomId === roomId), incoming);
        if (result.hasMore && result.next && JSON.stringify(result.next) === JSON.stringify(before)) throw new Error("Conversation is unavailable");
        before = result.next;
      } while (known !== undefined && result.hasMore && before && (incoming[0]?.sequence ?? 0) > known);
      return { state, messages: merge(current?.messages ?? [], incoming), revision: result.revision, page: current && known !== undefined ? current.page : result };
    },
  });
}
export async function loadOlderRoomMessages(rpc: BotRpc, roomId: string, beforePublish: () => void) {
  const options = botRoomConversationQuery(rpc, roomId), current = queryClient.getQueryData(options.queryKey);
  if (!current?.page.hasMore || !current.page.next || queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching") return;
  await queryClient.fetchQuery({ ...options, queryFn: async ({ signal }) => {
    const page = await rpc<BotRoomMessages>("botRooms.messages", { roomId, limit: 30, before: current.page.next });
    signal.throwIfAborted();
    beforePublish();
    return { ...current, page, messages: merge(page.messages.filter(message => message.roomId === roomId), current.messages) };
  } });
}
