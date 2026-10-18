import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, cp, link, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

import { WSL_EXEC_PROTOCOL, MAX_FRAME_BYTES, readLines } from "./wsl-exec-protocol.mjs";
export { WSL_EXEC_PROTOCOL, MAX_FRAME_BYTES, readLines } from "./wsl-exec-protocol.mjs";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const ownEntry = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const errorValue = (error) => ({ message: error.message ?? String(error), ...(error.code ? { code: error.code } : {}) });

export async function processIdentity(pid, procRoot = "/proc") {
  const [value, bootId] = await Promise.all([
    readFile(join(procRoot, String(pid), "stat"), "utf8"),
    readFile(join(procRoot, "sys/kernel/random/boot_id"), "utf8"),
  ]);
  // comm (field 2) may itself contain spaces and parentheses.
  const fields = value.slice(value.lastIndexOf(")") + 2).split(" ");
  if (!/^\d+$/.test(fields[19] ?? "")) throw new Error("Invalid Linux process identity");
  return { pid, startTime: fields[19], bootId: bootId.trim() };
}

/** Never signal a reused PID, or a process from a different Linux boot. */
export async function cleanupOrphans(directory, options = {}) {
  const identify = options.identify ?? processIdentity;
  const kill = options.kill ?? ((pid) => process.kill(-pid, "SIGKILL"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const path = join(directory, name);
    try {
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(saved.pid) || saved.pid < 2 || name !== `${saved.pid}.json`) continue;
      const current = await identify(saved.pid);
      if (current.startTime === saved.startTime && current.bootId === saved.bootId) await kill(saved.pid);
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error.code) && error instanceof SyntaxError === false)
        throw error;
    } finally { await rm(path, { force: true }); }
  }
}

function childEnvironment(overrides, loginPath) {
  const env = { ...process.env, ...(loginPath ? { PATH: loginPath } : {}) };
  for (const key of ["MONOCODE_CONTROL_ENDPOINT", "MONOCODE_CONTROL_TOKEN", "MONOCODE_APP_ENDPOINT", "MONOCODE_APP_TOKEN"])
    delete env[key];
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === null) delete env[key];
    else if (typeof value === "string") env[key] = value;
    else throw new Error(`Invalid environment value: ${key}`);
  }
  return env;
}

function loopbackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password)
    throw new Error("WSL HTTP is limited to loopback addresses");
  return url;
}

const encodingOf = (value, fallback = "base64") => {
  if (value === undefined) return fallback;
  if (value !== "utf8" && value !== "base64") throw new Error("Unsupported encoding");
  return value;
};

