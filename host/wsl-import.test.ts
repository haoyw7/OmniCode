import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { importWslSnapshot } from "./wsl-import";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "monocode-wsl-import-test-"));
  const source = new HostStore(join(root, "source.db"));
  const target = new HostStore(join(root, "target.db"));
  const project = source.addProject("/home/dev/repo", "Linux repository");
  const value = source.save({
    projectId: project.id, revision: 7, status: "running", runId: "old-run", updatedAt: 123,
    session: { id: "old-session", cwd: project.cwd, harness: "codex", model: "codex:test", runtimeMode: "supervised", title: "Kept title", blocks: [] },
  }, { type: "fixture" });
  cleanups.push(async () => { source.close(); target.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, target, value, machine: { kind: "wsl" as const, distribution: "Ubuntu" } };
}

it("imports history and checkpoint indexes idempotently, preserving the source and later deletions", async () => {
  const { root, source, target, machine } = await fixture();
  const staged = join(root, "stage");
  const original = JSON.stringify({ cwd: "/home/dev/repo", files: ["app.ts"] });
  await mkdir(join(staged, "checkpoints", "old-session"), { recursive: true });
  await mkdir(join(staged, "attachments"));
  await writeFile(join(staged, "attachments", "image-1"), "image bytes");
  await writeFile(join(staged, "checkpoints", "old-session", "index.json"), original);
  const before = source.session("old-session");
  expect(await importWslSnapshot(target, source.databasePath, machine, staged)).toEqual({ projects: 1, sessions: 1 });
  const imported = target.session("old-session");
  expect(imported).toMatchObject({ status: "interrupted", revision: 8, session: { title: "Kept title" } });
  expect(imported.runId).toBeUndefined();
  expect(target.project(imported.projectId)).toMatchObject({ cwd: "/home/dev/repo", machine });
  expect(JSON.parse(await readFile(join(root, "checkpoints", "old-session", "index.json"), "utf8")))
    .toMatchObject({ cwd: "/home/dev/repo", machine: "wsl:Ubuntu" });
  expect(await readFile(join(staged, "checkpoints", "old-session", "index.json"), "utf8")).toBe(original);
  expect(await readFile(join(target.attachmentDir, "image-1"), "utf8")).toBe("image bytes");
  expect(source.session("old-session")).toEqual(before);
  expect(await importWslSnapshot(target, source.databasePath, machine, staged)).toEqual({ projects: 1, sessions: 0 });
  target.deleteSession("old-session");
  expect((await importWslSnapshot(target, source.databasePath, machine, staged)).sessions).toBe(0);
  expect(target.sessionIfExists("old-session")).toBeUndefined();
});

it("rejects collisions before changing destination projects or conversations", async () => {
  const { source, target, machine, value } = await fixture();
  const existing = target.addProject(process.cwd(), "Desktop");
  target.save({ ...value, projectId: existing.id, status: "idle", session: { ...value.session, cwd: existing.cwd, title: "Desktop title" } }, { type: "fixture" });
  await expect(importWslSnapshot(target, source.databasePath, machine)).rejects.toThrow("collision");
  expect(target.projects()).toEqual([existing]);
  expect(target.session("old-session").session.title).toBe("Desktop title");
});

it("archives detached worker history and pauses migrated queued attachments", async () => {
  const { source, target, machine, value } = await fixture();
  source.save({ ...value, revision: value.revision + 1, session: { ...value.session,
    orchestrationLeadId: "old-lead", workflowParentId: "old-parent", workflowRunId: "old-workflow",
    queueStatus: "active", queuedMessages: [{ id: "queued", text: "Next", attachments: [{
      id: "image-1", path: "/home/dev/.monocode/remote/data/attachments/image-1", name: "image.png", kind: "image", size: 10, mimeType: "image/png",
    }] }],
  } }, { type: "fixture.worker" });
  await importWslSnapshot(target, source.databasePath, machine);
  const result = target.session("old-session");
  expect(result.archived).toBe(true);
  expect(result.session.orchestrationLeadId).toBeUndefined();
  expect(result.session.workflowParentId).toBeUndefined();
  expect(result.session.workflowRunId).toBeUndefined();
  expect(result.session.queueStatus).toBe("paused");
  expect(result.session.queuedMessages?.[0].attachments[0].path).toBe(join(target.attachmentDir, "image-1"));
});
