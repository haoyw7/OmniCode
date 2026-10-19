import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  install: vi.fn(), inspect: vi.fn(), probe: vi.fn(), available: vi.fn(),
  refresh: vi.fn(), announce: vi.fn(),
}));
vi.mock("../../../platform/tauri/harnessInstall", () => ({ installLocalHarness: mock.install }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_WIN: true }));
vi.mock("../../../integrations/harness/core/child", () => ({ inspectHarnessBinary: mock.inspect }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: mock.probe, isHarnessAvailable: mock.available,
}));
vi.mock("../../../integrations/harness/core/registry", () => ({ refreshHarnessCatalogs: mock.refresh }));
vi.mock("./harnessUpdates", () => ({ announceHarnessesRefreshed: mock.announce }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mock.install.mockResolvedValue(undefined);
  mock.inspect.mockResolvedValue({ path: "/bin/cursor-agent", version: "1.2.3" });
  mock.probe.mockResolvedValue(undefined);
  mock.available.mockReturnValue(true);
  mock.refresh.mockResolvedValue(undefined);
  mock.announce.mockResolvedValue(undefined);
});

it("verifies the CLI before refreshing availability, models and other windows", async () => {
  const { runHarnessInstall } = await import("./harnessInstall");
  await runHarnessInstall("cursor");
  expect(mock.install).toHaveBeenCalledWith("cursor");
  expect(mock.inspect).toHaveBeenCalledWith("cursor");
  expect(mock.probe).toHaveBeenNthCalledWith(1);
  expect(mock.probe).toHaveBeenNthCalledWith(2, { force: true });
  expect(mock.refresh).toHaveBeenCalledWith(["cursor"], { force: true });
  expect(mock.announce).toHaveBeenCalledWith(["cursor"]);
  expect(mock.inspect.mock.invocationCallOrder[0]).toBeLessThan(mock.probe.mock.invocationCallOrder[0]);
  expect(mock.probe.mock.invocationCallOrder[0]).toBeLessThan(mock.refresh.mock.invocationCallOrder[0]);
});

it("deduplicates repeated clicks and serializes installs across provider rows", async () => {
  let finish!: () => void;
  mock.install.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const { runHarnessInstall } = await import("./harnessInstall");
  const first = runHarnessInstall("cursor");
  expect(runHarnessInstall("cursor")).toBe(first);
  expect(runHarnessInstall("codex")).toBe(first);
  expect(mock.install).toHaveBeenCalledTimes(1);
  finish();
  await first;
});

it("does not announce success for a broken installation and permits retry", async () => {
  mock.inspect.mockResolvedValueOnce({ path: "/bin/agent", error: "broken binary" });
  const { runHarnessInstall } = await import("./harnessInstall");
  await runHarnessInstall("cursor");
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.announce).not.toHaveBeenCalled();
  await runHarnessInstall("cursor");
  expect(mock.install).toHaveBeenCalledTimes(2);
  expect(mock.announce).toHaveBeenCalledWith(["cursor"]);
});

it("keeps failed downloads and failed detection out of the success path", async () => {
  const { runHarnessInstall } = await import("./harnessInstall");
  mock.install.mockRejectedValueOnce(new Error("network unavailable"));
  await runHarnessInstall("cursor");
  expect(mock.inspect).not.toHaveBeenCalled();
  mock.available.mockReturnValue(false);
  await runHarnessInstall("cursor");
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.announce).not.toHaveBeenCalled();
});

it("rejects unsupported installers without blocking later installations", async () => {
  const { runHarnessInstall, harnessInstallUnavailableReason } = await import("./harnessInstall");
  expect(harnessInstallUnavailableReason("fx")).not.toBeNull();
  expect(harnessInstallUnavailableReason("antigravity")).not.toBeNull();
  await runHarnessInstall("antigravity");
  expect(mock.install).not.toHaveBeenCalled();
  await runHarnessInstall("pi");
  expect(mock.install).toHaveBeenCalledWith("pi");
});
