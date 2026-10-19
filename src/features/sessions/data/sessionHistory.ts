import type { OrchestrationReadRun } from "../../orchestration/model/orchestrationClient";
import { summarizeOrchestration } from "../../orchestration/model/orchestrationSummary";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { pathKey, projectName } from "../../../shared/lib/paths";
import { sameProjectPath } from "../../projects/model/recents";
import {
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionNeedsInput,
  type Session,
} from "../model/session";
import { shouldPersistSession, type SessionSummary } from "./sessionStore";
import { sessionMessageActivityAt, sessionRecencyAt } from "../model/sessionActivity";

export type SessionGitHint = {
  repo?: string;
  branch?: string;
};

/** New composers stay in their pane until a turn is sent or explicitly saved. */
export function sidebarLiveSessions(
  sessions: readonly Session[],
): Session[] {
  return sessions.filter(
    (session) =>
      !session.inboxAsk && !session.orchestrationLeadId && !session.workflowParentId &&
      (session.busy || session.blocks.some((block) => block.role === "user")),
  );
}

export function compareSessionSummaries(
  a: SessionSummary,
  b: SessionSummary,
): number {
  const pin = Number(!!b.pinned) - Number(!!a.pinned);
  if (pin !== 0) return pin;
  return sessionRecencyAt(b) - sessionRecencyAt(a) || a.id.localeCompare(b.id);
}

export function mergeHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const previous = current.find((entry) => entry.id === summary.id);
  const next = {
    ...summary,
    archived: summary.archived ?? previous?.archived,
    pinned: summary.pinned ?? previous?.pinned,
    orchestration: summary.orchestration ?? previous?.orchestration,
    orchestrationLeadId:
      summary.orchestrationLeadId ?? previous?.orchestrationLeadId,
    workflowParentId: summary.workflowParentId ?? previous?.workflowParentId,
    automationId: summary.automationId ?? previous?.automationId,
    remoteControl: summary.remoteControl ?? previous?.remoteControl,
    remoteControlDevice: summary.remoteControlDevice ?? previous?.remoteControlDevice,
  };
  return [next, ...current.filter((entry) => entry.id !== summary.id)].sort(
    compareSessionSummaries,
  );
}

/**
 * Swap in one project's freshly fetched rows while leaving every other
 * project's cached rows alone. The Host may return a canonical cwd when the
 * requested project is a symlink, so incoming session IDs also replace their
 * cached copies regardless of the requested path.
 */
export function replaceProjectHistory(
  current: SessionSummary[],
  cwd: string,
  rows: SessionSummary[],
): SessionSummary[] {
  const incomingIds = new Set(rows.map((row) => row.id));
  const others = current.filter(
    (entry) => !sameProjectPath(entry.cwd, cwd) && !incomingIds.has(entry.id),
  );
  return [...others, ...rows];
}

/**
 * `mergeHistorySummary`, but scoped so persisting a session cannot drop the
 * other projects the cache is holding. A session that changed project is
 * removed from its old one so the id cannot appear twice.
 */
export function mergeProjectHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const mine: SessionSummary[] = [];
  const others: SessionSummary[] = [];
  for (const entry of current) {
    if (sameProjectPath(entry.cwd, summary.cwd)) mine.push(entry);
    else if (entry.id !== summary.id) others.push(entry);
  }
  return [...others, ...mergeHistorySummary(mine, summary)];
}

export function filterSessionsByArchive(
  rows: SessionSummary[],
  showArchived: boolean,
): SessionSummary[] {
  return rows.filter((row) => !!row.archived === showArchived);
}

export function filterSessionsByQuery(
  rows: SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim();
  if (!needle) return rows;
  return rows.filter((row) => sessionSearchHit(row, needle));
}

function sessionSearchHit(row: SessionSummary, query: string): boolean {
  const title = sessionDisplayTitle(row.title, row.harness);
  const git = [row.repo, row.branch].filter(Boolean).join("/");
  const fields = [title, row.title, row.model, row.harness, git];
  return fields.some((field) => field && fuzzyMatch(query, field) != null);
}

/** Reading or expanding a project must never count as conversation activity. */
function sessionActivityAt(session: Session): number {
  let latest = Math.max(
    session.updatedAt ?? 0,
    session.nativeSession?.updatedAt ?? 0,
  );
  for (const block of session.blocks) {
    latest = Math.max(
      latest,
      block.sentAt ?? 0,
      (block.startedAt ?? 0) +
        (block.startedAt != null ? Math.max(0, block.durationMs ?? 0) : 0),
    );
  }
  return latest;
}

