import { afterEach, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection, createServer as createTcpServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { cleanupOrphans, createWslExecServer, prepareWslExec, probeWslExec, processIdentity } from "./wsl-exec.mjs";
import { readLines } from "./wsl-exec-protocol.mjs";
import { WslConnection, WslRequestError, type WslExecutionEvent } from "./machines/wsl";
import { readWslCursorSubagents } from "./cursor-subagents";
import { WslLoopbackRelay } from "./machines/wsl-relay";

let directory: string;
let socket: string;
let service: Awaited<ReturnType<typeof createWslExecServer>>;
const connections: WslConnection[] = [];
const entry = resolve("host/wsl-exec.mjs");
const waitFor = async (condition: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 5000;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for execution event");
    await new Promise((done) => setTimeout(done, 10));
  }
};
function connect(launch?: () => ReturnType<typeof bridge>) {
  const connection = new WslConnection({ distribution: "fixture", launch: launch ?? bridge, setupTimeoutMs: 5000 });
  connections.push(connection);
  return connection;
}
function bridge() { return spawn(process.execPath, [entry, "bridge", directory, socket], { stdio: "pipe", windowsHide: true }); }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "monocode-wsl-exec-"));
  socket = process.platform === "win32" ? `\\\\.\\pipe\\monocode-wsl-exec-${randomUUID()}` : join(directory, "rpc.sock");
  service = await createWslExecServer({ socket, runDirectory: directory });
});
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await service.close();
  await rm(directory, { recursive: true, force: true });
});

it("multiplexes exec replies and process events, including large UTF-8 output and stdin", async () => {
  const connection = connect();
  const events: WslExecutionEvent[] = [];
  connection.onEvent((event) => events.push(event));
  await connection.request("process.spawn", {
    stream: "provider", command: process.execPath,
    args: ["-e", "process.stdout.write('汉'.repeat(400000)+'\\n'); process.stderr.write('diagnostic\\n'); process.stdin.on('data', b=>process.stdout.write(b));"],
  });
  const [first, second] = await Promise.all([
    connection.request<{ stdout: string; code: number }>("exec", { command: process.execPath, args: ["-e", "setTimeout(()=>console.log('slow'),40)"] }),
    connection.request<{ stdout: string; code: number }>("exec", { command: process.execPath, args: ["-e", "console.log('fast')"] }),
  ]);
  expect(first.stdout.trim()).toBe("slow");
  expect(second.stdout.trim()).toBe("fast");
  await connection.request("process.write", { stream: "provider", data: "input ✓\n" });
  await waitFor(() => events.some((event) => event.kind === "stdout" && event.data === "input ✓"));
  await connection.request("process.closeStdin", { stream: "provider" });
  await waitFor(() => events.some((event) => event.kind === "exit"));
  expect(events.filter((event) => event.kind === "stdout").map((event) => event.data)).toEqual(["汉".repeat(400000), "input ✓"]);
  expect(events.find((event) => event.kind === "stderr")?.data).toBe("diagnostic");
});

it("owns each child and append handle by connection and kills children on disconnect", async () => {
  const first = connect(), second = connect();
  const processArgs = { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] };
  const child = await first.request<{ pid: number }>("process.spawn", { ...processArgs, stream: "first" });
  await second.request("process.spawn", { ...processArgs, stream: "second" });
  const secondEvents: WslExecutionEvent[] = [];
  second.onEvent((event) => secondEvents.push(event));
  await expect(second.request("process.write", { stream: "first", data: "x" })).rejects.toThrow("does not belong");
  const handle = await first.request<string>("fs.appendOpen", { path: join(directory, "append") });
  await expect(second.request("fs.append", { handle, data: "x" })).rejects.toThrow("does not belong");
  await first.close();
  await waitFor(() => { try { process.kill(child.pid, 0); return false; } catch { return true; } });
  expect(secondEvents.filter((event) => event.kind === "exit")).toHaveLength(0);
  await second.request("process.killAll");
  await waitFor(() => secondEvents.some((event) => event.kind === "exit"));
});

