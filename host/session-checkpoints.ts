import { createHash } from "node:crypto";
import { newUndoId, undoPlanDirectory, saveUndoPlan, readUndoPlan, writeUndoFile, type PreparedCheckpointUndo, type DurableUndoPlan } from "./checkpoint-undo-plan";
export type { PreparedCheckpointUndo } from "./checkpoint-undo-plan";
import { machineExec as exec, machineFs, machinePath, machineEnvironment, currentMachineIO, localMachineIO, withMachineIO, assertLocalMachinePath } from "./machine-io";
import { lstatSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CheckpointFile, CheckpointFileDiff, CheckpointStatus } from "../src/contracts/checkpoint";
import { TurnCheckpoints, type GitCheckpointUndo } from "./turn-checkpoints";
import { rebaseCheckpointMetadata } from "./checkpoint-rebase";
import { workspacePath } from "./workspace";

const MAX_SNAPSHOT_FILES = 500;
/** Same limit as the desktop checkpoint store. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type SnapshotKind = "contents" | "missing" | "skipped";
type ChangeStats = { status: string; additions: number; deletions: number };
type FileState =
  | { kind: "contents"; bytes: Buffer; mode?: number }
  | { kind: "missing" }
  | { kind: "skipped" };

type StoredManifest = {
  turnId?: string;
  multiTurn?: boolean;
  turnComplete?: boolean;
  machine?: string;
  cwd: string;
  files: Record<string, SnapshotKind>;
  touched: string[];
  tracked: string[];
  /** Paths captured before a structured edit started. Only these are safe
   * candidates for Undo. */
  prepared: string[];
  /** Worktree contents immediately after the session's latest edit. */
  after: Record<string, SnapshotKind>;
  /** Stable line counts for the session-owned before/after pair. */
  stats: Record<string, ChangeStats>;
  /** Paths whose contents changed between two edits by this session. */
  diverged: string[];
};

type Manifest = {
  turnId?: string;
  multiTurn?: boolean;
  turnComplete?: boolean;
  machine: string;
  cwd: string;
  files: Map<string, SnapshotKind>;
  touched: Set<string>;
  tracked: Set<string>;
  prepared: Set<string>;
  after: Map<string, SnapshotKind>;
  stats: Map<string, ChangeStats>;
  diverged: Set<string>;
};

type FileUndoEntry = { relative: string; before: "contents" | "missing"; after: "contents" | "missing"; beforeHash?: string; afterHash?: string; beforeMode?: number; afterMode?: number };
type FileCheckpointUndo = { files: FileUndoEntry[] };
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Per-session Keep/Undo checkpoints for conversations the Host runs. It follows
 * the desktop store (src-tauri/src/checkpoint.rs): Git workspaces review the
 * latest turn's snapshots, while folders without Git retain structured-edit
 * checkpoints. Undo refuses to overwrite later or shared changes.
 */
export class SessionCheckpoints {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly turns: TurnCheckpoints;

  constructor(private readonly root: string) {
    this.turns = new TurnCheckpoints(root, (sessionId) => this.sessionDir(sessionId));
  }

  /** Every operation shares one queue: status reads other sessions' claims. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId))
      throw new Error("Invalid session id");
    return join(this.root, sessionId);
  }

  /** Called under the project's move lease, before committing its new path. */
  rebase(fromCwd: string, toCwd: string, sessionIds: readonly string[]): Promise<() => Promise<void>> {
    return this.exclusive(async () => {
      const undo = await rebaseCheckpointMetadata(this.root, fromCwd, toCwd, sessionIds);
      return () => this.exclusive(undo);
    });
  }

