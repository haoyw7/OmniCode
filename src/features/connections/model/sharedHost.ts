import { cachedSharedHost, listHostProjections, loadHostProjection } from "../../../platform/tauri/hostProjectionCache";
import { prepareDesktopHost, type PreparedDesktopHost } from "../../../platform/tauri/connections";
import { readLegacyWorkspaceSnapshot } from "../../../platform/tauri/appShell";
import { configureLocalExecutionDiagnostics } from "../../../shared/lib/localExecutionDiagnostics";
import { hostOrchestrationClient } from "../../orchestration/model/orchestrationClient";
import type { HostProject, HostSession, HostSessionSummary } from "../../../contracts/protocol";
import type { NativeSessionAccess, NativeSourceListing } from "../../../contracts/session";
import { loadRemoteSession, remoteRequest, rememberRemoteSession, remoteSessionFor, refreshRemoteMachines, forgetDeletedRemoteBindings, forgetUnknownRemoteBindings, remoteSessionScopeFor } from "./connections";
import { hostStateTransportUnavailable } from "./hostStateOffline";
import { configureSharedHost, ensureSharedProject, sharedHostEnvironment, sharedProjects, sharedProjectKey, projectPath } from "./remoteProjects";
import { rememberImportedProject } from "../../projects/model/recents";
import { normalizeProjectPath } from "../../../domain/pathDisplay";
import { OUTBOX_PREFIX, deleteOutboxEntries, loadRemoteOutbox, outboxEntry, outboxKeys } from "../../../platform/tauri/remoteOutbox";
import { setSharedSessionBackend } from "../../sessions/data/sharedSessionBackend";
import { setRetiredSessionIds, isRetiredSession } from "../../sessions/model/retiredSessions";
import type { SessionSummary, SessionSearchHit } from "../../sessions/data/sessionStore";



