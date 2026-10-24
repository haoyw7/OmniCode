import { expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { shouldPersistSession } from "../../sessions/data/sessionStore";
import type { HostSession } from "../../../contracts/protocol";
import { remoteSessionState } from "./remoteSessionState";

it("keeps a host transcript in normal session state under its local tab ID", () => {
  const shell = newSession("codex", "remote://env/home/me/repo");
  const snapshot = {
    projectId: "project",
    revision: 2,
    status: "idle",
    createdAt: 500,
    updatedAt: 1_000,
    session: {
      ...shell,
      id: "host-session",
      cwd: "/home/me/repo-worktrees/dev",
      linkedWorktree: true,
      title: "Fix the build",
      blocks: [
        { id: "turn", role: "user", text: "Fix it" },
        { id: "plan", role: "plan", text: "Build the fix" },
      ],
    },
  } as HostSession;
  const session = remoteSessionState(shell, snapshot, {
    key: shell.cwd,
    environmentId: "env",
    projectId: "project",
    cwd: "/home/me/repo",
  });
  expect(session).toMatchObject({
    id: shell.id,
    cwd: shell.cwd,
    executionCwd: "remote://env/home/me/repo-worktrees/dev",
    linkedWorktree: true,
    title: "Fix the build",
    blocks: snapshot.session.blocks,
    createdAt: 500,
    updatedAt: 1_000,
  });
  expect(shouldPersistSession(session)).toBe(false);
});

it("clears stale worktree confirmation when the Host has not confirmed it", () => {
  const shell = { ...newSession("codex", "D:/repo"), linkedWorktree: true };
  const snapshot: HostSession = { projectId: "project", revision: 1, status: "idle", updatedAt: 1,
    session: newSession("codex", "D:\\repo") };
  const project = { key: shell.cwd, environmentId: "local", projectId: "project", cwd: shell.cwd, local: true };
  const session = remoteSessionState(shell, snapshot, project);
  expect(session.linkedWorktree).toBe(false);
  expect(session.executionCwd).toBe(snapshot.session.cwd);
});

it("restores execution phases on reconnect and clears a stale phase from an older snapshot", () => {
  const shell = newSession("pi", "/project");
  shell.executionState = { runId: "old", phase: "waiting-resource", since: 1 };
  const snapshot: HostSession = { projectId: "project", revision: 3, status: "running", updatedAt: 10,
    session: { ...newSession("pi", "/project"), executionState: { runId: "new", phase: "awaiting-response", since: 5, providerStartedAt: 5 } } };
  const project = { key: "/project", environmentId: "host", projectId: "project", cwd: "/project" };
  expect(remoteSessionState(shell, snapshot, project).executionState).toEqual(snapshot.session.executionState);
  delete snapshot.session.executionState;
  expect(remoteSessionState(shell, snapshot, project).executionState).toBeUndefined();
});
