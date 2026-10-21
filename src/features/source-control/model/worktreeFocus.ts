import { create } from "zustand";
import { pathKey } from "../../../shared/lib/paths";

/** The working copy a project's sidebar is narrowed to. New sessions in that
 * project start there too. Kept for this run only: the app reopens on each
 * project's default workspace. */
export type WorktreeFocus = { path: string; branch: string | null };

const useWorktreeFocusStore = create<{ focuses: Record<string, WorktreeFocus> }>(() => ({
  focuses: {},
}));

export function worktreeFocus(project: string): WorktreeFocus | undefined {
  return useWorktreeFocusStore.getState().focuses[pathKey(project)];
}

export function setWorktreeFocus(
  project: string,
  focus: WorktreeFocus | undefined,
) {
  useWorktreeFocusStore.setState(({ focuses }) => {
    const next = { ...focuses };
    if (focus) next[pathKey(project)] = focus;
    else delete next[pathKey(project)];
    return { focuses: next };
  });
}

export function useWorktreeFocus(project: string): WorktreeFocus | undefined {
  return useWorktreeFocusStore((state) => state.focuses[pathKey(project)]);
}

export function inWorktreeFocus(
  session: { cwd: string; executionCwd?: string },
  focus: WorktreeFocus | undefined,
): boolean {
  return (
    !focus ||
    pathKey(session.executionCwd || session.cwd) === pathKey(focus.path)
  );
}
