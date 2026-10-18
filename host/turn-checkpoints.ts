import { machineExec, machineFs, machinePath, machineEnvironment, currentMachineIO } from "./machine-io";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CheckpointFile,
  CheckpointFileDiff,
  CheckpointStatus,
} from "../src/features/sessions/model/checkpoint";

/** Same limit as the desktop checkpoint store. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Git-backed recordings of workspace changes during a turn, following the
 * desktop store (src-tauri/src/checkpoint/turn.rs). Snapshots record what
 * changed in the workspace, including shell writes. Shared turns expose the
 * complete recording with Undo disabled, without claiming per-session ownership.
 */
type RecordedTurn = {
  id: string;
  before: string | null;
  after: string | null;
  head: string | null;
  shared: boolean;
  error: string | null;
  dismissed: string[];
  /** Files reported by this session's successful structured edit tools. */
  edited: string[];
};

type TurnReview = {
  machine?: string;
  cwd: string;
  repo: string;
  active: RecordedTurn | null;
  latest: RecordedTurn | null;
};

type Blob = { mode: string; oid: string };

type Change = {
  relative: string;
  before?: Blob;
  after?: Blob;
  status: string;
  additions: number;
  deletions: number;
};

type FileState =
  | { kind: "contents"; bytes: Buffer }
  | { kind: "missing" }
  | { kind: "skipped" };

export class TurnCheckpoints {
  constructor(
    private readonly root: string,
    private readonly sessionDir: (sessionId: string) => string,
  ) {}

  /** Record the workspace before a turn. Returns false outside Git, where the
   * caller keeps structured-edit review instead. */
  async begin(sessionId: string, cwd: string, id: string): Promise<boolean> {
    validateId(id, "turn");
    const root = await canonicalRoot(cwd);
    const dir = this.sessionDir(sessionId);
    let discovered: string | undefined;
    let discoverError: string | undefined;
    try {
      discovered = (await runGit(root, ["rev-parse", "--show-toplevel"])).toString("utf8");
    } catch (error) {
      discoverError = message(error);
    }
    let review = await readReview(dir);
    if (discoverError?.includes("not a git repository") && !review) return false;
    if (review && (review.cwd !== clientPath(root) || (review.machine ?? "local") !== currentMachineIO().key)) review = undefined;
    review ??= { machine: currentMachineIO().key, cwd: clientPath(root), repo: "", active: null, latest: null };
    const pending = review.active && review.active.before && !review.active.error
      ? review.active
      : undefined;
    if (pending) {
      // An interrupted turn may already have written files. Continue from its
      // original boundary.
      await this.finish(sessionId, cwd, pending.id).catch(() => undefined);
      review = (await readReview(dir)) ?? review;
    }
    const turn: RecordedTurn = {
      id,
      before: pending?.before ?? null,
      after: null,
      head: pending
        ? pending.head
        : (await runGit(root, ["rev-parse", "--verify", "HEAD"]).then(
            (bytes) => bytes.toString("utf8").trim(),
            () => null,
          )),
      shared: pending?.shared ?? false,
      error: null,
      dismissed: [],
      edited: pending?.edited ?? [],
    };
    // Publish the pending state first. A failed baseline must not leave the
    // previous turn's card underneath the new response.
    review.active = { ...turn };
    await writeReview(dir, review);
    try {
      if (discoverError) throw new Error(discoverError);
      review.repo = discovered!.replace(/[\r\n]+$/, "");
      // Shared checkouts can include another session's writes. Keep the
      // recorded diff exact, but never offer to restore those turns.
      for (const [otherDir, other] of await this.activeTurns(root, sessionId)) {
        turn.shared = true;
        if (other.active) other.active.shared = true;
        await writeReview(otherDir, other);
      }
      const reference = turnRef(sessionId, id, "before");
      if (turn.before) {
        await runGit(root, ["update-ref", reference, turn.before]);
      } else {
        turn.before = await captureWorkspace(root, reference);
      }
    } catch (error) {
      turn.error = message(error);
    }
    review.active = turn;
    await writeReview(dir, review);
    if (turn.error) throw new Error(turn.error);
    return true;
  }

