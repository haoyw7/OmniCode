import { invalidateProjectFiles } from "../../features/connections/files/model/fileIndex";
import { notifyDirsChanged } from "../../features/connections/files/model/fileTree";
import {
  invalidateWatchedFiles,
  nudgeWatchedFiles,
} from "../../features/connections/files/model/fileWatch";
import {
  captureSessionCheckpoint,
  notifyReviewChanged,
  prepareSessionCheckpoint,
} from "../../features/sessions/model/checkpoint";
import { type HarnessEvent } from "../../integrations/harness";
import { isEditTool } from "../../integrations/harness/core/preview";
import { notifyGitChanged } from "../../platform/tauri/fs";
import { resolveWorkspacePath } from "../../shared/lib/paths";

/** Paths each in-flight edit call reported, keyed by session then call id. */
const editCalls = new Map<string, Map<string, string[]>>();

export function trackSessionEdits(
  sessionId: string,
  cwd: string,
  event: HarnessEvent,
) {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  // Completion updates may omit the kind and paths their start reported;
  // they attribute the turn's changes to this session, so remember them.
  const calls = editCalls.get(sessionId);
  const known = calls?.get(event.callId);
  if (!known && !isEditTool(event.kind, event.title, event.preview)) return;
  const own = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);
  const paths = own.length ? own : known ?? [];
  const status = event.type === "tool.updated" ? event.status : undefined;
  const completed = status === "completed" || status === "success";
  if (completed || status === "failed" || status === "error") {
    calls?.delete(event.callId);
    if (calls?.size === 0) editCalls.delete(sessionId);
  }
  if (paths.length === 0 || cwd === "~") return;
  if (!completed) {
    if (status === "failed" || status === "error") return;
    const merged = [...new Set([...(known ?? []), ...paths])];
    if (calls) calls.set(event.callId, merged);
    else editCalls.set(sessionId, new Map([[event.callId, merged]]));
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch(() => undefined);
    return;
  }
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch(() => undefined)
    .then(() => notifyReviewChanged(sessionId));
}

export function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

export function nudgeOpenEditors(event: HarnessEvent, cwd: string) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
    window.setTimeout(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const resolved = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ]
    .map((path) => resolveWorkspacePath(path, cwd) ?? path)
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (completed) {
    // A successful edit is authoritative. Reload it even if a startup race or
    // coarse filesystem timestamp makes the mtime appear unchanged.
    invalidateWatchedFiles(resolved.length > 0 ? resolved : undefined);
  } else if (resolved.length > 0) {
    nudgeWatchedFiles(resolved);
  }
  if (completed) {
    window.setTimeout(
      () => nudgeWatchedFiles(resolved.length > 0 ? resolved : undefined),
      150,
    );
    notifyGitChanged();
    nudgeWorkspace(cwd);
  }
}
