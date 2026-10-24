import { randomUUID } from "node:crypto";
import { machineExec, machineFs, machinePath, currentMachineIO } from "./machine-io";
import { hostWorktrees } from "./git-worktrees";
import { checkoutPath, checkoutPathsOverlap, checkoutResources, withCheckoutRemoval } from "./checkout-guards";
import type { HostStore } from "./store";
import type { HostSession } from "../src/contracts/protocol";
import type { Worktrees, WorktreeRemoval } from "../src/contracts/worktree";

const PREFIX = "worktree-removal:";
const inside = (root: string, path: string) => {
  const relative = machinePath.relative(root, path);
  return relative !== ".." && !relative.startsWith(`..${machinePath.sep}`) && !machinePath.isAbsolute(relative);
};
const git = async (cwd: string, args: string[]) => (await machineExec("git", args, { cwd, timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
type Removal = { projectId: string; path: string; sessions: HostSession[] };

function affectedSessions(store: HostStore, path: string): HostSession[] {
  const machine = currentMachineIO().key;
  const projects = new Set(store.projects().filter(value => (value.machine ? `wsl:${value.machine.distribution}` : "local") === machine).map(value => value.id));
  return store.sessions().filter(value => projects.has(value.projectId) && !value.session.worktreeRemoved && inside(path, value.session.executionCwd || value.session.cwd));
}

export async function detailedHostWorktrees(store: HostStore, cwd: string): Promise<Worktrees> {
  const listed = await hostWorktrees(cwd);
  const worktrees = await Promise.all(listed.worktrees.map(async tree => {
    const [dirty, unpushed] = tree.missing ? [null, null] : await Promise.all([
      git(tree.path, ["status", "--porcelain", "--untracked-files=normal"]).then(value => !!value, () => null),
      git(tree.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"]).then(value => /^\d+$/.test(value) ? Number(value) : null, () => null),
    ]);
    return { ...tree, locked: !!tree.locked, prunable: !!tree.prunable, dirty, unpushed, sessionIds: affectedSessions(store, tree.path).map(value => value.session.id) };
  }));
  return { ...listed, worktrees };
}

export class HostWorktreeLifecycle {
  constructor(private store: HostStore) {}
  private async target(projectId: string, path: unknown) {
    if (typeof path !== "string" || !machinePath.isAbsolute(path) || path.includes("\0")) throw new Error("Invalid working copy");
    const project = this.store.project(projectId);
    const listed = await hostWorktrees(project.cwd);
    const tree = listed.worktrees.find(value => machinePath.relative(value.path, path) === "");
    if (!tree) throw new Error("This path is not a registered worktree of this repository");
    if (tree.isMain) throw new Error("The main working copy cannot be deleted");
    if (tree.locked) throw new Error("This worktree is locked. Unlock it in Git before deleting it.");
    if (!tree.branch) throw new Error("Create a branch for this detached worktree before deleting it.");
    return { tree, main: listed.worktrees[0] };
  }

  async check(projectId: string, path: unknown, force: boolean): Promise<void> {
    const { tree } = await this.target(projectId, path);
    const key = checkoutPath(tree.path);
    if (checkoutResources(this.store).some(resource => resource.kind !== "computer" && resource.kind !== "executing" && !resource.id.startsWith("host-provider:") && checkoutPathsOverlap(key, resource.path)))
      throw new Error("Close the files and terminals using this worktree first.");
    if (!force && !tree.missing && await git(tree.path, ["status", "--porcelain", "--untracked-files=normal"]))
      throw new Error("This worktree has uncommitted or untracked changes.");
  }

  projectsUsing(path: string): string[] { return [...new Set(affectedSessions(this.store, path).map(value => value.projectId))]; }

  async remove(projectId: string, path: unknown, force: boolean, keepSessions: boolean): Promise<WorktreeRemoval> {
    const { tree, main } = await this.target(projectId, path);
    return withCheckoutRemoval(this.store, tree.path, async () => {
      await this.target(projectId, tree.path);
      const sessions = affectedSessions(this.store, tree.path);
      if (sessions.some(value => value.status === "running")) throw new Error("Stop the sessions using this worktree first.");
      if (!keepSessions && sessions.length) throw new Error("Sessions still use this worktree. Move or delete those sessions first (including archived sessions).");
      const id = `${PREFIX}${randomUUID()}`;
      const journal: Removal = { projectId, path: tree.path, sessions };
      this.store.transaction(() => {
        this.store.db.prepare("INSERT INTO metadata(key,value) VALUES (?,?)").run(id, JSON.stringify(journal));
        for (const value of sessions) {
          const project = this.store.project(value.projectId);
          const projectId = inside(tree.path, project.cwd) ? this.store.addProject(main.path, machinePath.basename(main.path), undefined, project.machine).id : value.projectId;
          this.store.save({ ...value, projectId, revision: value.revision + 1, nativeBinding: undefined, nativeStatus: undefined,
          session: { ...value.session, cwd: inside(tree.path, value.session.cwd) ? main.path : value.session.cwd,
            executionCwd: value.session.executionCwd || value.session.cwd, worktreeRemoved: true, linkedWorktree: false,
            branch: undefined, providerSessionId: undefined, nativeSession: undefined, context: undefined, pendingSwitch: undefined, pendingQuestion: undefined, busy: false, queueStatus: "paused" } },
          { type: "worktree.detached", path: tree.path });
        }
      });
      try { await git(main.path, ["worktree", "remove", ...(force ? ["--force"] : []), "--", tree.path]); }
      catch (error) { await this.finish(id, journal); throw error; }
      // If cleanup fails the durable detached state is still correct. Startup
      // can clear the journal; never put sessions back into a removed directory.
      this.store.db.prepare("DELETE FROM metadata WHERE key=?").run(id);
      return { sessionIds: sessions.map(value => value.session.id), projectCwd: main.path };
    });
  }

  private async finish(id: string, journal: Removal) {
    const survives = await machineFs.lstat(machinePath.join(journal.path, ".git")).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    this.store.transaction(() => {
      if (survives) for (const previous of journal.sessions) {
        const current = this.store.sessionIfExists(previous.session.id);
        // A later reattachment or user edit takes precedence over recovery.
        if (current && current.revision === previous.revision + 1 && current.session.worktreeRemoved)
          this.store.save({ ...previous, revision: current.revision + 1 }, { type: "worktree.removeFailed" });
      }
      this.store.db.prepare("DELETE FROM metadata WHERE key=?").run(id);
    });
  }
  async recover(runOnProject: <T>(projectId: string, action: () => Promise<T>) => Promise<T>): Promise<void> {
    for (const row of this.store.db.prepare("SELECT key,value FROM metadata WHERE key LIKE ?").all(`${PREFIX}%`)) {
      const journal = JSON.parse(String(row.value)) as Removal;
      await runOnProject(journal.projectId, () => this.finish(String(row.key), journal));
    }
  }
}
