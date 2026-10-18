import { pathKey } from "../../shared/lib/paths";

export type ProjectHoverSummary = {
  /** Unknown until a complete project listing has succeeded. */
  total?: number;
  unread: number;
  opened: number;
  historyState: "idle" | "loading" | "ready" | "error";
  /** A previous complete listing remains available during loading or failure. */
  cached?: boolean;
  /** False when the summary producer has no loader for this project's backend. */
  canRetry?: boolean;
};

type SummarySession = {
  id: string;
  cwd: string;
  archived?: boolean;
  orchestrationLeadId?: string;
  workflowParentId?: string;
  orchestration?: { tasks: readonly { sessionId: string }[] };
  inboxAsk?: unknown;
};

type RemoteSummarySession = Omit<SummarySession, "cwd"> & { cwd?: string };

/** Full project counts are independent of tree search, filters and pagination. */
export function projectHoverSummary(input: {
  path: string;
  history: readonly SummarySession[];
  openSessions?: readonly SummarySession[];
  openSessionIds?: ReadonlySet<string>;
  /** Completion flags are already scoped and translated to Host ids by Sidebar. */
  unseenFinishedIds?: ReadonlySet<string>;
  remoteSessions?: readonly RemoteSummarySession[];
  remoteSessionId?: (shellId: string) => string | undefined;
  loaded: boolean;
  pending?: boolean;
  failed?: boolean;
}): ProjectHoverSummary {
  const key = pathKey(input.path);
  const local = input.history.filter((row) => pathKey(row.cwd) === key);
  const live = (input.openSessions ?? []).filter(
    (row) => pathKey(row.cwd) === key,
  );
  const idFor = (id: string) => input.remoteSessionId?.(id) ?? id;
  const excluded = new Set<string>();
  for (const row of [...local, ...live]) {
    if (row.orchestrationLeadId || row.workflowParentId || row.inboxAsk) excluded.add(idFor(row.id));
    for (const task of row.orchestration?.tasks ?? [])
      excluded.add(idFor(task.sessionId));
  }
  for (const row of input.remoteSessions ?? []) {
    if (row.orchestrationLeadId || row.workflowParentId || row.inboxAsk) excluded.add(row.id);
    for (const task of row.orchestration?.tasks ?? [])
      excluded.add(task.sessionId);
  }

  const rows = new Map<string, SummarySession | RemoteSummarySession>();
  for (const row of local) rows.set(idFor(row.id), row);
  // The complete Host cache supplies the durable archive state for shell rows.
  for (const row of input.remoteSessions ?? []) rows.set(row.id, row);
  const opened = new Set<string>();
  const workspaceIds =
    input.openSessionIds ?? new Set(live.map((row) => row.id));
  for (const row of live) {
    if (!workspaceIds.has(row.id)) continue;
    const id = idFor(row.id);
    if (excluded.has(id)) continue;
    opened.add(id);
    // Live summaries also contain retained background sessions. Add only actual
    // workspace tabs, so a closed ephemeral blank never becomes a conversation.
    if (!rows.has(id)) rows.set(id, row);
  }

  let total = 0;
  let unread = 0;
  for (const [id, row] of rows) {
    if (row.archived || excluded.has(id)) continue;
    total++;
    if (input.unseenFinishedIds?.has(id)) unread++;
  }
  const historyState = input.pending
    ? "loading"
    : input.failed
      ? "error"
      : input.loaded
        ? "ready"
        : "idle";
  return {
    total: input.loaded ? total : undefined,
    unread,
    opened: opened.size,
    historyState,
    ...(input.loaded && historyState !== "ready" ? { cached: true } : {}),
  };
}
