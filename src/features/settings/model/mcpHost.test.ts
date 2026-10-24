import { beforeEach, expect, it, vi } from "vitest";
import { addMcpServer, discoverMcpServers, loginMcpServer } from "./mcpHost";

const mocks = vi.hoisted(() => ({ request: vi.fn(), descriptor: vi.fn(), project: vi.fn(), ensure: vi.fn(), machine: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.request, remoteMachineFor: mocks.machine }));
vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.descriptor }));
vi.mock("../../connections/model/remoteProjects", () => ({ remoteProjectFor: mocks.project,
  ensureSharedProject: mocks.ensure, parseRemotePath: (path: string) => path.startsWith("remote://") ? { hostPath: "/srv/repo" } : undefined }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockReturnValue(undefined);
  mocks.ensure.mockResolvedValue({ projectId: "project", environmentId: "env" });
  mocks.machine.mockResolvedValue({ id: "machine" });
  mocks.descriptor.mockResolvedValue({ capabilities: ["mcp.v1"] });
});

it("registers a local folder with the Host before reading its MCP configuration", async () => {
  mocks.request.mockResolvedValue([]);
  expect(await discoverMcpServers("/repo")).toEqual([]);
  expect(mocks.ensure).toHaveBeenCalledWith("/repo");
  expect(mocks.request).toHaveBeenCalledWith("machine", "mcp.discover", { projectId: "project", cwd: "/repo" });
});

it("polls a Host job with one request identity until it settles", async () => {
  mocks.project.mockReturnValue({ projectId: "remote", environmentId: "env" });
  mocks.request.mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "completed", result: { operation: "login" } });
  await loginMcpServer("remote://env/srv/repo", { provider: "pi", name: "docs" });
  expect(mocks.request).toHaveBeenNthCalledWith(1, "machine", "mcp.start", expect.objectContaining({
    operation: "login", provider: "pi", name: "docs", projectId: "remote", cwd: "/srv/repo" }));
  const { requestId } = mocks.request.mock.calls[0][2];
  expect(mocks.request.mock.calls.slice(1).map((call) => call.slice(1))).toEqual([["mcp.status", { requestId }], ["mcp.status", { requestId }]]);
});

it("surfaces Host failures and refuses an older Host without local fallback", async () => {
  mocks.request.mockResolvedValueOnce({ status: "failed", error: "docs is already configured in this file" });
  await expect(addMcpServer("/repo", { provider: "cursor", scope: "user", name: "docs", config: "{}" })).rejects.toThrow("already configured");
  mocks.request.mockReset();
  mocks.descriptor.mockResolvedValue({ capabilities: [] });
  await expect(discoverMcpServers("/repo")).rejects.toThrow("Update the Host");
  expect(mocks.request).not.toHaveBeenCalled();
});
