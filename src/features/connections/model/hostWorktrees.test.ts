import { afterEach, expect, it, vi } from "vitest";
const { request, machine, project, ensure } = vi.hoisted(() => ({ request: vi.fn(), machine: vi.fn(), project: vi.fn(), ensure: vi.fn() }));
vi.mock("./connections", () => ({ remoteRequest: request, remoteMachineFor: machine }));
vi.mock("./remoteProjects", async original => ({ ...await original<typeof import("./remoteProjects")>(), remoteProjectFor: project, ensureSharedProject: ensure }));
import { createWorktreeWithProgress, hostWorktreeCommand } from "./hostWorktrees";
afterEach(() => vi.resetAllMocks());
it("fails closed for an older Host without removal support", async () => {
  project.mockReturnValue({ projectId: "p", environmentId: "env", cwd: "/repo" }); machine.mockResolvedValue({ id: "host" });
  request.mockResolvedValue({ capabilities: ["git.worktreeCreate"] });
  await expect(hostWorktreeCommand("remote://env/repo", "git.worktreeRemove", { path: "remote://env/tree" })).rejects.toThrow("Update OmniCode Host");
  expect(request).toHaveBeenCalledTimes(1);
});
it("maps remote removal paths without losing the Host session identities", async () => {
  project.mockReturnValue({ projectId: "p", environmentId: "env", cwd: "/repo" }); machine.mockResolvedValue({ id: "host" });
  request.mockResolvedValueOnce({ capabilities: ["git.worktreeLifecycle.v1"] }).mockResolvedValueOnce({ sessionIds: ["s"], projectCwd: "/repo" });
  expect(await hostWorktreeCommand("remote://env/repo", "git.worktreeRemove", { path: "remote://env/tree", keepSessions: true })).toEqual({ sessionIds: ["s"], projectCwd: "remote://env/repo" });
  expect(request).toHaveBeenLastCalledWith("host", "git.worktreeRemove", { projectId: "p", cwd: "/repo", path: "/tree", keepSessions: true });
});
it("streams Host worktree output while creation runs, without repeating lines from the final log", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (tree: unknown) => void;
    const reads = [{ lines: ["Preparing worktree"], offset: 1, done: false }, { lines: ["HEAD is now at abc"], offset: 2, done: true }];
    request.mockImplementation((_machine: string, method: string) => method === "git.worktreeCreate"
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve(reads.shift() ?? { lines: [], offset: 2, done: true }));
    const lines: string[] = [];
    const pending = createWorktreeWithProgress("host", ["git.worktreeProgress.v1"], { projectId: "p", branch: "b" }, line => lines.push(line));
    await vi.advanceTimersByTimeAsync(260);
    expect(lines).toEqual(["Preparing worktree"]);
    const progressId = request.mock.calls.find(call => call[1] === "git.worktreeCreate")![2].progressId;
    expect(request).toHaveBeenCalledWith("host", "git.worktreeProgress", { progressId, offset: 0 });
    finish({ path: "/tree", log: ["Preparing worktree", "HEAD is now at abc"] });
    await expect(pending).resolves.toMatchObject({ path: "/tree" });
    expect(lines).toEqual(["Preparing worktree", "HEAD is now at abc"]);
  } finally { vi.useRealTimers(); }
});
it("replays the completed log for Hosts without live worktree progress", async () => {
  request.mockResolvedValue({ path: "/tree", log: ["one", "two"] });
  const lines: string[] = [];
  await createWorktreeWithProgress("host", ["git.worktreeCreate"], { branch: "b" }, line => lines.push(line));
  expect(lines).toEqual(["one", "two"]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][2]).not.toHaveProperty("progressId");
});
