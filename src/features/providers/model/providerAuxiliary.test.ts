import { beforeEach, expect, it, vi } from "vitest";
import { generateCommitMessage, generateHostBranchName, generatePrContent } from "./providerAuxiliary";

const mocks = vi.hoisted(() => ({ request: vi.fn(), descriptor: vi.fn(), project: vi.fn(), ensure: vi.fn(), machine: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.request, remoteMachineFor: mocks.machine }));
vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mocks.descriptor }));
vi.mock("../../connections/model/remoteProjects", () => ({ remoteProjectFor: mocks.project,
  ensureSharedProject: mocks.ensure, parseRemotePath: () => undefined }));
vi.mock("./providerAccounts", async (importOriginal) => ({
  supportsProviderAccounts: (await importOriginal<typeof import("./providerAccounts")>()).supportsProviderAccounts,
  selectedProviderAccountId: () => "work",
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockReturnValue({ projectId: "project", environmentId: "env" });
  mocks.machine.mockResolvedValue({ id: "machine" });
  mocks.descriptor.mockResolvedValue({ capabilities: ["providers.auxiliary.v1"] });
});

it("starts Host generation and uses its bounded result reads with the selected account", async () => {
  mocks.request.mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "completed", result: { operation: "commit", message: "Fix login" } });
  expect(await generateCommitMessage("/repo", "codex")).toBe("Fix login");
  expect(mocks.request).toHaveBeenNthCalledWith(1, "machine", "providers.auxiliary.start", expect.objectContaining({
    projectId: "project", cwd: "/repo", harness: "codex", providerAccountId: "work", operation: "commit",
  }));
  const { requestId } = mocks.request.mock.calls[0][2];
  expect(mocks.request).toHaveBeenNthCalledWith(2, "machine", "providers.auxiliary.read", { projectId: "project", requestId });
});

it("refuses an older Host without starting a local provider", async () => {
  mocks.descriptor.mockResolvedValue({ capabilities: [] });
  await expect(generateHostBranchName("codex", "/repo", "Fix")).rejects.toThrow("Update the Host");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("cancels an ambiguous pending start using the same request identity", async () => {
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation((_machine, method) => method === "providers.auxiliary.start"
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ status: "cancelled" }));
  const controller = new AbortController();
  const pending = generateCommitMessage("/repo", "codex", controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  const { requestId } = mocks.request.mock.calls[0][2];
  expect(mocks.request).toHaveBeenCalledWith("machine", "providers.auxiliary.cancel", { projectId: "project", requestId });
  finish({ status: "cancelled" });
});

it("retains pull request title/body and base/head supplied by Host", async () => {
  const result = { operation: "pullRequest", title: "Fix", body: "Explanation", base: "main", head: "fix" };
  mocks.request.mockResolvedValue({ status: "completed", result });
  expect(await generatePrContent("/repo", "codex")).toMatchObject(result);
});
