import { beforeEach, expect, it, vi } from "vitest";
import { remoteRequest } from "./connections";
import { loadRemoteHostCatalog, loadRemoteHostDescriptor } from "./remoteHostMetadata";
import type { HostDescriptor, HostModelCatalog } from "./protocol";

vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));

const descriptor = (environmentId = "env"): HostDescriptor => ({
  protocolVersion: 1,
  environmentId,
  name: "Host",
  providers: ["codex"],
  capabilities: [],
});
const catalog: HostModelCatalog = { models: {}, errors: {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.mocked(remoteRequest).mockReset());

it("shares 39 simultaneous pane reads and revalidates after each request settles", async () => {
  const host = deferred<HostDescriptor>();
  const models = deferred<HostModelCatalog>();
  vi.mocked(remoteRequest).mockImplementation((_machine, method) =>
    (method === "environment.describe" ? host.promise : models.promise) as never,
  );
  const descriptors = Array.from({ length: 39 }, () => loadRemoteHostDescriptor("machine", "env"));
  const catalogs = Array.from({ length: 39 }, () => loadRemoteHostCatalog("machine", "env", "project"));
  await Promise.resolve();
  expect(remoteRequest).toHaveBeenCalledTimes(2);
  host.resolve(descriptor());
  models.resolve(catalog);
  expect(await Promise.all(descriptors)).toEqual(Array(39).fill(descriptor()));
  expect(await Promise.all(catalogs)).toEqual(Array(39).fill(catalog));
  await Promise.all([
    loadRemoteHostDescriptor("machine", "env"),
    loadRemoteHostCatalog("machine", "env", "project"),
  ]);
  expect(remoteRequest).toHaveBeenCalledTimes(4);
});

it("retries both metadata reads after a shared connection failure", async () => {
  const offline = deferred<never>();
  vi.mocked(remoteRequest).mockReturnValue(offline.promise);
  const requests = [
    loadRemoteHostDescriptor("machine", "env"),
    loadRemoteHostDescriptor("machine", "env"),
    loadRemoteHostCatalog("machine", "env", "project"),
    loadRemoteHostCatalog("machine", "env", "project"),
  ];
  const results = Promise.allSettled(requests);
  offline.reject(new Error("offline"));
  expect((await results).every(result => result.status === "rejected")).toBe(true);
  expect(remoteRequest).toHaveBeenCalledTimes(2);
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) =>
    (method === "environment.describe" ? descriptor() : catalog) as never,
  );
  await expect(loadRemoteHostDescriptor("machine", "env")).resolves.toEqual(descriptor());
  await expect(loadRemoteHostCatalog("machine", "env", "project")).resolves.toEqual(catalog);
  expect(remoteRequest).toHaveBeenCalledTimes(4);
});

it("separates descriptor requests by machine and expected environment", async () => {
  const host = deferred<HostDescriptor>();
  vi.mocked(remoteRequest).mockReturnValue(host.promise as never);
  const results = Promise.allSettled([
    loadRemoteHostDescriptor("machine", "env"),
    loadRemoteHostDescriptor("machine-2", "env"),
    loadRemoteHostDescriptor("machine", "other-env"),
  ]);
  await Promise.resolve();
  expect(remoteRequest).toHaveBeenCalledTimes(3);
  host.resolve(descriptor());
  const settled = await results;
  expect(settled.slice(0, 2).every(result => result.status === "fulfilled")).toBe(true);
  expect(settled[2]).toMatchObject({ status: "rejected", reason: new Error("Host identity changed. Reconnect this machine before continuing.") });
  vi.mocked(remoteRequest).mockResolvedValue(descriptor("other-env") as never);
  await expect(loadRemoteHostDescriptor("machine", "other-env")).resolves.toEqual(descriptor("other-env"));
});

it("separates model catalogs by machine, environment and project", async () => {
  const models = deferred<HostModelCatalog>();
  vi.mocked(remoteRequest).mockReturnValue(models.promise as never);
  const requests = [
    loadRemoteHostCatalog("machine", "env", "project"),
    loadRemoteHostCatalog("machine-2", "env", "project"),
    loadRemoteHostCatalog("machine", "other-env", "project"),
    loadRemoteHostCatalog("machine", "env", "project-2"),
  ];
  await Promise.resolve();
  expect(remoteRequest).toHaveBeenCalledTimes(4);
  models.resolve(catalog);
  await Promise.all(requests);
});