  /** Open the session's checkpoint before a turn; it lasts until Keep or Undo. */
  ensure(sessionId: string, cwd: string): Promise<void> {
    return this.exclusive(async () => {
      const root = await projectRoot(cwd);
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (manifest && manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root)) return;
      await rm(dir, { recursive: true, force: true });
      await mkdir(join(dir, "files"), { recursive: true });
      await writeManifest(dir, emptyManifest(root));
    });
  }

  /** Record the workspace before a turn's provider runs. Folders without Git
   * keep structured-edit review instead. */
  beginTurn(sessionId: string, cwd: string, turnId: string): Promise<void> {
    return this.exclusive(async () => {
      if (await this.turns.begin(sessionId, cwd, turnId)) return;
      const root = await projectRoot(cwd);
      const dir = this.sessionDir(sessionId);
      let manifest = await readManifest(dir);
      if (!manifest || manifest.machine !== currentMachineIO().key || !sameCwd(manifest.cwd, root)) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(join(dir, "files"), { recursive: true });
        manifest = emptyManifest(root);
      }
      // Older accumulated snapshots cannot prove a one-turn provider boundary.
      if (manifest.touched.size && manifest.turnId !== turnId) manifest.multiTurn = true;
      manifest.turnId = turnId;
      manifest.turnComplete = false;
      await writeManifest(dir, manifest);
    });
  }

  /** Capture the settled workspace once the turn's provider has stopped. */
  finishTurn(sessionId: string, cwd: string, turnId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.turns.finish(sessionId, cwd, turnId);
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (manifest?.turnId === turnId && manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, await projectRoot(cwd))) {
        manifest.turnComplete = true;
        await writeManifest(dir, manifest);
      }
    });
  }

  /** Capture files immediately before a structured edit starts. Contents are
   * read now, before the provider can write, and recorded in queue order. */
  prepare(sessionId: string, cwd: string, paths: string[]): Promise<void> {
    if (!paths.length) return Promise.resolve();
    const root = machinePath.resolve(cwd);
    const before = new Map<string, FileState | Promise<FileState>>();
    for (const path of paths) {
      const relativePath = relativeTo(root, path);
      if (relativePath && !before.has(relativePath))
        before.set(relativePath, currentMachineIO().key === "local"
          ? readWorktreeSync(root, relativePath) : readWorktree(root, relativePath));
    }
    if (!before.size) return Promise.resolve();
    return this.exclusive(async () => {
      if (await this.turns.has(sessionId, cwd)) return;
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root))) return;
      let dirty = false;
      for (const [relativePath, pendingState] of before) {
        const state = await pendingState;
        // Keep the original pre-edit snapshot across later edits by this
        // session. The first tool-start event owns the safe undo boundary.
        if (manifest.touched.has(relativePath) && manifest.prepared.has(relativePath)) {
          const after = manifest.after.get(relativePath);
          const matches = after
            ? sameState(state, await readBlob(join(dir, "after"), relativePath, after))
            : false;
          if (!matches && !manifest.diverged.has(relativePath)) {
            manifest.diverged.add(relativePath);
            dirty = true;
          }
          continue;
        }
        if (manifest.prepared.has(relativePath)) continue;
        // Upgrade a completion-only claim by starting at this real boundary.
        if (manifest.touched.has(relativePath)) releasePath(manifest, relativePath);
        manifest.files.set(
          relativePath,
          await writeBlob(join(dir, "files"), relativePath, state),
        );
        manifest.prepared.add(relativePath);
        if (await inHead(root, relativePath)) manifest.tracked.add(relativePath);
        dirty = true;
      }
      if (dirty) await writeManifest(dir, manifest);
    });
  }

  /** Record a completed structured edit. */
  capture(sessionId: string, cwd: string, paths: string[]): Promise<void> {
    if (!paths.length) return Promise.resolve();
    return this.exclusive(async () => {
      if (await this.turns.captureEdits(sessionId, cwd, paths)) return;
      const root = await projectRoot(cwd);
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root))) return;
      let dirty = false;
      for (const path of paths) {
        if (manifest.touched.size >= MAX_SNAPSHOT_FILES) break;
        const relativePath = relativeTo(root, path);
        if (!relativePath) continue;
        manifest.touched.add(relativePath);
        const tracked = await inHead(root, relativePath);
        if (tracked) manifest.tracked.add(relativePath);
        const current = await readWorktree(root, relativePath);
        if (!manifest.files.has(relativePath) && current.kind === "missing" && !tracked) {
          // A completion without a matching prepare event is retained for
          // review but is deliberately not undoable.
          manifest.files.set(
            relativePath,
            await writeBlob(join(dir, "files"), relativePath, current),
          );
        }
        manifest.after.set(
          relativePath,
          await writeBlob(join(dir, "after"), relativePath, current),
        );
        const stats = await sessionStats(dir, manifest, relativePath);
        if (stats) manifest.stats.set(relativePath, stats);
        dirty = true;
      }
      if (dirty) await writeManifest(dir, manifest);
    });
  }

  status(sessionId: string, cwd: string, turnId?: string): Promise<CheckpointStatus> {
    return this.exclusive(async () =>
      (await this.turns.status(sessionId, cwd, turnId)) ?? this.currentStatus(sessionId, cwd));
  }

  fileDiff(sessionId: string, cwd: string, input: string, turnId?: string): Promise<CheckpointFileDiff> {
    return this.exclusive(async () => {
      const recorded = await this.turns.fileDiff(sessionId, cwd, input, turnId);
      if (recorded) return recorded;
      const root = await projectRoot(cwd);
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root)))
        throw new Error("Session changes are no longer available");
      const relativePath = relativeTo(root, input);
      if (!relativePath || !manifest.touched.has(relativePath) || !manifest.prepared.has(relativePath))
        throw new Error("This file was not changed by the session");
      if (manifest.diverged.has(relativePath))
        throw new Error(
          "Exact lines are unavailable because the file changed between this session's edits",
        );
      const before = manifest.files.get(relativePath);
      const after = manifest.after.get(relativePath);
      if (!before) throw new Error("Session baseline is unavailable");
      if (!after) throw new Error("Session result is unavailable");
      const original = await readBlob(join(dir, "files"), relativePath, before);
      const current = await readBlob(join(dir, "after"), relativePath, after);
      const tooLarge = original.kind === "skipped" || current.kind === "skipped";
      const binary = isBinary(original) || isBinary(current);
      return {
        path: clientPath(root, relativePath),
        relative: relativePath,
        status: manifest.stats.get(relativePath)?.status ?? "modified",
        // Match the CR-insensitive line counts: an editor rewriting LF as CRLF
        // must not turn a small edit into a whole-file replacement.
        original: binary || tooLarge ? "" : lfText(original),
        current: binary || tooLarge ? "" : lfText(current),
        binary,
        tooLarge,
      };
    });
  }

  async undo(sessionId: string, cwd: string, input?: string): Promise<CheckpointStatus> {
    return this.applyUndo(await this.prepareUndo(sessionId, cwd, input));
  }

  prepareUndo(sessionId: string, cwd: string, input?: string): Promise<PreparedCheckpointUndo> {
    return this.exclusive(async () => {
      const git = await this.turns.prepareUndo(sessionId, cwd, input);
      const root = git?.cwd ?? await projectRoot(cwd);
      const id = newUndoId();
      const directory = undoPlanDirectory(this.root, sessionId, id);
      if (git) {
        const prepared = { id, sessionId, cwd: root, turnId: git.turnId, paths: git.changes.map(change => change.relative) };
        await saveUndoPlan(directory, { version: 1, kind: "git", machine: currentMachineIO().key, prepared, data: git });
        return prepared;
      }
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (!manifest || manifest.machine !== currentMachineIO().key || !sameCwd(manifest.cwd, root)) throw new Error("No checkpoint is available for this workspace");
      if (!manifest.turnId || manifest.multiTurn || !manifest.turnComplete) throw new Error("This checkpoint has no verified single-turn restoration boundary");
      const status = await this.currentStatus(sessionId, cwd);
      const selected = input === undefined ? status.files : status.files.filter(file => file.relative === relativeTo(root, input));
      if (selected.some(file => !file.undoable)) throw new Error("Cannot safely undo all: one or more files changed outside this session");
      const files: FileUndoEntry[] = [];
      for (const file of selected) {
        if (await pathContainsSymlink(root, file.relative)) throw new Error(`Cannot write through symbolic link ${file.relative}`);
        const beforeKind = manifest.files.get(file.relative), afterKind = manifest.after.get(file.relative);
        if (!beforeKind || !afterKind || beforeKind === "skipped" || afterKind === "skipped") throw new Error("Checkpoint snapshot is incomplete");
        const before = await readBlob(join(dir, "files"), file.relative, beforeKind);
        const after = await readBlob(join(dir, "after"), file.relative, afterKind);
        if (before.kind !== beforeKind || after.kind !== afterKind) throw new Error("Checkpoint snapshot is missing; its recording was preserved");
        const entry: FileUndoEntry = { relative: file.relative, before: beforeKind, after: afterKind };
        for (const [side, value] of [["before", before], ["after", after]] as const) {
          if (value.kind !== "contents") continue;
          if (value.bytes.length > MAX_FILE_BYTES) throw new Error("Checkpoint snapshot exceeds the non-Git file limit");
          entry[`${side}Hash`] = digest(value.bytes); entry[`${side}Mode`] = value.mode;
          await writeUndoFile(join(directory, side, String(files.length)), value.bytes);
        }
        if (!exactState(await readWorktree(root, file.relative), after)) throw new Error("Cannot safely undo: a recorded file changed after the checkpoint");
        files.push(entry);
      }
      const prepared = { id, sessionId, cwd: root, turnId: manifest.turnId, paths: files.map(file => file.relative) };
      await saveUndoPlan(directory, { version: 1, kind: "files", machine: currentMachineIO().key, prepared, data: { files } });
      return prepared;
    });
  }

  applyUndo(prepared: PreparedCheckpointUndo): Promise<CheckpointStatus> {
    return this.exclusive(async () => {
      const plan = await readUndoPlan(this.root, prepared);
      if (plan.machine !== currentMachineIO().key) throw new Error("Checkpoint belongs to a different machine");
      if (plan.completed) return plan.completed;
      let result: CheckpointStatus;
      if (plan.kind === "git") result = await this.turns.applyUndo(prepared.sessionId, prepared.cwd, plan.data as GitCheckpointUndo);
      else result = await this.applyFileUndo(plan as DurableUndoPlan<FileCheckpointUndo>);
      plan.completed = result;
      await saveUndoPlan(undoPlanDirectory(this.root, prepared.sessionId, prepared.id), plan);
      return result;
    });
  }

  private async applyFileUndo(plan: DurableUndoPlan<FileCheckpointUndo>): Promise<CheckpointStatus> {
    const { prepared, data } = plan;
    const root = await projectRoot(prepared.cwd);
    const directory = undoPlanDirectory(this.root, prepared.sessionId, prepared.id);
    const dir = this.sessionDir(prepared.sessionId);
    const manifest = await readManifest(dir);
    if (!manifest || manifest.turnId !== prepared.turnId || manifest.multiTurn || !manifest.turnComplete || manifest.machine !== plan.machine || !sameCwd(manifest.cwd, root))
      throw new Error("Checkpoint restoration boundary changed");
    const foreign = await this.foreignTouched(root, prepared.sessionId);
    const saved = async (entry: FileUndoEntry, index: number, side: "before" | "after"): Promise<FileState> => {
      if (entry[side] === "missing") return { kind: "missing" };
      const bytes = await readFile(join(directory, side, String(index)));
      if (digest(bytes) !== entry[`${side}Hash`]) throw new Error("Checkpoint restoration snapshot is corrupt");
      return { kind: "contents", bytes, mode: entry[`${side}Mode`] };
    };
    const state = async (entry: FileUndoEntry, index: number) => {
      if (relativeTo(root, entry.relative) !== entry.relative || foreign.has(entry.relative) || await pathContainsSymlink(root, entry.relative)) throw new Error("Cannot safely undo a shared or symbolic-link path");
      const current = await readWorktree(root, entry.relative);
      const before = await saved(entry, index, "before");
      const after = await saved(entry, index, "after");
      if (exactState(current, before)) return { restored: true, before };
      if (exactState(current, after)) return { restored: false, before };
      throw new Error("Cannot safely undo: a recorded file changed after the checkpoint");
    };
    for (const [index, entry] of data.files.entries()) await state(entry, index);
    for (const [index, entry] of data.files.entries()) {
      const { restored, before } = await state(entry, index); if (restored) continue;
      const target = machinePath.join(root, ...entry.relative.split("/"));
      if (before.kind === "missing") await machineFs.unlink(target);
      else if (before.kind === "contents") {
        await machineFs.mkdir(machinePath.dirname(target), { recursive: true });
        await machineFs.writeFile(target, before.bytes);
        if (before.mode !== undefined && currentMachineIO().pathStyle !== "win32") await machineFs.chmod(target, before.mode);
      }
      if (!(await state(entry, index)).restored) throw new Error("Checkpoint restoration did not write the recorded baseline");
    }
    for (const entry of data.files) releasePath(manifest, entry.relative);
    await writeManifest(dir, manifest);
    return this.currentStatus(prepared.sessionId, prepared.cwd);
  }

  /** Remove a finished restoration plan's private snapshot copies. */
  discardUndo(prepared: PreparedCheckpointUndo): Promise<void> {
    return this.exclusive(() => rm(undoPlanDirectory(this.root, prepared.sessionId, prepared.id), { recursive: true, force: true }));
  }

  keep(sessionId: string, cwd: string, input?: string): Promise<CheckpointStatus> {
    return this.exclusive(async () => {
      const recorded = await this.turns.keep(sessionId, cwd, input);
      if (recorded) return recorded;
      const root = await projectRoot(cwd);
      const dir = this.sessionDir(sessionId);
      const manifest = await readManifest(dir);
      if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root))) return { files: [] };
      if (input === undefined) {
        await rm(dir, { recursive: true, force: true });
        return { files: [] };
      }
      const relativePath = relativeTo(root, input);
      if (!relativePath) throw new Error("Invalid workspace path");
      releasePath(manifest, relativePath);
      await writeManifest(dir, manifest);
      return this.currentStatus(sessionId, cwd);
    });
  }

  forget(sessionId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.turns.forget(sessionId).catch(() => undefined);
      await rm(this.sessionDir(sessionId), { recursive: true, force: true });
    });
  }

  private async currentStatus(sessionId: string, cwd: string): Promise<CheckpointStatus> {
    const root = await projectRoot(cwd);
    const dir = this.sessionDir(sessionId);
    const manifest = await readManifest(dir);
    if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root))) return { files: [] };
    const foreign = await this.foreignTouched(root, sessionId);
    const dirty = await gitDirty(root);
    const files: CheckpointFile[] = [];
    for (const relativePath of [...manifest.touched].sort()) {
      // Without a tool-start snapshot there is no trustworthy session
      // boundary. Never guess from the shared working tree.
      if (!manifest.prepared.has(relativePath)) continue;
      const before = manifest.files.get(relativePath);
      const after = manifest.after.get(relativePath);
      if (before && after && sameState(
        await readBlob(join(dir, "files"), relativePath, before),
        await readBlob(join(dir, "after"), relativePath, after),
      )) continue;
      if (!(await fileDiffers(dir, root, manifest, relativePath, dirty))) continue;
      const exact = !manifest.diverged.has(relativePath);
      const undoable = exact && !foreign.has(relativePath) &&
        (await afterMatchesWorktree(dir, root, manifest, relativePath));
      const stats = manifest.stats.get(relativePath);
      files.push({
        path: clientPath(root, relativePath),
        relative: relativePath,
        status: stats?.status ?? changeStatus(before, after),
        additions: exact ? stats?.additions ?? 0 : 0,
        deletions: exact ? stats?.deletions ?? 0 : 0,
        exact,
        undoable,
      });
    }
    if (!files.length) return { files };
    // Snapshots accumulated across turns, or an unfinished turn, cannot prove
    // which provider turn wrote them. Review stays available; Undo does not.
    if (manifest.turnId && !manifest.multiTurn && manifest.turnComplete) return { files, turnId: manifest.turnId };
    return { files, undoUnavailableReason: manifest.multiTurn
      ? "These changes span several conversation turns without a verified boundary. Workspace files were not changed."
      : "This checkpoint has no verified conversation turn boundary. Workspace files were not changed." };
  }

  /** Paths already claimed by another session in the same checkout. */
  private async foreignTouched(root: string, except: string): Promise<Set<string>> {
    const paths = new Set<string>();
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === except) continue;
      const manifest = await readManifest(join(this.root, entry.name)).catch(() => undefined);
      if (!manifest || !(manifest.machine === currentMachineIO().key && sameCwd(manifest.cwd, root))) continue;
      for (const path of manifest.touched)
        if (manifest.prepared.has(path)) paths.add(path);
    }
    return paths;
  }
}

