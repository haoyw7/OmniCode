import { beforeEach, expect, it, vi } from "vitest";
import { hostOrchestrationRuntime } from "./hostOrchestrationRuntime";
const mocks = vi.hoisted(() => ({ reference: vi.fn(), view: vi.fn(), accept: vi.fn(), load: vi.fn(), dispatch: vi.fn(), describe: vi.fn() }));
vi.mock("./orchestrationClient", () => ({ hostOrchestrationClient: {
  reference: mocks.reference, view: mocks.view, accept: mocks.accept,
  subscribe: vi.fn(), snapshot: vi.fn(), shellId: (_source: unknown, id: string) => `shell-${id}`,
} }));
vi.mock("../../connections/model/connections", () => ({ loadRemoteSessionText: mocks.load, dispatchRemoteCommand: mocks.dispatch }));
vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.describe }));
const source = { machineId: "machine", leadId: "lead", project: { environmentId: "env", projectId: "project", key: "/repo" } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.reference.mockReturnValue(source);
  mocks.describe.mockResolvedValue({ capabilities: ["sessions.orchestration"] });
  mocks.load.mockResolvedValue({ projectId: "project", orchestration: { id: "run" } });
  mocks.dispatch.mockResolvedValue({ sessionId: "lead" });
});
it("sends the canonical Host run command and refreshes its projection", async () => {
  await hostOrchestrationRuntime.stop("shell");
  expect(mocks.dispatch).toHaveBeenCalledWith("machine", "/repo", "env", expect.objectContaining({ type: "orchestration", action: "stop", sessionId: "lead", projectId: "project", orchestrationId: "run" }), "shell");
  expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.accept).toHaveBeenCalledTimes(2);
});
it("refuses commands for an unbound run", async () => {
  mocks.reference.mockReturnValue(undefined);
  await expect(hostOrchestrationRuntime.resume("missing")).rejects.toThrow("Connect to the Host");
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("rejects missing capabilities before dispatching or loading the transcript", async () => {
  mocks.describe.mockResolvedValue({ capabilities: [] });
  await expect(hostOrchestrationRuntime.cancelTask("shell", "task")).rejects.toThrow("Update the Host");
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
});
it("uses Host blockers with their desktop shell identity", () => {
  mocks.view.mockReturnValue({ resumeLeadBusy: true, resumeBlocker: { sessionId: "other", title: "Other turn" } });
  expect(hostOrchestrationRuntime.resumeLeadBusy("shell")).toBe(true);
  expect(hostOrchestrationRuntime.resumeBlocker("shell")).toEqual({ id: "shell-other", title: "Other turn" });
});
