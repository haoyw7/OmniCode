import { useMemo, useSyncExternalStore } from "react";
import type { HostSession } from "../contracts/protocol";
import type { RemoteProvider } from "../contracts/provider";
import { withOutgoing, type OutgoingMessage } from "../features/connections/model/outgoing";
import { sessionComposerConfiguration } from "../domain/composerConfiguration";
import { latestPlanDecision } from "../features/sessions/model/planDecision";
import { pendingSessionInputKey } from "../domain/sessionActivity";

type Snapshot = HostSession | undefined;

/** One store per mobile shell: navigation and Host changes retain their guards. */
export function createSessionSnapshotStore(initial?: HostSession) {
  let value = initial;
  let rendered: Snapshot;
  const listeners = new Set<() => void>();
  const renderedListeners = new Set<() => void>();
  const subscribeTo = (set: Set<() => void>, listener: () => void) => {
    set.add(listener);
    return () => { set.delete(listener); };
  };
  return {
    get: () => value,
    set: (update: Snapshot | ((previous: Snapshot) => Snapshot)) => {
      const next = typeof update === "function" ? update(value) : update;
      if (next === value || (next && value && next.session.id === value.session.id && next.revision < value.revision)) return;
      const changedSession = next?.session.id !== value?.session.id;
      value = next;
      if (changedSession) {
        rendered = undefined;
        for (const listener of renderedListeners) listener();
      }
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => subscribeTo(listeners, listener),
    // Read acknowledgements follow a visible transcript commit, not receipt of
    // a network response (which may arrive while another surface covers chat).
    getRendered: () => rendered,
    markRendered: (snapshot: HostSession) => {
      if (snapshot !== value || snapshot === rendered) return;
      rendered = snapshot;
      for (const listener of renderedListeners) listener();
    },
    subscribeRendered: (listener: () => void) => subscribeTo(renderedListeners, listener),
  };
}

export type SessionSnapshotStore = ReturnType<typeof createSessionSnapshotStore>;

export function useSessionSnapshot<T>(
  store: SessionSnapshotStore,
  select: (snapshot: Snapshot) => T,
  equal: (previous: T, next: T) => boolean = Object.is,
): T {
  const get = useMemo(() => {
    let initialized = false;
    let previous: Snapshot;
    let selected: T;
    return () => {
      const snapshot = store.get();
      if (initialized && snapshot === previous) return selected;
      const next = select(snapshot);
      if (!initialized || !equal(selected, next)) selected = next;
      initialized = true;
      previous = snapshot;
      return selected;
    };
  }, [store, select, equal]);
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Only metadata used by the shell; text, usage and progress belong to leaves. */
export function selectSessionShell(snapshot: Snapshot, outgoing?: OutgoingMessage) {
  if (!snapshot) return undefined;
  const session = snapshot.session;
  const configuration = sessionComposerConfiguration(session);
  const view = withOutgoing(snapshot, outgoing);
  const native = session.nativeSession;
  return {
    projectId: snapshot.projectId,
    archived: snapshot.archived,
    status: snapshot.status,
    runId: snapshot.runId,
    supportsQueue: snapshot.supportsQueue,
    canSteer: snapshot.canSteer,
    queueSteeringId: snapshot.queueSteeringId,
    // Sync timestamps/revisions belong to the status sheet, not the shell.
    nativeStatus: snapshot.nativeStatus ? {
      state: snapshot.nativeStatus.state, reason: snapshot.nativeStatus.reason,
    } : undefined,
    lastCompletedRunId: snapshot.lastCompletedRunId,
    hasBlocks: view.session.blocks.length > 0,
    pendingInputKey: pendingSessionInputKey(session, snapshot.runId),
    // The existing plan hook owns skipped decisions. This key wakes the shell
    // when an idle plan appears/changes without subscribing it to all text.
    planDecisionKey: snapshot.status !== "running" ? latestPlanDecision(session.blocks) : undefined,
    configuration: { ...configuration, harness: configuration.harness as RemoteProvider },
    session: {
      id: session.id,
      title: session.title,
      harness: session.harness,
      cwd: session.cwd,
      executionCwd: session.executionCwd,
      orchestrationLeadId: session.orchestrationLeadId,
      pendingConfiguration: session.pendingConfiguration,
      pendingQuestion: session.pendingQuestion,
      nativeSession: native ? {
        provider: native.provider, path: native.path, storage: native.storage,
        providerSessionId: native.providerSessionId, accountId: native.accountId,
      } : undefined,
      queuedMessages: view.session.queuedMessages,
      queueStatus: session.queueStatus,
      editingQueuedMessageId: session.editingQueuedMessageId,
    },
  };
}

export type MobileSessionShell = NonNullable<ReturnType<typeof selectSessionShell>>;

// RPC responses recreate metadata objects even when only text changed. Compare
// their values without serializing queued attachment payloads into more strings.
function sameMetadata(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (!previous || !next || typeof previous !== "object" || typeof next !== "object") return false;
  if (Array.isArray(previous) !== Array.isArray(next)) return false;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(next, key) && sameMetadata(
      (previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key],
    ));
}

export const sameSessionShell = (
  previous: ReturnType<typeof selectSessionShell>, next: ReturnType<typeof selectSessionShell>,
) => sameMetadata(previous, next);