function emptyManifest(cwd: string): Manifest {
  return {
    cwd,
    machine: currentMachineIO().key,
    files: new Map(),
    touched: new Set(),
    tracked: new Set(),
    prepared: new Set(),
    after: new Map(),
    stats: new Map(),
    diverged: new Set(),
  };
}

function releasePath(manifest: Manifest, path: string) {
  manifest.files.delete(path);
  manifest.touched.delete(path);
  manifest.tracked.delete(path);
  manifest.prepared.delete(path);
  manifest.after.delete(path);
  manifest.stats.delete(path);
  manifest.diverged.delete(path);
}

async function readManifest(dir: string): Promise<Manifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "manifest.json"), "utf8");
  } catch {
    return undefined;
  }
  const value = JSON.parse(raw) as StoredManifest;
  return {
    cwd: value.cwd,
    turnId: value.turnId, multiTurn: value.multiTurn, turnComplete: value.turnComplete,
    machine: value.machine ?? "local",
    files: new Map(Object.entries(value.files ?? {})),
    touched: new Set(value.touched ?? []),
    tracked: new Set(value.tracked ?? []),
    prepared: new Set(value.prepared ?? []),
    after: new Map(Object.entries(value.after ?? {})),
    stats: new Map(Object.entries(value.stats ?? {})),
    diverged: new Set(value.diverged ?? []),
  };
}