/** Native cache lookup verifies saved endpoint, environment and credential hash. */
async function prepareSharedHost(): Promise<{ prepared: PreparedDesktopHost; offline: boolean }> {
  try {
    return { prepared: await prepareDesktopHost(), offline: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const startupUnavailable = /^Could not start shared conversation service(?::|$)/i.test(message)
      && !/unauthori[sz]ed|forbidden|authentication|identity|revoked|\b401\b|\b403\b|unsupported/i.test(message);
    if (!hostStateTransportUnavailable(error) && !startupUnavailable) throw error;
    const prepared = await cachedSharedHost<PreparedDesktopHost>().catch(() => null);
    if (!prepared) throw error;
    return { prepared, offline: true };
  }
}

export function clearRetiredHostOutbox(environmentId: string, retired: ReadonlySet<string>): void {
  const removals: string[] = [];
  for (const key of outboxKeys()) {
    if (!key.startsWith(OUTBOX_PREFIX)) continue;
    try {
      const boundary = key.lastIndexOf("]:" );
      const scope = JSON.parse(key.slice(OUTBOX_PREFIX.length, boundary + 1));
      if (scope[1] !== environmentId) continue;
      const entry = JSON.parse(outboxEntry(key)!);
      const command = entry.command ?? entry;
      if (retired.has(command.sessionId) || retired.has(entry.shellId)) removals.push(key);
    } catch {
      // Leave unrelated or malformed requests available for normal recovery.
    }
  }
  if (removals.length) void deleteOutboxEntries(removals);
}

/** Session and shell IDs that queued Host requests still refer to. */
function pendingOutboxIds(): Set<string> {
  const ids = new Set<string>();
  for (const key of outboxKeys()) {
    if (!key.startsWith(OUTBOX_PREFIX)) continue;
    try {
      const entry = JSON.parse(outboxEntry(key)!);
      const command = entry.command ?? entry;
      if (typeof command.sessionId === "string") ids.add(command.sessionId);
      if (typeof entry.shellId === "string") ids.add(entry.shellId);
    } catch {
      // Malformed requests never reach the Host, so they pin nothing.
    }
  }
  return ids;
}

/** Awaited before workspace restore: there is no fallback to a second runtime. */
export async function initializeSharedHost(): Promise<void> {
  configureLocalExecutionDiagnostics(({ cwd }) =>
    cwd === "~" ? "home-draft" : !sharedHostEnvironment() ? "host-not-ready" : "legacy-local",
  );
  await loadRemoteOutbox();
  const { prepared, offline } = await prepareSharedHost();
  const projectByPath = new Map(prepared.projects.map(project => [sharedProjectKey(project), project]));
  const projectForPreparedSession = (row: PreparedDesktopHost["sessions"][number]) =>
    row.projectId ? prepared.projects.find((project) => project.id === row.projectId) : projectByPath.get(normalizeProjectPath(row.cwd));
  // Older bindings stored only a wire ID. A saved local workspace supplies
  // positive identity evidence; an unknown alias is kept for its own Host.
  const legacyShellIds = new Set<string>();
  const rawWorkspace = await readLegacyWorkspaceSnapshot().catch(() => null);
  const workspace = rawWorkspace && typeof rawWorkspace === "object" ? rawWorkspace as { sessions?: unknown } : null;
  for (const row of Array.isArray(workspace?.sessions) ? workspace.sessions : []) {
    if (typeof row.id !== "string" || typeof row.cwd !== "string" || row.cwd.startsWith("remote://")) continue;
    const project = projectByPath.get(normalizeProjectPath(row.cwd));
    const scope = remoteSessionScopeFor(row.id);
    if (!project || scope && (scope.environmentId !== prepared.machine.environmentId || scope.projectId !== project.id)) continue;
    legacyShellIds.add(row.id);
    const hostId = remoteSessionFor(row.id);
    if (hostId) rememberRemoteSession(row.id, hostId, { environmentId: prepared.machine.environmentId, projectId: project.id });
  }
  const deletedIds = [...new Set([...(prepared.retiredSessionIds ?? []), ...prepared.sessions.filter(row => row.deleted).map(row => row.id)])];
  const deletedAliases = forgetDeletedRemoteBindings(deletedIds, {
    environmentId: prepared.machine.environmentId,
    projectIds: new Set(prepared.projects.map(project => project.id)),
    legacyShellIds,
  });
  // Without this, bindings to sessions the Host has dropped accumulate forever.
  try {
    if (!offline) forgetUnknownRemoteBindings(
      {
        environmentId: prepared.machine.environmentId,
        projectIds: new Set(prepared.projects.map((project) => project.id)),
      },
      new Set([...prepared.sessions.map((row) => row.id), ...deletedIds]),
      new Set([
        ...(Array.isArray(workspace?.sessions) ? workspace.sessions : []).flatMap(
          (row) => (typeof row.id === "string" ? [row.id] : []),
        ),
        ...pendingOutboxIds(),
      ]),
    );
  } catch {
    // Cleanup is best effort; a full storage must not block startup.
  }
  const retiredIds = [...new Set([...deletedIds, ...deletedAliases])];
  setRetiredSessionIds(retiredIds);
  hostOrchestrationClient.retire(prepared.machine.environmentId, retiredIds);
  clearRetiredHostOutbox(prepared.machine.environmentId, new Set(retiredIds));
  configureSharedHost(
    prepared.machine.environmentId,
    prepared.projects,
    prepared.machine.id,
  );
  const paths = new Map(
    prepared.sessions.map((row) => [row.id, projectForPreparedSession(row) ? sharedProjectKey(projectForPreparedSession(row)!) : normalizeProjectPath(row.cwd)]),
  );
  for (const row of prepared.sessions) {
    const project = projectForPreparedSession(row);
    if (!row.deleted && !remoteSessionFor(row.id) && project)
      rememberRemoteSession(row.id, row.id, { environmentId: prepared.machine.environmentId, projectId: project.id });
  }
  const hostId = (id: string) => remoteSessionFor(id) ?? id;
  const localSession = async (id: string) => {
    const scope = remoteSessionScopeFor(id);
    if (isRetiredSession(id) || scope && scope.environmentId !== prepared.machine.environmentId) return null;
    try {
      const snapshot = await loadRemoteSession(prepared.machine.id, hostId(id)).catch(async (error) => {
        if (!hostStateTransportUnavailable(error)) throw error;
        const cached = await loadHostProjection(prepared.machine.id, hostId(id));
        if (!cached) throw error;
        return { ...cached, session: { ...cached.session, busy: false } };
      });
      if (scope && snapshot.projectId !== scope.projectId) return null;
      const project = sharedProjects().find(
        (row) => row.projectId === snapshot.projectId,
      );
      if (!project) return null;
      hostOrchestrationClient.bindShell({ machineId: prepared.machine.id, project }, snapshot.session.id, id);
      hostOrchestrationClient.accept({ machineId: prepared.machine.id, project }, snapshot);
      paths.set(snapshot.session.id, project.key);
      paths.set(id, project.key);
      if (!remoteSessionFor(id)) rememberRemoteSession(id, snapshot.session.id, project);
      return {
        ...snapshot.session,
        nativeSyncStatus: snapshot.nativeStatus,
        id,
        cwd: project.key,
        executionCwd: projectPath(project, snapshot.session.executionCwd || snapshot.session.cwd),
      };
    } catch (error) {
      if (String(error).includes("Session not found")) return null;
      throw error;
    }
  };
  const list = async (cwd?: string): Promise<SessionSummary[]> => {
    if (!cwd) {
      try {
        configureSharedHost(
          prepared.machine.environmentId,
          await remoteRequest<HostProject[]>(prepared.machine.id, "projects.list"),
          prepared.machine.id,
        );
      } catch (error) {
        if (!hostStateTransportUnavailable(error)) throw error;
      }
    }
    const projects = cwd ? [await ensureSharedProject(cwd)] : sharedProjects();
    const results = await Promise.all(
      projects.map(async (project) => {
        let rows: HostSessionSummary[];
        try {
          rows = await remoteRequest<HostSessionSummary[]>(
            prepared.machine.id, "sessions.list", { projectId: project.projectId },
          );
        } catch (error) {
          if (!hostStateTransportUnavailable(error)) throw error;
          const projections = await listHostProjections(prepared.machine.id, project.projectId);
          const cachedRows = new Map<string, HostSessionSummary>();
          for (const value of projections) {
            const { blocks: _blocks, ...session } = value.session;
            cachedRows.set(session.id, { ...session, projectId: value.projectId, revision: value.revision,
              updatedAt: value.updatedAt, createdAt: value.createdAt, archived: value.archived, pinned: value.pinned,
              status: value.status } as HostSessionSummary);
          }
          rows = [...cachedRows.values()];
        }
        return rows.map((row) => {
          hostOrchestrationClient.accept({ machineId: prepared.machine.id, project }, row);
          paths.set(row.id, project.key);
          return {
            ...row,
            cwd: project.key,
            model: row.model ?? "",
            runtimeMode: row.runtimeMode ?? "supervised",
            providerSessionId: row.providerSessionId ?? undefined,
            createdAt: row.createdAt ?? row.updatedAt,
          } satisfies SessionSummary;
        });
      }),
    );
    return results.flat();
  };
  const searches = new Map<string, number>();
  const projectForSession = async (id: string) => {
    let cwd = paths.get(id) ?? paths.get(hostId(id));
    if (!cwd) cwd = (await localSession(id))?.cwd;
    if (!cwd) throw new Error("Conversation not found");
    return ensureSharedProject(cwd);
  };
  setSharedSessionBackend({
    ownsProject: (cwd) =>
      !!sharedHostEnvironment() && !cwd.startsWith("remote://") && cwd !== "~",
    ownsSession: (id) => {
      const scope = remoteSessionScopeFor(id);
      if (scope && scope.environmentId !== prepared.machine.environmentId) return false;
      const cwd = paths.get(id) ?? paths.get(hostId(id));
      if (scope && cwd && sharedProjects().find(project => normalizeProjectPath(project.key) === normalizeProjectPath(cwd))?.projectId !== scope.projectId) return false;
      return paths.has(id) || (scope?.environmentId === prepared.machine.environmentId || legacyShellIds.has(id)) && paths.has(hostId(id));
    },
    rememberSession: (id, cwd) => {
      paths.set(id, normalizeProjectPath(cwd));
    },
    list,
    get: localSession,
    update: async (id, patch) => {
      const project = await projectForSession(id);
      await remoteRequest(prepared.machine.id, "sessions.update", {
        projectId: project.projectId,
        sessionId: hostId(id),
        ...patch,
      });
    },
    delete: async (id) => {
      const project = await projectForSession(id);
      await remoteRequest(prepared.machine.id, "sessions.delete", {
        projectId: project.projectId,
        sessionId: hostId(id),
      });
    },
    native: {
      list: (options = {}) =>
        remoteRequest<NativeSourceListing>(prepared.machine.id, "nativeSources.list", {
          ...(options.refresh ? { refresh: true } : {}),
          ...(options.autoSync === undefined ? {} : { autoSync: options.autoSync }),
        }),
      import: async (sourceId) => {
        const value = await remoteRequest<HostSession>(prepared.machine.id, "nativeSources.import", { sourceId });
        const project = await ensureSharedProject(value.session.cwd);
        paths.set(value.session.id, normalizeProjectPath(project.key));
        if (!remoteSessionFor(value.session.id))
          rememberRemoteSession(value.session.id, value.session.id, { environmentId: prepared.machine.environmentId, projectId: value.projectId });
        rememberImportedProject(project.key);
        return value.session.id;
      },
      syncAll: async () => {
        await remoteRequest(prepared.machine.id, "nativeSources.syncAll");
      },
      access: (id) =>
        remoteRequest<NativeSessionAccess | null>(prepared.machine.id, "sessions.nativeAccess", { sessionId: hostId(id) }),
    },
    cancelSearch: (owner) => {
      searches.set(owner, (searches.get(owner) ?? 0) + 1);
    },
    search: async (query, cwd, includeArchived, owner = "desktop") => {
      const version = (searches.get(owner) ?? 0) + 1;
      searches.set(owner, version);
      const hits: SessionSearchHit[] = [];
      const needle = query.toLocaleLowerCase();
      for (const row of await list(cwd)) {
        if (searches.get(owner) !== version) return [];
        if (!includeArchived && row.archived) continue;
        const common = {
          sessionId: row.id,
          cwd: row.cwd,
          harness: row.harness,
          title: row.title,
          updatedAt: row.updatedAt,
        };
        if (row.title.toLocaleLowerCase().includes(needle))
          hits.push({ kind: "conversation", preview: row.title, ...common });
        const session = await localSession(row.id);
        for (const block of session?.blocks ?? []) {
          const at = block.text.toLocaleLowerCase().indexOf(needle);
          if (at >= 0)
            hits.push({
              kind: "message",
              ...common,
              blockId: block.id,
              role: block.role,
              preview: block.text.slice(
                Math.max(0, at - 80),
                at + needle.length + 160,
              ),
            });
          if (hits.length >= 201) return hits;
        }
      }
      return hits;
    },
  });
  refreshRemoteMachines();
}
