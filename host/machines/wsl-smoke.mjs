// Opt-in real Linux/WSL process test. Uses only a temporary run directory and
// this Node executable; does not install providers, start a Host or use accounts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeWslExec, processIdentity } from "../wsl-exec.mjs";
import { readLines } from "../wsl-exec-protocol.mjs";

if (process.platform !== "linux") throw new Error("Run this smoke test inside Linux or WSL");
const directory = await mkdtemp(join(tmpdir(), "monocode-wsl-exec-smoke-"));
const socket = join(directory, "rpc.sock");
const entry = fileURLToPath(new URL("../wsl-exec.mjs", import.meta.url));
const identities = [];
const daemons = [];
const connections = [];
const waitFor = async (predicate) => {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("WSL smoke test timed out");
    await new Promise((done) => setTimeout(done, 20));
  }
};
async function startDaemon() {
  const child = spawn(process.execPath, [entry, "serve", directory, socket], { stdio: ["ignore", "ignore", "inherit"] });
  daemons.push(child);
  await waitFor(async () => { try { await probeWslExec(socket, 500); return true; } catch { return false; } });
  return child;
}
async function connect() {
  const connection = createConnection(socket); connections.push(connection);
  const requests = new Map(), events = [];
  let id = 0;
  await new Promise((done, reject) => {
    connection.on("error", reject);
    readLines(connection, (line) => {
      const frame = JSON.parse(line);
      if (frame.ready) { done(); return; }
      if (frame.stream) { events.push(frame); return; }
      const pending = requests.get(frame.id); requests.delete(frame.id);
      if (frame.error) pending?.reject(new Error(frame.error.message));
      else pending?.resolve(frame.result);
    }, reject);
  });
  return {
    connection, events,
    request(op, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id; requests.set(requestId, { resolve, reject });
        connection.write(`${JSON.stringify({ ...params, op, id: requestId })}\n`);
      });
    },
  };
}
const alive = async (identity) => {
  try { const current = await processIdentity(identity.pid); return current.startTime === identity.startTime && current.bootId === identity.bootId; }
  catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
};
try {
  const daemon = await startDaemon();
  const client = await connect();
  assert.equal((await client.request("env.info")).platform, "linux");
  const prefixFile = join(directory, "prefix"), prefixLink = join(directory, "prefix-link");
  await writeFile(prefixFile, "bounded prefix"); await symlink(prefixFile, prefixLink);
  assert.equal(await client.request("fs.readPrefix", { path: prefixFile, maxBytes: 7, noFollow: true, encoding: "utf8" }), "bounded");
  await assert.rejects(client.request("fs.readPrefix", { path: prefixLink, maxBytes: 7, noFollow: true }), /symbolic links/);
  await assert.rejects(client.request("fs.readPrefix", { path: directory, maxBytes: 7, noFollow: true }), /not a regular/);
  await client.request("process.spawn", { stream: "large", command: process.execPath, args: ["-e", "console.log('汉'.repeat(3000000))"] });
  await waitFor(() => client.events.some((event) => event.stream === "large" && event.kind === "exit"));
  assert.equal(client.events.find((event) => event.stream === "large" && event.kind === "stdout").data.length, 3_000_000);
  const spawnPersistent = async (stream) => {
    const result = await client.request("process.spawn", { stream, command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
    const identity = await processIdentity(result.pid); identities.push(identity); return identity;
  };
  const killed = await spawnPersistent("kill");
  await client.request("process.kill", { stream: "kill" });
  await waitFor(async () => !await alive(killed));
  const orphan = await spawnPersistent("orphan");
  daemon.kill("SIGKILL");
  await new Promise((done) => daemon.once("close", done));
  assert.equal(await alive(orphan), true);
  await rm(socket, { force: true });
  await startDaemon();
  // A killed orphan may briefly remain a zombie until Linux init reaps it.
  await waitFor(async () => !await alive(orphan) || /\) Z /.test(await readFile(`/proc/${orphan.pid}/stat`, "utf8")));
  const connected = await connect();
  const disconnected = await connected.request("process.spawn", { stream: "disconnect", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
  const disconnectedIdentity = await processIdentity(disconnected.pid); identities.push(disconnectedIdentity);
  connected.connection.destroy();
  await waitFor(async () => !await alive(disconnectedIdentity));
  const migration = await connect();
  const legacyDirectory = join(directory, "legacy-data");
  await mkdir(legacyDirectory);
  await writeFile(join(legacyDirectory, "running.json"), JSON.stringify({ pid: process.pid, port: 1, secret: "fixture" }));
  await assert.rejects(migration.request("legacy.stop", { directory: legacyDirectory }), /PID no longer owns/);
  const mockHost = join(directory, "mock-host.mjs");
  await writeFile(mockHost, `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const server=createServer((request,response)=>{
      if(request.headers.authorization!=='Bearer fixture'){response.writeHead(403).end();return;}
      let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
        const {action}=JSON.parse(body);response.end('{}');
        if(action==='stop')server.close(()=>process.exit(0));
      });
    });
    server.listen(0,'127.0.0.1',()=>writeFileSync(join(process.argv[4],'running.json'),JSON.stringify({pid:process.pid,port:server.address().port,secret:'fixture'})));
  `);
  const legacy = spawn(process.execPath, [mockHost, "serve", "--data-dir", legacyDirectory], { stdio: ["ignore", "ignore", "inherit"] });
  daemons.push(legacy);
  await waitFor(async () => JSON.parse(await readFile(join(legacyDirectory, "running.json"), "utf8")).pid === legacy.pid);
  assert.deepEqual(await migration.request("legacy.stop", { directory: legacyDirectory }), { stopped: true, wasRunning: true });
  assert.equal(JSON.parse(await readFile(join(legacyDirectory, "running.json"), "utf8")).pid, legacy.pid);
  console.log("WSL execution smoke passed: Linux environment, 9 MB UTF-8 output, kill, crash/orphan cleanup, disconnect cleanup, authenticated legacy shutdown and PID mismatch rejection.");
} finally {
  for (const connection of connections) connection.destroy();
  for (const child of daemons) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.all(daemons.filter((child) => child.exitCode === null && child.signalCode === null).map((child) => new Promise((done) => child.once("close", done))));
  for (const identity of identities) if (await alive(identity)) { try { process.kill(-identity.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  await rm(directory, { recursive: true, force: true });
}