  async finish(sessionId: string, cwd: string, id: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    const review = await this.matching(sessionId, cwd);
    const turn = review?.active;
    if (!review || !turn || turn.id !== id) return;
    review.active = null;
    if (turn.before) {
      try {
        turn.after = await captureWorkspace(review.cwd, turnRef(sessionId, id, "after"));
      } catch (error) {
        turn.error = message(error);
      }
    }
    await writeJson(join(dir, "turns", `${id}.json`), { machine: review.machine, cwd: review.cwd, repo: review.repo, turn });
    review.latest = turn;
    await writeReview(dir, review);
    if (turn.error) throw new Error(turn.error);
  }

  async has(sessionId: string, cwd: string): Promise<boolean> {
    return !!(await this.matching(sessionId, cwd));
  }

  /** Record successful structured edits as attribution evidence. Returns
   * whether this session uses turn review at all. */
  async captureEdits(sessionId: string, cwd: string, paths: string[]): Promise<boolean> {
    const review = await this.matching(sessionId, cwd);
    if (!review) return false;
    // Late tool events must not change the last completed turn.
    if (!review.active) return true;
    const workspace = machinePath.resolve(cwd.trim());
    const edited = new Set(review.active.edited);
    for (const path of paths) {
      const relativePath = resolveEditPath(workspace, review.cwd, path);
      if (relativePath) edited.add(relativePath);
    }
    if (edited.size !== review.active.edited.length) {
      review.active.edited = [...edited];
      await writeReview(this.sessionDir(sessionId), review);
    }
    return true;
  }

  async status(sessionId: string, cwd: string): Promise<CheckpointStatus | undefined> {
    const review = await this.matching(sessionId, cwd);
    if (!review) return undefined;
    let turn = completedTurn(review);
    const root = review.cwd;
    const head = await runGit(root, ["rev-parse", "--verify", "HEAD"]).then(
      (bytes) => bytes.toString("utf8").trim(),
      () => null,
    );
    const recorded = await changes(root, turn);
    const resolved = await resolvedTurnPaths(root, turn, recorded, head);
    if (resolved.length) {
      // Dismiss accepted work durably so later edits cannot resurrect this
      // turn's card. Its saved snapshots remain available to review.
      review.latest!.dismissed = [...new Set([...review.latest!.dismissed, ...resolved])];
      await writeReview(this.sessionDir(sessionId), review);
      turn = completedTurn(review);
    }
    const canRestore = !turn.shared && head === turn.head &&
      (await this.activeTurns(root, sessionId)).length === 0;
    const dismissed = new Set(turn.dismissed);
    const files: CheckpointFile[] = [];
    for (const change of recorded) {
      if (dismissed.has(change.relative)) continue;
      files.push({
        path: joinClient(root, change.relative),
        relative: change.relative,
        status: change.status,
        additions: change.additions,
        deletions: change.deletions,
        exact: true,
        undoable: canRestore && (await restorable(root, change)),
      });
    }
    return { files, ...(turn.shared ? { workspaceShared: true } : {}) };
  }

  async fileDiff(sessionId: string, cwd: string, input: string): Promise<CheckpointFileDiff | undefined> {
    const review = await this.matching(sessionId, cwd);
    if (!review) return undefined;
    const turn = completedTurn(review);
    const root = review.cwd;
    const relativePath = resolveTurnPath(input);
    const change = (await changes(root, turn)).find((entry) => entry.relative === relativePath);
    if (!change) throw new Error("This file did not change during the recorded turn");
    const original = await readBlob(root, change.before);
    const current = await readBlob(root, change.after);
    const tooLarge = original.kind === "skipped" || current.kind === "skipped";
    const binary = isBinary(original) || isBinary(current);
    return {
      path: joinClient(root, relativePath),
      relative: relativePath,
      status: change.status,
      original: tooLarge || binary ? "" : text(original),
      current: tooLarge || binary ? "" : text(current),
      binary,
      tooLarge,
    };
  }

  async keep(sessionId: string, cwd: string, input?: string): Promise<CheckpointStatus | undefined> {
    const review = await this.matching(sessionId, cwd);
    if (!review) return undefined;
    const recorded = completedTurn(review);
    const dismissed = input !== undefined
      ? [resolveTurnPath(input)]
      : (await changes(review.cwd, recorded)).map((change) => change.relative);
    review.latest!.dismissed = [...new Set([...review.latest!.dismissed, ...dismissed])];
    await writeReview(this.sessionDir(sessionId), review);
    return this.status(sessionId, cwd);
  }