it("performs atomic binary writes, preserves open append handles and supports recursive file IO", async () => {
  const connection = connect();
  const path = join(directory, "file.bin");
  const bytes = Buffer.from([0, 255, 13, 10, 128]);
  await connection.request("fs.writeFile", { path, data: bytes.toString("base64") });
  expect(await connection.request("fs.readFile", { path })).toBe(bytes.toString("base64"));
  await expect(connection.request("fs.writeFile", { path, data: "oops", encoding: "utf8", flag: "wx" })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path)).toEqual(bytes);
  const handle = await connection.request<string>("fs.appendOpen", { path });
  await Promise.all(["one\n", "two\n", "three\n"].map((data) => connection.request("fs.append", { handle, data })));
  await connection.request("fs.appendClose", { handle });
  expect(await readFile(path)).toEqual(Buffer.concat([bytes, Buffer.from("one\ntwo\nthree\n")]));
  expect(await connection.request("fs.readPrefix", { path, maxBytes: bytes.length })).toBe(bytes.toString("base64"));
  expect(await connection.request("fs.hash", { path, algorithm: "sha256" })).toBe(createHash("sha256").update(await readFile(path)).digest("hex"));
  const nested = join(directory, "nested");
  await connection.request("fs.mkdir", { path: nested, recursive: true });
  await connection.request("fs.cp", { path, destination: join(nested, "copy") });
  const entries = await connection.request<{ name: string; isDirectory: boolean }[]>("fs.readdir", { path: directory, recursive: true });
  expect(entries.some((entry) => entry.name === "nested/copy")).toBe(true);
  await connection.request("fs.rename", { path: join(nested, "copy"), destination: join(nested, "renamed") });
  expect(await connection.request("fs.stat", { path: nested })).toMatchObject({ isDirectory: true, isFile: false });
  await connection.request("fs.rm", { path: nested, recursive: true });
  await expect(connection.request("fs.stat", { path: nested })).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

it("snapshots committed WAL data into a new file without changing the source", async () => {
  const source = join(directory, "source.db"), destination = join(directory, "snapshot.db");
  const database = new DatabaseSync(source);
  try {
    database.exec("PRAGMA journal_mode=WAL; CREATE TABLE sessions (id TEXT); INSERT INTO sessions VALUES ('saved');");
    const result = await connect().request("db.snapshot", { path: source, destination });
    expect(result).toMatchObject({ path: destination });
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try { expect(snapshot.prepare("SELECT id FROM sessions").all()).toEqual([{ id: "saved" }]); }
    finally { snapshot.close(); }
    await expect(connect().request("db.snapshot", { path: source, destination })).rejects.toMatchObject({ code: "EEXIST" });
    expect(database.prepare("SELECT id FROM sessions").all()).toEqual([{ id: "saved" }]);
  } finally { database.close(); }
});

it("reads Cursor WAL subagents through bounded read-only SQL without local database access", async () => {
  const nativeHome = join(directory, "home");
  const session = join(nativeHome, ".cursor", "acp-sessions", "child");
  await mkdir(session, { recursive: true });
  const file = join(session, "store.db"), db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE meta(key TEXT, value TEXT); CREATE TABLE blobs(id TEXT, data BLOB)");
    db.prepare("INSERT INTO meta VALUES ('0', ?)").run(JSON.stringify({ agentId: "child", subagentInfo: { parentAgentId: "parent", toolCallId: "tool-call" } }));
    db.prepare("INSERT INTO blobs VALUES ('message', ?)").run(Buffer.from(JSON.stringify({ role: "assistant", content: [{ type: "text", text: "from Linux store" }] })));
    const connection = connect();
    const rpc = { request: async <T>(op: string, params?: Record<string, unknown>) => {
      if (op === "env.info") return { home: nativeHome.replaceAll("\\", "/") } as T;
      return connection.request<T>(op, params);
    } };
    expect(await readWslCursorSubagents({ sessionId: "parent", toolCallIds: ["tool-call"] }, rpc))
      .toEqual([expect.objectContaining({ agentId: "child", steps: [expect.objectContaining({ text: "from Linux store" })] })]);
    expect(await readWslCursorSubagents({ sessionId: "parent", toolCallIds: ["tool-call"], knownRevisions: { child: "1" } }, rpc)).toEqual([]);
    await expect(connection.request("db.query", { path: file, sql: "DELETE FROM blobs" })).rejects.toThrow("SELECT");
    expect(db.prepare("SELECT COUNT(*) AS count FROM blobs").get()!.count).toBe(1);
  } finally { db.close(); }
});

