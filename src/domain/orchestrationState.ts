import type { OrchestrationWorkspace, OrchestrationRun } from "../contracts/session";

import { workspacePathKey as pathKey } from "./workspacePaths";



export function workspaceIdentity(
  projectCwd: string,
  checkoutCwd: string,
  branch?: string,
): OrchestrationWorkspace {
  return {
    id: `checkout:${pathKey(checkoutCwd)}`,
    projectCwd,
    checkoutCwd,
    kind: pathKey(projectCwd) === pathKey(checkoutCwd) ? "main" : "worktree",
    ...(branch ? { branch } : {}),
  };
}

export function orchestrationWorkspace(
  run: Pick<OrchestrationRun, "cwd" | "workspace">,
): OrchestrationWorkspace {
  return run.workspace ?? workspaceIdentity(run.cwd, run.cwd);
}

export const orchestrationProjectCwd = (run: Pick<OrchestrationRun, "cwd" | "workspace">) =>
  orchestrationWorkspace(run).projectCwd;

export const orchestrationCheckoutCwd = (run: Pick<OrchestrationRun, "cwd" | "workspace">) =>
  orchestrationWorkspace(run).checkoutCwd;

export function normalizeOrchestrationRun(
  run: OrchestrationRun,
): OrchestrationRun {
  const workspace = orchestrationWorkspace(run);
  // Older builds implemented every worker scope violation as a global pause
  // and copied the pause reason onto every running task as a generic failure.
  // Preserve the actual offender for review, but recover the collateral tasks
  // as resumable interruptions. The exact shared error is the durable marker
  // that distinguishes these tasks from ordinary worker failures.
  const legacyPauseError = run.status === "paused" ? run.error : undefined;
  const escaped =
    legacyPauseError &&
    run.tasks.find((task) =>
      legacyPauseError.startsWith(
        `${task.title} reported a write outside its assignment:`,
      ),
    )?.id;
  const tasks = run.tasks.map((task) => {
    const legacyInterrupted =
      !!legacyPauseError &&
      task.status === "failed" &&
      task.error === legacyPauseError;
    return {
      ...task,
      ...(legacyInterrupted
        ? {
            status:
              task.id === escaped
                ? ("blocked" as const)
                : ("interrupted" as const),
            delivered: task.id === escaped ? false : true,
          }
        : {}),
      // Version 1 predates per-worker worktrees and must retain its original
      // shared-checkout behavior. New version 2 tasks default to isolation.
      workspacePolicy:
        task.workspacePolicy ??
        (run.version === 1 ? "shared" : "isolated-child"),
    };
  });
  const statusByDispatch = new Map(
    tasks.flatMap((task) =>
      task.lastDispatchId &&
      (task.status === "blocked" || task.status === "interrupted")
        ? [[task.lastDispatchId, task.status] as const]
        : [],
    ),
  );
  return {
    ...run,
    version: 2,
    cwd: workspace.projectCwd,
    workspace,
    tasks,
    dispatches: (run.dispatches ?? []).map((dispatch) => ({
      ...dispatch,
      state: statusByDispatch.get(dispatch.id) ?? dispatch.state,
    })),
  };
}
