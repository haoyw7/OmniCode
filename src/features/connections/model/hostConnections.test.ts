// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { connectionDefinition, HostConnectionDirectory } from "./hostConnections";
import type { HostStateRequest } from "./hostWorkspace";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => localStorage.clear());

it("exports discovery metadata without SSH users, URLs, or credentials", () => {
  expect(connectionDefinition({ id: "local-id", name: "Build machine", environmentId: "remote-host",
    endpoint: "http://user:secret@localhost:4444/private?token=secret", ssh: { target: "alice@builder", port: 2222, remotePort: 3774 } }))
    .toEqual({ id: "remote-host", environmentId: "remote-host", name: "Build machine", kind: "ssh", hostname: "builder", port: 2222 });
});

it("keeps offline directory edits pending, shows them immediately, and retries idempotently", async () => {
  const definition = { id: "remote", name: "Remote", kind: "http" as const, environmentId: "remote" };
  let online = false;
  const calls: Record<string, unknown>[] = [];
  const request = vi.fn(async (method, params) => {
    if (method === "connections.patch") calls.push(params);
    if (!online) throw new Error("offline");
    return method === "connections.list" ? null : { revision: 1, connections: [definition] };
  }) as HostStateRequest;
  const directory = new HostConnectionDirectory("home", request, localStorage);
  await directory.patch({ remote: definition });
  expect(directory.pending).toBe(true);
  expect(directory.connections).toEqual([definition]);
  online = true;
  await directory.sync();
  expect(directory.pending).toBe(false);
  expect(calls[1].operationId).toBe(calls[0].operationId);
  const otherHost = new HostConnectionDirectory("other", request, localStorage);
  expect(otherHost.connections).toEqual([]);
});

it("writes a connection deletion without touching a device's authentication storage", async () => {
  localStorage.setItem("device-credentials", "local-only");
  const request = vi.fn(async () => ({ revision: 2, connections: [] })) as HostStateRequest;
  const directory = new HostConnectionDirectory("home", request, localStorage);
  await directory.patch({ remote: null });
  expect(request).toHaveBeenCalledWith("connections.patch", expect.objectContaining({ changes: { remote: null } }));
  expect(localStorage.getItem("device-credentials")).toBe("local-only");
});
