import type { CheckpointStatus, CheckpointFileDiff } from "../../../contracts/checkpoint";

const REVIEW_CHANGED = "omnicode-review-changed";

/** Answers review, Keep and Undo for a conversation the Host runs; paths in its
 * results are already in this window's form. */
export type HostCheckpointRoute = <T>(
  action: "status" | "diff" | "undo" | "keep",
  relative?: string,
  turnId?: string,
) => Promise<T>;
const hostRoutes = new Map<string, HostCheckpointRoute>();

/** Route a Host conversation's checkpoint calls (keyed by its tab session id)
 * to the Host that captured its edits. */
export function registerHostCheckpointRoute(
  sessionId: string,
  route: HostCheckpointRoute,
): () => void {
  hostRoutes.set(sessionId, route);
  notifyReviewChanged(sessionId);
  return () => {
    if (hostRoutes.get(sessionId) !== route) return;
    hostRoutes.delete(sessionId);
    notifyReviewChanged(sessionId);
  };
}

/** Checkpoints are recorded only by the Host; this computer never reads or
 * restores a separate store for the same tab id. */
function hostRoute(sessionId: string): HostCheckpointRoute {
  const route = hostRoutes.get(sessionId);
  if (!route) throw new Error("Session changes are available only while the conversation is connected to its Host.");
  return route;
}

export function notifyReviewChanged(sessionId?: string) {
  window.dispatchEvent(
    new CustomEvent(REVIEW_CHANGED, { detail: sessionId ?? "" }),
  );
}

export function subscribeReviewChanged(
  listener: (sessionId: string) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<string>).detail ?? "");
  };
  window.addEventListener(REVIEW_CHANGED, handler);
  return () => window.removeEventListener(REVIEW_CHANGED, handler);
}

export async function sessionCheckpointStatus(
  sessionId: string,
  _cwd: string,
  _editedPaths?: readonly string[],
  turnId?: string,
): Promise<CheckpointStatus> {
  const host = hostRoute(sessionId);
  return turnId ? host("status", undefined, turnId) : host("status");
}

/** The before/after contents saved in the session's recorded checkpoint. */
export async function sessionCheckpointFileDiff(
  sessionId: string,
  _cwd: string,
  relative: string,
  turnId?: string,
): Promise<CheckpointFileDiff> {
  const host = hostRoute(sessionId);
  return turnId ? host("diff", relative, turnId) : host("diff", relative);
}

/** Undo restores a complete turn: the Host rolls back provider history and
 * files together, so a single file is never restored on its own. */
export async function undoSessionChanges(
  sessionId: string,
  _cwd: string,
): Promise<CheckpointStatus> {
  return hostRoute(sessionId)("undo");
}

export async function keepSessionChanges(
  sessionId: string,
  _cwd: string,
  relative?: string,
): Promise<CheckpointStatus> {
  return hostRoute(sessionId)("keep", relative);
}
