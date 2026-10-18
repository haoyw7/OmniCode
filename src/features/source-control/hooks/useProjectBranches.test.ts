// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { gitBranches, type GitBranches } from "../../../platform/tauri/fs";
import { useProjectBranchesState, type ProjectBranchesState } from "./useProjectBranches";

vi.mock("../../../platform/tauri/fs", () => ({
  gitBranches: vi.fn(),
  subscribeGitChanged: () => () => {},
}));

it("keeps branch responses scoped to their folder through rapid project switches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const reads = new Map<string, (branches: GitBranches) => void>();
  vi.mocked(gitBranches).mockImplementation((cwd) => new Promise((resolve) => reads.set(cwd, resolve)));
  const container = document.createElement("div");
  const root = createRoot(container);
  let state: ProjectBranchesState;
  function Probe({ cwd }: { cwd: string }) {
    state = useProjectBranchesState(cwd, true);
    return null;
  }
  const render = (cwd: string) => act(async () => root.render(createElement(Probe, { cwd })));
  const repo = (current: string): GitBranches => ({ current, detached: false,
    branches: [{ name: current, current: true, remote: null }] });
  try {
    await render("/switch-a");
    await act(async () => reads.get("/switch-a")!(repo("branch-a")));
    expect(state!.branches?.current).toBe("branch-a");
    await render("/switch-b");
    expect(state!).toEqual({ branches: null, settled: false });
    await render("/switch-plain");
    await act(async () => reads.get("/switch-b")!(repo("branch-b")));
    expect(state!).toEqual({ branches: null, settled: false });
    await act(async () => reads.get("/switch-plain")!({ current: null, detached: false, branches: [] }));
    expect(state!).toEqual({ branches: { current: null, detached: false, branches: [] }, settled: true });
    await render("/switch-b");
    expect(state!.branches?.current).toBe("branch-b");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
