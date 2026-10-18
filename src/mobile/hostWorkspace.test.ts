// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { initializeMobileWorkspace, mobileWorkspacePending, saveMobileWorkspace, stopMobileWorkspace } from "./hostWorkspace";
import type { MobileClient } from "./client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { localStorage.clear(); stopMobileWorkspace(); });
const location = { environmentId: "host", projectId: "project", sessionId: "session" };
function client(reason: string = "timeout") {
  return {
    connection: { environmentId: "host" },
    hasCapability: () => false,
    getConnectionStatus: () => ({ state: "failed", reason }),
    rpc: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as MobileClient;
}
function cache() {
  localStorage.setItem("monocode.host-workspace.v1:host:cache:mobile", JSON.stringify({
    revision: 1, kind: "desktop", windowId: "desktop", updatedAt: 1, snapshot: { location },
  }));
}

it("restores cached selection and journals new selection when a verified Host is offline", async () => {
  cache();
  const device = client();
  expect(await initializeMobileWorkspace(device)).toEqual(location);
  await saveMobileWorkspace(device, { ...location, sessionId: "next-session" });
  expect(mobileWorkspacePending()).toBe(true);
  expect(device.rpc).toHaveBeenCalledWith("workspaces.save", expect.objectContaining({ kind: "mobile", snapshot: { location: { ...location, sessionId: "next-session" } } }));
});

it("does not treat revoked credentials or changed Host identity as an offline cache restore", async () => {
  cache();
  await expect(initializeMobileWorkspace(client("authentication"))).rejects.toThrow("Update Host");
  await expect(initializeMobileWorkspace(client("identity"))).rejects.toThrow("Update Host");
});

it("stops accepting writes to the old Host immediately when the device switches", async () => {
  cache();
  const device = client();
  await initializeMobileWorkspace(device);
  stopMobileWorkspace();
  await saveMobileWorkspace(device, location);
  expect(mobileWorkspacePending()).toBe(false);
  expect(device.rpc).not.toHaveBeenCalledWith("workspaces.save", expect.anything());
});
