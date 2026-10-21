import type { BotMemoryDocument, BotMemoryList, BotMemoryChange } from "./botMemory";
import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import type { BotRpc } from "./botRpc";
import type { BotRun, BotRuns, BotScope, BotDelegation, BotDelegations, BotsSnapshot } from "./bots";
import type { SessionReference, BotMemory } from "./botView";
import type { HostSession } from "../../connections/model/protocol";
import type { ImView } from "./im";

// These panels receive a scoped transport instead of a Host ID. Never share
// their remote data between different transports with identical bot/session IDs.
const sources = new WeakMap<object, number>();
let sourceId = 0;
export function botPanelKey(rpc: object) {
  if (!sources.has(rpc)) sources.set(rpc, ++sourceId);
  return ["botPanels", sources.get(rpc)!] as const;
}
/** Read identity includes the transport and complete RPC arguments. */
export const botRpcQuery = <T,>(rpc: BotRpc, method: string, params?: Record<string, unknown>) => queryOptions({
  queryKey: [...botPanelKey(rpc), "rpc", method, params ?? null],
  queryFn: ({ signal }): Promise<T> => { signal.throwIfAborted(); return rpc<T>(method, params); },
});
export const botNamesQuery = (rpc: BotRpc) => queryOptions({
  queryKey: [...botPanelKey(rpc), "names"],
  queryFn: async () => Object.fromEntries((await rpc<BotsSnapshot>("bots.list", { includeArchived: true })).bots.map(bot => [bot.id, bot.name])),
});
export const botWorkerQuery = (rpc: BotRpc, target: SessionReference) => queryOptions({
  queryKey: [...botPanelKey(rpc), "worker", target.projectId, target.sessionId],
  queryFn: async ({ signal }) => {
    signal.throwIfAborted();
    const value = await rpc<HostSession>("sessions.get", { sessionId: target.sessionId });
    if (!value || value.projectId !== target.projectId || !value.session.orchestrationLeadId) throw new Error("Conversation is unavailable");
    return value;
  },
});
export const botImQuery = (rpc: BotRpc) => queryOptions({
  queryKey: [...botPanelKey(rpc), "im"],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return rpc<ImView>("im.get", {}); },
});

export const delegationBelongs = (value: BotDelegation, scope: BotScope) =>
  [value.source, value.target].some(target => target.botId === scope.botId && target.threadId === scope.threadId);
const merge = <T extends { id: string; createdAt: number }>(rows: T[], incoming: T[]) =>
  [...new Map([...rows, ...incoming].map(value => [value.id, value])).values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
const beforeBoundary = (next: { createdAt: number; id: string }, last: { createdAt: number; id: string }) =>
  next.createdAt > last.createdAt || (next.createdAt === last.createdAt && next.id > last.id);

export function botRunsQuery(rpc: BotRpc, scope: BotScope) {
  const queryKey = [...botPanelKey(rpc), "runs", scope] as const;
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<BotRuns> => {
      const boundary = queryClient.getQueryData<BotRuns>(queryKey)?.runs.at(-1);
      let before: BotRuns["next"], result: BotRuns, rows: BotRun[] = [];
      do {
        signal.throwIfAborted();
        result = await rpc<BotRuns>("botThreads.runs", { botId: scope.botId, threadId: scope.threadId, limit: 30, ...(before ? { before } : {}) });
        rows = merge(rows, result.runs); before = result.next;
      } while (boundary && result.hasMore && before && beforeBoundary(before, boundary));
      return { ...result, runs: rows };
    },
  });
}
export async function loadMoreBotRuns(rpc: BotRpc, scope: BotScope) {
  const options = botRunsQuery(rpc, scope), current = queryClient.getQueryData(options.queryKey);
  if (!current?.hasMore || !current.next || queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching") return;
  await queryClient.fetchQuery({ ...options, queryFn: async ({ signal }) => {
    signal.throwIfAborted();
    const next = await rpc<BotRuns>("botThreads.runs", { botId: scope.botId, threadId: scope.threadId, limit: 30, before: current.next });
    return { ...next, runs: merge(current.runs, next.runs) };
  }});
}
export function botDelegationsQuery(rpc: BotRpc, scope: BotScope) {
  const queryKey = [...botPanelKey(rpc), "delegations", scope] as const;
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<BotDelegations> => {
      const boundary = queryClient.getQueryData<BotDelegations>(queryKey)?.delegations.at(-1);
      let before: BotDelegations["next"], result: BotDelegations, rows: BotDelegation[] = [];
      do {
        signal.throwIfAborted();
        result = await rpc<BotDelegations>("botDelegations.list", { botId: scope.botId, threadId: scope.threadId, limit: 30, ...(before ? { before } : {}) });
        rows = merge(rows, result.delegations.filter(value => delegationBelongs(value, scope))); before = result.next;
      } while (boundary && result.hasMore && before && beforeBoundary(before, boundary));
      return { ...result, delegations: rows };
    },
  });
}
export async function loadMoreBotDelegations(rpc: BotRpc, scope: BotScope) {
  const options = botDelegationsQuery(rpc, scope), current = queryClient.getQueryData(options.queryKey);
  if (!current?.hasMore || !current.next || queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching") return;
  await queryClient.fetchQuery({ ...options, queryFn: async ({ signal }) => {
    signal.throwIfAborted();
    const next = await rpc<BotDelegations>("botDelegations.list", { botId: scope.botId, threadId: scope.threadId, limit: 30, before: current.next });
    return { ...next, delegations: merge(current.delegations, next.delegations.filter(value => delegationBelongs(value, scope))) };
  }});
}
export const botDelegationQuery = (rpc: BotRpc, scope: BotScope, delegationId: string) => queryOptions({
  queryKey: [...botPanelKey(rpc), "delegation", scope, delegationId],
  queryFn: async ({ signal }) => {
    signal.throwIfAborted();
    const next = await rpc<BotDelegation>("botDelegations.get", { botId: scope.botId, threadId: scope.threadId, delegationId });
    if (next.id !== delegationId || !delegationBelongs(next, scope)) throw new Error("Delegation unavailable in this thread");
    return next;
  },
});

export const botMemoryListQuery = (rpc: BotRpc, botId: string) => queryOptions({
  queryKey: [...botPanelKey(rpc), "memory", botId, "list"],
  queryFn: () => rpc<BotMemoryList>("botMemory.list", { botId }),
});
export const botMemoryDocumentQuery = (rpc: BotRpc, botId: string, path: string) => queryOptions({
  queryKey: [...botPanelKey(rpc), "memory", botId, "document", path],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return rpc<BotMemoryDocument>("botMemory.read", { botId, path }); },
});
export const botMemoryHistoryQuery = (rpc: BotRpc, botId: string, path: string) => queryOptions({
  queryKey: [...botPanelKey(rpc), "memory", botId, "history", path],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return rpc<BotMemoryChange[]>("botMemory.log", { botId, path, limit: 30 }); },
});

export const botResidentMemoryQuery = (rpc: BotRpc) => queryOptions({
  queryKey: [...botPanelKey(rpc), "residentMemory"],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return rpc<BotMemory | null>("assistant.memory"); },
});
