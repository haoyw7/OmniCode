import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createServer, type AddressInfo } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
const exec = promisify(execFile);

it("starts shared Host automatically, imports history and reuses the owner and desktop credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-desktop-bootstrap-"));
  const desktop = join(directory, "desktop");
  mkdirSync(desktop);
  const legacy = new DatabaseSync(join(desktop, "monocode.db"));
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, harness TEXT, model TEXT,
    runtime_mode TEXT, title TEXT, blocks_json TEXT, created_at INTEGER, updated_at INTEGER);
    INSERT INTO sessions VALUES ('old', '${desktop.replaceAll("'", "''")}', 'codex', 'codex:test',
      'supervised', 'Desktop history', '[{"id":"user","role":"user","text":"Old desktop message"}]', 1, 2);`);
  legacy.close();
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  let binaryPaths = { codex: process.execPath };
  const run = (...args: string[]) =>
    exec(
      process.execPath,
      [
        resolve("build/host/monocode-host.mjs"),
        ...args,
        "--data-dir",
        directory,
        "--port",
        String(port),
      ],
      { timeout: 30_000, env: { ...process.env, MONOCODE_DESKTOP_BINARY_PATHS: JSON.stringify(binaryPaths) } },
    );
  try {
    const first = JSON.parse(
      (await run("desktop", "--desktop-data-dir", desktop)).stdout,
    );
    const state = JSON.parse(
      readFileSync(join(directory, "running.json"), "utf8"),
    );
    expect(first.sessions).toContainEqual({ id: "old", cwd: desktop });
    expect(first.token).toHaveLength(43);
    const providers = async () => {
      const response = await fetch(`${first.endpoint}/rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${first.token}` },
        body: JSON.stringify({ version: 1, method: "environment.describe", params: { supportedProviders: ["codex"] } }),
      });
      return (await response.json()).result.providers;
    };
    expect(await providers()).toContain("codex");
    binaryPaths = { codex: join(directory, "missing-codex.exe") };
    const second = JSON.parse(
      (await run("desktop", "--desktop-data-dir", desktop)).stdout,
    );
    expect(second.token).toBe(first.token);
    expect(await providers()).not.toContain("codex");
    expect(
      JSON.parse(readFileSync(join(directory, "running.json"), "utf8")).pid,
    ).toBe(state.pid);
    const response = await fetch(`${first.endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({
        version: 1,
        environmentId: first.environmentId,
        method: "sessions.sync",
        params: { sessionId: "old" },
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.value.session.blocks[0].text).toBe(
      "Old desktop message",
    );
    await fetch(`${first.endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first.token}` },
      body: JSON.stringify({
        version: 1,
        environmentId: first.environmentId,
        method: "sessions.delete",
        params: { projectId: first.projects[0].id, sessionId: "old" },
      }),
    });
    const reopened = JSON.parse(
      (await run("desktop", "--desktop-data-dir", desktop)).stdout,
    );
    expect(reopened.sessions).toContainEqual({
      id: "old",
      cwd: desktop,
      deleted: true,
    });
  } finally {
    if (existsSync(join(directory, "running.json"))) {
      await run("stop");
      await vi.waitFor(() =>
        expect(existsSync(join(directory, "running.json"))).toBe(false),
      );
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it("retirement bootstrap deletes imported copies without mutating the source or replaying cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-retirement-bootstrap-"));
  const desktop = join(directory, "desktop");
  mkdirSync(desktop);
  const legacy = new DatabaseSync(join(desktop, "monocode.db"));
  legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, harness TEXT, model TEXT,
    runtime_mode TEXT, title TEXT, blocks_json TEXT, created_at INTEGER, updated_at INTEGER)`);
  for (const id of ["legacy-lead", "legacy-worker", "ordinary"]) legacy.prepare("INSERT INTO sessions VALUES (?, ?, 'pi', 'pi:test', 'supervised', ?, '[]', 1, 2)").run(id, desktop, id);
  legacy.close();
  const manifestPath = join(desktop, "retirement.json");
  writeFileSync(manifestPath, JSON.stringify({ manifestId: "host-orchestration-v1", entries: [{ id: "legacy-lead", cwd: desktop, harness: "pi" }, { id: "legacy-worker", cwd: desktop, harness: "pi" }] }));
  const checkpoint = join(desktop, "retained-checkpoint.bin");
  writeFileSync(checkpoint, "keep");
  const probe = createServer();
  await new Promise<void>(done => probe.listen(0, "127.0.0.1", done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(done => probe.close(() => done()));
  const run = (...args: string[]) => exec(process.execPath, [resolve("build/host/monocode-host.mjs"), ...args, "--data-dir", directory, "--port", String(port)], { timeout: 30_000 });
  try {
    const first = JSON.parse((await run("desktop", "--desktop-data-dir", desktop)).stdout);
    expect(first.sessions).toHaveLength(3);
    const source = readFileSync(join(desktop, "monocode.db"));
    const retired = JSON.parse((await run("desktop", "--desktop-data-dir", desktop, "--legacy-orchestration-manifest", manifestPath)).stdout);
    expect(retired.sessions).toContainEqual({ id: "ordinary", cwd: desktop });
    expect(retired.sessions).toContainEqual({ id: "legacy-lead", cwd: desktop, deleted: true });
    expect(readFileSync(join(desktop, "monocode.db"))).toEqual(source);
    expect(readFileSync(checkpoint, "utf8")).toBe("keep");
    const rpc = async (method: string, params: unknown) => (await fetch(`${retired.endpoint}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${retired.token}` }, body: JSON.stringify({ version: 1, environmentId: retired.environmentId, method, params }) })).json();
    expect((await rpc("sessions.sync", { sessionId: "legacy-worker" })).error).toBeDefined();
    expect((await rpc("sessions.sync", { sessionId: "ordinary" })).result.value.session.id).toBe("ordinary");
    expect((await rpc("environment.describe", {})).result.capabilities).toContain("sessions.orchestration");
    await run("stop");
    await vi.waitFor(() => expect(existsSync(join(directory, "running.json"))).toBe(false));
    const reopened = JSON.parse((await run("desktop", "--desktop-data-dir", desktop, "--legacy-orchestration-manifest", manifestPath)).stdout);
    expect(reopened.token).toBe(first.token);
    expect(reopened.sessions.filter((row: {deleted?: boolean}) => !row.deleted)).toEqual([{ id: "ordinary", cwd: desktop }]);
  } finally {
    if (existsSync(join(directory, "running.json"))) {
      await run("stop");
      await vi.waitFor(() => expect(existsSync(join(directory, "running.json"))).toBe(false));
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
