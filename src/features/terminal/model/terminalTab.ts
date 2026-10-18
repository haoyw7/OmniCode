import { basename } from "../../../platform/tauri/fs";
import type { FilePaneTab } from "../../workspace/model/layout";

export type TerminalMetaPatch = {
  title?: string;
  cwd?: string;
  /** `null` clears a running command; omit to leave it unchanged. */
  foreground?: string | null;
};

/** Default tab label from the working directory. */
export function defaultTerminalTitle(cwd: string): string {
  const name = basename(cwd);
  if (!name || name === "/") return "Terminal";
  return name;
}

/** Tab label: dynamic title (process or directory) stored on `path`. */
export function terminalTabLabel(file: FilePaneTab): string {
  return file.path?.trim() || defaultTerminalTitle(file.cwd);
}

/** Apply a live PTY title / cwd / foreground patch. */
export function applyTerminalMeta(
  file: FilePaneTab,
  patch: TerminalMetaPatch,
): FilePaneTab {
  if (!file.terminal) return file;
  const path = patch.title ?? file.path;
  const cwd = patch.cwd ?? file.cwd;
  const foreground =
    patch.foreground === undefined
      ? file.foreground
      : (patch.foreground?.trim() || undefined);
  if (
    path === file.path &&
    cwd === file.cwd &&
    foreground === file.foreground
  ) {
    return file;
  }
  return {
    ...file,
    path,
    cwd,
    foreground,
  };
}

const OSC_CWD =
  /\x1b\]7;file:\/\/[^/]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function decodeOscPath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Scan PTY output for OSC 7 cwd reports from shell integration. */
export function scanOscCwd(
  chunk: string,
  buffer: string,
): { cwd?: string; rest: string } {
  const merged = buffer + chunk;
  let cwd: string | undefined;
  let last = 0;
  for (const match of merged.matchAll(OSC_CWD)) {
    const index = match.index ?? 0;
    const path = decodeOscPath(match[1] ?? "");
    if (path) cwd = path;
    last = index + match[0].length;
  }
  const tail = merged.slice(last);
  const rest = tail.length > 256 ? tail.slice(-256) : tail;
  return { cwd, rest };
}

/**
 * Working directory for a terminal opened by the general New Terminal
 * commands.
 *
 * A session working in a worktree opens terminals in that worktree, even when
 * the focused pane is a file or terminal from another checkout. Without a
 * worktree, the focused pane's directory wins, then the session's, then
 * `fallback`.
 */
export function newTerminalCwd({
  activeFile,
  session,
  fallback,
}: {
  activeFile?: Pick<FilePaneTab, "cwd">;
  session?: { cwd: string; executionCwd?: string; worktreeRemoved?: boolean };
  fallback: string;
}): string {
  if (session?.executionCwd && !session.worktreeRemoved)
    return session.executionCwd;
  return activeFile?.cwd ?? session?.cwd ?? fallback;
}
