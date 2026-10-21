// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { workflowRequest } from "../../../model/workflowClient";
import { useSavedWorkflowLauncher } from "./useSavedWorkflowLauncher";

vi.mock("../../../model/workflowClient", () => ({ workflowRequest: vi.fn() }));
vi.mock("../../logger.js", () => ({ logger: { warn: vi.fn() } }));
let root: Root;
let launcher!: ReturnType<typeof useSavedWorkflowLauncher>;
const navigate = vi.fn();
const target = { workspacePath: "/target" };
const request = { name: "review", scope: "project" as const, args: { branch: "feature" } };
function View() {
  launcher = useSavedWorkflowLauncher({ agentService: {} as Parameters<typeof useSavedWorkflowLauncher>[0]["agentService"], onNavigate: navigate });
  return null;
}
beforeEach(async () => {
  queryClient.clear(); vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(View)));
});
afterEach(() => { act(() => root.unmount()); queryClient.clear(); vi.unstubAllGlobals(); });

it("prevents a same-tick duplicate launch and navigates only after acceptance", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(workflowRequest).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let first!: ReturnType<typeof launcher.launch>, duplicate!: ReturnType<typeof launcher.launch>;
  await act(async () => { first = launcher.launch(target, request); duplicate = launcher.launch(target, request); });
  expect(launcher.pending).toBe(true);
  expect(await duplicate).toMatchObject({ ok: false, error: { code: "launch_in_flight" } });
  expect(workflowRequest).toHaveBeenCalledExactlyOnceWith("/target", "startInNewSession", {
    input: { name: "review", saved: { name: "review", scope: "project", args: { branch: "feature" } } },
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => { finish({ ok: true, sessionId: "new-session", runId: "run" }); await first; });
  expect(navigate).toHaveBeenCalledExactlyOnceWith(target, "new-session");
  expect(launcher.pending).toBe(false);
});

it("preserves rejection diagnostics, supports clearing and retries exceptions explicitly", async () => {
  vi.mocked(workflowRequest).mockResolvedValueOnce({ ok: false, reason: "diagnostics", message: "compile", diagnostics: ["line 3"] })
    .mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await launcher.launch(target, request); });
  expect(launcher.error).toMatchObject({ reason: "compile_failed", message: "compile\nline 3" });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => launcher.clearError());
  expect(launcher.error).toBeNull();
  await act(async () => { await launcher.launch(target, request); });
  expect(launcher.error).toMatchObject({ reason: "generic", code: "exception", message: "offline" });
  expect(workflowRequest).toHaveBeenCalledTimes(2);
});
