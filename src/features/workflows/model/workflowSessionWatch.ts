// Shared, ref-counted watches of Host sessions for the workflow views: the
// parent conversation (live run state) and hidden subagent sessions.

import { loadRemoteSession, remoteMachineFor, remoteRequest, remoteSessionFor } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import type { Session } from "../../sessions/model/session";

export type HostSessionLease = {
  readonly sessionId: string;
  getSnapshot(): Session | undefined;
  subscribe(listener: () => void): () => void;
  /** Re-read now (after a command), instead of waiting for the next poll. */
  refresh(): void;
  /** Answer a tool approval the session is waiting on. */
  approve(requestId: number, decision: "allow" | "deny"): Promise<void>;
  release(): void;
};

type Watch = {
  cwd: string;
  sessionId: string;
  refs: number;
  snapshot?: Session;
  known?: HostSession;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  polling: boolean;
  disposed: boolean;
};

const watches = new Map<string, Watch>();

/** Hidden or live sessions poll faster while something runs in them. */
function busy(session: Session | undefined, host: HostSession | undefined): boolean {
  return host?.status === "running" || !!session?.workflowRuns?.runs.some((run) => run.status === "running" || run.status === "pending");
}

async function poll(watch: Watch): Promise<void> {
  if (watch.disposed || watch.polling) return;
  watch.polling = true;
  clearTimeout(watch.timer);
  try {
    const project = remoteProjectFor(watch.cwd);
    const machine = project ? await remoteMachineFor(project.environmentId) : undefined;
    if (machine) {
      const hostId = remoteSessionFor(watch.sessionId) ?? watch.sessionId;
      const next = await loadRemoteSession(machine.id, hostId, watch.known);
      if (!watch.disposed && next !== watch.known) {
        watch.known = next;
        watch.snapshot = next.session;
        for (const listener of watch.listeners) listener();
      }
    }
  } catch {
    // Keep the last snapshot readable while the Host is unreachable.
  } finally {
    watch.polling = false;
    if (!watch.disposed) watch.timer = setTimeout(() => void poll(watch), busy(watch.snapshot, watch.known) ? 900 : 4_000);
  }
}

export function watchHostSession(cwd: string, sessionId: string, seed?: Session): HostSessionLease {
  const key = `${cwd}\0${sessionId}`;
  let watch = watches.get(key);
  if (!watch) {
    watch = { cwd, sessionId, refs: 0, listeners: new Set(), polling: false, disposed: false, ...(seed ? { snapshot: seed } : {}) };
    watches.set(key, watch);
    void poll(watch);
  }
  const current = watch;
  current.refs++;
  let released = false;
  return {
    sessionId,
    getSnapshot: () => current.snapshot,
    subscribe: (listener) => {
      current.listeners.add(listener);
      return () => current.listeners.delete(listener);
    },
    refresh: () => void poll(current),
    approve: async (requestId, decision) => {
      const project = remoteProjectFor(current.cwd);
      const machine = project ? await remoteMachineFor(project.environmentId) : undefined;
      const runId = current.known?.runId;
      if (!machine || !runId) throw new Error("This subagent is not waiting for an approval");
      await remoteRequest(machine.id, "commands.dispatch", {
        type: "approve",
        commandId: crypto.randomUUID(),
        sessionId: remoteSessionFor(current.sessionId) ?? current.sessionId,
        runId,
        requestId,
        decision,
      });
      void poll(current);
    },
    release: () => {
      if (released) return;
      released = true;
      current.refs--;
      if (current.refs > 0) return;
      current.disposed = true;
      clearTimeout(current.timer);
      watches.delete(key);
    },
  };
}
