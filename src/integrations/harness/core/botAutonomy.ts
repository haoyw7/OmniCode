export type BotRouting = "reuse-last" | "new";
export const BOT_CONTINUATION_MS = 60 * 60 * 1000;
export const BOT_PARALLEL_LIMIT = 10;
export const BOT_WORKTREE_IDLE_MINUTES = 60;

export type BotManagedWorktree = {
  version: 1;
  sourceCwd: string;
  /** Canonical Git roots used only for reservations; derivation keeps sourceCwd. */
  sourceRoot?: string;
  repositoryRoot?: string;
  path: string;
  branch: string;
  targetBranch: string;
  baseCommit: string;
  createdAt: number;
  state:
    | "creating"
    | "working"
    | "integrating"
    | "merged"
    | "blocked"
    | "removing"
    | "removed";
  mergedHead?: string;
  idleSince?: number;
  error?: string;
  verification?: {
    head: string;
    runId: string;
    summary: string;
    blockIds: string[];
  };
  changes?: { files: string[]; additions: number; deletions: number };
  commit?: { hash: string; message: string; pushed?: boolean };
};
export type BotTask = {
  id: string;
  ref: { environmentId: string; projectId: string; sessionId: string };
  projectName: string;
  request: string;
  startedAt: number;
  activityAt: number;
  status:
    | "accepted"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "unknown"
    | "unavailable"
    | "approval"
    | "question"
    | "stopped";
  error?: string;
  events: {
    id: string;
    at: number;
    action: string;
    state: "executing" | "accepted" | "completed" | "failed" | "unknown";
    error?: string;
  }[];
  changes?: { files: string[]; additions: number; deletions: number };
  commit?: { hash: string; message: string; pushed?: boolean };
  worktree?: Pick<
    BotManagedWorktree,
    "state" | "error" | "targetBranch" | "idleSince"
  >;
  snapshot?: "task" | "working-copy";
};
export type BotTimeline = { tasks: BotTask[]; nextCursor?: string };

export function canContinueBotTask(
  task: Pick<BotTask, "status" | "activityAt">,
  now: number,
): boolean {
  if (task.status === "unavailable") return false;
  return (
    ["running", "queued", "approval", "question"].includes(task.status) ||
    now - task.activityAt <= BOT_CONTINUATION_MS
  );
}

export type TaskMessage = {
  id: string;
  revision: number;
  createdAt: number;
  kind: string;
  wakeupId?: string;
  text?: string;
  ref?: BotTask["ref"];
  projectName?: string;
  status?: BotTask["status"];
  error?: string;
};
export type TaskAction = {
  id: string;
  action: string;
  origin: { wakeupId: string };
  createdAt?: number;
  targetRef?: BotTask["ref"];
  state: BotTask["events"][number]["state"];
  error?: string;
  worktree?: BotManagedWorktree;
  input?: Record<string, unknown>;
};

/** One task per exact session; old cards without wakeup metadata remain readable. */
export function botTasks(
  messages: readonly TaskMessage[],
  actions: readonly TaskAction[] = [],
): BotTask[] {
  const tasks = new Map<string, BotTask>();
  const requests = new Map(
    messages
      .filter((m) => m.kind === "user" && m.wakeupId)
      .map((m) => [m.wakeupId, "text" in m ? m.text : ""]),
  );
  const key = (ref: BotTask["ref"]) =>
    JSON.stringify([ref.environmentId, ref.projectId, ref.sessionId]);
  for (const message of [...messages].sort(
    (a, b) => a.createdAt - b.createdAt || a.revision - b.revision,
  )) {
    if (message.kind !== "session-card" || !message.ref || !message.status)
      continue;
    const id = key(message.ref),
      previous = tasks.get(id);
    tasks.set(id, {
      id,
      ref: { ...message.ref },
      projectName: message.projectName ?? "",
      request: previous?.request || requests.get(message.wakeupId) || "",
      startedAt: previous?.startedAt ?? message.createdAt,
      activityAt: Math.max(previous?.activityAt ?? 0, message.createdAt),
      status: message.status,
      error: message.error,
      events: previous?.events ?? [],
    });
  }
  for (const action of actions) {
    const ref =
      action.targetRef ??
      (action.worktree && typeof action.input?.projectId === "string"
        ? {
            environmentId: "",
            projectId: action.input.projectId,
            sessionId: `uncreated:${action.id}`,
          }
        : undefined);
    if (action.action === "sessions.create" && ref && !tasks.has(key(ref)))
      tasks.set(key(ref), {
        id: key(ref),
        ref,
        projectName: "",
        request: requests.get(action.origin.wakeupId) ?? "",
        startedAt: action.createdAt ?? action.worktree?.createdAt ?? 0,
        activityAt: action.createdAt ?? action.worktree?.createdAt ?? 0,
        status: action.targetRef ? "accepted" : "unavailable",
        events: [],
        error: action.error,
      });
    const candidates = !ref
      ? [...tasks.values()].filter(
          (task) =>
            task.ref.projectId === action.input?.projectId &&
            messages.some(
              (message) =>
                message.kind === "session-card" &&
                message.wakeupId === action.origin.wakeupId &&
                message.ref?.sessionId === task.ref.sessionId,
            ),
        )
      : [];
    const task = ref
      ? tasks.get(key(ref))
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!task) continue;
    const at = action.createdAt ?? task.startedAt;
    task.activityAt = Math.max(task.activityAt, at);
    if (action.worktree) {
      const { state, error, targetBranch, idleSince } = action.worktree;
      task.worktree = { state, error, targetBranch, idleSince };
      if (action.worktree.changes || action.worktree.commit) {
        task.changes = action.worktree.changes;
        task.commit = action.worktree.commit;
        task.snapshot = "task";
      }
      if (state === "removed") task.status = "unavailable";
    }
    task.events.push({
      id: action.id,
      at,
      action: action.action,
      state: action.state,
      error: action.error,
    });
  }
  for (const task of tasks.values())
    task.events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return [...tasks.values()].sort(
    (a, b) =>
      b.activityAt - a.activityAt ||
      b.startedAt - a.startedAt ||
      b.id.localeCompare(a.id),
  );
}