export function summaryFromSession(
  session: Session,
  git?: SessionGitHint,
): SessionSummary {
  const activityAt = sessionMessageActivityAt(session);
  return {
    id: session.id,
    orchestrationLeadId: session.orchestrationLeadId,
    ...(session.workflowParentId ? { workflowParentId: session.workflowParentId } : {}),
    cwd: session.cwd,
    harness: session.harness,
    model: session.model,
    runtimeMode: session.runtimeMode,
    title: session.title,
    titleState: session.titleState,
    draft: !!sessionDraftBlock(session),
    providerSessionId: session.providerSessionId,
    executionCwd: session.executionCwd,
    linkedWorktree: session.linkedWorktree,
    worktreeRemoved: session.worktreeRemoved,
    ...(session.linkedWorkItem
      ? { linkedWorkItem: session.linkedWorkItem }
      : {}),
    ...(session.automationId ? { automationId: session.automationId } : {}),
    ...(!session.worktreeRemoved && (session.branch || git?.branch)
      ? { branch: session.branch || git?.branch }
      : {}),
    ...(git?.repo ? { repo: git.repo } : {}),
    createdAt:
      session.createdAt ??
      session.nativeSession?.createdAt ??
      session.blocks.find((block) => block.role === "user")?.startedAt ??
      0,
    updatedAt: sessionActivityAt(session),
    ...(activityAt != null ? { activityAt } : {}),
  };
}

// Reuse merged rows while both inputs are unchanged, so memoized list rows
// do not re-render on every parent render during live activity.
const mergedLiveSummaries = new WeakMap<
  SessionSummary,
  WeakMap<SessionSummary, SessionSummary>
>();

/** Keep stored metadata while live activity catches up with the history cache. */
export function mergeLiveSessionSummaries(
  stored: readonly SessionSummary[],
  live: readonly SessionSummary[],
): SessionSummary[] {
  const byId = new Map(stored.map((row) => [row.id, row]));
  for (const row of live) {
    const previous = byId.get(row.id);
    if (!previous) byId.set(row.id, row);
    else {
      const updatedAt = Math.max(previous.updatedAt, row.updatedAt);
      const activityAt = row.activityAt ?? previous.activityAt;
      if (
        updatedAt !== previous.updatedAt ||
        activityAt !== previous.activityAt
      ) {
        let byLive = mergedLiveSummaries.get(previous);
        if (!byLive) mergedLiveSummaries.set(previous, (byLive = new WeakMap()));
        let merged = byLive.get(row);
        if (!merged) {
          merged = {
            ...previous,
            updatedAt,
            ...(activityAt != null ? { activityAt } : {}),
          };
          byLive.set(row, merged);
        }
        byId.set(row.id, merged);
      }
    }
  }
  return [...byId.values()];
}

/** Prefer the project's persisted origin name, then the overlay / folder name. */
export function projectGitHint(
  rows: SessionSummary[],
  overlay?: SessionGitHint,
): SessionGitHint {
  const repo = rows.find((row) => row.repo)?.repo ?? overlay?.repo;
  const branch = overlay?.branch ?? rows.find((row) => row.branch)?.branch;
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
  };
}

function gitOverlayForCwd(cwd: string, git?: SessionGitHint): SessionGitHint {
  if (git?.repo) return git;
  if (!cwd || cwd === "~") return git ?? {};
  const name = projectName(cwd);
  if (!name || name === "~") return git ?? {};
  return { ...git, repo: name };
}

type HistoryOverlayContext = {
  workerIds: Set<string>;
  inboxIds: Set<string>;
  byLead: Map<string, OrchestrationReadRun>;
  sessions: Session[];
};

function historyOverlayContext(
  history: SessionSummary[],
  sessions: Session[],
  runs: readonly OrchestrationReadRun[],
): HistoryOverlayContext {
  const workerIds = new Set([
    ...sessions
      .filter((session) => session.orchestrationLeadId)
      .map((session) => session.id),
    ...history.flatMap(
      (row) => row.orchestration?.tasks.map((task) => task.sessionId) ?? [],
    ),
    ...runs.flatMap((run) => run.tasks.map((task) => task.sessionId)),
  ]);
  const inboxIds = new Set(
    sessions.filter((session) => session.inboxAsk).map((session) => session.id),
  );
  return {
    workerIds,
    inboxIds,
    byLead: new Map(runs.map((run) => [run.leadId, run])),
    sessions,
  };
}

function visibleHistoryRow(
  entry: SessionSummary,
  context: HistoryOverlayContext,
) {
  return (
    !context.inboxIds.has(entry.id) &&
    !entry.orchestrationLeadId &&
    !entry.workflowParentId &&
    !context.workerIds.has(entry.id)
  );
}

function visibleLiveSession(session: Session, context: HistoryOverlayContext) {
  return !session.inboxAsk && !context.workerIds.has(session.id);
}

export function historyWithLiveSessions(
  history: SessionSummary[],
  sessions: Session[],
  cwd: string,
  git?: SessionGitHint,
  runs: readonly OrchestrationReadRun[] = [],
): SessionSummary[] {
  const context = historyOverlayContext(history, sessions, runs);
  const rows = history.filter(
    (entry) =>
      visibleHistoryRow(entry, context) && sameProjectPath(entry.cwd, cwd),
  );
  const liveSessions = sessions.filter(
    (session) =>
      visibleLiveSession(session, context) && sameProjectPath(session.cwd, cwd),
  );
  return overlayProjectHistory(rows, liveSessions, cwd, git, context);
}