async function writeManifest(dir: string, manifest: Manifest) {
  const value: StoredManifest = {
    cwd: manifest.cwd,
    turnId: manifest.turnId, multiTurn: manifest.multiTurn, turnComplete: manifest.turnComplete,
    machine: manifest.machine,
    files: Object.fromEntries(manifest.files),
    touched: [...manifest.touched],
    tracked: [...manifest.tracked],
    prepared: [...manifest.prepared],
    after: Object.fromEntries(manifest.after),
    stats: Object.fromEntries(manifest.stats),
    diverged: [...manifest.diverged],
  };
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, "manifest.json.tmp");
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, join(dir, "manifest.json"));
}

async function projectRoot(cwd: string): Promise<string> {
  const trimmed = cwd.trim();
  if (!trimmed || trimmed === "~") throw new Error("cwd is required");
  const root = machinePath.resolve(trimmed);
  if (!(await machineFs.stat(root).catch(() => undefined))?.isDirectory())
    throw new Error(`${root}: Not a directory`);
  return root;
}

function sameCwd(saved: string, root: string): boolean {
  return machinePath.resolve(saved) === root;
}

/** A tool's path relative to the checkout, or undefined outside it. */
function relativeTo(root: string, path: string): string | undefined {
  if (typeof path !== "string" || !path.trim()) return undefined;
  try {
    const absolute = workspacePath(root, path.trim());
    return machinePath.relative(root, absolute).split(machinePath.sep).join("/");
  } catch {
    return undefined;
  }
}

