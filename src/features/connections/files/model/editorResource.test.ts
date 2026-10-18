// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { configureSharedHost } from "../../model/remoteProjects";
import {
  remoteMachineFor,
  remoteRequest,
} from "../../model/connections";
import {
  claimEditorResource,
  flushEditorResourceReleases,
} from "./editorResource";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../model/connections", () => ({
  remoteMachineFor: vi.fn(),
  remoteRequest: vi.fn(),
}));
afterEach(async () => {
  vi.mocked(remoteRequest).mockResolvedValue(undefined);
  await flushEditorResourceReleases();
  configureSharedHost(undefined, []);
  vi.resetAllMocks();
  localStorage.clear();
});

it("holds a native buffer reference through reads and writes until explicit close", async () => {
  configureSharedHost("local", []);
  let allowClaim!: () => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "shared_host_resource_claim")
      await new Promise<void>((resolve) => {
        allowClaim = resolve;
      });
  });
  const lease = claimEditorResource("/repo/worker/file.ts");
  let ready = false;
  void lease.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(invoke).toHaveBeenCalledWith("shared_host_resource_claim", {
    path: "/repo/worker/file.ts",
    resourceId: expect.stringMatching(/^editor-/),
  });
  allowClaim();
  await lease.ready;
  expect(invoke).not.toHaveBeenCalledWith(
    "shared_host_resource_release",
    expect.anything(),
  );
  await lease.release();
  expect(invoke).toHaveBeenLastCalledWith("shared_host_resource_release", {
    resourceId: vi.mocked(invoke).mock.calls[0][1]?.resourceId,
  });
  await expect(lease.reclaim()).rejects.toThrow("closed");
});

it("does not open an editable buffer when checkout cleanup has reserved it", async () => {
  configureSharedHost("local", []);
  vi.mocked(invoke).mockRejectedValue(
    new Error("Checkout cleanup is in progress"),
  );
  const lease = claimEditorResource("/repo/worker/file.ts");
  await expect(lease.ready).rejects.toThrow("cleanup");
  await expect(lease.release()).rejects.toThrow("cleanup");
  expect(invoke).toHaveBeenCalledWith("shared_host_resource_release", {
    resourceId: expect.any(String),
  });
});

it("claims remote buffers on their owning Host and renews before another write", async () => {
  vi.mocked(remoteMachineFor).mockResolvedValue({
    id: "remote",
    environmentId: "env",
    endpoint: "http://host",
    name: "remote",
  });
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) =>
    method === "environment.describe"
      ? ({ capabilities: ["resources"] } as never)
      : (undefined as never),
  );
  const lease = claimEditorResource("remote://env/repo/worker/file.ts");
  await lease.ready;
  await lease.reclaim();
  await lease.release();
  expect(remoteRequest).toHaveBeenCalledWith("remote", "resources.claim", {
    resourceId: expect.any(String),
    path: "/repo/worker/file.ts",
  });
  expect(
    vi
      .mocked(remoteRequest)
      .mock.calls.filter(([, method]) => method === "resources.claim"),
  ).toHaveLength(2);
  expect(invoke).not.toHaveBeenCalled();
  expect(remoteRequest).toHaveBeenLastCalledWith(
    "remote",
    "resources.release",
    { resourceId: expect.any(String) },
  );
});

it("keeps file editing compatible with Hosts lacking resource claims", async () => {
  vi.mocked(remoteMachineFor).mockResolvedValue({
    id: "old",
    environmentId: "old",
    endpoint: "http://host",
    name: "old",
  });
  vi.mocked(remoteRequest).mockResolvedValue({ capabilities: [] } as never);
  const lease = claimEditorResource("remote://old/repo/file.ts");
  await lease.ready;
  await lease.release();
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});

it("retries an explicit close after the remote Host disconnects", async () => {
  vi.mocked(remoteMachineFor).mockResolvedValue({
    id: "remote",
    environmentId: "env",
    endpoint: "http://host",
    name: "remote",
  });
  let online = true;
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) => {
    if (method === "environment.describe")
      return { capabilities: ["resources"] } as never;
    if (!online) throw new Error("Host disconnected");
    return undefined as never;
  });
  const lease = claimEditorResource("remote://env/repo/worker/file.ts");
  await lease.ready;
  online = false;
  await expect(lease.release()).rejects.toThrow("disconnected");
  expect(localStorage.length).toBe(1);
  online = true;
  await flushEditorResourceReleases();
  expect(localStorage.length).toBe(0);
  expect(
    vi
      .mocked(remoteRequest)
      .mock.calls.filter(([, method]) => method === "resources.release"),
  ).toHaveLength(2);
});

it("releases a remote claim whose accepted response was lost", async () => {
  vi.mocked(remoteMachineFor).mockResolvedValue({
    id: "remote",
    environmentId: "env",
    endpoint: "http://host",
    name: "remote",
  });
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) => {
    if (method === "environment.describe")
      return { capabilities: ["resources"] } as never;
    if (method === "resources.claim") throw new Error("Response lost");
    return undefined as never;
  });
  const lease = claimEditorResource("remote://env/repo/file.ts");
  await expect(lease.ready).rejects.toThrow("Response lost");
  await lease.release();
  expect(remoteRequest).toHaveBeenLastCalledWith(
    "remote",
    "resources.release",
    { resourceId: expect.any(String) },
  );
});
