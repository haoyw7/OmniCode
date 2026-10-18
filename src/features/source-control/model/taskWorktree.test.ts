import { beforeEach, expect, it, vi } from "vitest";
import { createTaskWorktree } from "./taskWorktree";
import { generateConfiguredWorktreeName } from "../../sessions/model/titleModelClient";
import { generateHarnessBranchName } from "../../../integrations/harness/core/registry";
import { gitBranches } from "../../../platform/tauri/fs";
import { createWorktree, listWorktrees } from "./worktrees";

vi.mock("../../sessions/model/titleModelClient", () => ({
  generateConfiguredWorktreeName: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  generateHarnessBranchName: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({ gitBranches: vi.fn() }));
vi.mock("./worktrees", () => ({
  createWorktree: vi.fn(),
  listWorktrees: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(gitBranches).mockResolvedValue({
    current: "main",
    detached: false,
    branches: [],
  });
  vi.mocked(listWorktrees).mockResolvedValue({
    defaultRoot: "/trees",
    worktrees: [],
  });
});

it("waits for a model name and creates the branch and directory once", async () => {
  let finish!: (name: string) => void;
  vi.mocked(generateConfiguredWorktreeName).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const progress = { id: "creation", onLine: vi.fn() };
  const task = createTaskWorktree(
    "/repo",
    "codex",
    "修复登录",
    "main",
    progress,
    () => true,
  );
  expect(createWorktree).not.toHaveBeenCalled();
  finish("fix-login");
  await task;
  expect(createWorktree).toHaveBeenCalledExactlyOnceWith(
    "/repo",
    "mc/fix-login",
    "main",
    false,
    progress,
  );
  expect(generateHarnessBranchName).not.toHaveBeenCalled();
});

it("uses the selected agent and avoids a model name that already exists", async () => {
  vi.mocked(generateConfiguredWorktreeName).mockResolvedValue(null);
  vi.mocked(generateHarnessBranchName).mockResolvedValue("fix-login");
  vi.mocked(gitBranches).mockResolvedValue({
    current: "main",
    detached: false,
    branches: [{ name: "mc/fix-login", current: false, remote: null }],
  });
  await createTaskWorktree(
    "/repo",
    "omp",
    "Fix login",
    "HEAD",
    undefined,
    () => true,
  );
  expect(generateHarnessBranchName).toHaveBeenCalledWith(
    "omp",
    "/repo",
    "Fix login",
  );
  expect(createWorktree).toHaveBeenCalledWith(
    "/repo",
    "mc/fix-login-2",
    "HEAD",
    false,
    undefined,
  );
});

it("creates nothing when naming fails or the send was cancelled while naming", async () => {
  vi.mocked(generateConfiguredWorktreeName).mockResolvedValue(null);
  vi.mocked(generateHarnessBranchName).mockResolvedValue(null);
  await expect(
    createTaskWorktree(
      "/repo",
      "codex",
      "Fix login",
      "main",
      undefined,
      () => true,
    ),
  ).rejects.toThrow("Could not generate a worktree name");
  expect(
    await createTaskWorktree(
      "/repo",
      "codex",
      "Fix login",
      "main",
      undefined,
      () => false,
    ),
  ).toBeNull();
  vi.mocked(generateConfiguredWorktreeName).mockResolvedValue("fix-login");
  expect(
    await createTaskWorktree(
      "/repo",
      "codex",
      "Fix login",
      "main",
      undefined,
      () => false,
    ),
  ).toBeNull();
  expect(createWorktree).not.toHaveBeenCalled();
});
