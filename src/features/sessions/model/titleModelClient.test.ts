import { beforeEach, expect, it, vi } from "vitest";
import { generateConfiguredSessionTitle, generateConfiguredWorktreeName } from "./titleModelClient";
import {
  remoteMachineFor,
  remoteRequest,
} from "../../connections/model/connections";
import {
  remoteProjectFor,
  sharedHostMachineId,
} from "../../connections/model/remoteProjects";

vi.mock("../../connections/model/connections", () => ({
  remoteMachineFor: vi.fn(),
  remoteRequest: vi.fn(),
}));
vi.mock("../../connections/model/remoteProjects", () => ({
  remoteProjectFor: vi.fn(),
  sharedHostMachineId: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sharedHostMachineId).mockReturnValue("local");
});
it("uses the local Host's API for desktop-owned sessions", async () => {
  await generateConfiguredSessionTitle("/repo", "Title this");
  expect(remoteRequest).toHaveBeenCalledWith("local", "titleModel.generate", {
    message: "Title this",
  });
});
it("uses the configured Host model for branch and directory names", async () => {
  vi.mocked(remoteRequest).mockResolvedValue("fix-login");
  expect(await generateConfiguredWorktreeName("/repo", "修复登录")).toBe("fix-login");
  expect(remoteRequest).toHaveBeenCalledWith("local", "titleModel.generateBranch", { message: "修复登录" });
});
it("never sends a disconnected remote project's message to the local Host", async () => {
  vi.mocked(remoteProjectFor).mockReturnValue({
    key: "remote://project",
    environmentId: "remote-env",
    projectId: "project",
    cwd: "/repo",
  });
  expect(
    await generateConfiguredSessionTitle(
      "remote://project",
      "Private remote message",
    ),
  ).toBeNull();
  expect(remoteMachineFor).toHaveBeenCalledWith("remote-env");
  expect(remoteRequest).not.toHaveBeenCalled();
});
