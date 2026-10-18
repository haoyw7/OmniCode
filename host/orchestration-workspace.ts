import { machineExec as exec, machineFs, machinePath, currentMachineIO } from "./machine-io";
import { projectMachineKey } from "../src/integrations/harness/core/machine";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  OrchestrationRun,
  OrchestrationTask,
  WorkerPreparation,
} from "../src/features/orchestration/model/orchestration";
import {
  orchestrationCheckoutCwd,
  orchestrationProjectCwd,
  workspaceIdentity,
} from "../src/features/orchestration/model/orchestrationState";
import { createHostWorktree, hostWorktrees } from "./git-worktrees";
import type { HostStore } from "./store";
import type { HostSession } from "../src/features/connections/model/protocol";
import {
  checkoutPath,
  checkoutPathsOverlap,
  claimCheckoutResource,
  initCheckoutGuards,
  withCheckoutIntegration,
  withCheckoutOwner,
  withCheckoutRemoval,
} from "./checkout-guards";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAX_CHANGED = 500;
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
type FileState = {
  kind: "file" | "link" | "unsupported";
  hash: string;
  mode: number;
  size: number;
  bytes?: string;
  blob?: string;
};
type Files = Record<string, FileState>;
type Manifest = {
  machine?: string;
  version: 1;
  leadId: string;
  sessionId: string;
  taskId: string;
  leadCwd: string;
  workerCwd: string;
  branch: string;
  head: string;
  seeded: boolean;
  baseline: Files;
  pristine?: Files;
  after?: Files;
  changed?: string[];
  integrated?: boolean;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const same = (a: FileState | undefined, b: FileState | undefined) =>
  a?.kind === b?.kind && a?.hash === b?.hash && a?.mode === b?.mode;
const branchFor = (task: OrchestrationTask) =>
  `mc/orch-${task.id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12)
    .toLowerCase()}`;
const validateId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new Error("Invalid worker identity");
  return id;
};

async function git(
  cwd: string,
  args: string[],
  binary = false,
): Promise<Buffer> {
  const result = await exec("git", ["-c", "core.pager=cat", ...args], {
    cwd,
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "buffer",
    windowsHide: true,
  });
  return binary ? result.stdout : Buffer.from(result.stdout);
}
const gitText = async (cwd: string, args: string[]) =>
  (await git(cwd, args)).toString("utf8").trim();

async function durableJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  // Directory fsync is supported on Unix; Windows rejects opening directories.
  if (process.platform !== "win32") {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

/** Includes ignored additions. Never follows a link or descends into .git. */
async function scan(
  cwd: string,
  selected?: string[],
  reference?: Files,
  tree?: Record<string, { blob: string; mode: string }>,
): Promise<Files> {
  const files: Files = Object.create(null);
  const pending = [""];
  let count = 0;
  let savedBytes = 0;
  const capture = async (path: string) => {
    assertRelative(path);
    const info = await machineFs.lstat(machinePath.join(cwd, path)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!info) return;
    if (info.isDirectory()) {
      if (selected)
        throw new Error(
          `Cannot safely snapshot directory or submodule ${path}. Its files were kept.`,
        );
      pending.push(path);
      return;
    }
    if (++count > MAX_FILES)
      throw new Error(
        "Worker checkout has too many files to verify safely. Its worktree was kept.",
      );
    if (info.isSymbolicLink()) {
      const target = await machineFs.readlink(machinePath.join(cwd, path));
      files[path] = {
        kind: "link",
        hash: hash(Buffer.from(target)),
        mode: 0,
        size: target.length,
      };
    } else if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      const digest = info.isFile()
        ? await machineFs.hash(machinePath.join(cwd, path))
        : hash(Buffer.from(`${info.mtimeMs}:${info.size}`));
      files[path] = {
        kind: "unsupported",
        hash: digest,
        mode: currentMachineIO().pathStyle === "win32" ? 0o644 : info.mode & 0o777,
        size: info.size,
      };
    } else {
      const bytes = await machineFs.readFile(machinePath.join(cwd, path));
      const after = await machineFs.lstat(machinePath.join(cwd, path));
      if (
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        !after.isFile()
      )
        throw new Error(
          `Cannot snapshot ${path}: it changed while being read. Its worktree was kept.`,
        );
      const state: FileState = {
        kind: "file",
        hash: hash(bytes),
        mode: currentMachineIO().pathStyle === "win32" ? 0o644 : info.mode & 0o777,
        size: bytes.length,
        bytes: bytes.toString("base64"),
      };
      files[path] =
        reference && same(reference[path], state)
          ? { ...state, bytes: undefined, blob: reference[path].blob }
          : tree
            ? compactBaseline({ [path]: state }, tree)[path]
            : state;
      if (
        files[path].bytes !== undefined &&
        (savedBytes += bytes.length) > MAX_CHECKPOINT_BYTES
      )
        throw new Error(
          "This worker requires more than 64 MiB of checkpoint contents. Its worktree was kept for review.",
        );
    }
  };
  if (selected) {
    for (const path of [...new Set(selected)]) {
      // Do not read through a symlinked parent outside the selected checkout.
      const separator = path.lastIndexOf("/");
      if (separator > 0) await assertNoLinks(cwd, path.slice(0, separator));
      await capture(path);
    }
    return files;
  }
  while (pending.length) {
    const parent = pending.pop()!;
    for (const item of await machineFs.readdir(machinePath.join(cwd, parent), {
      withFileTypes: true,
    })) {
      if (item.name === ".git") continue;
      await capture(parent ? `${parent}/${item.name}` : item.name);
    }
  }
  return files;
}

