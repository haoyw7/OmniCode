import { randomUUID } from "node:crypto";
import {
  BOT_WORKTREE_IDLE_MINUTES,
  type BotManagedWorktree,
} from "../../src/integrations/harness/core/botAutonomy";
import { projectMachineKey } from "../../src/integrations/harness/core/machine";
import {
  checkoutPath,
  checkoutPathsOverlap,
  claimCheckoutResource,
  withCheckoutIntegration,
  withCheckoutRemoval,
} from "../checkout-guards";
import {
  createHostWorktree,
  hostWorktrees,
  resolveHostWorktreeAsync,
} from "../git-worktrees";
import {
  currentMachineIO,
  machineExec,
  machineFs,
  machinePath,
} from "../machine-io";
import type { HostStore } from "../store";

type RecordKey = { botId: string; threadId: string; requestId: string };
type Owned = RecordKey & {
  projectId: string;
  sessionId?: string;
  tree: BotManagedWorktree;
};
const git = async (cwd: string, args: string[]) =>
  (
    await machineExec("git", ["-c", "core.pager=cat", ...args], {
      cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout.trim();

/** Ownership and recovery live in the existing creation action, never a new table. */
export class BotTaskWorktrees {
  private tails = new Map<string, Promise<unknown>>();
  private sweeping?: Promise<void>;
  private nextSweep = 0;
  private closing = false;
  constructor(
    private readonly store: HostStore,
    private readonly inProject: <T>(projectId: string, operation: () => T) => T,
    private readonly idleMinutes: (
      botId: string,
      threadId: string,
      projectId: string,
    ) => number | undefined,
    private readonly releaseIdle: (
      sessionId: string,
    ) => Promise<void> = async () => {},
  ) {}

  private owned(): Owned[] {
    return this.store.db
      .prepare(
        "SELECT bot_id,thread_id,request_id,payload FROM bot_actions WHERE json_extract(payload, '$.worktree.version')=1",
      )
      .all()
      .map((row) => {
        const action = JSON.parse(String(row.payload));
        return {
          botId: String(row.bot_id),
          threadId: String(row.thread_id),
          requestId: String(row.request_id),
          projectId: action.input.projectId,
          sessionId: action.targetRef?.sessionId,
          tree: action.worktree,
        };
      });
  }
  private save(
    owner: Owned,
    patch: Partial<BotManagedWorktree>,
  ): BotManagedWorktree {
    const row = this.store.db
      .prepare(
        "SELECT payload FROM bot_actions WHERE bot_id=? AND thread_id=? AND request_id=?",
      )
      .get(owner.botId, owner.threadId, owner.requestId);
    if (!row)
      throw new Error("Task ownership is unavailable; worktree preserved");
    const action = JSON.parse(String(row.payload));
    owner.tree = { ...action.worktree, ...patch };
    this.store.db
      .prepare(
        "UPDATE bot_actions SET payload=? WHERE bot_id=? AND thread_id=? AND request_id=?",
      )
      .run(
        JSON.stringify({ ...action, worktree: owner.tree }),
        owner.botId,
        owner.threadId,
        owner.requestId,
      );
    return owner.tree;
  }
  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => {})
      .then(() => {
        if (this.closing) throw new Error("Host is closing");
        return operation();
      });
    this.tails.set(key, result);
    void result
      .finally(() => {
        if (this.tails.get(key) === result) this.tails.delete(key);
      })
      .catch(() => {});
    return result;
  }
  /** Standard task derivation: existing name generator, source HEAD and Host directory convention. */
  async prepare(
    key: RecordKey,
    projectId: string,
    requestedCwd: unknown,
    name: (cwd: string) => Promise<string>,
    authorized: () => void,
  ): Promise<BotManagedWorktree | undefined> {
    const project = this.store.project(projectId);
    const sourceCwd = await resolveHostWorktreeAsync(project.cwd, requestedCwd);
    let sourceRoot: string;
    try {
      sourceRoot = await machineFs.realpath(
        await git(sourceCwd, ["rev-parse", "--show-toplevel"]),
      );
    } catch (error) {
      if (
        /not a git repository/i.test(
          String((error as { stderr?: string }).stderr),
        )
      )
        return;
      throw error;
    }
    const repositoryRoot = (await hostWorktrees(project.cwd)).worktrees[0].path;
    return this.exclusive(checkoutPath(repositoryRoot), async () => {
      authorized();
      const targetBranch = await git(sourceCwd, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      const baseCommit = await git(sourceCwd, ["rev-parse", "HEAD"]);
      const branch = await name(sourceCwd);
      authorized();
      const listed = await hostWorktrees(project.cwd);
      const tree: BotManagedWorktree = {
        version: 1,
        sourceCwd,
        sourceRoot,
        repositoryRoot,
        targetBranch,
        baseCommit,
        branch,
        path: machinePath.join(
          listed.defaultRoot,
          `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        ),
        createdAt: Date.now(),
        state: "creating",
      };
      const owner = { ...key, projectId, tree };
      this.save(owner, tree);
      const releases = [...new Set([project.cwd, sourceCwd, tree.path])].map(
        (path) =>
          claimCheckoutResource(
            this.store,
            `bot-worktree:${randomUUID()}`,
            path,
          ),
      );
      try {
        // Do not invent seeding rules: the normal Host task creation entry reads
        // source HEAD and leaves the user's dirty/untracked source files alone.
        const created = await createHostWorktree(
          project.cwd,
          branch,
          "HEAD",
          false,
          sourceCwd,
        );
        if (
          checkoutPath(created.path) !== checkoutPath(tree.path) ||
          created.head !== baseCommit
        )
          throw new Error(
            "Source checkout moved during creation; worktree preserved",
          );
        return this.save(owner, { state: "working" });
      } catch (error) {
        this.save(owner, {
          state: "blocked",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        releases.forEach((release) => release());
      }
    });
  }

  private linked(owner: Owned) {
    const key = projectMachineKey(this.store.project(owner.projectId).machine),
      path = checkoutPath(owner.tree.path);
    return this.store
      .sessions()
      .filter(
        (value) =>
          !value.session.worktreeRemoved &&
          projectMachineKey(this.store.project(value.projectId).machine) ===
            key &&
          checkoutPathsOverlap(
            checkoutPath(value.session.executionCwd || value.session.cwd),
            path,
          ),
      );
  }
  private inactive(owner: Owned): boolean {
    return this.linked(owner).every(
      (value) =>
        value.status === "idle" &&
        !value.session.queuedMessages?.length &&
        !value.session.pendingQuestion &&
        !value.session.blocks.some(
          (block) => block.approval && !block.approval.decided,
        ),
    );
  }
  private async verify(owner: Owned) {
    const project = this.store.project(owner.projectId),
      tree = owner.tree;
    const listed = await hostWorktrees(project.cwd);
    const expected = machinePath.join(
      listed.defaultRoot,
      `wt-${tree.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    );
    // Path identity and exact registration protect Windows case, junction and
    // sibling-prefix boundaries. Only our recorded linked checkout is eligible.
    if (
      checkoutPath(expected) !== checkoutPath(tree.path) ||
      checkoutPathsOverlap(
        checkoutPath(tree.path),
        checkoutPath(tree.sourceCwd),
      )
    )
      throw new Error("Task checkout identity changed; worktree preserved");
    const registered = listed.worktrees.find(
      (item) => checkoutPath(item.path) === checkoutPath(tree.path),
    );
    if (
      !registered ||
      registered.isMain ||
      registered.missing ||
      registered.branch !== tree.branch
    )
      throw new Error("Task branch or checkout changed; worktree preserved");
    if (
      (tree.sourceRoot &&
        !listed.worktrees.some(
          (item) =>
            !item.missing &&
            item.branch === tree.targetBranch &&
            checkoutPath(item.path) === checkoutPath(tree.sourceRoot!),
        )) ||
      (await git(tree.sourceCwd, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ])) !== tree.targetBranch
    )
      throw new Error("Target branch changed; worktree preserved");
    return registered;
  }
  private async clean(cwd: string, ignored = false) {
    return !(await git(cwd, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      ...(ignored ? ["--ignored"] : []),
    ]));
  }

  /** The Bot must present successful tool evidence from the completed task turn. */
  async integrate(
    sessionId: string,
    verification: { runId: string; blockIds: string[]; summary: string },
    authorized: () => void,
  ) {
    const owner = this.owned().find((entry) => entry.sessionId === sessionId);
    if (!owner) throw new Error("This is not a Bot-managed task checkout");
    return this.exclusive(
      checkoutPath(
        owner.tree.repositoryRoot ?? this.store.project(owner.projectId).cwd,
      ),
      async () => {
        Object.assign(
          owner,
          this.owned().find((entry) => entry.sessionId === sessionId) ?? owner,
        );
        const tree = owner.tree;
        authorized();
        if (tree.state === "removed" || tree.state === "removing")
          throw new Error("Task checkout has been reclaimed");
        try {
          return await withCheckoutIntegration(
            this.store,
            [tree.path, tree.sourceRoot ?? tree.sourceCwd],
            async () => {
              authorized();
              if (!this.inactive(owner))
                throw new Error(
                  "Task is active or awaiting input; worktree preserved",
                );
              this.save(owner, {
                state: "integrating",
                error: undefined,
                idleSince: undefined,
                verification: undefined,
              });
              const session = this.store.session(sessionId);
              const lastUser = session.session.blocks.findLastIndex(
                (block) => block.role === "user",
              );
              const tools = session.session.blocks.slice(lastUser + 1);
              if (
                session.lastCompletedRunId !== verification.runId ||
                !verification.summary.trim() ||
                !verification.blockIds.length ||
                verification.blockIds.some(
                  (id) =>
                    !tools.some(
                      (block) =>
                        block.id === id &&
                        block.role === "tool" &&
                        ["completed", "success", "succeeded"].includes(
                          block.tool?.status ?? "",
                        ) &&
                        !block.tool?.background,
                    ),
                )
              )
                throw new Error(
                  "Provide successful verification tool blocks from the latest completed task turn",
                );
              const registered = await this.verify(owner);
              if (!(await this.clean(tree.path)))
                throw new Error(
                  "Task has uncommitted or untracked work; commit verified results before integration",
                );
              if (!(await this.clean(tree.sourceCwd)))
                throw new Error(
                  "Target has user changes; worktree preserved until the target is clean",
                );
              await git(tree.path, [
                "diff",
                "--check",
                tree.baseCommit,
                "HEAD",
              ]);
              await git(tree.path, [
                "merge-base",
                "--is-ancestor",
                tree.baseCommit,
                "HEAD",
              ]);
              // Preflight reports conflicts without leaving conflict files in the user's checkout.
              await git(tree.sourceCwd, [
                "merge-tree",
                "--write-tree",
                "HEAD",
                registered.head,
              ]);
              authorized();
              if (!this.inactive(owner) || !(await this.clean(tree.sourceCwd)))
                throw new Error(
                  "Target changed during verification; worktree preserved",
                );
              await this.verify(owner);
              const stat = await git(tree.path, [
                "diff",
                "--numstat",
                "--no-renames",
                "-z",
                tree.baseCommit,
                registered.head,
              ]);
              const changes = {
                files: [] as string[],
                additions: 0,
                deletions: 0,
              };
              for (const row of stat.split("\0").filter(Boolean)) {
                const [added, deleted, ...path] = row.split("\t");
                changes.files.push(path.join("\t"));
                changes.additions += Number(added) || 0;
                changes.deletions += Number(deleted) || 0;
              }
              const commit =
                registered.head === tree.baseCommit
                  ? undefined
                  : {
                      hash: registered.head,
                      message: await git(tree.path, [
                        "log",
                        "-1",
                        "--format=%s",
                      ]),
                    };
              if (
                !this.inactive(owner) ||
                (await this.verify(owner)).head !== registered.head ||
                !(await this.clean(tree.path)) ||
                !(await this.clean(tree.sourceCwd))
              )
                throw new Error(
                  "Task or target changed after verification; worktree preserved",
                );
              authorized();
              this.save(owner, {
                state: "integrating",
                error: undefined,
                verification: { ...verification, head: registered.head },
                idleSince: undefined,
                changes,
                commit,
              });
              await git(tree.sourceCwd, [
                "merge",
                "--no-edit",
                "--no-ff",
                registered.head,
              ]);
              await git(tree.sourceCwd, [
                "merge-base",
                "--is-ancestor",
                registered.head,
                "HEAD",
              ]);
              return this.save(owner, {
                state: "merged",
                mergedHead: registered.head,
                idleSince: Date.now(),
                error: undefined,
              });
            },
          );
        } catch (error) {
          this.save(owner, {
            state: "blocked",
            idleSince: undefined,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    );
  }

  /** A send invalidates previous integration/verification before provider dispatch. */
  touch(sessionId: string): void {
    for (const owner of this.owned()) {
      let associated = owner.sessionId === sessionId;
      if (!associated) {
        try {
          associated =
            projectMachineKey(this.store.project(owner.projectId).machine) ===
              currentMachineIO().key &&
            this.linked(owner).some((value) => value.session.id === sessionId);
        } catch {
          continue; /* A removed project must not block unrelated sessions. */
        }
      }
      if (!associated) continue;
      if (["removing", "removed", "integrating"].includes(owner.tree.state))
        throw new Error(
          "Task checkout is being integrated or reclaimed; retry after it finishes",
        );
      if (owner.tree.state !== "working" || owner.tree.idleSince !== undefined)
        this.save(owner, {
          state: "working",
          idleSince: undefined,
          verification: undefined,
          error: undefined,
        });
    }
  }

  sweep(now = Date.now(), force = false): Promise<void> {
    if (this.closing || (!force && now < this.nextSweep))
      return this.sweeping ?? Promise.resolve();
    if (this.sweeping) return this.sweeping;
    this.nextSweep = now + 60_000;
    this.sweeping = (async () => {
      for (const owner of this.owned()) {
        if (this.closing) break;
        try {
          await this.inProject(owner.projectId, () =>
            this.exclusive(
              checkoutPath(
                owner.tree.repositoryRoot ??
                  this.store.project(owner.projectId).cwd,
              ),
              async () => {
                Object.assign(
                  owner,
                  this.owned().find(
                    (entry) =>
                      entry.botId === owner.botId &&
                      entry.threadId === owner.threadId &&
                      entry.requestId === owner.requestId,
                  ) ?? owner,
                );
                const tree = owner.tree;
                if (tree.state === "integrating" && tree.verification) {
                  await this.verify(owner);
                  await git(tree.sourceCwd, [
                    "merge-base",
                    "--is-ancestor",
                    tree.verification.head,
                    "HEAD",
                  ]);
                  this.save(owner, {
                    state: "merged",
                    mergedHead: tree.verification.head,
                    idleSince: now,
                  });
                  return;
                }
                if (tree.state === "removing") {
                  const exists = await machineFs.lstat(tree.path).then(
                    () => true,
                    (error: NodeJS.ErrnoException) => {
                      if (error.code === "ENOENT") return false;
                      throw error;
                    },
                  );
                  this.save(owner, {
                    state: exists ? "merged" : "removed",
                    idleSince: now,
                  });
                  if (!exists) this.markRemoved(owner);
                  return;
                }
                if (tree.state !== "merged" || !tree.mergedHead) return;
                if (!this.inactive(owner)) {
                  this.save(owner, { idleSince: undefined });
                  return;
                }
                const latest = Math.max(
                  ...this.linked(owner).map((value) => value.updatedAt),
                  tree.createdAt,
                );
                if (tree.idleSince === undefined || latest > tree.idleSince) {
                  this.save(owner, { idleSince: Math.max(now, latest) });
                  return;
                }
                const minutes =
                  this.idleMinutes(
                    owner.botId,
                    owner.threadId,
                    owner.projectId,
                  ) ?? BOT_WORKTREE_IDLE_MINUTES;
                if (minutes <= 0 || now - tree.idleSince < minutes * 60_000)
                  return;
                // Block new sends before releasing idle provider handles. A failed
                // cleanup restores eligibility without losing the verification.
                this.save(owner, { state: "removing" });
                for (const value of this.linked(owner))
                  await this.releaseIdle(value.session.id);
                await withCheckoutRemoval(this.store, tree.path, async () => {
                  await this.verify(owner);
                  if (
                    !this.inactive(owner) ||
                    !(await this.clean(tree.path, true))
                  ) {
                    this.save(owner, { state: "merged" });
                    return;
                  }
                  if (
                    (await git(tree.path, ["rev-parse", "HEAD"])) !==
                    tree.mergedHead
                  ) {
                    this.save(owner, { state: "merged" });
                    return;
                  }
                  await git(tree.sourceCwd, [
                    "merge-base",
                    "--is-ancestor",
                    tree.mergedHead!,
                    `refs/heads/${tree.targetBranch}`,
                  ]);
                  // Re-read ownership after awaits; touch() invalidates eligibility.
                  const current = this.owned().find(
                    (entry) =>
                      entry.requestId === owner.requestId &&
                      entry.botId === owner.botId &&
                      entry.threadId === owner.threadId,
                  );
                  const retention =
                    this.idleMinutes(
                      owner.botId,
                      owner.threadId,
                      owner.projectId,
                    ) ?? BOT_WORKTREE_IDLE_MINUTES;
                  if (
                    current?.tree.state !== "removing" ||
                    current.tree.idleSince !== tree.idleSince ||
                    !this.inactive(owner) ||
                    retention <= 0 ||
                    now - tree.idleSince! < retention * 60_000
                  ) {
                    this.save(owner, { state: "merged" });
                    return;
                  }
                  await git(this.store.project(owner.projectId).cwd, [
                    "worktree",
                    "remove",
                    "--",
                    tree.path,
                  ]);
                  this.markRemoved(owner);
                  this.save(owner, { state: "removed", error: undefined });
                });
              },
            ),
          );
        } catch (error) {
          // Keep recoverable output and a visible explanation; never force removal.
          this.save(owner, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })().finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }
  private markRemoved(owner: Owned) {
    for (const value of this.linked(owner))
      this.store.save(
        {
          ...value,
          revision: value.revision + 1,
          session: { ...value.session, worktreeRemoved: true },
        },
        { type: "assistant.worktreeRemoved" },
      );
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([
      ...this.tails.values(),
      ...(this.sweeping ? [this.sweeping] : []),
    ]);
  }
}