function clientPath(root: string, relativePath: string): string {
  return machinePath.join(root, relativePath).split(machinePath.sep).join("/");
}

function blobPath(blobRoot: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => !part || part === "..")
  )
    throw new Error("Invalid path");
  return join(blobRoot, ...relativePath.split("/"));
}

function readWorktreeSync(root: string, relativePath: string): FileState {
  const path = machinePath.join(root, ...relativePath.split("/"));
  assertLocalMachinePath(root);
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES)
      return { kind: "skipped" };
    return { kind: "contents", bytes: readFileSync(path), mode: info.mode & 0o777 };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "skipped" };
  }
}

async function readWorktree(root: string, relativePath: string): Promise<FileState> {
  const path = machinePath.join(root, ...relativePath.split("/"));
  try {
    const info = await machineFs.lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE_BYTES)
      return { kind: "skipped" };
    return { kind: "contents", bytes: await machineFs.readFile(path), mode: info.mode & 0o777 };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "skipped" };
  }
}

async function writeBlob(
  blobRoot: string,
  relativePath: string,
  state: FileState,
): Promise<SnapshotKind> {
  if (state.kind === "skipped") return "skipped";
  const path = blobPath(blobRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  // A missing file keeps an empty blob so line counts compare against nothing.
  await writeFile(path, state.kind === "contents" ? state.bytes : Buffer.alloc(0));
  if (state.kind === "contents" && state.mode !== undefined && process.platform !== "win32")
    await chmod(path, state.mode);
  // A Windows metadata directory cannot preserve a Linux executable bit in
  // its own file mode. Keep that small piece of snapshot metadata separately.
  if (state.kind === "contents" && state.mode !== undefined &&
    currentMachineIO().pathStyle !== localMachineIO.pathStyle) {
    const modePath = blobPath(`${blobRoot}.modes`, `${relativePath}.json`);
    await mkdir(dirname(modePath), { recursive: true });
    await writeFile(modePath, JSON.stringify(state.mode));
  }
  return state.kind;
}

async function readBlob(
  blobRoot: string,
  relativePath: string,
  kind: SnapshotKind,
): Promise<FileState> {
  if (kind === "missing") return { kind: "missing" };
  if (kind === "skipped") return { kind: "skipped" };
  const path = blobPath(blobRoot, relativePath);
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    const storedMode = await readFile(blobPath(`${blobRoot}.modes`, `${relativePath}.json`), "utf8")
      .then((value) => JSON.parse(value) as unknown, () => undefined);
    const mode = typeof storedMode === "number" && Number.isInteger(storedMode)
      ? storedMode & 0o777 : info.mode & 0o777;
    return { kind: "contents", bytes, mode };
  } catch {
    return { kind: "missing" };
  }
}