async function atomicWrite(path, bytes, mode, exclusive = false) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let handle;
  try {
    // Preserve the existing file's permissions unless the caller changes them.
    if (mode === undefined) {
      try { mode = (await stat(path)).mode & 0o777; } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    handle = await open(temporary, "wx", mode ?? 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = undefined;
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function listDirectory(path, recursive, prefix = "") {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(path, entry.name);
    result.push({ name, path: absolute, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymbolicLink: entry.isSymbolicLink() });
    if (recursive && entry.isDirectory()) result.push(...await listDirectory(absolute, true, name));
  }
  return result;
}

/** Execution only: no account, session, workspace database, or provider policy. */
export async function createWslExecServer({ socket, runDirectory }) {
  const registry = join(runDirectory, "children");
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const sessions = new Set();
  const connections = new Set();
  const cleaning = new Set();
  let loginPath;
  const getPath = () => loginPath ??= new Promise((done) => {
    if (process.platform === "win32") { done(process.env.PATH ?? ""); return; }
    const shell = spawn(process.env.SHELL || "/bin/sh", ["-l", "-c", "printf '\\0%s\\0' \"$PATH\""], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => shell.kill("SIGKILL"), 10_000);
    shell.stdout.on("data", (chunk) => { if (output.length < 1024 * 1024) output += chunk; });
    shell.on("error", () => { clearTimeout(timer); done(process.env.PATH ?? ""); });
    shell.on("close", () => { clearTimeout(timer); done(output.split("\0")[1] || process.env.PATH || ""); });
  });
  let accepting = false, shutdown;
  const server = createServer((connection) => {
    connections.add(connection);
    connection.on("close", () => connections.delete(connection));
    if (!accepting) { connection.destroy(); return; }
    const children = new Map(), handles = new Map(), streams = new Map(), listeners = new Map(), tunnels = new Map();
    let closed = false, closing;
    const send = (frame) => {
      if (closed || connection.destroyed) return;
      const data = `${JSON.stringify(frame)}\n`;
      if (Buffer.byteLength(data) > MAX_FRAME_BYTES || connection.writableLength > MAX_FRAME_BYTES * 2) {
        connection.destroy(new Error("WSL execution client is not consuming output"));
        return;
      }
      connection.write(data);
    };
    const event = (stream, kind, data) => send({ stream, kind, data });
    const signal = (record, value) => {
      if (!Number.isSafeInteger(record.child.pid) || record.child.pid < 2) return;
      try {
        if (process.platform === "win32") record.child.kill(value);
        else process.kill(-record.child.pid, value);
      } catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    const stop = async (record) => {
      signal(record, "SIGTERM");
      let timer;
      await Promise.race([record.done, new Promise((done) => { timer = setTimeout(done, 500); })]);
      clearTimeout(timer);
      // Also end descendants which kept running after the group leader exited.
      signal(record, "SIGKILL");
      await record.done;
    };
    const close = () => {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        for (const controller of streams.values()) controller.abort();
        for (const { socket } of tunnels.values()) socket.destroy();
        await Promise.all([...listeners.values()].map(server => new Promise(done => server.close(done))));
        listeners.clear(); tunnels.clear();
        await Promise.allSettled([...children.values()].map(stop));
        await Promise.allSettled([...handles.values()].map(async (record) => { try { await record.queue; } finally { await record.handle.close(); } }));
        sessions.delete(close);
      })();
      cleaning.add(closing);
      void closing.then(() => cleaning.delete(closing), () => cleaning.delete(closing));
      return closing;
    };
    sessions.add(close);
    connection.on("error", () => {});
    connection.on("close", close);

    const launch = async (params, emitOutput = true, onSpawn) => {
      if (closed) throw new Error("Execution connection closed");
      const stream = params.stream ?? randomUUID();
      if (typeof stream !== "string" || children.has(stream)) throw new Error("Process stream already exists or is invalid");
      if (typeof params.command !== "string" || !params.command || (params.args && (!Array.isArray(params.args) || params.args.some((arg) => typeof arg !== "string"))))
        throw new Error("Invalid process command");
      const env = childEnvironment(params.env, await getPath());
      if (closed) throw new Error("Execution connection closed");
      const child = spawn(params.command, params.args ?? [], { cwd: params.cwd, env, detached: process.platform !== "win32", stdio: "pipe", windowsHide: true });
      let complete;
      const record = { child, done: new Promise((done) => { complete = done; }), ended: false, file: undefined, error: undefined };
      children.set(stream, record);
      const cleanup = async (code, exitSignal) => {
        if (record.ended) return;
        record.ended = true;
        // A provider may leave tool grandchildren behind when it exits first.
        // Their process group is still ours even after its leader has exited.
        if (process.platform !== "win32") signal(record, "SIGKILL");
        children.delete(stream);
        if (record.file) await rm(record.file, { force: true });
        if (emitOutput) event(stream, "exit", { code, signal: exitSignal, pid: child.pid, ...(record.error ? { error: record.error } : {}) });
        complete({ code, signal: exitSignal });
      };
      child.on("error", (error) => { record.error = error.message; });
      child.on("close", cleanup);
      child.stdin.on("error", () => {});
      onSpawn?.(record);
      if (emitOutput) {
        for (const [kind, maximum] of [["stdout", MAX_OUTPUT_BYTES], ["stderr", MAX_DIAGNOSTIC_BYTES]])
          readLines(child[kind], (line) => event(stream, kind, line), (error) => { record.error = error.message; signal(record, "SIGKILL"); }, maximum);
      }
      try {
        await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); });
        if (process.platform !== "win32") {
          try {
            const identity = await processIdentity(child.pid);
            record.file = join(registry, `${child.pid}.json`);
            await atomicWrite(record.file, JSON.stringify(identity), 0o600);
            if (record.ended) await rm(record.file, { force: true });
          } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) { await stop(record); throw error; } }
        }
        if (closed) await stop(record);
        return { stream, record };
      } catch (error) { await record.done; throw error; }
    };
    const getChild = (stream) => {
      const record = children.get(stream);
      if (!record) throw new Error("Process does not belong to this connection");
      return record;
    };
    const execute = async (params) => {
      const chunks = { stdout: [], stderr: [] };
      const maximum = params.maxBuffer ?? MAX_OUTPUT_BYTES;
      let size = 0, failure;
      const { record } = await launch(params, false, (record) => {
        // Subscribe before /proc registration yields: short-lived commands can
        // finish and drain their pipes while their ownership file is written.
        for (const kind of ["stdout", "stderr"])
          record.child[kind].on("data", (chunk) => {
            size += chunk.length;
            if (size > maximum) { failure = new Error("WSL exec output exceeds maxBuffer"); signal(record, "SIGKILL"); }
            else chunks[kind].push(chunk);
          });
      });
      const timer = params.timeout ? setTimeout(() => { failure = Object.assign(new Error("WSL exec timed out"), { code: "ETIMEDOUT" }); signal(record, "SIGKILL"); }, params.timeout) : undefined;
      record.child.stdin.end(params.stdin === undefined ? undefined : Buffer.from(params.stdin, encodingOf(params.encoding, "utf8")));
      const result = await record.done;
      clearTimeout(timer);
      if (failure) throw failure;
      const encoding = encodingOf(params.encoding, "utf8");
      return { ...result, stdout: Buffer.concat(chunks.stdout).toString(encoding), stderr: Buffer.concat(chunks.stderr).toString(encoding) };
    };
    const request = async (params) => {
      switch (params.op) {
        case "service.shutdown": {
          if (sessions.size > 1 || children.size || handles.size || streams.size || listeners.size || tunnels.size)
            throw Object.assign(new Error("The previous WSL execution runtime is still in use"), { code: "EBUSY" });
          // The response must reach the preparing Host before its socket closes.
          setTimeout(() => { void shutdown(); }, 20);
          return null;
        }
        case "legacy.stop": {
          if (process.platform !== "linux") throw new Error("Legacy WSL Host shutdown requires Linux");
          const directory = await realpath(params.directory);
          let running;
          try { running = JSON.parse(await readFile(join(directory, "running.json"), "utf8")); }
          catch (error) { if (error.code === "ENOENT") return { stopped: true, wasRunning: false }; throw error; }
          if (!Number.isSafeInteger(running.pid) || running.pid < 2 || !Number.isInteger(running.port) || running.port < 1 || running.port > 65535 || typeof running.secret !== "string" || !running.secret)
            throw new Error("Invalid legacy Host ownership record");
          let identity, args;
          try {
            identity = await processIdentity(running.pid);
            args = (await readFile(`/proc/${running.pid}/cmdline`, "utf8")).split("\0");
          } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return { stopped: true, wasRunning: false }; throw error; }
          const index = args.indexOf("--data-dir");
          if (!args.includes("serve") || index < 0 || await realpath(args[index + 1]) !== directory)
            throw new Error("Legacy Host PID no longer owns this data directory");
          for (const action of ["status", "stop"]) {
            const response = await fetch(`http://127.0.0.1:${running.port}/lifecycle`, {
              method: "POST", headers: { Authorization: `Bearer ${running.secret}`, "Content-Type": "application/json" },
              body: JSON.stringify({ action }), redirect: "error", signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error("Could not verify and stop the legacy WSL Host");
            await response.arrayBuffer();
          }
          for (let attempt = 0; attempt < 150; attempt++) {
            try {
              const current = await processIdentity(running.pid);
              if (current.startTime !== identity.startTime || current.bootId !== identity.bootId) return { stopped: true, wasRunning: true };
            } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return { stopped: true, wasRunning: true }; throw error; }
            await delay(200);
          }
          throw new Error("Legacy WSL Host is still stopping; retry import after it exits");
        }
        case "db.snapshot": {
          const source = await realpath(params.path);
          const destination = resolve(params.destination ?? `${params.path}.import-${randomUUID()}.db`);
          if (source === destination) throw new Error("A database snapshot cannot replace its source");
          const { DatabaseSync, backup } = await import("node:sqlite");
          // Reserve a new output path. Never overwrite an existing database or
          // follow a destination symlink back into the source database.
          const reservation = await open(destination, "wx", 0o600);
          await reservation.close();
          let database;
          try {
            database = new DatabaseSync(source, { readOnly: true });
            database.exec("PRAGMA busy_timeout=5000");
            await backup(database, destination);
            return { path: destination, size: (await stat(destination)).size };
          } catch (error) { await rm(destination, { force: true }); throw error; }
          finally { database?.close(); }
        }
        case "db.query": {
          if (typeof params.sql !== "string" || !/^\s*SELECT\b/i.test(params.sql) || !Array.isArray(params.params ?? [])) throw new Error("Only read-only SELECT queries are available");
          const { DatabaseSync } = await import("node:sqlite");
          const database = new DatabaseSync(params.path, { readOnly: true });
          try {
            database.exec("PRAGMA busy_timeout=100; PRAGMA query_only=ON");
            const rows = []; let size = 0;
            for (const source of database.prepare(params.sql).iterate(...(params.params ?? []))) {
              const row = Object.fromEntries(Object.entries(source).map(([key, value]) =>
                [key, value instanceof Uint8Array ? { $base64: Buffer.from(value).toString("base64") } : value]));
              const bytes = Buffer.byteLength(JSON.stringify(row));
              if (bytes > 16 * 1024 * 1024) throw new Error("SQLite row exceeds output limit");
              if (rows.length && size + bytes > 16 * 1024 * 1024) break;
              rows.push(row); size += bytes;
              if (rows.length >= 256) break;
            }
            return rows;
          } finally { database.close(); }
        }
        case "env.path": return getPath();
        case "env.info": return { platform: process.platform, arch: process.arch, home: process.env.HOME, node: process.execPath, pid: process.pid, path: await getPath() };
        case "process.spawn": { const { stream, record } = await launch(params); return { stream, pid: record.child.pid }; }
        case "process.write": {
          const child = getChild(params.stream).child;
          await new Promise((done, reject) => child.stdin.write(Buffer.from(params.data, encodingOf(params.encoding, "utf8")), (error) => error ? reject(error) : done()));
          return null;
        }
        case "process.closeStdin": getChild(params.stream).child.stdin.end(); return null;
        case "process.kill": { const record = children.get(params.stream); if (record) await stop(record); return null; }
        case "process.killAll": await Promise.all([...children.values()].map(stop)); return null;
        case "exec": return execute(params);
        case "fs.stat": {
          const info = await (params.followSymlinks === false ? lstat : stat)(params.path);
          return { isFile: info.isFile(), isDirectory: info.isDirectory(), isSymbolicLink: info.isSymbolicLink(), size: info.size, mtimeMs: info.mtimeMs, mode: info.mode };
        }
        case "fs.readFile": return (await readFile(params.path)).toString(encodingOf(params.encoding));
        case "fs.readlink": return readlink(params.path);
        case "fs.hash": {
          if (params.algorithm !== "sha256") throw new Error("Unsupported file hash algorithm");
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(params.path)) hash.update(chunk);
          return hash.digest("hex");
        }
        case "fs.readPrefix": {
          if (!Number.isSafeInteger(params.maxBytes) || params.maxBytes < 0 || params.maxBytes > MAX_OUTPUT_BYTES) throw new Error("Invalid prefix length");
          if (params.noFollow && !constants.O_NOFOLLOW) throw new Error("No-follow reads are unavailable on this platform");
          const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (params.noFollow ? constants.O_NOFOLLOW : 0);
          const handle = await open(params.path, flags);
          try {
            if (!(await handle.stat()).isFile()) throw new Error("File is not a regular readable file");
            const buffer = Buffer.alloc(params.maxBytes);
            const { bytesRead } = await handle.read(buffer, 0, params.maxBytes, 0);
            return buffer.subarray(0, bytesRead).toString(encodingOf(params.encoding));
          } finally { await handle.close(); }
        }
        case "fs.readFiles": return Promise.all(params.paths.map(async (path) => ({ path, data: (await readFile(path)).toString(encodingOf(params.encoding)) })));
        case "fs.writeFile": await atomicWrite(params.path, Buffer.from(params.data, encodingOf(params.encoding)), params.mode, params.flag === "wx"); return null;
        case "fs.readdir": return listDirectory(params.path, params.recursive);
        case "fs.mkdir": await mkdir(params.path, { recursive: params.recursive ?? false, mode: params.mode }); return null;
        case "fs.rm": await rm(params.path, { recursive: params.recursive ?? false, force: params.force ?? false }); return null;
        case "fs.rename": await rename(params.path, params.destination); return null;
        case "fs.cp": await cp(params.path, params.destination, { recursive: params.recursive ?? false, errorOnExist: params.errorOnExist ?? false, force: params.force ?? !params.errorOnExist }); return null;
        case "fs.chmod": await chmod(params.path, params.mode); return null;
        case "fs.realpath": return realpath(params.path);
        case "fs.appendOpen": {
          const id = randomUUID();
          const handle = await open(params.path, "a", params.mode ?? 0o600);
          if (closed) { await handle.close(); throw new Error("Execution connection closed"); }
          handles.set(id, { handle, queue: Promise.resolve() });
          return id;
        }
        case "fs.append": {
          const record = handles.get(params.handle);
          if (!record) throw new Error("Append handle does not belong to this connection");
          const bytes = Buffer.from(params.data, encodingOf(params.encoding, "utf8"));
          record.queue = record.queue.then(() => record.handle.writeFile(bytes));
          await record.queue;
          return null;
        }
        case "fs.appendClose": {
          const record = handles.get(params.handle);
          if (record) { handles.delete(params.handle); try { await record.queue; } finally { await record.handle.close(); } }
          return null;
        }
        case "net.listen": {
          if (typeof params.stream !== "string" || listeners.has(params.stream) || listeners.size >= 16) throw new Error("Invalid or excessive relay listener");
          const listener = createServer({ allowHalfOpen: true }, socket => {
            if (closed || tunnels.size >= 128) { socket.destroy(); return; }
            const stream = randomUUID();
            tunnels.set(stream, { socket, listener: params.stream });
            socket.pause();
            socket.on("data", chunk => {
              socket.pause();
              event(stream, "tcp-data", chunk.toString("base64"));
            });
            socket.on("end", () => event(stream, "tcp-end", null));
            socket.on("error", () => {});
            socket.on("close", () => { tunnels.delete(stream); event(stream, "tcp-close", null); });
            event(params.stream, "tcp-open", { stream });
          });
          listeners.set(params.stream, listener);
          try {
            await new Promise((done, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", done); });
            if (closed) { listener.close(); throw new Error("Execution connection closed"); }
            return { port: listener.address().port };
          } catch (error) { listeners.delete(params.stream); throw error; }
        }
        case "net.close": {
          const listener = listeners.get(params.stream);
          if (listener) {
            listeners.delete(params.stream);
            for (const record of tunnels.values()) if (record.listener === params.stream) record.socket.destroy();
            await new Promise(done => listener.close(done));
          }
          return null;
        }
        case "net.ack": tunnels.get(params.stream)?.socket.resume(); return null;
        case "net.write": {
          const record = tunnels.get(params.stream);
          if (!record) throw new Error("TCP stream does not belong to this connection");
          if (typeof params.data !== "string" || params.data.length > 90_000) throw new Error("TCP frame exceeds limit");
          const bytes = Buffer.from(params.data, "base64");
          if (bytes.length > 65_536 || record.socket.writableLength > 2 * 1024 * 1024) throw new Error("TCP relay is not consuming output");
          await new Promise((done, reject) => record.socket.write(bytes, error => error ? reject(error) : done()));
          return null;
        }
        case "net.end": {
          const record = tunnels.get(params.stream);
          if (record) { if (params.destroy) record.socket.destroy(); else record.socket.end(); }
          return null;
        }
        case "net.freePort": return new Promise((done, reject) => {
          const probe = createServer();
          probe.once("error", reject);
          probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => done(address.port)); });
        });
        case "net.http": {
          const url = loopbackUrl(params.url);
          const controller = new AbortController();
          const id = randomUUID(); streams.set(id, controller);
          const timer = setTimeout(() => controller.abort(), params.timeout ?? 30_000);
          try {
            const response = await fetch(url, { method: params.method ?? "GET", headers: params.headers, body: params.body, redirect: "error", signal: controller.signal });
            const chunks = []; let size = 0;
            for await (const chunk of response.body ?? []) {
              size += chunk.length;
              if (size > MAX_OUTPUT_BYTES) throw new Error("WSL HTTP response exceeds output limit");
              chunks.push(chunk);
            }
            return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.concat(chunks).toString(encodingOf(params.encoding, "utf8")) };
          } finally { clearTimeout(timer); controller.abort(); streams.delete(id); }
        }
        case "net.sseOpen": {
          const url = loopbackUrl(params.url), stream = params.stream ?? randomUUID();
          if (streams.has(stream)) throw new Error("SSE stream already exists");
          const controller = new AbortController(); streams.set(stream, controller);
          const response = await fetch(url, { headers: params.headers, redirect: "error", signal: controller.signal }).catch((error) => { streams.delete(stream); throw error; });
          if (!response.ok) { controller.abort(); streams.delete(stream); throw new Error(`WSL SSE HTTP ${response.status}`); }
          void (async () => {
            const decoder = new StringDecoder("utf8");
            try { for await (const chunk of response.body ?? []) event(stream, "sse", decoder.write(chunk)); event(stream, "sse", decoder.end()); }
            catch (error) { if (!controller.signal.aborted) event(stream, "sse-error", error.message); }
            finally { streams.delete(stream); event(stream, "sse-close", null); }
          })();
          return { stream };
        }
        case "net.sseClose": streams.get(params.stream)?.abort(); return null;
        default: throw new Error(`Unsupported execution operation: ${params.op}`);
      }
    };
    readLines(connection, (line) => {
      let frame;
      try { frame = JSON.parse(line); } catch { connection.destroy(); return; }
      if (!Number.isSafeInteger(frame?.id) || typeof frame.op !== "string") { connection.destroy(); return; }
      // A reconnect must not mutate a checkout while its previous connection's
      // provider process is still being terminated.
      void Promise.allSettled([...cleaning]).then(() => {
        if (closed) throw new Error("Execution connection closed");
        return request(frame);
      }).then((result) => send({ id: frame.id, result }), (error) => send({ id: frame.id, error: errorValue(error) }));
    }, () => connection.destroy());
    send({ ready: WSL_EXEC_PROTOCOL, service: "wsl-exec", runtime: ownEntry, connections: sessions.size - 1 });
  });
  // Binding precedes orphan cleanup: a second daemon must not kill live children.
  await new Promise((done, reject) => { server.once("error", reject); server.listen(socket, done); });
  try {
    if (process.platform !== "win32") await chmod(socket, 0o600);
    if (process.platform !== "win32") await cleanupOrphans(registry);
    else await mkdir(registry, { recursive: true });
    accepting = true;
  } catch (error) { server.close(); throw error; }
  shutdown = async () => {
      accepting = false;
      const stopped = new Promise((done) => server.close(done));
      await Promise.allSettled([...sessions].map((close) => close()));
      // The connection remains owned by its bridge until it observes EOF.
      for (const connection of connections) connection.destroy();
      await stopped;
  };
  return { server, close: shutdown };
}