  async undo(sessionId: string, cwd: string, input?: string): Promise<CheckpointStatus | undefined> {
    const review = await this.matching(sessionId, cwd);
    if (!review) return undefined;
    const status = (await this.status(sessionId, cwd))!;
    const root = review.cwd;
    const relativePath = input === undefined ? undefined : resolveTurnPath(input);
    const selected = status.files.filter((file) => relativePath === undefined || file.relative === relativePath);
    if (selected.some((file) => !file.undoable))
      throw new Error("Cannot safely undo this turn: the workspace was shared, the branch moved, or a recorded file changed afterward");
    const turn = completedTurn(review);
    const names = new Set(selected.map((file) => file.relative));
    const restoring = (await changes(root, turn)).filter((change) => names.has(change.relative));
    // Validate all paths again before restoring any, preserving later edits
    // and refusing symlink traversal. The user's Git index is never reset.
    for (const change of restoring)
      if (!(await restorable(root, change)))
        throw new Error("Cannot safely undo: a recorded file changed after the checkpoint");
    for (const change of restoring) {
      if (change.before)
        await runGit(root, ["restore", "--source", turn.before!, "--worktree", "--", change.relative]);
      else await machineFs.unlink(machinePath.join(root, ...change.relative.split("/")));
    }
    return this.keep(sessionId, cwd, relativePath);
  }

  async forget(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    const repos = new Set<string>();
    const review = await readReview(dir);
    if (review && (review.machine ?? "local") !== currentMachineIO().key)
      throw new Error("Checkpoint belongs to a different machine");
    if (review?.repo) repos.add(review.repo);
    for (const entry of await readdir(join(dir, "turns")).catch(() => [])) {
      const saved = JSON.parse(await readFile(join(dir, "turns", entry), "utf8")) as { repo?: string };
      if (saved.repo) repos.add(saved.repo);
    }
    const prefix = `refs/monocode/checkpoints/${sessionId}/`;
    for (const repo of repos) {
      if (!(await machineFs.lstat(repo).catch(() => undefined))?.isDirectory()) continue;
      const refs = (await runGit(repo, ["for-each-ref", "--format=%(refname)", prefix])).toString("utf8");
      for (const reference of refs.split("\n"))
        if (reference.startsWith(prefix)) await runGit(repo, ["update-ref", "-d", reference]);
    }
  }

  private async matching(sessionId: string, cwd: string): Promise<TurnReview | undefined> {
    const review = await readReview(this.sessionDir(sessionId));
    if (!review || (review.machine ?? "local") !== currentMachineIO().key) return undefined;
    return review.cwd === clientPath(await canonicalRoot(cwd)) ? review : undefined;
  }

  private async activeTurns(root: string, except: string): Promise<[string, TurnReview][]> {
    const active: [string, TurnReview][] = [];
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === except) continue;
      const dir = join(this.root, entry.name);
      const review = await readReview(dir).catch(() => undefined);
      if (review?.active && (review.machine ?? "local") === currentMachineIO().key && pathsOverlap(root, review.cwd)) active.push([dir, review]);
    }
    return active;
  }
}

function completedTurn(review: TurnReview): RecordedTurn {
  const turn = review.active ?? review.latest;
  if (!turn) throw new Error("No recorded turn is available");
  if (turn.error) throw new Error(`Could not record workspace changes: ${turn.error}`);
  if (review.active) throw new Error("The turn ended without a final workspace checkpoint");
  if (!turn.before || !turn.after) throw new Error("The turn's workspace checkpoints are incomplete");
  return turn;
}

function turnRef(session: string, turn: string, side: string): string {
  return `refs/monocode/checkpoints/${session}/${turn}/${side}`;
}

function validateId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error(`Invalid ${label} id`);
}

function message(error: unknown): string {
  const stderr = (error as { stderr?: Buffer | string }).stderr;
  const text = stderr ? stderr.toString().trim() : "";
  return text || (error instanceof Error ? error.message : String(error));
}

async function canonicalRoot(cwd: string): Promise<string> {
  const trimmed = cwd.trim();
  if (!trimmed || trimmed === "~") throw new Error("cwd is required");
  return machineFs.realpath(machinePath.resolve(trimmed));
}

function clientPath(path: string): string {
  return path.split(machinePath.sep).join("/");
}

