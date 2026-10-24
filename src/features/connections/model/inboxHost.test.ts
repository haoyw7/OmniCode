import { afterEach, expect, it, vi } from "vitest";
const { request, machine, environment, knownProject, ensureProject, parsedRemote } = vi.hoisted(() => ({ request: vi.fn(), machine: vi.fn(), environment: vi.fn(), knownProject: vi.fn(), ensureProject: vi.fn(), parsedRemote: vi.fn() }));
vi.mock("./connections", () => ({ remoteRequest: request, remoteMachineFor: machine }));
vi.mock("./remoteProjects", () => ({ sharedHostEnvironment: environment, remoteProjectFor: knownProject, ensureSharedProject: ensureProject, parseRemotePath: parsedRemote }));
import { inboxHostCommand } from "./inboxHost";
afterEach(() => vi.resetAllMocks());
it.each(["linear_list_teams", "azure_devops_list_todos"])("requires the Host capability before %s dispatch, with no native fallback", async command => {
  environment.mockReturnValue("local"); machine.mockResolvedValue({ id: "machine" });
  request.mockResolvedValue({ capabilities: [] });
  await expect(inboxHostCommand(command)).rejects.toThrow("Update OmniCode Host");
  expect(request).toHaveBeenCalledTimes(1);
});
it("routes an available service command and arguments through Host", async () => {
  environment.mockReturnValue("local"); machine.mockResolvedValue({ id: "machine" });
  request.mockResolvedValueOnce({ capabilities: ["inbox.linear.v1"] }).mockResolvedValueOnce({ connected: true });
  expect(await inboxHostCommand("linear_status")).toEqual({ connected: true });
  expect(request).toHaveBeenLastCalledWith("machine", "inbox.run", { command: "linear_status", args: {} });
});
it("fails closed while the shared Host is disconnected", async () => {
  await expect(inboxHostCommand("linear_list_teams")).rejects.toThrow("not connected");
  expect(request).not.toHaveBeenCalled();
});

it.each(["gitlab_repo", "azure_devops_repo"])("routes %s through the registered project's Host and machine identity", async command => {
  knownProject.mockReturnValue({ projectId: "project", cwd: "/work/repo", environmentId: "remote-host", machine: { kind: "wsl", distribution: "Ubuntu" } });
  machine.mockResolvedValue({ id: "machine" });
  request.mockResolvedValueOnce({ capabilities: [command.startsWith("gitlab") ? "inbox.gitlab.v1" : "inbox.azuredevops.v1"] }).mockResolvedValueOnce("team/repo");
  expect(await inboxHostCommand(command, { cwd: "wsl://Ubuntu/work/repo" })).toBe("team/repo");
  expect(machine).toHaveBeenCalledWith("remote-host");
  expect(request).toHaveBeenLastCalledWith("machine", "inbox.run", { command, projectId: "project", args: { cwd: "/work/repo" } });
  expect(ensureProject).not.toHaveBeenCalled();
});

it("registers a new local folder and rejects a stale remote folder instead of executing it locally", async () => {
  ensureProject.mockResolvedValue({ projectId: "new", cwd: "C:/repo", environmentId: "local" });
  machine.mockResolvedValue({ id: "machine" });
  request.mockResolvedValueOnce({ capabilities: ["inbox.gitlab.v1"] }).mockResolvedValueOnce("team/repo");
  await inboxHostCommand("gitlab_repo", { cwd: "C:/repo" });
  expect(ensureProject).toHaveBeenCalledWith("C:/repo");
  parsedRemote.mockReturnValue({ environmentId: "missing", path: "/repo" });
  await expect(inboxHostCommand("gitlab_repo", { cwd: "remote://missing/repo" })).rejects.toThrow("Remote project is not connected");
  expect(request).toHaveBeenCalledTimes(2);
});