async function seedFiles(
  cwd: string,
  tree: Record<string, { blob: string; mode: string }>,
): Promise<Files> {
  const paths = (
    await git(cwd, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return scan(cwd, paths, undefined, tree);
}

async function headFiles(
  cwd: string,
  head: string,
): Promise<Record<string, { blob: string; mode: string }>> {
  const out: Record<string, { blob: string; mode: string }> =
    Object.create(null);
  for (const entry of (await git(cwd, ["ls-tree", "-rz", "--full-tree", head]))
    .toString("utf8")
    .split("\0")) {
    const match = entry.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/);
    if (match) out[match[3]] = { blob: match[2], mode: match[1] };
  }
  return out;
}

function compactBaseline(
  files: Files,
  tree: Record<string, { blob: string; mode: string }>,
): Files {
  return Object.fromEntries(
    Object.entries(files).map(([path, state]) => {
      const entry = tree[path];
      if (
        state.kind !== "file" ||
        !state.bytes ||
        !entry ||
        entry.mode === "120000"
      )
        return [path, state];
      const bytes = Buffer.from(state.bytes, "base64");
      const object = createHash(entry.blob.length === 64 ? "sha256" : "sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      return [
        path,
        object === entry.blob
          ? { ...state, bytes: undefined, blob: entry.blob }
          : state,
      ];
    }),
  );
}

function delta(before: Files, after: Files): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => !same(before[path], after[path]))
    .sort();
}

function assertRelative(path: string) {
  if (
    !path ||
    path.includes("\0") ||
    path
      .split(/[\\/]/)
      .some((part) => part === ".." || part.toLowerCase() === ".git") ||
    /^[\\/]|^[a-z]:/i.test(path)
  )
    throw new Error("Invalid worker checkpoint path");
}

async function assertNoLinks(root: string, path: string) {
  assertRelative(path);
  let current = root;
  for (const part of path.split("/")) {
    current = machinePath.join(current, part);
    const info = await machineFs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (
      info?.isSymbolicLink() ||
      (current !== machinePath.join(root, path) && info && !info.isDirectory())
    )
      throw new Error(
        `Cannot safely write ${path}: its path contains a link or non-directory. The worker worktree was kept.`,
      );
  }
}