export async function probeWslExec(socket, timeout = 2000) {
  return new Promise((done, reject) => {
    const client = createConnection(socket);
    let finished = false;
    const timer = setTimeout(() => { client.destroy(); reject(new Error("Execution service did not identify itself")); }, timeout);
    const finish = (error, frame) => { if (finished) return; finished = true; clearTimeout(timer); client.destroy(); error ? reject(error) : done(frame); };
    client.once("error", finish);
    client.once("close", () => { if (!finished) finish(Object.assign(new Error("Execution service is not ready"), { code: "ECONNREFUSED" })); });
    readLines(client, (line) => {
      try {
        const frame = JSON.parse(line);
        finish(frame.ready === WSL_EXEC_PROTOCOL && frame.service === "wsl-exec" ? undefined : new Error("Socket belongs to another service"), frame);
      } catch { finish(new Error("Socket belongs to another service")); }
    }, finish, 4096);
  });
}

export async function prepareWslExec(runDirectory, socket) {
  try {
    const running = await probeWslExec(socket);
    if (running.runtime === ownEntry) return;
    if (running.connections) throw new Error("The previous WSL runtime is still in use; close its desktop before upgrading");
    await new Promise((done, reject) => {
      const client = createConnection(socket);
      const timer = setTimeout(() => { client.destroy(); reject(new Error("Previous WSL runtime did not stop")); }, 5000);
      client.once("error", reject);
      readLines(client, (line) => {
        const frame = JSON.parse(line);
        if (frame.ready) client.write(`${JSON.stringify({ id: 1, op: "service.shutdown" })}\n`);
        else if (frame.error) { clearTimeout(timer); client.destroy(); reject(new Error(frame.error.message)); }
      }, reject);
      client.once("close", () => { clearTimeout(timer); done(); });
    });
  }
  catch (error) { if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error; }
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await rm(socket, { force: true });
  const log = await open(join(runDirectory, "exec.log"), "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [ownEntry, "serve", runDirectory, socket], { detached: true, stdio: ["ignore", log.fd, log.fd], windowsHide: true });
    await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); });
    child.unref();
  } finally { await log.close(); }
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await probeWslExec(socket); return; } catch (error) {
      if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
    }
    await delay(50);
  }
  throw new Error("Could not start the WSL execution service");
}

/** No request is written until the daemon's ready frame reaches the Host. */
export function bridgeWslExec(socket, input = process.stdin, output = process.stdout) {
  return new Promise((done, reject) => {
    const client = createConnection(socket);
    client.once("error", reject);
    client.once("connect", () => { input.pipe(client); client.pipe(output, { end: false }); });
    const end = () => client.end();
    input.once("end", end);
    client.once("close", () => { input.unpipe(client); input.off("end", end); input.pause(); done(); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === ownEntry) {
  const [command, runDirectory, socket] = process.argv.slice(2);
  const main = async () => {
    if (!runDirectory || !socket) throw new Error("Use prepare, serve, or bridge with run directory and socket");
    if (command === "prepare") await prepareWslExec(runDirectory, socket);
    else if (command === "bridge") { await bridgeWslExec(socket); process.stdout.end(() => process.exit(0)); }
    else if (command === "serve") {
      const service = await createWslExecServer({ runDirectory, socket });
      let stopping = false;
      const stop = () => { if (!stopping) { stopping = true; void service.close().finally(() => process.exit(0)); } };
      process.on("SIGTERM", stop); process.on("SIGINT", stop);
    } else throw new Error("Unknown WSL execution command");
  };
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
