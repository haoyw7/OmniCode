import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCodexAccountRequest } from "./codexAccountRequest";
import { killChild, spawnChild, unwatchChild } from "../../core/child";

const request = vi.hoisted(() => vi.fn());
vi.mock("../../core/child", () => ({ killChild: vi.fn(async () => {}), spawnChild: vi.fn(async () => 1), unwatchChild: vi.fn(), watchChild: vi.fn() }));
vi.mock("../../core/jsonRpc", () => ({ JsonRpcClient: class {
  request = request;
  respond = async () => {};
  notify = async () => {};
  close() {}
  pushLine() {}
} }));
beforeEach(() => request.mockResolvedValue({ rateLimits: {} }));
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

it("cleans each independent probe without touching conversation processes", async () => {
  await Promise.all(["work", "personal"].map(account => runCodexAccountRequest("/bin/codex", "/home", "account/rateLimits/read", {}, account, `usage-${account}`)));
  expect(vi.mocked(spawnChild).mock.calls.map(call => [call[0], call[4]])).toEqual([
    ["usage-work", { provider: "codex", id: "work" }],
    ["usage-personal", { provider: "codex", id: "personal" }],
  ]);
  expect(new Set(vi.mocked(killChild).mock.calls.map(call => call[0]))).toEqual(new Set(["usage-work", "usage-personal"]));
  expect(unwatchChild).toHaveBeenCalledTimes(2);
});

it("cleans up after an initialization failure", async () => {
  request.mockRejectedValueOnce(new Error("probe exited"));
  await expect(runCodexAccountRequest("/bin/codex", "/home", "account/rateLimits/read", {}, "work", "usage-work")).rejects.toThrow("probe exited");
  expect(unwatchChild).toHaveBeenCalledWith("usage-work");
  expect(killChild).toHaveBeenLastCalledWith("usage-work");
});

it("bounds a stalled probe and cleans it on timeout", async () => {
  vi.useFakeTimers();
  request.mockImplementationOnce(() => new Promise(() => {}));
  const pending = runCodexAccountRequest("/bin/codex", "/home", "account/rateLimits/read", {}, "work", "usage-work");
  const rejected = expect(pending).rejects.toThrow("Codex usage probe timed out");
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(unwatchChild).toHaveBeenCalledWith("usage-work");
  expect(killChild).toHaveBeenLastCalledWith("usage-work");
});