it("returns binary exec output/nonzero status and kills timed out or oversized execs", async () => {
  const connection = connect();
  const output = await connection.request("exec", {
    command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout); process.exitCode=7"],
    stdin: "AP8=", encoding: "base64",
  });
  expect(output).toMatchObject({ stdout: "AP8=", code: 7 });
  await expect(connection.request("exec", { command: join(directory, "missing-command") })).rejects.toMatchObject({ code: "ENOENT" });
  await expect(connection.request("exec", { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], timeout: 30 })).rejects.toMatchObject({ code: "ETIMEDOUT" });
  await expect(connection.request("exec", { command: process.execPath, args: ["-e", "console.log('x'.repeat(10000))"], maxBuffer: 100 })).rejects.toThrow("maxBuffer");
});

it("limits HTTP to loopback and relays cancellable SSE streams", async () => {
  const connection = connect();
  const http = createServer((request, response) => {
    if (request.url === "/sse") { response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: one\n\n"); }
    else if (request.url === "/redirect") { response.writeHead(302, { location: "http://example.invalid/" }); response.end(); }
    else response.end("loopback");
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const address = http.address();
  const url = `http://127.0.0.1:${typeof address === "object" ? address!.port : 0}`;
  try {
    expect(await connection.request("net.http", { url })).toMatchObject({ status: 200, body: "loopback" });
    await expect(connection.request("net.http", { url: "http://example.invalid/" })).rejects.toThrow("loopback");
    await expect(connection.request("net.http", { url: `${url}/redirect` })).rejects.toThrow();
    const events: WslExecutionEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.request("net.sseOpen", { url: `${url}/sse`, stream: "events" });
    await waitFor(() => events.some((event) => event.kind === "sse" && event.data === "data: one\n\n"));
    await connection.request("net.sseClose", { stream: "events" });
    await waitFor(() => events.some((event) => event.kind === "sse-close"));
    expect(await connection.request("net.freePort")).toBeGreaterThan(0);
  } finally { http.closeAllConnections(); await new Promise<void>((done) => http.close(() => done())); }
});

it("relays bounded bidirectional TCP to granted Host endpoints and closes owned listeners", async () => {
  const active = new Set<Socket>();
  const target = createTcpServer({ allowHalfOpen: true }, socket => {
    active.add(socket); socket.on("close", () => active.delete(socket)); socket.on("error", () => {});
    socket.on("data", chunk => { if (!socket.write(chunk)) socket.pause(); });
    socket.on("drain", () => socket.resume()); socket.on("end", () => socket.end());
  });
  await new Promise<void>(done => target.listen(0, "127.0.0.1", done));
  const address = target.address();
  const endpoint = `127.0.0.1:${typeof address === "object" ? address!.port : 0}`;
  const connection = connect(), relay = new WslLoopbackRelay(connection);
  let lingering: Socket | undefined;
  try {
    await expect(relay.environment({ MONOCODE_CONTROL_ENDPOINT: "example.invalid:80" })).rejects.toThrow("loopback");
    const environment = await relay.environment({ MONOCODE_CONTROL_ENDPOINT: endpoint, MONOCODE_WORKFLOW_ENDPOINT: endpoint, UNCHANGED: "value" });
    expect(environment.MONOCODE_CONTROL_ENDPOINT).toBe(environment.MONOCODE_WORKFLOW_ENDPOINT);
    expect(environment.UNCHANGED).toBe("value");
    const port = Number(environment.MONOCODE_CONTROL_ENDPOINT.split(":")[1]);
    const bytes = Buffer.alloc(2 * 1024 * 1024, 187);
    const result = await new Promise<Buffer>((done, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const chunks: Buffer[] = [];
      socket.on("error", reject); socket.on("data", chunk => chunks.push(chunk));
      socket.on("connect", () => socket.end(bytes)); socket.on("end", () => done(Buffer.concat(chunks)));
    });
    expect(result).toEqual(bytes);
    await expect(connect().request("net.write", { stream: "unowned", data: "AA==" })).rejects.toThrow("does not belong");
    lingering = createConnection({ host: "127.0.0.1", port }); lingering.on("error", () => {});
    await waitFor(() => active.size > 0);
    await connection.close();
    await waitFor(() => active.size === 0 && lingering!.destroyed);
    await expect(new Promise((done, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); done(undefined); }); socket.once("error", reject);
    })).rejects.toMatchObject({ code: "ECONNREFUSED" });
  } finally {
    lingering?.destroy(); await relay.close();
    for (const socket of active) socket.destroy();
    await new Promise<void>(done => target.close(() => done()));
  }
});

