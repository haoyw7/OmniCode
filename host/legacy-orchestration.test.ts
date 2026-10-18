import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { importDesktopSessions } from "./desktop-import";
import { readLegacyRetirementManifest, type LegacyRetirementManifest } from "./legacy-orchestration";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "monocode-legacy-retire-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "monocode.db");
  const source = new DatabaseSync(path);
  source.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, harness TEXT, model TEXT,
    runtime_mode TEXT, title TEXT, blocks_json TEXT, created_at INTEGER, updated_at INTEGER)`);
  for (const id of ["old-lead", "old-worker", "ordinary"]) source.prepare("INSERT INTO sessions VALUES (?, ?, 'pi', 'pi:test', 'supervised', ?, '[]', 1, 2)").run(id, directory, id);
  source.close();
  const store = new HostStore(join(directory, "host.db"));
  const provider = { send: vi.fn(async () => {}), stop: vi.fn(async () => {}), cancel: vi.fn(async () => {}), bind: vi.fn(), approve: vi.fn(), answer: vi.fn() };
  const engine = new HostEngine(store, { pi: provider });
  cleanup.push(async () => { await engine.close(); store.close(); });
  const manifest: LegacyRetirementManifest = { manifestId: "host-orchestration-v1",
    sourceKey: createHash("sha256").update(resolve(path)).digest("hex"),
    entries: [{ id: "old-lead", cwd: directory, harness: "pi" }, { id: "old-worker", cwd: directory, harness: "pi" }, { id: "missing-worker" }] };
  return { directory, path, store, engine, provider, manifest };
}

it("derives the source identity locally and rejects changed/invalid native manifests", () => {
  const { directory } = fixture();
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify({ manifestId: "host-orchestration-v1", sourceKey: "untrusted", entries: [{ id: "old-lead" }] }));
  expect(readLegacyRetirementManifest(path, directory).sourceKey).toBe(createHash("sha256").update(resolve(join(directory, "monocode.db"))).digest("hex"));
  for (const value of [{ manifestId: "other", entries: [] }, { manifestId: "host-orchestration-v1", entries: [{ id: "../path" }] }, { manifestId: "host-orchestration-v1", entries: [{ id: "same" }, { id: "same" }] }, { manifestId: "host-orchestration-v1", entries: [{ id: "old", cwd: 42 }] }]) {
    writeFileSync(path, JSON.stringify(value));
    expect(() => readLegacyRetirementManifest(path, directory)).toThrow();
  }
});

it("removes imported copies once, preserves the source/files and permanently prevents reimport", async () => {
  const { directory, path, store, engine, provider, manifest } = fixture();
  await engine.ready;
  expect(importDesktopSessions(store, path)).toBe(3);
  const original = readFileSync(path);
  const kept = join(directory, "retained-checkpoint.bin");
  writeFileSync(kept, "keep worktree data");
  const oldSnapshot = store.session("old-lead");
  await expect(engine.retireLegacyOrchestration(manifest)).resolves.toEqual({ retired: true });
  expect(store.sessions().map(row => row.session.id)).toEqual(["ordinary"]);
  expect(provider.stop.mock.calls.map(args => args[0]).sort()).toEqual(["old-lead", "old-worker"]);
  expect(readFileSync(path)).toEqual(original);
  expect(readFileSync(kept, "utf8")).toBe("keep worktree data");
  expect(() => store.save(oldSnapshot, { type: "late.providerEvent" })).toThrow();
  expect(importDesktopSessions(store, path)).toBe(0);
  await engine.retireLegacyOrchestration(manifest);
  expect(provider.stop).toHaveBeenCalledTimes(2);
  await expect(engine.retireLegacyOrchestration({ ...manifest, entries: [...manifest.entries, { id: "ordinary" }] })).rejects.toThrow("manifest changed");
  expect(store.session("ordinary").session.id).toBe("ordinary");
});

it("retries after a failed targeted stop without interrupting ordinary sessions or partial deletion", async () => {
  const { path, store, engine, provider, manifest } = fixture();
  await engine.ready;
  importDesktopSessions(store, path);
  provider.stop.mockRejectedValueOnce(new Error("process still running"));
  await expect(engine.retireLegacyOrchestration(manifest)).rejects.toThrow("process still running");
  expect(store.sessions()).toHaveLength(3);
  await engine.retireLegacyOrchestration(manifest);
  expect(store.sessions().map(row => row.session.id)).toEqual(["ordinary"]);
  expect(provider.stop.mock.calls.every(args => args[0] !== "ordinary")).toBe(true);
});

it("validates every Host identity before stopping any same-ID foreign conversation", async () => {
  const { path, store, engine, provider, manifest } = fixture();
  await engine.ready;
  importDesktopSessions(store, path);
  store.db.prepare("DELETE FROM metadata WHERE key=?").run(`desktop-import:${manifest.sourceKey}:old-worker`);
  await expect(engine.retireLegacyOrchestration({ ...manifest, entries: [{ id: "old-lead" }, { id: "old-worker", cwd: "/another-machine", harness: "pi" }] })).rejects.toThrow("identity could not be verified");
  expect(provider.stop).not.toHaveBeenCalled();
  expect(store.sessions()).toHaveLength(3);
});
