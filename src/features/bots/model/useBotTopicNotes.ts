import { useCallback, useEffect, useState } from "react";
import type { BotMemory } from "./botView";
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
type TopicList = {
  source: BotTopicSource;
  topics: string[];
  loading: boolean;
  error?: string;
};

/** Read each Host independently, so an offline Host never hides another's notes. */
export function useBotTopicNotes(
  sources: BotTopicSource[],
  active = true,
) {
  const [lists, setLists] = useState<TopicList[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLists((current) => sources.map((source) => ({
      source,
      topics: current.find((list) => list.source === source)?.topics ?? [],
      loading: true,
    })));
    for (const source of sources) {
      const update = (value: Omit<TopicList, "source">) => {
        if (!disposed)
          setLists((current) => current.map((list) =>
            list.source === source ? { source, ...value } : list,
          ));
      };
      void source.rpc<BotMemory | null>("assistant.memory").then(
        (memory) => update({ topics: memory?.topics ?? [], loading: false }),
        (error: unknown) => update({
          topics: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
    };
  }, [sources, active, revision, refresh]);
  const current = lists.filter((list) => sources.includes(list.source));
  const notes: BotTopicNote[] = current.flatMap(({ source, topics }) =>
    topics.map((name) => ({
      key: JSON.stringify([source.key, name]),
      name,
      source,
    })),
  );
  return {
    notes,
    loading: current.some((list) => list.loading),
    errors: current.filter((list) => list.error),
    refresh,
  };
}
