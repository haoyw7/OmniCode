import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "./store";

it("migrates persisted execution directories without retaining the old worktree field", () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-execution-migration-"));
  const database = join(directory, "host.db");
  let store = new HostStore(database);
  try {
    const project = store.addProject(directory, "Project");
    const executionCwd = join(directory, "ordinary-subdirectory");
    const session = { id: "legacy", cwd: directory, worktreeCwd: executionCwd,
      harness: "codex", model: "test", runtimeMode: "supervised", title: "Keep me", modelSettings: {}, blocks: [] };
    const snapshot = { projectId: project.id, revision: 1, status: "idle", updatedAt: 10, session };
    store.db.prepare("INSERT INTO sessions(id, project_id, snapshot, summary) VALUES (?, ?, ?, ?)")
      .run(session.id, project.id, JSON.stringify(snapshot), JSON.stringify({ id: session.id, cwd: directory }));
    store.db.prepare("DELETE FROM metadata WHERE key='execution-cwd-v1'").run();
    store.close();
    store = new HostStore(database);
    const migrated = store.session(session.id).session;
    expect(migrated).toMatchObject({ cwd: directory, executionCwd, title: "Keep me" });
    expect(migrated).not.toHaveProperty("worktreeCwd");
    expect(migrated.linkedWorktree).toBeUndefined();
    expect(store.summaries(project.id)[0].executionCwd).toBe(executionCwd);
    const saved = String(store.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(session.id)!.snapshot);
    expect(saved).not.toContain("worktreeCwd");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
