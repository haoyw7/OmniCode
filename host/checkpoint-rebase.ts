import { lstat, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { currentMachineIO, machinePath } from "./machine-io";

type Rewrite = { path: string; before: string; after: string };

async function existsDirectory(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Invalid checkpoint directory");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(contents); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Rewrites only path metadata; snapshot blobs and hidden Git refs keep their identity.
 * The caller holds the checkout move lease and persists its own recovery journal.
 * Replaying the same move is safe: already-rebased metadata needs no rewrite. */
export async function rebaseCheckpointMetadata(
  root: string,
  fromCwd: string,
  toCwd: string,
  sessionIds: readonly string[],
): Promise<() => Promise<void>> {
  const machine = currentMachineIO().key;
  const from = machinePath.resolve(fromCwd);
  const to = machinePath.resolve(toCwd);
  const relocate = (value: unknown): unknown => {
    if (typeof value !== "string" || !machinePath.isAbsolute(value)) return value;
    const relative = machinePath.relative(from, machinePath.resolve(value));
    if (relative === ".." || relative.startsWith(`..${machinePath.sep}`) || machinePath.isAbsolute(relative)) return value;
    return machinePath.resolve(to, relative).replaceAll("\\", "/");
  };
  const rewrites: Rewrite[] = [];
  for (const id of new Set(sessionIds)) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid session id");
    const dir = join(root, id);
    if (!await existsDirectory(dir)) continue;
    const paths = [join(dir, "manifest.json"), join(dir, "turn-review.json")];
    const turns = join(dir, "turns");
    if (await existsDirectory(turns)) {
      for (const entry of await readdir(turns, { withFileTypes: true })) {
        if (!entry.name.endsWith(".json")) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Invalid checkpoint recording");
        paths.push(join(turns, entry.name));
      }
    }
    for (const path of paths) {
      let before: string;
      try {
        const entry = await lstat(path);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Invalid checkpoint recording");
        before = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const value = JSON.parse(before) as Record<string, unknown>;
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.cwd !== "string")
        throw new Error("Invalid checkpoint recording");
      if ((value.machine ?? "local") !== machine) continue;
      const cwd = relocate(value.cwd);
      const repo = relocate(value.repo);
      if (cwd === value.cwd && repo === value.repo) continue;
      const after = JSON.stringify({ ...value, cwd, ...(value.repo === undefined ? {} : { repo }) });
      rewrites.push({ path, before, after });
    }
  }
  const applied: Rewrite[] = [];
  const rollback = async () => {
    for (const entry of [...applied].reverse()) {
      const current = await readFile(entry.path, "utf8");
      if (current === entry.before) continue;
      if (current !== entry.after) throw new Error("Checkpoint changed after the project move; its recording was preserved");
      await atomicWrite(entry.path, entry.before);
    }
  };
  try {
    for (const entry of rewrites) {
      await atomicWrite(entry.path, entry.after);
      applied.push(entry);
    }
  } catch (error) {
    try { await rollback(); }
    catch (recovery) { throw new AggregateError([error, recovery], "Checkpoint move failed and requires recovery"); }
    throw error;
  }
  return rollback;
}
