import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  request: vi.fn(), descriptor: vi.fn(), publish: vi.fn(), begin: vi.fn(), done: vi.fn(),
  machine: "local", environment: "environment", toast: vi.fn(),
}));
vi.mock("../../../shared/ui/StatusToast", () => ({ showStatusToast: mock.toast }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mock.request }));
vi.mock("../../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: mock.descriptor }));
vi.mock("../../connections/model/remoteProjects", () => ({
  sharedHostMachineId: () => mock.machine, sharedHostEnvironment: () => mock.environment,
}));
vi.mock("../../../integrations/harness/core/modelCatalog", () => ({ beginCatalogLoad: mock.begin, setHarnessModels: mock.publish }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mock.machine = "local";
  mock.environment = "environment";
  mock.begin.mockReturnValue(mock.done);
  mock.descriptor.mockResolvedValue({ providers: ["codex", "pi", "omp"], capabilities: ["models.list", "models.refresh.v1"] });
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("shares concurrent requested catalogs and refreshes cached results only on force", async () => {
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  const model = { id: "codex:host", harness: "codex", name: "Host model", supportsImages: false };
  mock.request.mockResolvedValue({ models: { codex: [model] }, errors: {} });
  await Promise.all([refreshHostModelCatalogs(["codex"]), refreshHostModelCatalogs(["codex", "codex"])]);
  expect(mock.request).toHaveBeenCalledExactlyOnceWith("local", "models.list", { progressive: true, providers: ["codex"] });
  expect(mock.publish).toHaveBeenCalledWith("codex", [model]);
  expect(mock.done).toHaveBeenCalledOnce();
  await refreshHostModelCatalogs(["codex"]);
  expect(mock.request).toHaveBeenCalledOnce();
  await refreshHostModelCatalogs(["codex"], { force: true });
  expect(mock.request).toHaveBeenLastCalledWith("local", "models.list", { progressive: true, providers: ["codex"], force: true });
});

it.each(["pi", "omp"] as const)("collects progressive %s discovery without repeatedly forcing the probe", async (provider) => {
  vi.useFakeTimers();
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  mock.request.mockResolvedValueOnce({ models: {}, errors: {}, pending: [provider] })
    .mockResolvedValueOnce({ models: { [provider]: [{ id: `${provider}:host`, harness: provider, name: "Host" }] }, errors: {}, pending: [] });
  const request = refreshHostModelCatalogs([provider], { force: true });
  await vi.advanceTimersByTimeAsync(500);
  await request;
  expect(mock.request).toHaveBeenNthCalledWith(1, "local", "models.list", { progressive: true, providers: [provider], force: true });
  expect(mock.request).toHaveBeenNthCalledWith(2, "local", "models.list", { progressive: true, providers: [provider] });
  expect(mock.publish).toHaveBeenCalledOnce();
});

it("retains cached projections when disconnected or when an old Host lacks discovery", async () => {
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  mock.machine = "";
  await refreshHostModelCatalogs(["codex"]);
  expect(mock.descriptor).not.toHaveBeenCalled();
  mock.machine = "local";
  mock.descriptor.mockResolvedValue({ providers: ["codex"], capabilities: [] });
  await refreshHostModelCatalogs(["codex"]);
  expect(mock.request).not.toHaveBeenCalled();
  expect(mock.publish).not.toHaveBeenCalled();
  expect(console.debug).toHaveBeenLastCalledWith("[omnicode] codex Host catalog", expect.objectContaining({ message: "This Host does not support model discovery" }));
});

it("reads an older Host normally but reports that it cannot force discovery", async () => {
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  mock.descriptor.mockResolvedValue({ providers: ["codex"], capabilities: ["models.list"] });
  mock.request.mockResolvedValue({ models: { codex: [{ id: "codex:old", harness: "codex", name: "Old Host" }] }, errors: {} });
  await refreshHostModelCatalogs(["codex"]);
  await refreshHostModelCatalogs(["codex"], { force: true });
  expect(mock.request).toHaveBeenCalledOnce();
  expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining("does not support refreshing"), "error");
  expect(console.debug).toHaveBeenLastCalledWith("[omnicode] codex Host catalog", expect.objectContaining({ message: expect.stringContaining("does not support refreshing") }));
});

it("queues one forced refresh after an already running ordinary probe", async () => {
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  let finish!: (value: unknown) => void;
  mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ models: { codex: [{ id: "codex:new", name: "New" }] }, errors: {} });
  const ordinary = refreshHostModelCatalogs(["codex"]);
  await vi.waitFor(() => expect(mock.request).toHaveBeenCalledOnce());
  const first = refreshHostModelCatalogs(["codex"], { force: true });
  const second = refreshHostModelCatalogs(["codex"], { force: true });
  finish({ models: { codex: [{ id: "codex:old", name: "Old" }] }, errors: {} });
  await Promise.all([ordinary, first, second]);
  expect(mock.request).toHaveBeenCalledTimes(2);
  expect(mock.request).toHaveBeenLastCalledWith("local", "models.list", { progressive: true, providers: ["codex"], force: true });
  expect(mock.publish).toHaveBeenLastCalledWith("codex", [{ id: "codex:new", name: "New" }]);
});

it("retries a failed Host read and ignores a previous Host's late result", async () => {
  const { refreshHostModelCatalogs } = await import("./hostModelCatalog");
  mock.request.mockRejectedValueOnce(new Error("disconnected"));
  await refreshHostModelCatalogs(["codex"]);
  let finish!: (value: unknown) => void;
  mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const retry = refreshHostModelCatalogs(["codex"]);
  await vi.waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
  mock.environment = "replacement";
  finish({ models: { codex: [{ id: "codex:stale", name: "Stale" }] }, errors: {} });
  await retry;
  expect(mock.publish).not.toHaveBeenCalled();
  expect(mock.done).toHaveBeenCalledTimes(2);
});
