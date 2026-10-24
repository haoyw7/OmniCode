// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { configureSharedHost } from "../../model/remoteProjects";
import { remoteMachineFor, remoteRequest } from "../../model/connections";
import { claimEditorResource, flushEditorResourceReleases } from "./editorResource";

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

const project = { id: "repo", cwd: "/repo", name: "repo" } as never;
const describeResources = (claim?: () => Promise<void>) =>
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method) => {
    if (method === "environment.describe") return { capabilities: ["resources"] } as never;
    if (method === "resources.claim") await claim?.();
    return undefined as never;
  });

it("holds a shared-Host buffer reference through reads and writes until explicit close", async () => {
  configureSharedHost("local", [project], "local-machine");
  let allowClaim!: () => void;
  describeResources(() => new Promise<void>((resolve) => { allowClaim = resolve; }));
  const lease = claimEditorResource("/repo/worker/file.ts");
  let ready = false;
  void lease.ready.then(() => {
    ready = true;
  });
  await vi.waitFor(() => expect(remoteRequest).toHaveBeenCalledWith("local-machine", "resources.claim", {
    path: "/repo/worker/file.ts",
    resourceId: expect.stringMatching(/^editor-/),
  }));
  expect(ready).toBe(false);
  allowClaim();
  await lease.ready;
  expect(remoteRequest).not.toHaveBeenCalledWith("local-machine", "resources.release", expect.anything());
  await lease.release();
  const claimed = vi.mocked(remoteRequest).mock.calls.find(([, method]) => method === "resources.claim")![2] as { resourceId: string };
  expect(remoteRequest).toHaveBeenLastCalledWith("local-machine", "resources.release", { resourceId: claimed.resourceId });
  await expect(lease.reclaim()).rejects.toThrow("closed");
  expect(invoke).not.toHaveBeenCalled();
});

it("does not open an editable buffer when checkout cleanup has reserved it", async () => {
  configureSharedHost("local", [project], "local-machine");
  describeResources(() => Promise.reject(new Error("Checkout cleanup is in progress")));
  const lease = claimEditorResource("/repo/worker/file.ts");
  await expect(lease.ready).rejects.toThrow("cleanup");
  await lease.release();
  expect(remoteRequest).toHaveBeenCalledWith("local-machine", "resources.release", {
    resourceId: expect.any(String),
  });
});

it("leaves files outside registered projects unclaimed", async () => {
  configureSharedHost("local", [project], "local-machine");
  describeResources();
  const lease = claimEditorResource("/elsewhere/file.ts");
  await lease.ready;
  await lease.release();
  expect(remoteRequest).not.toHaveBeenCalled();
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
