import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostMachines } from "./host-machines";
import { HostChildBackend } from "./child-backend";
import { WslConnection } from "./machines/wsl";
import { createHostServer } from "./server";
import { currentMachineIO } from "./machine-io";
import type { HostProvider } from "./providers";
import { executeBotAction } from "./bots/thread/control";
import { attachmentPath } from "./attachments";

/** Execution-service double: Linux paths and bytes, deliberately no session engine. */
class ExecutionService extends WslConnection {
  readonly files = new Map<string, Buffer>();
  readonly directories = new Set(["/", "/workspace"]);
  readonly requests: Array<{ op: string; params: Record<string, unknown> }> = [];
  stopped = false;
  constructor(readonly distribution: string) {
    super({ distribution });
    this.files.set("/workspace/readme.txt", Buffer.from(`${distribution} workspace`));
  }
  override onEvent(): () => void { return () => {}; }
  override async close(): Promise<void> { this.stopped = true; }
  override async request<T = unknown>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ op, params });
    const path = String(params.path ?? "");
    const missing = () => { throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }); };
    const stats = (file: string) => ({
      isFile: this.files.has(file), isDirectory: this.directories.has(file), isSymbolicLink: false,
      size: this.files.get(file)?.length ?? 0, mtimeMs: 1, mode: this.directories.has(file) ? 0o40755 : 0o100644,
    });
    let result: unknown;
    if (op === "env.info") result = { home: "/home/test", platform: "linux", arch: "x64", node: "/runtime/node", path: "/usr/bin" };
    else if (op === "env.path") result = "/usr/bin";
    else if (op === "process.killAll") result = null;
    else if (op === "fs.stat") result = this.files.has(path) || this.directories.has(path) ? stats(path) : missing();
    else if (op === "fs.realpath") result = this.files.has(path) || this.directories.has(path) ? path : missing();
    else if (op === "fs.readFile") result = this.files.get(path)?.toString(params.encoding === "utf8" ? "utf8" : "base64") ?? missing();
    else if (op === "fs.readPrefix") result = this.files.get(path)?.subarray(0, Number(params.maxBytes)).toString("base64") ?? missing();
    else if (op === "fs.writeFile") {
      if (params.flag === "wx" && this.files.has(path)) throw Object.assign(new Error("File exists"), { code: "EEXIST" });
      this.files.set(path, Buffer.from(String(params.data), params.encoding === "utf8" ? "utf8" : "base64"));
      result = null;
    } else if (op === "fs.rename") {
      const bytes = this.files.get(path) ?? missing();
      this.files.set(String(params.destination), bytes);
      this.files.delete(path);
      result = null;
    } else if (op === "fs.mkdir") { this.directories.add(path); result = null; }
    else if (op === "fs.rm") { this.files.delete(path); this.directories.delete(path); result = null; }
    else if (op === "fs.readdir") {
      if (!this.directories.has(path)) missing();
      result = [...this.files.keys(), ...this.directories].filter((entry) => entry !== path && posix.dirname(entry) === path)
        .map((entry) => ({ ...stats(entry), name: posix.basename(entry), path: entry }));
    } else if (op === "exec") {
      const encode = (value: string) => Buffer.from(value).toString(params.encoding === "base64" ? "base64" : "utf8");
      result = params.command === "wslpath"
        ? { stdout: encode("/mnt/c/desktop-home\n"), stderr: "", code: 0, signal: null }
        : params.command === "uname"
        ? { stdout: encode("Linux\n"), stderr: "", code: 0, signal: null }
        : { stdout: "", stderr: encode("fatal: not a git repository"), code: 128, signal: null };
    } else throw new Error(`Unsupported test operation: ${op}`);
    return result as T;
  }
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it("uses one Host database and paired-device API for local and same-path WSL projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "monocode-shared-wsl-"));
  const store = new HostStore(join(root, "host.db"));
  const services = new Map<string, ExecutionService>();
  const local = new HostChildBackend({});
  const machines = new HostMachines(store, local, (distribution) => {
    const service = new ExecutionService(distribution);
    services.set(distribution, service);
    return service;
  });
  const turns: Array<{ machine: string; cwd: string }> = [];
  let holdBot: (() => void) | undefined;
  const provider: HostProvider = {
    send: async (input) => {
      if (input.text.includes("Hold bot for workspace checks")) {
        await new Promise<void>((done) => { holdBot = done; });
        return;
      }
      const io = currentMachineIO();
      turns.push({ machine: io.key, cwd: input.cwd });
      const output = io.key === "local" ? "local" : (await io.exec("uname", ["-s"], { cwd: input.cwd })).stdout.trim();
      input.onAccepted?.();
      input.onEvent({ type: "message.delta", text: `${io.key}: ${output}` });
    },
    bind: () => {}, stop: async () => { holdBot?.(); }, cancel: async () => { holdBot?.(); }, approve: () => {}, answer: () => {},
  };
  const engine = new HostEngine(store, { codex: provider }, undefined, {
    machines, native: { environment: { home: join(root, "home"), env: {} } },
  });
  const server = createHostServer(engine, ["codex"]);
  cleanups.push(async () => {
    await engine.workflows.ready;
    await engine.close();
    await machines.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const desktop = store.issueDevice("Desktop");
  store.markAdminDevice(desktop.id);
  const phone = store.issueDevice("Phone");
  const call = async (method: string, params: unknown = {}, token = desktop.token) => {
    const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }) });
    const body = await response.json() as { result?: any; error?: string };
    expect(body.error, `${method}: ${body.error}`).toBeUndefined();
    expect(response.status).toBe(200);
    return body.result;
  };
  const localProject = await call("projects.open", { cwd: root });
  const ubuntu = await call("projects.open", { cwd: "/workspace", machine: { kind: "wsl", distribution: "Ubuntu" } });
  const debian = await call("projects.open", { cwd: "/workspace", machine: { kind: "wsl", distribution: "Debian" } });
  expect(ubuntu.id).not.toBe(debian.id);
  expect(ubuntu.machine).toEqual({ kind: "wsl", distribution: "Ubuntu" });
  expect(debian.machine).toEqual({ kind: "wsl", distribution: "Debian" });
  expect((await call("projects.open", { cwd: "/workspace", machine: ubuntu.machine })).id).toBe(ubuntu.id);
  expect((await call("projects.list", {}, phone.token)).map((project: { id: string }) => project.id).sort())
    .toEqual([localProject.id, ubuntu.id, debian.id].sort());
  await call("preferences.patch", { operationId: "shared-setting", changes: { "monocode.colorScheme": "dark" } });
  expect(await call("preferences.read", {}, phone.token)).toEqual(await call("preferences.read"));
  const created = await Promise.all([localProject, ubuntu, debian].map((project, index) => call("commands.dispatch", {
    type: "create", commandId: `create-${index}`, projectId: project.id, harness: "codex", model: "codex:test", runtimeMode: "supervised",
  }, phone.token)));
  await Promise.all(created.map(({ sessionId }, index) => call("commands.dispatch", {
    type: "send", commandId: `send-${index}`, sessionId, text: "Run on this project machine",
  }, phone.token)));
  await vi.waitFor(() => {
    expect(turns).toHaveLength(3);
    for (const { sessionId } of created) expect(store.session(sessionId).status).toBe("idle");
  });
  expect(turns).toEqual(expect.arrayContaining([
    { machine: "local", cwd: localProject.cwd },
    { machine: "wsl:Ubuntu", cwd: "/workspace" },
    { machine: "wsl:Debian", cwd: "/workspace" },
  ]));
  for (const [index, project] of [localProject, ubuntu, debian].entries()) {
    const sessions = await call("sessions.list", { projectId: project.id }, phone.token);
    expect(sessions).toContainEqual(expect.objectContaining({ id: created[index].sessionId, remoteControl: true }));
    expect((await call("sessions.get", { sessionId: created[index].sessionId }, phone.token)).projectId).toBe(project.id);
  }
  expect(await call("workspace.run", { projectId: ubuntu.id, command: "read_text_file", args: { path: "/workspace/readme.txt" } }, phone.token)).toBe("Ubuntu workspace");
  expect(await call("workspace.run", { projectId: debian.id, command: "read_text_file", args: { path: "/workspace/readme.txt" } }, phone.token)).toBe("Debian workspace");
  await call("workspace.run", { projectId: ubuntu.id, command: "write_text_file", args: { path: "/workspace/readme.txt", content: "Changed in Ubuntu" } }, phone.token);
  expect(services.get("Ubuntu")!.files.get("/workspace/readme.txt")?.toString()).toBe("Changed in Ubuntu");
  expect(services.get("Debian")!.files.get("/workspace/readme.txt")?.toString()).toBe("Debian workspace");
  const persisted = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    expect(persisted.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n).toBe(3);
    expect(persisted.prepare("SELECT machine FROM projects WHERE cwd='/workspace' ORDER BY machine").all())
      .toEqual([{ machine: "wsl:Debian" }, { machine: "wsl:Ubuntu" }]);
  } finally { persisted.close(); }
  // Submission and later approval start outside an active project scope.
  const workflow = await engine.workflows.submit(created[1].sessionId,
    { script: 'phase("Inspect"); const text = await files.read("readme.txt"); await artifact.file("readme", "readme.txt"); return { text };' }, "agent");
  expect(workflow.ok).toBe(true);
  if (!workflow.ok) throw new Error(workflow.message);
  expect(workflow.status).toBe("awaiting_approval");
  await call("workflows.request", { action: "approve", runId: workflow.runId });
  const settled = await engine.workflows.wait(workflow.runId, 10);
  expect(settled.status).toBe("completed");
  expect(engine.workflows.journal.getRun(workflow.runId)?.cwd).toBe("/workspace");
  expect((await call("workflows.request", { action: "saved.runs", projectId: ubuntu.id })).runs).toHaveLength(1);
  expect((await call("workflows.request", { action: "saved.runs", projectId: debian.id })).runs).toHaveLength(0);
  const published = await call("workflows.request", { action: "artifacts", runId: workflow.runId });
  const artifact = await call("workflows.request", { action: "artifact", uri: published.artifacts[0].versions[0].uri });
  expect(Buffer.from(artifact.base64, "base64").toString()).toBe("Changed in Ubuntu");
  const saved = await call("workflows.request", { action: "saved.save", projectId: ubuntu.id, name: "inspect", scope: "project",
    description: "Inspect this workspace", script: 'phase("Inspect"); return await files.read("readme.txt");' });
  expect(saved.ok).toBe(true);
  expect((await call("workflows.request", { action: "saved.list", projectId: ubuntu.id, scope: "project" })).workflows).toHaveLength(1);
  expect((await call("workflows.request", { action: "saved.list", projectId: debian.id, scope: "project" })).workflows).toHaveLength(0);

  engine.assistant.setCatalog(async () => ["codex"], async () => ({ models: { codex: [{ id: "test", name: "Test" }] }, errors: {} }));
  await engine.assistant.rpc("assistant.configure", { commandId: "bot-setup", expectedRevision: 0,
    patch: { harness: "codex", model: "test", triggers: { user: true, event: false, schedule: false } } });
  await engine.assistant.rpc("assistant.send", { commandId: "bot-start", text: "Hold bot for workspace checks" });
  await vi.waitFor(() => expect(holdBot).toBeDefined());
  expect(await executeBotAction(engine.assistant, "bot-read", "files.read", {
    projectId: debian.id, args: { path: "/workspace/readme.txt" },
  }, () => true)).toBe("Debian workspace");
  await executeBotAction(engine.assistant, "bot-write", "files.write", {
    projectId: debian.id, args: { path: "/workspace/readme.txt", content: "Written by bot" },
  }, () => true);
  const reply = await executeBotAction(engine.assistant, "bot-attachment", "reply.attachments", {
    text: "Shared result", sources: [{ kind: "project-file", projectId: debian.id, relativePath: "readme.txt" }],
  }, () => true) as { attachments: Array<{ id: string }> };
  expect(await readFile(attachmentPath(store, reply.attachments[0].id), "utf8")).toBe("Written by bot");
  expect(services.get("Ubuntu")!.files.get("/workspace/readme.txt")?.toString()).toBe("Changed in Ubuntu");
  holdBot?.();
  for (const service of services.values()) {
    expect(service.requests.filter(({ op }) => op === "fs.writeFile").every(({ params }) => String(params.path).startsWith("/workspace/"))).toBe(true);
    expect([...service.files.keys()].some((file) => /host\.db|checkpoints|sessions/.test(file))).toBe(false);
  }
});
