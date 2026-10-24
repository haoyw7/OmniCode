import type { HarnessId, RuntimeMode, WorkspaceMode } from "./session";

export const HOST_DESKTOP_APP_CAPABILITY = "app.desktopCommands.v1";
export const APP_ACTIONS = ["models.list", "sessions.list", "sessions.read", "sessions.send", "sessions.draft", "sessions.start", "worktrees.list", "worktrees.create", "notes.list", "notes.read", "notes.write"] as const;

export type AppSessionPlacement = { direction: "right" | "down"; besideSessionId: string };
export type AppSessionLaunch = {
  prompt: string;
  draft?: boolean;
  cwd: string;
  harness: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  runtimeMode?: RuntimeMode;
  workspaceMode?: WorkspaceMode;
  worktreeBase?: string;
  executionCwd?: string;
  reveal: boolean;
};
export type DesktopAppCommand = {
  id: string;
  sourceSessionId: string;
  sessionId: string;
  projectId: string;
  action: "sessions.reveal";
  reveal: boolean;
  placement?: AppSessionPlacement;
};
export type DesktopAppCommandPoll = { commands: DesktopAppCommand[] };
export type DesktopAppCommandResponse = { ok: true; result?: unknown } | { ok: false; error: string };
