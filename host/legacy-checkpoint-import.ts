import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const MAX_BYTES = 8 * 1024 * 1024;

/** Desktop and Host use the same contents/missing/skipped manifests and hidden
 * Git refs. Copy the recording once, never mutate the desktop rollback source. */
export function importDesktopCheckpoints(sourceRoot: string, destinationRoot: string, sessionIds: readonly string[]): number {
  if (!existsSync(sourceRoot)) return 0;
  if (lstatSync(sourceRoot).isSymbolicLink()) throw new Error("Legacy checkpoint directory is a symbolic link; the original recordings were preserved");
  let imported = 0;
  const receiptRoot = join(destinationRoot, ".desktop-imports", createHash("sha256").update(sourceRoot).digest("hex"));
  for (const id of new Set(sessionIds)) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) continue;
    const source = join(sourceRoot, id);
    const destination = join(destinationRoot, id);
    const receipt = join(receiptRoot, id);
    if (!existsSync(source) || existsSync(receipt)) continue;
    const acknowledge = () => {
      mkdirSync(receiptRoot, { recursive: true });
      writeFileSync(receipt, "1", { mode: 0o600 });
    };
    if (existsSync(destination)) { acknowledge(); continue; }
    const validate = (path: string, relative: string) => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error(`Legacy checkpoint ${id} cannot be imported safely; the original recording was preserved`);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(path)) validate(join(path, entry), relative ? `${relative}/${entry}` : entry);
        return;
      }
      if (stat.size > MAX_BYTES) throw new Error(`Legacy checkpoint ${id} exceeds the supported snapshot size; the original recording was preserved`);
      if (relative === "manifest.json" || relative === "turn-review.json" || /^turns\/[^/]+\.json$/.test(relative)) {
        let record: unknown;
        try { record = JSON.parse(readFileSync(path, "utf8")); }
        catch { throw new Error(`Legacy checkpoint ${id} has invalid metadata; the original recording was preserved`); }
        if (!record || typeof record !== "object" || typeof (record as { cwd?: unknown }).cwd !== "string")
          throw new Error(`Legacy checkpoint ${id} has unsupported metadata; the original recording was preserved`);
      }
    };
    validate(source, "");
    if (!existsSync(join(source, "manifest.json")) && !existsSync(join(source, "turn-review.json")))
      throw new Error(`Legacy checkpoint ${id} has no readable manifest; the original recording was preserved`);
    mkdirSync(destinationRoot, { recursive: true });
    const temporary = join(destinationRoot, `.desktop-import-${randomUUID()}`);
    try {
      cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false, dereference: false });
      // The Host may have begun a new turn during bootstrap. Its own recording
      // wins; retain the legacy source rather than replacing active state.
      if (existsSync(destination)) { acknowledge(); continue; }
      renameSync(temporary, destination);
      acknowledge();
      imported++;
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  return imported;
}
