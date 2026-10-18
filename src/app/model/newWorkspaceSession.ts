import {
  newDefaultSession,
  type RuntimeMode,
} from "../../features/sessions/model/session";
import { worktreeFocus } from "../../features/source-control/model/worktreeFocus";

/** Session defaults can supply permissions, but the visible project owns cwd. */
export function newWorkspaceSession(
  project: string,
  runtimeMode?: RuntimeMode,
) {
  const focus = worktreeFocus(project);
  return {
    ...newDefaultSession(project, runtimeMode),
    ...(focus
      ? { executionCwd: focus.path, branch: focus.branch ?? undefined }
      : {}),
  };
}
