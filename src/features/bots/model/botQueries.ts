import { queryOptions } from "@tanstack/react-query";
import type { BotRpc } from "./botRpc";
import type { BotMemory, BotMemoryTopic } from "./botView";
import type { BotsSnapshot } from "./bots";
import type { BotTeams } from "./botTeams";
import type { BotRooms } from "./botRooms";
import { REMOTE_PROVIDERS, type HostDescriptor, type HostModelCatalog, type HostProject } from "../../connections/model/protocol";

export const botKeys = {
  host: (host: string) => ["bots", host] as const,
  descriptor: (host: string) => ["bots", host, "descriptor"] as const,
  list: (host: string) => ["bots", host, "list"] as const,
  teams: (host: string) => ["bots", host, "teams"] as const,
  rooms: (host: string) => ["bots", host, "rooms"] as const,
  catalog: (host: string) => ["bots", host, "catalog"] as const,
  topics: (host: string) => ["bots", host, "topics"] as const,
  topic: (host: string, name: string) => ["bots", host, "topic", name] as const,
};
export const botTopicsQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.topics(host), queryFn: () => rpc<BotMemory | null>("assistant.memory"),
});
export const botTopicQuery = (host: string, name: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.topic(host, name), queryFn: () => rpc<BotMemoryTopic | null>("assistant.memoryTopic", { topic: name }),
});
export const botDescriptorQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.descriptor(host), staleTime: Infinity,
  queryFn: () => rpc<HostDescriptor>("environment.describe", { supportedProviders: REMOTE_PROVIDERS }),
});
export const botsQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.list(host), queryFn: () => rpc<BotsSnapshot>("bots.list", { includeArchived: true }),
});
export const botTeamsQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.teams(host), queryFn: () => rpc<BotTeams>("botTeams.list", { includeArchived: true }),
});
export const botRoomsQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.rooms(host), queryFn: () => rpc<BotRooms>("botRooms.list", { includeArchived: true }),
});
export const botCatalogQuery = (host: string, rpc: BotRpc) => queryOptions({
  queryKey: botKeys.catalog(host),
  queryFn: async () => {
    const [catalog, projects] = await Promise.all([rpc<HostModelCatalog>("models.list"), rpc<HostProject[]>("projects.list")]);
    return { catalog, projects };
  },
});
