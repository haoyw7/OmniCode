import {
  botTasks,
  type BotTask,
  type BotTimeline,
} from "../../../src/integrations/harness/core/botAutonomy";
import { hostGitIndex } from "../../workspace";
import { machineExec } from "../../machine-io";
import { withValidatedHostWorktree } from "../../git-worktrees";
import type { BotThreadStore } from "./store";

/** Derived snapshots only: no new task table or writes while reading. */
export function currentBotTasks(store: BotThreadStore): BotTask[] {
  const policy = store.get()?.policy;
  if (!policy?.permissions["sessions.read"]) return [];
  return botTasks(store.latestMessages(), store.actions())
    .filter(
      (task) =>
        policy.allowedProjects === "all" ||
        policy.allowedProjects.includes(task.ref.projectId),
    )
    .map((task) => {
      task.ref.environmentId ||= store.host.environmentId;
      try {
        task.projectName ||= store.host.project(task.ref.projectId).name;
        const target = store.host.session(task.ref.sessionId);
        if (
          target.session.assistantOwnerId ||
          store.host.project(target.projectId).kind ||
          target.projectId !== task.ref.projectId
        )
          return { ...task, status: "unavailable" as const };
        const queued = target.session.queuedMessages?.some(
          (row) =>
            row.origin?.threadId === store.threadId &&
            row.origin?.botId === store.botId &&
            !row.blocked,
        );
        return {
          ...task,
          activityAt: Math.max(task.activityAt, target.updatedAt),
          status: target.archived
            ? ("unavailable" as const)
            : target.session.blocks.some(
                  (block) => block.approval && !block.approval.decided,
                )
              ? ("approval" as const)
              : target.session.pendingQuestion
                ? ("question" as const)
                : queued
                  ? ("queued" as const)
                  : target.status === "running"
                    ? ("running" as const)
                    : target.status === "interrupted"
                      ? ("stopped" as const)
                      : task.status,
        };
      } catch {
        return {
          ...task,
          projectName: task.projectName || task.ref.projectId,
          status: "unavailable" as const,
        };
      }
    });
}

export async function readBotTimeline(
  store: BotThreadStore,
  input: Record<string, unknown>,
  inSession: <T>(id: string, read: () => T) => T,
): Promise<BotTimeline> {
  const limit = input.limit === undefined ? 20 : input.limit;
  if (
    !Number.isSafeInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 50 ||
    (input.sessionId !== undefined &&
      (typeof input.sessionId !== "string" || input.sessionId.length > 200))
  )
    throw new Error("Invalid timeline page");
  let before: { at: number; id: string } | undefined;
  if (input.cursor !== undefined) {
    try {
      if (typeof input.cursor !== "string" || input.cursor.length > 2000)
        throw new Error();
      before = JSON.parse(input.cursor);
      if (
        !before ||
        !Number.isSafeInteger(before.at) ||
        typeof before.id !== "string"
      )
        throw new Error();
    } catch {
      throw new Error("Invalid timeline cursor");
    }
  }
  const tasks = currentBotTasks(store)
    .filter(
      (task) => !input.sessionId || task.ref.sessionId === input.sessionId,
    )
    .sort(
      (a, b) =>
        b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .filter(
      (task) =>
        !before ||
        task.startedAt < before.at ||
        (task.startedAt === before.at && task.id < before.id),
    );
  const page = tasks.slice(0, Number(limit));
  for (const task of page) {
    if (
      !store.get()?.policy.permissions["git.read"] ||
      task.status === "unavailable" ||
      task.snapshot === "task"
    )
      continue;
    const read = async () => {
      const target = store.host.session(task.ref.sessionId);
      const cwd = target.session.executionCwd || target.session.cwd;
      return withValidatedHostWorktree(
        store.host.project(target.projectId).cwd,
        target.session.executionCwd,
        async () => {
          const index = await hostGitIndex(cwd);
          task.changes = {
            files: index.files.map((file) => file.relative),
            additions: index.additions,
            deletions: index.deletions,
          };
          task.snapshot = "working-copy";
          // A working-copy snapshot is explicitly labelled in the UI. Never infer
          // a task-authored commit from an unrelated older HEAD.
          const { stdout } = await machineExec(
            "git",
            [
              "log",
              "-1",
              `--since=${Math.floor(task.startedAt / 1000)}`,
              "--format=%H%n%s",
            ],
            { cwd, windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
          );
          const [hash, ...subject] = stdout.trim().split("\n");
          if (/^[a-f0-9]{40,64}$/.test(hash))
            task.commit = {
              hash,
              message: subject.join("\n"),
              pushed: hash === index.head && index.headPushed,
            };
        },
      );
    };
    try {
      await inSession(task.ref.sessionId, read);
    } catch {
      /* Unavailable Git metadata does not make activity unreadable. */
    }
  }
  // Permissions can change while Git reads await the execution machine.
  const policy = store.get()?.policy;
  const permitted = page.filter(
    (task) =>
      policy?.permissions["sessions.read"] &&
      (policy.allowedProjects === "all" ||
        policy.allowedProjects.includes(task.ref.projectId)),
  );
  if (!policy?.permissions["git.read"])
    for (const task of permitted) {
      delete task.changes;
      delete task.commit;
    }
  const last = page.at(-1);
  return {
    tasks: permitted,
    ...(tasks.length > page.length && last
      ? { nextCursor: JSON.stringify({ at: last.startedAt, id: last.id }) }
      : {}),
  };
}
