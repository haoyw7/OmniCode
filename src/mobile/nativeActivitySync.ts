import type { HostSessionSummary } from "../features/connections/model/protocol";

/** The fields Android's activity tracker reads; nothing else crosses the bridge. */
const NATIVE_FIELDS = [
  "id",
  "projectId",
  "title",
  "harness",
  "revision",
  "lastReplyRevision",
  "lastCompletedRunId",
  "pendingInputKey",
  "notificationPreview",
  "archived",
] as const satisfies readonly (keyof HostSessionSummary)[];

export type NativeActivityRow = Pick<HostSessionSummary, (typeof NATIVE_FIELDS)[number]>;

export function nativeActivityRow(session: HostSessionSummary): NativeActivityRow {
  const row: Partial<Record<keyof NativeActivityRow, unknown>> = {};
  for (const field of NATIVE_FIELDS)
    if (session[field] !== undefined) row[field] = session[field];
  return row as NativeActivityRow;
}

export type NativeActivityUpdate =
  | { full: true; sessions: NativeActivityRow[] }
  | { full: false; sessions: NativeActivityRow[]; removed: string[] };

/**
 * Tracks what the native tracker was last told, so each poll can send only
 * the conversations that changed. Capacitor parses every plugin call on the
 * Android main thread; the whole list each poll stalled frames for ~120ms.
 */
export class NativeActivitySync {
  private environmentId: string | undefined;
  private sent = new Map<string, string>();

  /** Everything after a reset or a Host change; otherwise only what changed. */
  plan(environmentId: string, sessions: readonly HostSessionSummary[]) {
    const rows = sessions.map(nativeActivityRow);
    const keys = new Map(rows.map((row) => [row.id, JSON.stringify(row)]));
    const full = environmentId !== this.environmentId || this.sent.size === 0;
    const update: NativeActivityUpdate = full
      ? { full: true, sessions: rows }
      : {
          full: false,
          sessions: rows.filter((row) => this.sent.get(row.id) !== keys.get(row.id)),
          removed: [...this.sent.keys()].filter((id) => !keys.has(id)),
        };
    // Record only once the tracker accepted it; a failed call resends in full.
    const commit = () => {
      this.environmentId = environmentId;
      this.sent = keys;
    };
    return { update, commit };
  }

  reset() {
    this.environmentId = undefined;
    this.sent = new Map();
  }
}