function exactState(left: FileState, right: FileState): boolean {
  return sameState(left, right) && (left.kind !== "contents" || right.kind !== "contents" || currentMachineIO().pathStyle === "win32" || left.mode === right.mode);
}

function sameState(left: FileState, right: FileState): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind !== "contents" || left.bytes.equals((right as typeof left).bytes);
}

function isBinary(state: FileState): boolean {
  return state.kind === "contents" && state.bytes.includes(0);
}

function text(state: FileState): string {
  return state.kind === "contents" ? state.bytes.toString("utf8") : "";
}

function lfText(state: FileState): string {
  return text(state).replace(/\r\n/g, "\n");
}

function changeStatus(before?: SnapshotKind, after?: SnapshotKind): string {
  if (before === "missing" && after !== "missing") return "added";
  if (before !== "missing" && after === "missing") return "deleted";
  return "modified";
}

async function afterMatchesWorktree(
  dir: string,
  root: string,
  manifest: Manifest,
  relativePath: string,
): Promise<boolean> {
  const kind = manifest.after.get(relativePath);
  if (!kind) return false;
  return sameState(
    await readWorktree(root, relativePath),
    await readBlob(join(dir, "after"), relativePath, kind),
  );
}

async function fileDiffers(
  dir: string,
  root: string,
  manifest: Manifest,
  relativePath: string,
  dirty: Set<string>,
): Promise<boolean> {
  // Once a tracked path is clean against HEAD, its session change was
  // committed (or otherwise resolved) and no longer needs review.
  if (
    !dirty.has(relativePath) &&
    (manifest.tracked.has(relativePath) || (await inHead(root, relativePath)))
  )
    return false;
  const kind = manifest.files.get(relativePath);
  if (kind === "skipped") return false;
  if (kind)
    return !sameState(
      await readWorktree(root, relativePath),
      await readBlob(join(dir, "files"), relativePath, kind),
    );
  return dirty.has(relativePath);
}

