import { useQueries } from "@tanstack/react-query";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { botKeys, botTopicsQuery } from "./botQueries";
import type { BotRpc } from "./botRpc";

export type BotTopicSource = {
  key: string;
  name: string;
  rpc: BotRpc;
};
export type BotTopicNote = {
  key: string;
  name: string;
  source: BotTopicSource;
};
/** Read each Host independently, so an offline Host never hides another's notes. */
export function useBotTopicNotes(sources: BotTopicSource[], active = true) {
  const results = useQueries({
    queries: sources.map((source) => ({ ...botTopicsQuery(source.key, source.rpc), enabled: active })),
  }, queryClient);
  const lists = sources.map((source, index) => ({
    source,
    topics: results[index].isError ? [] : results[index].data?.topics ?? [],
    loading: active && results[index].isFetching,
    error: errorMessage(results[index].error),
  }));
  const notes: BotTopicNote[] = lists.flatMap(({ source, topics }) => topics.map((name) => ({
    key: JSON.stringify([source.key, name]), name, source,
  })));
  return {
    notes,
    loading: lists.some((list) => list.loading),
    errors: lists.filter((list) => list.error),
    refresh: () => { for (const source of sources) void invalidateAfterChange(botKeys.topics(source.key)); },
  };
}
