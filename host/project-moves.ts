import { currentMachineIO, machineFs, machinePath, machineExec } from "./machine-io";
import { withCheckoutIntegration } from "./checkout-guards";
import type { HostStore } from "./store";

type Checkpoints = { rebase(from: string, to: string, ids: string[]): Promise<() => Promise<void>> };
type Move = { projectId: string; from: string; to: string; rename: boolean };
const PREFIX = "project-move:";

/** Filesystem changes cannot join SQLite transactions. A durable intent lets
 * startup finish an interrupted move before provider bindings are restored. */
export class ProjectMoves {
  constructor(private store: HostStore, private checkpoints: Checkpoints) {}

  private key(move: Move) { return `${PREFIX}${move.projectId}`; }
  private clear(move: Move) { this.store.db.prepare("DELETE FROM metadata WHERE key=?").run(this.key(move)); }
  affectedProjects(projectId: string) {
    const project = this.store.project(projectId);
    const machine = project.machine ? `wsl:${project.machine.distribution}` : "local";
    return this.store.projects().filter(value => {
      if ((value.machine ? `wsl:${value.machine.distribution}` : "local") !== machine) return false;
      const relative = machinePath.relative(project.cwd, value.cwd);
      return relative !== ".." && !relative.startsWith(`..${machinePath.sep}`) && !machinePath.isAbsolute(relative);
    });
  }
  private sessionIds(move: Move) { return this.affectedProjects(move.projectId).flatMap(project => this.store.summaries(project.id).map(value => value.id)); }
  private exists(path: string) {
    return machineFs.lstat(path).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
  }

  async move(projectId: string, destination: string, rename: boolean) {
    const project = this.store.project(projectId);
    if ((project.machine ? `wsl:${project.machine.distribution}` : "local") !== currentMachineIO().key)
      throw new Error("Project belongs to another execution machine");
    const from = machinePath.resolve(project.cwd);
    const to = machinePath.resolve(destination);
    if (from === to) return project;
    if (!machinePath.isAbsolute(destination) || destination.includes("\0")) throw new Error("Invalid project destination");
    if (machinePath.dirname(from) !== machinePath.dirname(to)) throw new Error("Project moves must stay in the same parent folder");
    const affected = new Set(this.affectedProjects(projectId).map(value => value.id));
    if (this.store.projects().some(value => !affected.has(value.id) &&
      (value.machine ? `wsl:${value.machine.distribution}` : "local") === currentMachineIO().key && machinePath.relative(value.cwd, to) === ""))
      throw new Error("The destination is already registered as another project");
    if (this.store.db.prepare("SELECT 1 FROM metadata WHERE key=?").get(`${PREFIX}${projectId}`)) throw new Error("This project has an unfinished move; restart Host to recover it");
    const sourceExists = await this.exists(from);
    const targetExists = await this.exists(to);
    if (rename ? !sourceExists || targetExists : sourceExists || !targetExists) throw new Error("Project location changed; refresh before trying again");
    const directory = await machineFs.lstat(rename ? from : to);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Project destination must be a real directory");
    const move: Move = { projectId, from, to, rename };
    return withCheckoutIntegration(this.store, [from, to], async () => {
      if (this.affectedProjects(projectId).some(value => this.store.summaries(value.id).some(session => session.status === "running")))
        throw new Error("Wait for running host sessions before moving this project");
      this.store.db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run(this.key(move), JSON.stringify(move));
      let moved = false;
      let rollback: (() => Promise<void>) | undefined;
      try {
        if (rename) { await machineFs.rename(from, to); moved = true; }
        await this.repairGit(to, from);
        rollback = await this.checkpoints.rebase(from, to, this.sessionIds(move));
        this.commit(move);
        return this.store.project(projectId);
      } catch (error) {
        // An after-commit observer may throw. Never undo a durable SQLite move.
        if (this.store.project(projectId).cwd === to) throw error;
        try {
          if (rollback) await rollback();
          if (moved) await machineFs.rename(to, from);
          if (moved) await this.repairGit(from, to);
          this.clear(move);
        } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], "Project move needs recovery; restart Host before using this project");
        }
        throw error;
      }
    });
  }

  private async repairGit(cwd: string, previous: string) {
    if (!(await this.exists(machinePath.join(cwd, ".git")))) return;
    const { stdout } = await machineExec("git", ["-C", cwd, "worktree", "list", "--porcelain", "-z"], { timeout: 10_000, windowsHide: true });
    const moved: string[] = [];
    for (const row of stdout.split("\0")) {
      if (!row.startsWith("worktree ")) continue;
      const relative = machinePath.relative(previous, row.slice(9));
      if (relative === ".." || relative.startsWith(`..${machinePath.sep}`) || machinePath.isAbsolute(relative)) continue;
      const target = machinePath.join(cwd, relative);
      if (await this.exists(target)) moved.push(target);
    }
    // Repair needs explicit new locations for worktrees nested under the moved
    // main checkout; otherwise Git leaves their .git files pointing at the old root.
    await machineExec("git", ["-C", cwd, "worktree", "repair", ...moved], { timeout: 10_000, windowsHide: true });
  }

  private commit(move: Move) {
    const rebase = (path: string | undefined) => {
      if (!path) return path;
      const relative = machinePath.relative(move.from, path);
      return relative === "" || (!relative.startsWith(`..${machinePath.sep}`) && relative !== ".." && !machinePath.isAbsolute(relative))
        ? machinePath.join(move.to, relative) : path;
    };
    this.store.transaction(() => {
      for (const project of this.affectedProjects(move.projectId)) {
        const cwd = rebase(project.cwd)!;
        this.store.db.prepare("UPDATE projects SET cwd=?, name=? WHERE id=?").run(cwd, project.id === move.projectId ? machinePath.basename(move.to) : project.name, project.id);
        for (const value of this.store.sessions(project.id)) {
          this.store.save({ ...value, revision: value.revision + 1,
            session: { ...value.session, cwd: rebase(value.session.cwd)!, executionCwd: rebase(value.session.executionCwd) } },
          { type: "project.moved", from: move.from, to: move.to });
        }
      }
      this.clear(move);
    });
  }

  async recover(runOnProject: <T>(projectId: string, action: () => Promise<T>) => Promise<T>) {
    const rows = this.store.db.prepare("SELECT value FROM metadata WHERE key LIKE ?").all(`${PREFIX}%`);
    for (const row of rows) {
      const move = JSON.parse(String(row.value)) as Move;
      await runOnProject(move.projectId, async () => {
        const project = this.store.project(move.projectId);
        if (machinePath.relative(project.cwd, move.to) === "") { this.clear(move); return; }
        if (machinePath.relative(project.cwd, move.from) !== "") throw new Error("Cannot recover a move whose project location changed");
        const fromExists = await this.exists(move.from);
        const toExists = await this.exists(move.to);
        if (move.rename && fromExists && !toExists) {
          // The process stopped before rename (or completed rollback).
          await this.checkpoints.rebase(move.to, move.from, this.sessionIds(move));
          await this.repairGit(move.from, move.to);
          this.clear(move);
          return;
        }
        if (fromExists || !toExists) throw new Error("Project move recovery cannot identify the moved directory");
        const directory = await machineFs.lstat(move.to);
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Project destination must be a real directory");
        await this.repairGit(move.to, move.from);
        await this.checkpoints.rebase(move.from, move.to, this.sessionIds(move));
        this.commit(move);
      });
    }
  }
}