async function sessionStats(
  dir: string,
  manifest: Manifest,
  relativePath: string,
): Promise<ChangeStats | undefined> {
  const before = manifest.files.get(relativePath);
  const after = manifest.after.get(relativePath);
  if (!before || !after || before === "skipped" || after === "skipped") return undefined;
  const counts = await withMachineIO(localMachineIO, () => numstat(
    blobPath(join(dir, "files"), relativePath),
    blobPath(join(dir, "after"), relativePath),
    dir,
  ));
  if (!counts) return undefined;
  return { status: changeStatus(before, after), ...counts };
}

async function git(root: string, args: string[]): Promise<string> {
  return (
    await exec("git", ["-c", "core.pager=cat", ...args], {
      cwd: root,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      env: { ...machineEnvironment(), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    })
  ).stdout;
}

async function numstat(
  before: string,
  after: string,
  cwd: string,
): Promise<{ additions: number; deletions: number } | undefined> {
  let output: string;
  try {
    // Line-ending-only edits are not counted; fileDiff hides them as well.
    output = await git(cwd, ["diff", "--no-index", "--no-ext-diff", "--ignore-cr-at-eol", "--numstat", "--", before, after]);
  } catch (error) {
    // `git diff --no-index` exits 1 when the files differ.
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 1 || typeof failure.stdout !== "string") return undefined;
    output = failure.stdout;
  }
  const match = /^(\d+)\t(\d+)\t/.exec(output);
  if (!match) return output.trim() ? undefined : { additions: 0, deletions: 0 };
  return { additions: Number(match[1]), deletions: Number(match[2]) };
}

async function inHead(root: string, relativePath: string): Promise<boolean> {
  return git(root, ["cat-file", "-e", `HEAD:./${relativePath}`]).then(
    () => true,
    () => false,
  );
}

/** Checkout-relative paths that differ from HEAD or are untracked. */
async function gitDirty(root: string): Promise<Set<string>> {
  const paths = new Set<string>();
  let prefix: string;
  let output: string;
  try {
    [prefix, output] = await Promise.all([
      git(root, ["rev-parse", "--show-prefix"]),
      git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]),
    ]);
  } catch {
    return paths;
  }
  prefix = prefix.trim();
  const parts = output.split("\0");
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (!item || item.length < 4) continue;
    const code = item.slice(0, 2);
    // Porcelain paths are relative to the repository root.
    const path = item.slice(3);
    if (code.includes("R") || code.includes("C")) index++;
    if (path.startsWith(prefix)) paths.add(path.slice(prefix.length));
  }
  return paths;
}

async function pathContainsSymlink(root: string, relativePath: string): Promise<boolean> {
  let current = root;
  for (const part of relativePath.split("/")) {
    current = machinePath.join(current, part);
    try {
      if ((await machineFs.lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }
  return false;
}



