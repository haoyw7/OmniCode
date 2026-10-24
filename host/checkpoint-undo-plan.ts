import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CheckpointStatus } from "../src/contracts/checkpoint";

/** Only this descriptor enters the SQLite restoration journal. Blob/tree data
 * stays in an independently durable Host-owned plan. */
export type PreparedCheckpointUndo = { id: string; sessionId: string; cwd: string; turnId: string; paths: string[] };
export type DurableUndoPlan<T = unknown> = { version: 1; prepared: PreparedCheckpointUndo; machine: string; kind: "git" | "files"; data: T; completed?: CheckpointStatus };
export const newUndoId = () => randomUUID();
export function undoPlanDirectory(root: string, sessionId: string, id: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid checkpoint restoration id");
  return join(root, sessionId, "undo-plans", id);
}
export async function writeUndoFile(path: string, bytes: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    // Windows cannot open directories this way. File data is still synced.
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}
export const saveUndoPlan = (directory: string, plan: DurableUndoPlan): Promise<void> => writeUndoFile(join(directory, "plan.json"), JSON.stringify(plan));
export async function readUndoPlan(root: string, prepared: PreparedCheckpointUndo): Promise<DurableUndoPlan> {
  const plan = JSON.parse(await readFile(join(undoPlanDirectory(root, prepared.sessionId, prepared.id), "plan.json"), "utf8")) as DurableUndoPlan;
  if (plan.version !== 1 || JSON.stringify(plan.prepared) !== JSON.stringify(prepared) || !["git", "files"].includes(plan.kind)) throw new Error("Checkpoint restoration plan does not match its journal");
  return plan;
}