it("retries only before delivery and reconnects without replaying a possibly executed request", async () => {
  let launches = 0;
  const undelivered = connect(() => ++launches === 1
    ? spawn(process.execPath, ["-e", "process.exit(1)"], { stdio: "pipe", windowsHide: true }) : bridge());
  expect(await undelivered.request("env.info")).toMatchObject({ platform: process.platform });
  expect(launches).toBe(2);
  const marker = join(directory, "delivered");
  launches = 0;
  const uncertain = connect(() => ++launches === 1
    ? spawn(process.execPath, ["-e", "const fs=require('fs');console.log(JSON.stringify({ready:1,service:'wsl-exec'}));process.stdin.once('data',()=>{fs.writeFileSync(process.argv[1],'once');process.exit(1)});", marker], { stdio: "pipe", windowsHide: true }) : bridge());
  await expect(uncertain.request("exec", { command: "irrelevant" })).rejects.toMatchObject({ delivered: true });
  expect(await readFile(marker, "utf8")).toBe("once");
  expect(launches).toBe(1);
  expect(await uncertain.request("env.info")).toMatchObject({ platform: process.platform });
  expect(launches).toBe(2);
});

it("replaces an idle previous runtime while refusing to replace one with a live connection", async () => {
  const previousRuntime = join(directory, "previous");
  await mkdir(previousRuntime);
  await copyFile(entry, join(previousRuntime, "wsl-exec.mjs"));
  await copyFile(resolve("host/wsl-exec-protocol.mjs"), join(previousRuntime, "wsl-exec-protocol.mjs"));
  const secondSocket = process.platform === "win32" ? `\\\\.\\pipe\\monocode-wsl-upgrade-${randomUUID()}` : join(directory, "upgrade.sock");
  const runDirectory = join(directory, "upgrade");
  const previous = spawn(process.execPath, [join(previousRuntime, "wsl-exec.mjs"), "serve", runDirectory, secondSocket], { stdio: "pipe", windowsHide: true });
  const exited = new Promise<void>((done) => previous.once("close", () => done()));
  const launch = () => spawn(process.execPath, [entry, "bridge", runDirectory, secondSocket], { stdio: "pipe", windowsHide: true });
  let current: WslConnection | undefined;
  try {
    await waitFor(async () => { try { await probeWslExec(secondSocket); return true; } catch { return false; } });
    const active = connect(launch);
    await active.request("env.info");
    await expect(prepareWslExec(runDirectory, secondSocket)).rejects.toThrow("still in use");
    await active.close();
    await prepareWslExec(runDirectory, secondSocket);
    await exited;
    current = connect(launch);
    const info = await current.request<{ pid: number }>("env.info");
    expect(info.pid).not.toBe(previous.pid);
    await current.request("service.shutdown");
    await current.close();
  } finally {
    previous.kill();
    await current?.close();
  }
});

it("matches process start time and boot ID before orphan cleanup", async () => {
  const registry = join(directory, "orphans");
  await mkdir(registry);
  for (const pid of [101, 102, 103]) await writeFile(join(registry, `${pid}.json`), JSON.stringify({ pid, startTime: "100", bootId: "boot" }));
  const killed: number[] = [];
  await cleanupOrphans(registry, {
    identify: async (pid) => ({ pid, startTime: pid === 102 ? "200" : "100", bootId: pid === 103 ? "new-boot" : "boot" }),
    kill: (pid) => { killed.push(pid); },
  });
  expect(killed).toEqual([101]);
  expect(await readdir(registry)).toEqual([]);
  const proc = join(directory, "proc");
  await mkdir(join(proc, "123"), { recursive: true });
  await mkdir(join(proc, "sys/kernel/random"), { recursive: true });
  await writeFile(join(proc, "123/stat"), `123 (name with ) parentheses) S ${Array(18).fill("0").join(" ")} 987654 0`);
  await writeFile(join(proc, "sys/kernel/random/boot_id"), "boot\n");
  expect(await processIdentity(123, proc)).toEqual({ pid: 123, startTime: "987654", bootId: "boot" });
});

it("decodes split UTF-8 and rejects oversized frames without emitting their tail", () => {
  const input = new PassThrough();
  const lines: string[] = [], errors: Error[] = [];
  readLines(input, (line) => lines.push(line), (error) => errors.push(error), 8);
  const bytes = Buffer.from("汉\n");
  input.write(bytes.subarray(0, 1)); input.write(bytes.subarray(1));
  input.write("123456789\ntail\n"); input.end();
  expect(lines).toEqual(["汉"]);
  expect(errors).toHaveLength(1);
  expect(new WslRequestError("uncertain", true).delivered).toBe(true);
});
