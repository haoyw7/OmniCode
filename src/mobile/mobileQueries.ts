import { queryOptions } from "@tanstack/react-query";
import type { HostProject, HostSessionSummary } from "../features/connections/model/protocol";
import type { Note } from "../features/notes/notesText";
import { archivedMobileSessions } from "./sessionList";
import type { Connection, HostConnectionStatus, MobileClient } from "./client";

const sources = new WeakMap<object, number>();
let sourceId = 0;
export const mobileSourceKey = (source: object) => {
  if (!sources.has(source)) sources.set(source, ++sourceId);
  return sources.get(source)!;
};
export const mobileArchiveQuery = (host: string | undefined, projects: readonly HostProject[], load: (project: string) => Promise<HostSessionSummary[]>) => queryOptions({
  queryKey: ["mobile", "archive", host ?? mobileSourceKey(load), projects],
  queryFn: async ({ signal }) => {
    signal.throwIfAborted();
    const groups = await Promise.all(projects.filter(project => project.kind !== "assistant").map(async project => ({
      project, sessions: archivedMobileSessions(await load(project.id)),
    })));
    return groups.filter(group => group.sessions.length);
  },
});
export const mobileFileQuery = (owner: string, path: string, read: (path: string) => Promise<Uint8Array>) => queryOptions({
  queryKey: ["mobile", "file", owner, mobileSourceKey(read), path],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return read(path); },
  gcTime: 0,
  structuralSharing: false,
});
export const mobileNotesQuery = (host: string, list: () => Promise<Note[]>) => queryOptions({
  queryKey: ["mobile", "notes", host],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return list(); },
});
export const mobileNoteQuery = (host: string, id: string, get: (id: string) => Promise<Note | null>) => queryOptions({
  queryKey: ["mobile", "note", host, id],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return get(id); },
});
export const mobileProbeQuery = <T extends object>(connection: T, probe: (connection: T) => Promise<HostConnectionStatus>) => queryOptions({
  queryKey: ["mobile", "probe", mobileSourceKey(probe), mobileSourceKey(connection)],
  queryFn: ({ signal }) => { signal.throwIfAborted(); return probe(connection); },
});
export const mobileSavedConnectionsQuery = (client: Pick<MobileClient, "savedConnections">) => queryOptions({
  queryKey: ["mobile", "savedConnections", mobileSourceKey(client)],
  queryFn: () => client.savedConnections(),
});
export const mobileHostDirectoryQuery = (client: Pick<MobileClient, "peekProjects" | "peekSessions">, connection: Connection) => queryOptions({
  queryKey: ["mobile", "hostDirectory", mobileSourceKey(client), mobileSourceKey(connection)],
  queryFn: async ({ signal }) => {
    const projects = await client.peekProjects(connection);
    signal.throwIfAborted();
    const histories = await Promise.allSettled(projects.map(project => client.peekSessions(connection, project.id)));
    signal.throwIfAborted();
    return { endpoint: connection.endpoint, name: connection.name, projects,
      sessions: histories.flatMap(result => result.status === "fulfilled" ? result.value : []),
      failed: histories.some(result => result.status === "rejected"),
    };
  },
});