function joinClient(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, "")}/${relativePath}`;
}

function pathsOverlap(left: string, right: string): boolean {
  const within = (parent: string, child: string) => {
    const rel = machinePath.relative(parent, child);
    return rel === "" || isInsidePath(rel);
  };
  return within(left, right) || within(right, left);
}

function isInsidePath(path: string): boolean {
  return !!path && path !== ".." && !path.startsWith(`..${machinePath.sep}`) && !machinePath.isAbsolute(path);
}

// Git's NUL-delimited output already contains literal paths. Never trim them
// or interpret rename notation: those characters can be part of a filename.
function resolveTurnPath(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    machinePath.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") ||
    (machinePath.sep === "\\" && relativePath.includes("\\"))
  )
    throw new Error("Invalid checkpoint path");
  return relativePath;
}

function resolveEditPath(workspace: string, root: string, path: string): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  let candidate = path;
  if (machinePath.isAbsolute(candidate)) {
    const inside = [workspace, root]
      .map((base) => machinePath.relative(base, candidate))
      .find(isInsidePath);
    if (!inside) return undefined;
    candidate = inside;
  }
  try {
    return resolveTurnPath(clientPath(candidate));
  } catch {
    return undefined;
  }
}

async function runGit(root: string, args: string[], env: Record<string, string> = {}): Promise<Buffer> {
  const base = { ...machineEnvironment() };
  // Undefined clears inherited Git overrides in both the native subprocess and
  // the remote environment overlay; a Linux daemon may inherit shell settings.
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) base[name] = undefined;
  const result = await machineExec("git", ["--no-pager", "-C", root, "-c", "core.fsmonitor=false", ...args], {
    cwd: root, windowsHide: true, encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
    env: { ...base, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", LC_ALL: "C", ...env },
  });
  return result.stdout;
}

async function captureWorkspace(root: string, reference: string): Promise<string> {
  const sparse = await runGit(root, ["config", "--bool", "core.sparseCheckout"]).catch(() => Buffer.alloc(0));
  if (sparse.toString("utf8").startsWith("true"))
    throw new Error("Workspace checkpoints are unavailable for sparse checkouts");
  const index = machinePath.join(currentMachineIO().key === "local" ? tmpdir() : "/tmp", `monocode-checkpoint-${randomUUID()}`);
  const env = {
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: "MonoCode",
    GIT_AUTHOR_EMAIL: "checkpoint@monocode.local",
    GIT_COMMITTER_NAME: "MonoCode",
    GIT_COMMITTER_EMAIL: "checkpoint@monocode.local",
  };
  const durable = ["-c", "core.fsync=objects,reference", "-c", "core.fsyncMethod=fsync"];
  const run = (args: string[]) => runGit(root, args, env);
  try {
    const hasHead = await runGit(root, ["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
    await run(hasHead ? ["read-tree", "HEAD"] : ["read-tree", "--empty"]);
    await run([...durable, "add", "-A", "--", "."]);
    const tree = (await run([...durable, "write-tree"])).toString("utf8").trim();
    const commit = (await run([...durable, "commit-tree", tree, "-m", "MonoCode workspace checkpoint"]))
      .toString("utf8").trim();
    await run([...durable, "update-ref", reference, commit]);
    return commit;
  } finally {
    await machineFs.rm(index, { force: true });
    await machineFs.rm(`${index}.lock`, { force: true });
  }
}

async function changes(root: string, turn: RecordedTurn): Promise<Change[]> {
  const before = turn.before, after = turn.after;
  if (!before) throw new Error("Missing turn baseline");
  if (!after) throw new Error("Missing turn result");
  const args = ["diff", "--relative", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-abbrev", "-z"];
  const [raw, numstat] = await Promise.all([
    runGit(root, [...args, "--raw", before, after, "--", "."]),
    runGit(root, [...args, "--numstat", before, after, "--", "."]),
  ]);
  const stats = new Map<string, [number, number]>();
  for (const row of nulFields(numstat)) {
    const first = row.indexOf("\t");
    const second = row.indexOf("\t", first + 1);
    if (first < 0 || second < 0) throw new Error("Invalid checkpoint line counts");
    const count = (value: string) => {
      if (value === "-") return 0;
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) throw new Error("Invalid checkpoint line counts");
      return parsed;
    };
    stats.set(row.slice(second + 1), [count(row.slice(0, first)), count(row.slice(first + 1, second))]);
  }
  const records = nulFields(raw);
  const out: Change[] = [];
  for (let index = 0; index < records.length; index += 2) {
    const header = records[index];
    const path = records[index + 1];
    if (path === undefined) throw new Error("Invalid checkpoint path");
    const fields = header.trim().split(/\s+/);
    if (fields.length !== 5 || !fields[0].startsWith(":")) throw new Error("Invalid checkpoint file status");
    const blob = (mode: string, oid: string): Blob | undefined => (mode === "000000" ? undefined : { mode, oid });
    const counts = stats.get(path);
    if (!counts) throw new Error("Missing checkpoint line counts");
    stats.delete(path);
    out.push({
      relative: path,
      before: blob(fields[0].slice(1), fields[2]),
      after: blob(fields[1], fields[3]),
      status: fields[4] === "A" ? "added" : fields[4] === "D" ? "deleted" : "modified",
      additions: counts[0],
      deletions: counts[1],
    });
  }
  return out.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}

function nulFields(output: Buffer): string[] {
  return output.toString("utf8").split("\0").filter(Boolean);
}

async function resolvedTurnPaths(
  root: string,
  turn: RecordedTurn,
  recorded: Change[],
  head: string | null,
): Promise<string[]> {
  if (!head || head === turn.head) return [];
  const dismissed = new Set(turn.dismissed);
  if (recorded.every((change) => dismissed.has(change.relative))) return [];
  const diff = ["diff", "--relative", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z"];
  const differsFromResult = new Set(nulFields(await runGit(root, [...diff, turn.after!, head, "--", "."])));
  const pending = new Set([
    ...nulFields(await runGit(root, [...diff, head, "--", "."])),
    ...nulFields(await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])),
  ]);
  // A file is resolved when its recorded result is in HEAD, even if someone
  // edited it again, or when it is clean after a commit that included more edits.
  return recorded
    .filter((change) => !dismissed.has(change.relative) &&
      (!differsFromResult.has(change.relative) || !pending.has(change.relative)))
    .map((change) => change.relative);
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

async function restorable(root: string, change: Change): Promise<boolean> {
  if (
    await pathContainsSymlink(root, change.relative) ||
    [change.before, change.after].some((blob) => blob && blob.mode !== "100644" && blob.mode !== "100755")
  )
    return false;
  const info = await machineFs.lstat(machinePath.join(root, ...change.relative.split("/"))).catch(
    (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : undefined),
  );
  if (!change.after) return info === null;
  if (!info?.isFile()) return false;
  const mode = currentMachineIO().pathStyle !== "win32" && info.mode & 0o111 ? "100755" : "100644";
  // Windows has no executable bit; compare contents only there.
  if (currentMachineIO().pathStyle !== "win32" && mode !== change.after.mode) return false;
  const oid = await runGit(root, ["hash-object", `--path=${change.relative}`, "--", change.relative]).then(
    (bytes) => bytes.toString("utf8").trim(),
    () => "",
  );
  return oid === change.after.oid;
}

async function readBlob(root: string, blob: Blob | undefined): Promise<FileState> {
  if (!blob) return { kind: "missing" };
  if (blob.mode === "160000")
    return { kind: "contents", bytes: Buffer.from(`Subproject commit ${blob.oid}\n`) };
  const size = Number((await runGit(root, ["cat-file", "-s", blob.oid])).toString("utf8").trim());
  if (!Number.isFinite(size)) throw new Error("Invalid checkpoint blob size");
  if (size > MAX_FILE_BYTES) return { kind: "skipped" };
  return { kind: "contents", bytes: await runGit(root, ["cat-file", "blob", blob.oid]) };
}

function isBinary(state: FileState): boolean {
  return state.kind === "contents" && state.bytes.includes(0);
}

function text(state: FileState): string {
  return state.kind === "contents" ? state.bytes.toString("utf8") : "";
}

async function readReview(dir: string): Promise<TurnReview | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "turn-review.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const review = JSON.parse(raw) as TurnReview;
  // Older recordings may omit evidence lists; they then claim nothing.
  for (const turn of [review.active, review.latest]) {
    if (!turn) continue;
    turn.dismissed ??= [];
    turn.edited ??= [];
  }
  return review;
}

function writeReview(dir: string, review: TurnReview): Promise<void> {
  return writeJson(join(dir, "turn-review.json"), review);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const file = await open(tmp, "w");
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tmp, path);
}