/** Group once instead of rescanning every project for each session update. */
export function allProjectHistoryWithLiveSessions(
  history: SessionSummary[],
  sessions: Session[],
  gitForProject?: (cwd: string) => SessionGitHint | undefined,
  runs: readonly OrchestrationReadRun[] = [],
): SessionSummary[] {
  // Ownership is global: a lead can own a worker in another checkout/project.
  const context = historyOverlayContext(history, sessions, runs);
  const projects = new Map<
    string,
    { cwd: string; rows: SessionSummary[]; sessions: Session[] }
  >();
  const project = (cwd: string) => {
    const key = pathKey(cwd);
    const previous = projects.get(key);
    if (previous) {
      previous.cwd = cwd;
      return previous;
    }
    const next = {
      cwd,
      rows: [] as SessionSummary[],
      sessions: [] as Session[],
    };
    projects.set(key, next);
    return next;
  };
  for (const row of history) {
    const bucket = project(row.cwd);
    if (visibleHistoryRow(row, context)) bucket.rows.push(row);
  }
  for (const session of sessions) {
    const bucket = project(session.cwd);
    if (visibleLiveSession(session, context)) bucket.sessions.push(session);
  }
  return [...projects.values()].flatMap(
    ({ cwd, rows, sessions: liveSessions }) =>
      overlayProjectHistory(
        rows,
        liveSessions,
        cwd,
        gitForProject?.(cwd),
        context,
      ),
  );
}

function overlayProjectHistory(
  initialRows: SessionSummary[],
  sessions: Session[],
  cwd: string,
  git: SessionGitHint | undefined,
  context: HistoryOverlayContext,
): SessionSummary[] {
  let rows = initialRows;
  const hint = projectGitHint(rows, gitOverlayForCwd(cwd, git));
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const added: SessionSummary[] = [];
  for (const session of sessions) {
    const live = session.busy || sessionNeedsInput(session);
    if (!shouldPersistSession(session) && !live) continue;
    const storedIndex = indexById.get(session.id) ?? -1;
    if (storedIndex >= 0) {
      const stored = rows[storedIndex];
      const updatedAt = Math.max(stored.updatedAt, sessionActivityAt(session));
      const activityAt = sessionMessageActivityAt(session) ?? stored.activityAt;
      const draft = !!sessionDraftBlock(session);
      const automationId = session.automationId || stored.automationId;
      // Live provider, title and work item land before the next persist.
      const linkedWorkItem = session.linkedWorkItem ?? stored.linkedWorkItem;
      if (
        stored.updatedAt !== updatedAt ||
        stored.activityAt !== activityAt ||
        stored.harness !== session.harness ||
        stored.model !== session.model ||
        !!stored.draft !== draft ||
        stored.automationId !== automationId ||
        stored.title !== session.title ||
        stored.linkedWorkItem?.url !== linkedWorkItem?.url
      ) {
        rows[storedIndex] = {
          ...stored,
          updatedAt,
          ...(activityAt != null ? { activityAt } : {}),
          harness: session.harness,
          model: session.model,
          title: session.title,
          titleState: session.titleState,
          draft: draft || undefined,
          ...(automationId ? { automationId } : {}),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
      }
      continue;
    }
    const sessionHint: SessionGitHint = {
      ...hint,
      ...(session.branch ? { branch: session.branch } : {}),
    };
    added.push(summaryFromSession(session, sessionHint));
  }
  // Merging reorders rows, so it waits until every stored index is used.
  for (const summary of added) rows = mergeHistorySummary(rows, summary);
  return rows
    .map((row) => {
      const run = context.byLead.get(row.id);
      return run
        ? {
            ...row,
            orchestration: summarizeOrchestration(run, context.sessions),
          }
        : row;
    })
    .sort(compareSessionSummaries);
}

function sameSummaryValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameSummary(a: SessionSummary, b: SessionSummary): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key as keyof SessionSummary];
    const right = b[key as keyof SessionSummary];
    if (!sameSummaryValue(left, right)) return false;
  }
  return true;
}

/**
 * Keep the previous rows (and array) when a live overlay produced the same
 * content, so memoized lists skip the frames where only transcripts streamed.
 */
export function reuseEqualSummaries(
  previous: readonly SessionSummary[] | undefined,
  next: SessionSummary[],
): SessionSummary[] {
  if (!previous) return next;
  let changed = previous.length !== next.length;
  const byId = new Map(previous.map((row) => [row.id, row]));
  const rows = next.map((row) => {
    const prior = byId.get(row.id);
    if (prior && sameSummary(prior, row)) return prior;
    changed = true;
    return row;
  });
  if (!changed && rows.every((row, index) => row === previous[index])) {
    return previous as SessionSummary[];
  }
  return rows;
}