async function applyState(
  root: string,
  path: string,
  state: FileState | undefined,
  blobCwd: string,
  expected?: { state: FileState | undefined },
) {
  await assertNoLinks(root, path);
  const target = machinePath.join(root, path);
  const checkTarget = async () => {
    if (!expected) return true;
    await assertNoLinks(root, path);
    const current = (await scan(root, [path]))[path];
    if (same(current, state)) return false;
    if (!same(current, expected.state))
      throw new Error(
        `Cannot integrate ${path}: the lead checkout changed before the result was written. Its worktree was kept.`,
      );
    return true;
  };
  if (!state) {
    if (!(await checkTarget())) return;
    await machineFs.rm(target, { force: true });
    if (currentMachineIO().key === "local" && process.platform !== "win32") {
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return;
  }
  if (state.kind !== "file")
    throw new Error(
      `Cannot safely integrate ${path}: unsupported file type or size. The worker worktree was kept.`,
    );
  const bytes =
    state.bytes !== undefined
      ? Buffer.from(state.bytes, "base64")
      : await git(blobCwd, ["cat-file", "blob", state.blob!], true);
  if (bytes.length > MAX_FILE_BYTES || hash(bytes) !== state.hash)
    throw new Error(
      `Checkpoint data for ${path} is unavailable or corrupt. The worker worktree was kept.`,
    );
  if (currentMachineIO().key !== "local") {
    await machineFs.mkdir(machinePath.dirname(target), { recursive: true });
    const temporary = machinePath.join(machinePath.dirname(target), `.monocode-integrate-${randomUUID()}`);
    await machineFs.writeFile(temporary, bytes, { flag: "wx", mode: state.mode });
    try {
      await machineFs.chmod(temporary, state.mode);
      if (await checkTarget()) await machineFs.rename(temporary, target);
    } finally { await machineFs.rm(temporary, { force: true }); }
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.monocode-integrate-${randomUUID()}`,
  );
  const file = await open(temporary, "wx", state.mode);
  try {
    await file.writeFile(bytes);
    if (process.platform !== "win32") await file.chmod(state.mode);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    if (!(await checkTarget())) {
      await rm(temporary, { force: true });
      return;
    }
    await rename(temporary, target);
    if (process.platform !== "win32") {
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export class HostOrchestrationWorkspace {
  private readonly root: string;
  private tails = new Map<string, Promise<unknown>>();
  private preparations = new Map<string, () => void>();
  constructor(private readonly store: HostStore) {
    this.root = join(dirname(store.attachmentDir), "orchestration-workers");
    initCheckoutGuards(store);
    // A journal is written before Git removes a checkout. A stopped process
    // cannot race this recovery because Host ownership is acquired first.
    for (const row of store.db
      .prepare("SELECT * FROM checkout_cleanup")
      .all()) {
      if (row.previous) {
        try {
          const previous = JSON.parse(String(row.previous)) as HostSession;
          if (this.store.project(previous.projectId).machine) continue;
        } catch { /* Corrupt/deleted local recovery is handled below. */ }
      }
      if (row.previous && existsSync(String(row.path))) {
        try {
          const previous = JSON.parse(String(row.previous));
          const current = store.session(previous.session.id);
          store.transaction(() =>
            store.save(
              { ...previous, revision: current.revision + 1 },
              { type: "orchestration.cleanupRecovered" },
            ),
          );
        } catch {
          /* A deleted conversation must not be resurrected. */
        }
      }
      store.db.prepare("DELETE FROM checkout_cleanup WHERE id=?").run(row.id);
    }
  }

  private dir(id: string) {
    return join(this.root, validateId(id));
  }
  /** Remote cleanup journals require their machine connection before recovery. */
  private async recoverCleanup(id: string): Promise<void> {
    const row = this.store.db.prepare("SELECT * FROM checkout_cleanup WHERE id=?").get(id);
    if (!row) return;
    if (row.previous) {
      const previous = JSON.parse(String(row.previous)) as HostSession;
      if (projectMachineKey(this.store.project(previous.projectId).machine) !== currentMachineIO().key)
        throw new Error("Worker cleanup belongs to a different machine");
      if (await machineFs.stat(String(row.path)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      })) {
        const current = this.store.sessionIfExists(previous.session.id);
        if (current) this.store.transaction(() => this.store.save(
          { ...previous, revision: current.revision + 1 }, { type: "orchestration.cleanupRecovered" },
        ));
      }
    }
    this.store.db.prepare("DELETE FROM checkout_cleanup WHERE id=?").run(id);
  }
  /** Called only after the worker conversation is saved durably. */
  releasePreparation(id: string): void {
    this.preparations.get(id)?.();
    this.preparations.delete(id);
  }
  private manifest(id: string): Manifest | undefined {
    const path = join(this.dir(id), "manifest.json");
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    if (
      value.version !== 1 ||
      value.sessionId !== id ||
      !value.baseline ||
      !value.workerCwd ||
      !value.branch
    )
      throw new Error(
        "Unsupported or corrupt worker checkpoint. Its worktree was kept.",
      );
    return value;
  }
  private save(value: Manifest) {
    return durableJson(join(this.dir(value.sessionId), "manifest.json"), value);
  }
  private assignment(
    run: OrchestrationRun,
    task: OrchestrationTask,
  ): Manifest | undefined {
    const value = this.manifest(task.sessionId);
    if (
      value &&
      ((value.machine ?? "local") !== currentMachineIO().key ||
        value.leadId !== run.leadId ||
        value.taskId !== task.id ||
        checkoutPath(value.leadCwd) !==
          checkoutPath(orchestrationCheckoutCwd(run)) ||
        value.branch !== branchFor(task) ||
        (task.workspace &&
          checkoutPath(task.workspace.checkoutCwd) !==
            checkoutPath(value.workerCwd)))
    )
      throw new Error("This worker checkpoint belongs to another assignment");
    return value;
  }
  private validateChanges(task: OrchestrationTask, manifest: Manifest) {
    if (!manifest.after || !manifest.changed)
      throw new Error("This worker has no completed change checkpoint");
    if (manifest.changed.length > MAX_CHANGED)
      throw new Error(
        "This worker changed more than 500 files. Its worktree was kept for review.",
      );
    const scopes = task.files.map((file) => {
      if (file === ".") return "";
      assertRelative(file);
      return file.replace(/\\/g, "/").replace(/\/$/, "");
    });
    for (const path of manifest.changed) {
      if (
        !scopes.some(
          (scope) => !scope || path === scope || path.startsWith(`${scope}/`),
        )
      )
        throw new Error(
          `${task.title} changed ${path} outside its assignment. Its worktree was kept; retry with corrected scope or cancel it.`,
        );
      if (
        (manifest.after[path] && manifest.after[path].kind !== "file") ||
        (manifest.baseline[path] && manifest.baseline[path].kind !== "file")
      )
        throw new Error(
          `Cannot safely capture ${path}: unsupported file type or size. Its worktree was kept.`,
        );
    }
  }
  private exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    const before = this.tails.get(id) ?? Promise.resolve();
    const result = before.catch(() => undefined).then(async () => {
      await this.recoverCleanup(id);
      return action();
    });
    this.tails.set(id, result);
    void result
      .finally(() => {
        if (this.tails.get(id) === result) this.tails.delete(id);
      })
      .catch(() => undefined);
    return result;
  }
  private async verifyTree(manifest: Manifest) {
    const listed = await hostWorktrees(manifest.leadCwd);
    const tree = listed.worktrees.find(
      (entry) => checkoutPath(entry.path) === checkoutPath(manifest.workerCwd),
    );
    if (
      !tree ||
      tree.missing ||
      tree.isMain ||
      tree.branch !== manifest.branch ||
      tree.head !== manifest.head ||
      (await gitText(manifest.leadCwd, ["rev-parse", "HEAD"])) !== manifest.head
    )
      throw new Error(
        "The worker or lead checkout moved or is missing. Its worktree was kept for manual review.",
      );
    await git(manifest.workerCwd, [
      "diff",
      "--cached",
      "--quiet",
      manifest.head,
    ]).catch(() => {
      throw new Error(
        "This worker changed its Git index. Its worktree was kept for manual review.",
      );
    });
    return tree;
  }

  createWorker(
    run: OrchestrationRun,
    task: OrchestrationTask,
  ): Promise<WorkerPreparation> {
    return this.exclusive(task.sessionId, async () => {
      if (task.workspacePolicy === "shared")
        throw new Error("New Host workers require an isolated checkout");
      const leadCwd = await machineFs.realpath(orchestrationCheckoutCwd(run));
      const branch = branchFor(task);
      let manifest = this.assignment(run, task);
      const listed = await hostWorktrees(leadCwd);
      if (!manifest) {
        if (
          await gitText(leadCwd, [
            "rev-parse",
            "--verify",
            `refs/heads/${branch}`,
          ]).then(
            () => true,
            () => false,
          )
        )
          throw new Error(
            "This temporary worker branch already exists. It was kept.",
          );
        const head = await gitText(leadCwd, ["rev-parse", "HEAD"]);
        const baseline = await seedFiles(
          leadCwd,
          await headFiles(leadCwd, head),
        );
        manifest = {
          version: 1,
          machine: currentMachineIO().key,
          leadId: run.leadId,
          sessionId: task.sessionId,
          taskId: task.id,
          leadCwd,
          workerCwd: machinePath.join(
            listed.defaultRoot,
            `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          ),
          branch,
          head,
          seeded: false,
          baseline,
        };
        await this.save(manifest);
      }
      if (!this.preparations.has(task.sessionId))
        this.preparations.set(
          task.sessionId,
          claimCheckoutResource(
            this.store,
            `worker-preparation:${randomUUID()}`,
            manifest.workerCwd,
          ),
        );
      const prepared = manifest;
      return withCheckoutIntegration(
        this.store,
        [prepared.workerCwd],
        async () => {
          let manifest = prepared;
          let tree = listed.worktrees.find((entry) => entry.branch === branch);
          let created = false;
          if (!tree) {
            const existingHead = await gitText(leadCwd, [
              "rev-parse",
              "--verify",
              `refs/heads/${branch}`,
            ]).catch(() => undefined);
            if (existingHead && existingHead !== manifest.head)
              throw new Error(
                "This temporary worker branch moved. It was kept.",
              );
            if (
              (await gitText(leadCwd, ["rev-parse", "HEAD"])) !== manifest.head
            )
              throw new Error(
                "The lead checkout moved. Its worker checkpoint was kept.",
              );
            tree = await createHostWorktree(
              leadCwd,
              branch,
              "HEAD",
              !!existingHead,
              leadCwd,
            );
            created = true;
          }
          if (checkoutPath(tree.path) !== checkoutPath(manifest.workerCwd))
            throw new Error(
              "This temporary branch has another worktree. It was kept.",
            );
          manifest.workerCwd = tree.path;
          await this.verifyTree(manifest);
          const current = await scan(tree.path, undefined, manifest.baseline);
          if (!manifest.seeded) {
            if (!manifest.pristine) {
              if (!created)
                throw new Error(
                  "Worker creation was interrupted before its pristine checkout was captured. Its worktree was kept for manual review.",
                );
              // Git filters and autocrlf can make checkout bytes differ from the
              // blob. Capture those actual pristine bytes before any seed write.
              manifest.pristine = Object.fromEntries(
                Object.entries(current).map(([path, state]) => [
                  path,
                  { ...state, bytes: undefined },
                ]),
              );
              await this.save(manifest);
            }
            // Only the pristine HEAD or the recorded seed may exist during a
            // creation retry; never overwrite an unknown partially edited tree.
            for (const path of delta(manifest.baseline, current)) {
              const state = current[path];
              if (!same(state, manifest.pristine[path]))
                throw new Error(
                  `Recovered worker has unexpected changes in ${path}. Its worktree was kept.`,
                );
              await applyState(
                tree.path,
                path,
                manifest.baseline[path],
                leadCwd,
              );
            }
            if (
              delta(
                manifest.baseline,
                await scan(tree.path, undefined, manifest.baseline),
              ).length
            )
              throw new Error(
                "Worker seed could not be verified. Its worktree was kept.",
              );
            manifest.seeded = true;
            await this.save(manifest);
          } else if (manifest.after && delta(manifest.after, current).length) {
            throw new Error(
              "This worker checkout changed after its last captured turn. Inspect it before resuming.",
            );
          } else if (
            !manifest.after &&
            delta(manifest.baseline, current).length
          ) {
            throw new Error(
              "This worker checkout has uncaptured changes. Inspect it before resuming.",
            );
          }
          if (manifest.integrated) {
            const lead = await scan(
              manifest.leadCwd,
              manifest.changed ?? [],
              manifest.after,
            );
            if (
              manifest.changed?.some(
                (path) => !same(lead[path], manifest!.after?.[path]),
              )
            )
              throw new Error(
                "The accepted result changed in the lead checkout. Its worker was kept.",
              );
            // A retained accepted worker starts its correction from the result
            // already integrated, while an interrupted dispatch keeps its seed.
            const baseline = Object.fromEntries(
              Object.entries(current).map(([path, state]) => [
                path,
                same(manifest!.baseline[path], state)
                  ? manifest!.baseline[path]
                  : state,
              ]),
            );
            manifest = {
              ...manifest,
              baseline: compactBaseline(
                baseline,
                await headFiles(tree.path, manifest.head),
              ),
              after: undefined,
              changed: undefined,
              integrated: false,
            };
            await this.save(manifest);
          }
          const scratchDir = join(this.dir(task.sessionId), "scratch");
          await mkdir(scratchDir, { recursive: true, mode: 0o700 });
          return {
            scratchDir: await currentMachineIO().hostPath(scratchDir),
            workspace: workspaceIdentity(
              orchestrationProjectCwd(run),
              tree.path,
              branch,
            ),
          };
        },
      );
    });
  }

  captureWorker(
    run: OrchestrationRun,
    task: OrchestrationTask,
  ): Promise<{ files: string[] }> {
    return this.exclusive(task.sessionId, async () => {
      const manifest = this.assignment(run, task);
      if (!manifest || !manifest.seeded)
        throw new Error("This worker has no recoverable change checkpoint");
      return withCheckoutIntegration(
        this.store,
        [manifest.workerCwd],
        async () => {
          await this.verifyTree(manifest);
          const after = await scan(
            manifest.workerCwd,
            undefined,
            manifest.baseline,
          );
          const changed = delta(manifest.baseline, after);
          // Save all hashes to detect otherwise unreported changes before review.
          const captured = Object.fromEntries(
            Object.entries(after).map(([path, state]) => [
              path,
              changed.includes(path)
                ? state
                : {
                    ...state,
                    bytes: undefined,
                    blob: manifest.baseline[path]?.blob,
                  },
            ]),
          );
          const capturedManifest = {
            ...manifest,
            after: captured,
            changed,
            integrated: false,
          };
          await this.save(capturedManifest);
          // Keep even a scope-violating turn recoverable so an explicit retry can
          // correct its assignment without overwriting or orphaning partial work.
          this.validateChanges(task, capturedManifest);
          return { files: changed };
        },
      );
    });
  }

  integrateWorker(
    run: OrchestrationRun,
    task: OrchestrationTask,
  ): Promise<{ files: string[]; alreadyApplied: number }> {
    return this.exclusive(task.sessionId, () => this.apply(run, task));
  }
  private async apply(
    run: OrchestrationRun,
    task: OrchestrationTask,
    removingWorker = false,
  ) {
    const manifest = this.assignment(run, task);
    if (!manifest?.after || !manifest.changed)
      throw new Error("This worker has no completed change checkpoint");
    const paths = removingWorker
      ? [manifest.leadCwd]
      : [manifest.leadCwd, manifest.workerCwd];
    return withCheckoutOwner(this.store, `orchestration:${run.leadId}`, () =>
      withCheckoutIntegration(this.store, paths, () => this.applyReserved(task, manifest)),
    );
  }
  private async applyReserved(task: OrchestrationTask, manifest: Manifest) {
    if (!manifest.after || !manifest.changed)
      throw new Error("This worker has no completed change checkpoint");
    this.validateChanges(task, manifest);
    await this.verifyTree(manifest);
    if (
      delta(
        manifest.after,
        await scan(manifest.workerCwd, undefined, manifest.after),
      ).length
    )
      throw new Error(
        "The worker changed after its captured result. Its worktree was kept.",
      );
    const target = await scan(
      manifest.leadCwd,
      manifest.changed,
      manifest.after,
    );
    let alreadyApplied = 0;
    for (const path of manifest.changed) {
      await assertNoLinks(manifest.leadCwd, path);
      if (same(target[path], manifest.after[path])) alreadyApplied++;
      else if (!same(target[path], manifest.baseline[path]))
        throw new Error(
          `Cannot integrate ${path}: the lead checkout changed since this worker started. Its worktree was kept.`,
        );
    }
    for (const path of manifest.changed)
      if (!same(target[path], manifest.after[path]))
        await applyState(
          manifest.leadCwd,
          path,
          manifest.after[path],
          manifest.workerCwd,
          { state: target[path] },
        );
    await this.save({ ...manifest, integrated: true });
    return { files: manifest.changed, alreadyApplied };
  }

  cleanupWorker(
    run: OrchestrationRun,
    task: OrchestrationTask,
    onlyIfUnchanged: boolean,
  ): Promise<boolean> {
    return this.exclusive(task.sessionId, async () => {
      const manifest = this.assignment(run, task);
      if (!manifest) return !task.workspace;
      this.releasePreparation(task.sessionId);
      return withCheckoutRemoval(this.store, manifest.workerCwd, async () => {
        let worker: HostSession | undefined;
        try {
          worker = this.store.session(task.sessionId);
        } catch {
          /* Failed preparation may not have created a session. */
        }
        if (worker?.status === "running")
          throw new Error("Stop this worker before cleanup");
        const foreign = this.store
          .sessions()
          .find(
            (entry) =>
              projectMachineKey(this.store.project(entry.projectId).machine) === currentMachineIO().key &&
              entry.session.id !== task.sessionId &&
              !entry.session.worktreeRemoved &&
              checkoutPathsOverlap(
                checkoutPath(entry.session.executionCwd || entry.session.cwd),
                checkoutPath(manifest.workerCwd),
              ),
          );
        if (foreign)
          throw new Error(
            "Another conversation uses this worker checkout. It was kept.",
          );
        const listed = await hostWorktrees(manifest.leadCwd);
        const exists = listed.worktrees.some(
          (entry) =>
            checkoutPath(entry.path) === checkoutPath(manifest.workerCwd),
        );
        if (exists) {
          await this.verifyTree(manifest);
          if (onlyIfUnchanged) {
            if (
              delta(
                manifest.baseline,
                await scan(manifest.workerCwd, undefined, manifest.baseline),
              ).length
            )
              return false;
          } else await this.apply(run, task, true);
        } else if (onlyIfUnchanged) return false;
        this.store.transaction(() => {
          this.store.db
            .prepare("INSERT OR REPLACE INTO checkout_cleanup VALUES (?, ?, ?)")
            .run(
              task.sessionId,
              manifest.workerCwd,
              worker ? JSON.stringify(worker) : null,
            );
          if (worker)
            this.store.save(
              {
                ...worker,
                revision: worker.revision + 1,
                session: {
                  ...worker.session,
                  cwd: orchestrationProjectCwd(run),
                  executionCwd: manifest.workerCwd,
                  worktreeRemoved: true,
                  providerSessionId: undefined,
                  branch: undefined,
                  context: undefined,
                },
              },
              { type: "orchestration.checkoutDetached" },
            );
        });
        try {
          if (exists)
            await git(manifest.leadCwd, [
              "worktree",
              "remove",
              "--force",
              "--",
              manifest.workerCwd,
            ]);
        } catch (error) {
          this.store.transaction(() => {
            if (worker)
              this.store.save(
                {
                  ...worker,
                  revision: this.store.session(task.sessionId).revision + 1,
                },
                { type: "orchestration.cleanupFailed" },
              );
            this.store.db
              .prepare("DELETE FROM checkout_cleanup WHERE id=?")
              .run(task.sessionId);
          });
          throw error;
        }
        const ref = `refs/heads/${manifest.branch}`;
        const head = await gitText(manifest.leadCwd, [
          "rev-parse",
          "--verify",
          ref,
        ]).catch(() => undefined);
        if (head && head !== manifest.head)
          throw new Error(
            "The worker branch moved; its branch was kept for manual review",
          );
        if (head)
          await git(manifest.leadCwd, ["update-ref", "-d", ref, manifest.head]);
        this.store.db
          .prepare("DELETE FROM checkout_cleanup WHERE id=?")
          .run(task.sessionId);
        await rm(this.dir(task.sessionId), { recursive: true, force: true });
        return true;
      });
    });
  }
}

