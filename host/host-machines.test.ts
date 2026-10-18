import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostMachines } from "./host-machines";
import { HostChildBackend } from "./child-backend";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { withMachineIO } from "./machine-io";
import { WslConnection } from "./machines/wsl";
import type { HostProvider } from "./providers";

it("reads stored WSL history with the execution service offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monocode-wsl-offline-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject("/workspace", "Ubuntu project", undefined, { kind: "wsl", distribution: "Ubuntu" });
  const connection = new WslConnection({ distribution: "Ubuntu" });
  const request = vi.spyOn(connection, "request").mockRejectedValue(new Error("WSL is offline"));
  const machines = new HostMachines(store, new HostChildBackend({}), () => connection);
  const io = machines.io(project.machine);
  const provider: HostProvider = { send: vi.fn(), bind: vi.fn(), stop: vi.fn(), cancel: vi.fn(), approve: vi.fn(), answer: vi.fn() };
  const engine = new HostEngine(store, { codex: provider }, undefined, { machines,
    native: { environment: { home: join(directory, "home"), env: {} } } });
  const server = createHostServer(engine, ["codex"]);
  try {
    await engine.ready;
    const { sessionId } = withMachineIO(io, () => engine.command({ type: "create", commandId: "offline-history", projectId: project.id,
      harness: "codex", model: "codex:test", runtimeMode: "supervised" }));
    const device = store.issueDevice("Phone");
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) });
      return await response.json() as { result?: any; error?: string };
    };
    expect((await call("sessions.list", { projectId: project.id })).result).toContainEqual(expect.objectContaining({ id: sessionId }));
    expect((await call("sessions.get", { sessionId })).result).toMatchObject({ projectId: project.id });
    expect((await call("sessions.sync", { sessionId, afterRevision: 0 })).error).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect((await call("workspace.run", { projectId: project.id, command: "read_text_file", args: { path: "/workspace/file" } })).error)
      .toContain("WSL is offline");
    expect(request).toHaveBeenCalledOnce();
    expect(machines.workspaceReady(project.machine)).toBe(false);
  } finally {
    await engine.workflows.ready;
    await engine.close();
    await machines.close();
    expect(request).toHaveBeenCalledOnce();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    store.close();
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

it("does not connect a distribution when closing a backend created only to scope history", async () => {
  const store = new HostStore(":memory:");
  const connection = new WslConnection({ distribution: "Ubuntu" });
  const request = vi.spyOn(connection, "request").mockRejectedValue(new Error("WSL is offline"));
  const machines = new HostMachines(store, new HostChildBackend({}), () => connection);
  try {
    machines.run({ kind: "wsl", distribution: "Ubuntu" }, () => undefined);
    await machines.close();
    expect(request).not.toHaveBeenCalled();
  } finally { store.close(); }
});

it.skipIf(process.platform !== "win32")("prepares WSL projects and restores execution scopes without an opt-in flag", async () => {
  vi.stubEnv("MONOCODE_WSL_SHARED_HOST", undefined);
  const request = vi.spyOn(WslConnection.prototype, "request").mockImplementation(async (op) => {
    if (op === "env.info") return { home: "/home/test", node: "/runtime/node" };
    if (op === "fs.stat") throw Object.assign(new Error("No legacy database"), { code: "ENOENT" });
    if (op === "fs.readFile") return Buffer.from("workspace contents").toString("base64");
    if (op === "fs.writeFile") return null;
    if (op === "exec") return { stdout: Buffer.from("Linux\n").toString("base64"), stderr: "", code: 0 };
    throw new Error(`Unexpected operation: ${op}`);
  });
  const store = new HostStore(":memory:");
  const machines = new HostMachines(store, new HostChildBackend({}));
  try {
    const io = machines.io({ kind: "wsl", distribution: "Ubuntu" });
    expect(io.key).toBe("wsl:Ubuntu");
    expect(request).not.toHaveBeenCalled();
    expect(machines.workspaceReady({ kind: "wsl", distribution: "Ubuntu" })).toBe(false);
    await expect(machines.forRequest("projects.open", { machine: { kind: "wsl", distribution: "Ubuntu" } },
      async () => io.key)).resolves.toBe("wsl:Ubuntu");
    expect(machines.workspaceReady({ kind: "wsl", distribution: "Ubuntu" })).toBe(true);
    await expect(io.fs.readFile("/workspace/a", "utf8")).resolves.toBe("workspace contents");
    await expect(io.fs.writeFile("/workspace/a", "changed")).resolves.toBeUndefined();
    await expect(io.nodePath()).resolves.toBe("/runtime/node");
    await expect(io.exec("uname", ["-s"])).resolves.toMatchObject({ stdout: "Linux\n" });
  } finally {
    await machines.close();
    request.mockRestore();
    store.close();
    vi.unstubAllEnvs();
  }
});
